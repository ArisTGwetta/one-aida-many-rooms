import { createSkillRegistry, skillDescriptor } from "./skill-registry.mjs";

const version = 1;
const enterTarget = text => /^(?:aida\s*,\s*)?(?:please\s+)?(?:let['’]s\s+)?(?:enter|return to|go back to|switch to|open project|select project|change project to|resume(?: project)?)\s+(.+?)\s*[.!?]?$/iu
  .exec(text.trim())?.[1].trim().toLowerCase();
const words = value => value.toLowerCase().match(/[\p{L}\p{N}_-]+/gu)?.join(" ") ?? "";
const names = (text, entry) => [entry.id, entry.name].some(name =>
  (" " + words(text) + " ").includes(" " + words(name) + " "));
const targetMatches = (target, entry) => [entry.id, entry.name.toLowerCase()].some(name => target === name || target === "project " + name);
const detail = /^(?:aida\s*,\s*)?(?:please\s+)?(?:what|who|when|where|why|how|which|did|do|does|is|are|was|were|can|could|would|tell me|remind me|show me|recap|summarize|look up)\b/iu;
const request = (id, input) => ({ id, version, input });
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
  return matches.length ? request("find_project", {
    projectId: matches[0].id, operation: target ? "enter" : "lookup", evidence: user.text
  }) : null;
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

export function projectPreview(envelope, awake) {
  const { action, changes } = awake;
  if (action.kind !== "propose_project" || action.uncertainty !== null ||
      !action.sources.includes(envelope.user.source) || !stableId(action.target)) return null;
  const args = Object.fromEntries(action.arguments.map(arg => [arg.name, arg.value]));
  if (Object.keys(args).length !== 2 || !bounded(args.name, 120) || !["fictional", "real"].includes(args.scope)) return null;
  const visible = new Map([...envelope.memory.recent, envelope.user].map(message => [message.source, message]));
  const selected = changes.filter(change => change.scope === "project");
  if (!selected.length || selected.some(change => change.sources.some(ref => !visible.has(ref)))) return null;
  const seed = { long: [], short: [], recent: [], facts: [], insights: [] };
  const evidence = new Map();
  for (const change of selected) {
    if (seed[change.layer].length === 4) return null;
    for (const ref of change.sources) evidence.set(ref, visible.get(ref));
    seed[change.layer].push({ source: change.sources[0], text: change.text, sources: change.sources });
  }
  const entry = { id: action.target, name: args.name.trim(), description: args.name.trim(), status: "active",
    routingSummary: args.name.trim(), scope: args.scope };
  evidence.set(envelope.user.source, envelope.user);
  return { entry, continuity: seed, evidence: [...evidence.values()], authorizationSource: envelope.user.source };
}

export function projectSkills(source) {
  return createSkillRegistry([
    {
      descriptor: skillDescriptor("find_project", version, "read", "Read one project's scoped continuity before answering.", findArgs),
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
        "Propose project creation with grounded changes. A preview requires separate confirmation.", [
          { name: "name", description: "Project name.", required: true, type: "string" },
          { name: "scope", description: "fictional or real.", required: true, type: "string" }
        ]),
      validate: input => input?.phase === "preview" || input?.phase === "confirm",
      authorize: (input, context) => input.phase === "preview" ? Boolean(context.envelope && context.awake) :
        Boolean(context.confirmed && input.preview),
      run: (input, context) => input.phase === "preview" ?
        { preview: projectPreview(context.envelope, context.awake) } : source.createProject(input.preview),
      validateResult: result => result && (result.preview === null || Boolean(result.preview?.entry?.id) ||
        (typeof result.projectId === "string" && typeof result.continuityReference === "string" &&
          typeof result.catalogReference === "string"))
    }
  ]);
}
