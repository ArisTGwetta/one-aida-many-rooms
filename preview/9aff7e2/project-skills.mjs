import { createSkillRegistry, skillDescriptor } from "./skill-registry.mjs";

const version = 1;
const enterTarget = text => /^(?:aida\s*,\s*)?(?:please\s+)?(?:let['’]s\s+)?(?:enter|return to|go back to|switch to|open project|select project|change project to|resume(?: project)?)\s+(.+?)\s*[.!?]?$/iu
  .exec(text.trim())?.[1].trim().toLowerCase();
const words = value => value.toLowerCase().match(/[\p{L}\p{N}_-]+/gu)?.join(" ") ?? "";
const names = (text, entry) => [entry.id, entry.name].some(name =>
  (" " + words(text) + " ").includes(" " + words(name) + " "));
const targetMatches = (target, entry) => [entry.id, entry.name.toLowerCase()].some(name => target === name || target === "project " + name);
const detail = /^(?:aida\s*,\s*)?(?:please\s+)?(?:what|who|when|where|why|how|which|did|do|does|is|are|was|were|can|could|would|tell me|remind me|show me|recap|summarize|look up)\b/iu;
const clarification = "Which project did you mean? Use its project ID.";
const findArgs = [
  { name: "projectId", description: "Registered project ID.", required: true, type: "string" },
  { name: "operation", description: "lookup or enter. Entry requires an explicit room change.", required: true, type: "string" },
  { name: "evidence", description: "Verbatim excerpt from the current user message.", required: true, type: "string" }
];

export function deterministicProjectRequest(user, projects) {
  const target = enterTarget(user.text);
  if (!target && !detail.test(user.text)) return null;
  const matches = projects.filter(entry => target ? targetMatches(target, entry) : names(user.text, entry));
  if (matches.length > 1) throw new Error(clarification);
  return matches.length ? {
    projectId: matches[0].id, operation: target ? "enter" : "lookup", evidence: user.text
  } : null;
}

export function attachProjectResult(context, { operation, project, reference }) {
  return {
    ...context,
    retrievalComplete: true,
    ...(operation === "enter" ? {
      activeProject: project, currentProjectId: project.id, likelyProjectId: project.id,
      projectSelection: { projectId: project.id }
    } : { lookupProject: project }),
    projectRead: { operation, status: operation === "enter" ? "loaded_for_entry" : "looked_up",
      projectId: project.id, reference, sectionCounts: Object.fromEntries(
        Object.entries(project.continuity).map(([layer, entries]) => [layer, entries.length])) },
    references: [...new Set([...context.references, reference])]
  };
}

const stableId = value => typeof value === "string" && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(value);
const bounded = (value, max) => typeof value === "string" && Boolean(value.trim()) && value.length <= max;

function projectPreview(envelope, { projectId, name, scope, evidence: excerpt, entries: selected }) {
  if (!envelope.user.text.includes(excerpt)) throw new Error("Invalid project request evidence.");
  const visible = new Map([...envelope.memory.recent, envelope.user].map(message => [message.source, message]));
  if (!selected.length || selected.some(change => change.sources.some(ref => !visible.has(ref)))) throw new Error("Invalid project continuity source.");
  const seed = { long: [], short: [], recent: [], facts: [], insights: [] };
  const evidence = new Map();
  for (const change of selected) {
    if (seed[change.layer].length === 4) throw new Error("Too many entries for a project continuity section.");
    for (const ref of change.sources) evidence.set(ref, visible.get(ref));
    seed[change.layer].push({ source: change.sources[0], text: change.text, sources: change.sources });
  }
  const entry = { id: projectId, name: name.trim(), description: name.trim(), status: "active",
    routingSummary: name.trim(), scope };
  evidence.set(envelope.user.source, envelope.user);
  return { entry, continuity: seed, evidence: [...evidence.values()], authorizationSource: envelope.user.source };
}

export function projectSkills(source, additionalBindings = []) {
  return createSkillRegistry([
    {
      descriptor: skillDescriptor("find_project", version, "read", "Read one project's scoped continuity before answering.", findArgs),
      available: ({ projects, currentProjectId }) => projects.some(entry => entry.id !== currentProjectId),
      plan: ({ user, context }) => user && deterministicProjectRequest(user, context.projects),
      action: ({ envelope, awake }) => {
        const { action } = awake;
        const current = envelope.context.currentProjectId;
        if (action.kind === "switch_project") return { status: "needs_clarification", route: "project_selection" };
        if (action.kind === "continue_project") return action.target === current && current
          ? { status: "project_continued", projectId: current }
          : { status: "needs_clarification", route: "project_selection" };
      },
      validate: input => input && Object.keys(input).length === 3 &&
        typeof input.projectId === "string" && ["lookup", "enter"].includes(input.operation) &&
        typeof input.evidence === "string" && input.evidence.trim() && input.evidence.length <= 4000,
      authorize: ({ projectId, operation, evidence }, { user, context }) => {
        const entry = context.projects.find(item => item.id === projectId);
        if (!entry || !user.text.includes(evidence)) return false;
        const mentioned = context.projects.filter(item => names(user.text, item));
        if (mentioned.length > 1 || (mentioned.length && mentioned[0].id !== projectId)) throw new Error(clarification);
        if (operation === "lookup") return true;
        const target = enterTarget(evidence);
        if (!targetMatches(target, entry) || !user.text.split(/\r?\n|[.!?](?=\s|$)/u)
          .some(clause => enterTarget(clause) === target)) {
          throw new Error("Explicitly name the project you want to enter.");
        }
        return true;
      },
      async run({ projectId, operation }, { context }) {
        const entry = context.projects.find(item => item.id === projectId);
        const record = await source.project(projectId);
        if (!record.reference) throw new Error("The project continuity record is missing.");
        return { operation, project: { ...entry, continuity: record.continuity }, reference: record.reference };
      },
      integrate(result, context, { track }) {
        const continuity = track("project:" + result.project.id, result.project.continuity);
        return attachProjectResult(context, { ...result, project: { ...result.project, continuity } });
      },
      validateResult: result => ["lookup", "enter"].includes(result?.operation) &&
        typeof result.project?.id === "string" && typeof result.reference === "string" &&
        ["long", "short", "recent", "facts", "insights"].every(layer => Array.isArray(result.project.continuity?.[layer]))
    },
    {
      descriptor: skillDescriptor("create_project", version, "preview",
        "For an explicit request to preserve a named project, propose concise LONG, SHORT and RECENT with exact conversation sources. Preserve fictional scope. Confirmation is separate.", [
          { name: "projectId", description: "Stable project slug.", required: true },
          { name: "name", description: "Project name.", required: true },
          { name: "scope", description: "fictional or real.", required: true },
          { name: "evidence", description: "Verbatim excerpt of the current request.", required: true },
          { name: "entries", description: "Grounded continuity entries.", required: true, schema: {
            type: "array", items: { type: "object", additionalProperties: false, required: ["layer", "text", "sources"],
              properties: { layer: { type: "string", enum: ["long", "short", "recent"] },
                text: { type: "string" }, sources: { type: "array", items: { type: "string" } } } }
          } }
        ]),
      action: ({ awake }) => awake.action.kind === "propose_project"
        ? { status: "unavailable", route: "project_creation", suppressUpdates: true } : null,
      validate: input => input?.phase === "confirm" ? Boolean(input.preview && input.arguments) :
        input && Object.keys(input).length === 5 && stableId(input.projectId) && bounded(input.name, 120) &&
        ["fictional", "real"].includes(input.scope) && bounded(input.evidence, 4000) &&
        Array.isArray(input.entries) && input.entries.length > 0 && input.entries.length <= 12 &&
        input.entries.every(entry => entry && Object.keys(entry).length === 3 &&
          ["long", "short", "recent"].includes(entry.layer) && bounded(entry.text, 400) &&
          Array.isArray(entry.sources) && entry.sources.length > 0 && entry.sources.length <= 4 &&
          new Set(entry.sources).size === entry.sources.length),
      authorize: (input, context) => input.phase === "confirm" ? context.confirmed === true :
        Boolean(context.envelope && context.user.text.includes(input.evidence)),
      run: (input, context) => input.phase === "confirm" ?
        source.createProject(input.preview) : { preview: projectPreview(context.envelope, input) },
      validateResult: result => result && (result.preview === null || Boolean(result.preview?.entry?.id) ||
        (typeof result.projectId === "string" && typeof result.continuityReference === "string" &&
          typeof result.catalogReference === "string"))
    },
    ...additionalBindings
  ]);
}
