import { createDriveClient } from "./memory.mjs";

const layers = ["long", "short", "recent", "facts", "insights"];
const kinds = ["just_keep_talking", "ask_for_help", "continue_project", "switch_project", "propose_project", "request_capability", "discover_capability"];
const reasons = ["meaningful_event", "project_change", "correction", "explicit_request", "threshold"];
const stableId = value => typeof value === "string" && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(value);
const bounded = (value, max) => typeof value === "string" && Boolean(value.trim()) && value.length <= max;
const string = { type: "string" };
const nullable = { type: ["string", "null"] };
const array = items => ({ type: "array", items });
const enumeration = (...values) => ({ type: "string", enum: values });
const object = properties => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
const scope = enumeration("global", "project");
const sources = array(string);
const item = object({ scope, text: string, sources, rationale: string });

export const awakeSchema = object({
  action: object({
    kind: enumeration(...kinds), target: nullable, arguments: array(object({ name: string, value: string })),
    sources, uncertainty: nullable
  }),
  rebuild: { anyOf: [enumeration(...reasons), { type: "null" }] },
  changes: array(object({ ...item.properties, layer: enumeration("long", "short", "recent") })),
  candidates: array(object({ ...item.properties, layer: enumeration("facts", "insights") })),
  contradictions: array(item)
});

export const awakeInstructions = [
  "Return the awake section. Default to just_keep_talking when conversation needs no action.",
  "Use ask_for_help when uncertain. An implied request can propose a capability, but never grants permission.",
  "Use switch_project only when the user asks to switch and cite the current user message. A mention is not a switch.",
  "Use stable project and capability IDs. Discovery is a request, never invent a capability.",
  "Describe requested external actions as proposals. Never claim a tool ran or an order was placed.",
  "Propose source-grounded changes only when context meaning changes or refresh is due. LONG is purpose and enduring direction, SHORT is current situation and next steps, RECENT is meaningful events.",
  "Use separate global and active-project scopes. Changes add a current observation to a bounded working layer, not a canonical commit.",
  "Use exact visible source IDs. Return empty arrays and null rebuild when there is no update. Report consequential unresolved contradictions and keep candidate facts separate from working context."
].join(" ");

const builtins = [
  { id: "just_keep_talking", purpose: "Continue conversation without an external action.", arguments: [], availability: "available", authorization: "conversation", route: "conversation" },
  { id: "ask_for_help", purpose: "Explain uncertainty or ask the user for help.", arguments: [], availability: "available", authorization: "conversation", route: "clarification" }
];

function list(value, max, label) {
  if (!Array.isArray(value) || value.length > max) throw new Error(`Invalid ${label}.`);
  return value;
}

function continuity(doc) {
  return Object.fromEntries(layers.map(layer => [layer, list(doc?.[layer] ?? [], 4, `${layer} context`).map(entry => {
    if (!bounded(entry?.source, 150) || !bounded(entry?.text, 400)) throw new Error("Invalid continuity entry.");
    return { source: entry.source, text: entry.text };
  })]));
}

function catalog(doc, kind) {
  const seen = new Set(kind === "capabilities" ? builtins.map(item => item.id) : []);
  return list(doc?.[kind] ?? [], 12, kind).map(entry => {
    if (!stableId(entry?.id) || seen.has(entry.id)) throw new Error(`Invalid or duplicate ${kind} ID.`);
    seen.add(entry.id);
    if (kind === "projects") {
      if (![entry.name, entry.description, entry.status, entry.routingSummary].every(value => bounded(value, 200))) {
        throw new Error("Invalid project catalog entry.");
      }
      return { id: entry.id, name: entry.name, description: entry.description, status: entry.status, routingSummary: entry.routingSummary };
    }
    if (!bounded(entry.purpose, 200) || !bounded(entry.route, 150) ||
        !["available", "unavailable"].includes(entry.availability) ||
        !["confirmation", "review-only"].includes(entry.authorization)) throw new Error("Invalid capability catalog entry.");
    const arguments_ = list(entry.arguments, 8, "capability arguments").map(arg => {
      if (!stableId(arg?.name) || !bounded(arg.description, 150) || typeof arg.required !== "boolean") {
        throw new Error("Invalid capability argument schema.");
      }
      return { name: arg.name, description: arg.description, required: arg.required, type: "string" };
    });
    if (new Set(arguments_.map(arg => arg.name)).size !== arguments_.length) throw new Error("Duplicate capability argument.");
    return { id: entry.id, purpose: entry.purpose, route: entry.route,
      availability: entry.availability, authorization: entry.authorization, arguments: arguments_ };
  });
}

export function createContextSource(folderId, token, fetchRequest = fetch) {
  const drive = createDriveClient(folderId, token, fetchRequest);
  async function read(name) {
    const query = new URLSearchParams({
      q: `'${folderId}' in parents and trashed = false and mimeType = 'application/json' and name = '${name}'`,
      fields: "files(id),nextPageToken,incompleteSearch", pageSize: "2"
    });
    const page = await drive.list(query);
    if (page?.incompleteSearch || page?.nextPageToken || !Array.isArray(page?.files) || page.files.length > 1) {
      throw new Error("Drive context lookup is incomplete or ambiguous.");
    }
    if (!page.files.length) return null;
    const { id } = page.files[0];
    const doc = await drive.readJson(id);
    if (doc?.schema_version !== 1) throw new Error("Unsupported Drive context version.");
    return { doc, ref: `drive:${id}` };
  }
  return {
    async load() {
      const [global, projects, capabilities] = await Promise.all([
        read("aida-context-global.json"), read("aida-context-projects.json"), read("aida-context-capabilities.json")
      ]);
      const projectEntries = catalog(projects?.doc, "projects");
      return { global: continuity(global?.doc), projects: projectEntries,
        likelyProjectId: projectEntries.find(entry => entry.id === projects?.doc.likelyProjectId)?.id ?? null,
        capabilities: [...builtins, ...catalog(capabilities?.doc, "capabilities")],
        references: [global?.ref, projects?.ref, capabilities?.ref].filter(Boolean) };
    },
    async project(id) {
      if (!stableId(id)) throw new Error("Invalid project context ID.");
      const result = await read(`aida-context-project-${id}.json`);
      if (result && result.doc.projectId !== id) throw new Error("Project context ID mismatch.");
      return { continuity: continuity(result?.doc), reference: result?.ref ?? null };
    }
  };
}

export function validateAwake(awake, envelope) {
  const exact = (value, fields) => value && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).length === fields.length && fields.every(field => Object.hasOwn(value, field));
  const known = new Set([envelope.user.source, ...envelope.context.references]);
  for (const track of [envelope.memory, envelope.context.global, envelope.context.activeProject?.continuity]) {
    if (track) for (const layer of layers) for (const entry of track[layer] ?? []) known.add(entry.source);
  }
  const validSources = (refs, required) => Array.isArray(refs) && refs.length <= 4 && (!required || refs.length > 0) &&
    new Set(refs).size === refs.length && refs.every(ref => known.has(ref));
  const action = awake?.action;
  if (!exact(awake, ["action", "rebuild", "changes", "candidates", "contradictions"]) ||
      !exact(action, ["kind", "target", "arguments", "sources", "uncertainty"]) || !kinds.includes(action.kind) ||
      (action.target !== null && !bounded(action.target, 120)) ||
      (action.uncertainty !== null && !bounded(action.uncertainty, 240)) ||
      !validSources(action.sources, !["just_keep_talking", "ask_for_help"].includes(action.kind)) ||
      !Array.isArray(action.arguments) || action.arguments.length > 8 ||
      action.arguments.some(arg => !exact(arg, ["name", "value"]) || !stableId(arg.name) || !bounded(arg.value, 240)) ||
      new Set(action.arguments.map(arg => arg.name)).size !== action.arguments.length ||
      (awake.rebuild !== null && !reasons.includes(awake.rebuild))) throw new Error("Invalid awake action or refresh request.");
  for (const [group, allowed] of [["changes", ["long", "short", "recent"]], ["candidates", ["facts", "insights"]], ["contradictions", null]]) {
    for (const entry of list(awake[group], 6, group)) {
      const fields = ["scope", "text", "sources", "rationale"];
      if (allowed) fields.push("layer");
      if (!exact(entry, fields) || !["global", "project"].includes(entry.scope) ||
          (allowed && !allowed.includes(entry.layer)) ||
          (entry.scope === "project" && !envelope.context.activeProject) ||
          !bounded(entry.text, 400) || !bounded(entry.rationale, 240) || !validSources(entry.sources, true)) {
        throw new Error("Invalid scoped awake update or evidence.");
      }
    }
  }
}

export function journalReceipt(result, supportingTurn) {
  const receipt = result.receipt;
  if (!receipt || receipt.outcome.status === "excluded") return undefined;
  if (!receipt.applied.length && !receipt.proposed.length && !receipt.candidates.length &&
      !receipt.contradictions.length && receipt.action.kind === "just_keep_talking") return undefined;
  const { envelope } = result;
  const allowed = new Set([envelope.user.source, supportingTurn?.user.source, supportingTurn?.aida.source,
    ...envelope.context.references, ...envelope.memory.facts.map(item => item.source)]);
  const groups = ["proposed", "applied", "candidates", "contradictions"];
  if (!receipt.action.sources.every(ref => allowed.has(ref))) return undefined;
  const safe = Object.fromEntries(groups.map(group =>
    [group, receipt[group].filter(item => item.sources.every(ref => allowed.has(ref)))]));
  return { ...receipt, ...safe, contextReferences: envelope.context.references,
    projectId: envelope.context.currentProjectId, userSource: envelope.user.source };
}

export function createAwakeSteward(source, { turns = 4, contextChars = 12000, recoveredTurns = [] } = {}) {
  let base;
  let activeId = null;
  let project;
  let count = 0;
  let refreshNext = false;
  let sizeAtRefresh = 0;
  const working = new Map();

  function track(key, seed) {
    const changes = working.get(key) ?? [];
    return Object.fromEntries(layers.map(layer => [layer, [
      ...seed[layer], ...changes.filter(item => item.layer === layer)
    ].slice(-4)]));
  }

  function add(key, update) {
    const previous = working.get(key) ?? [];
    const keep = previous.filter(item => item.layer !== update.layer || item.text !== update.text);
    working.set(key, [...keep, update].filter((item, index, all) =>
      all.slice(index + 1).filter(next => next.layer === item.layer).length < 4));
  }

  for (const turn of recoveredTurns) {
    const receipt = turn.awakeReceipt;
    if (!receipt || receipt.userSource !== turn.user.source) continue;
    if (receipt.outcome?.status === "project_selected" && stableId(receipt.outcome.projectId)) activeId = receipt.outcome.projectId;
    for (const item of Array.isArray(receipt.applied) ? receipt.applied : []) {
      if (!bounded(item?.text, 400) || !bounded(item.source, 150) ||
          !["long", "short", "recent"].includes(item.layer)) continue;
      if (item.scope === "global") add("global", item);
      if (item.scope === "project" && stableId(item.projectId)) add(`project:${item.projectId}`, item);
    }
  }

  return {
    async assemble(recent) {
      if (!base || refreshNext) {
        base = await source.load();
        if (activeId && !base.projects.some(entry => entry.id === activeId)) activeId = null;
        project = undefined;
        refreshNext = false;
      }
      const entry = base.projects.find(item => item.id === activeId);
      if (entry && !project) project = await source.project(entry.id);
      const global = track("global", base.global);
      const activeProject = entry ? { ...entry, continuity: track(`project:${entry.id}`, project.continuity) } : null;
      const size = JSON.stringify({ global, activeProject, recent }).length;
      return {
        global, activeProject, currentProjectId: activeId,
        likelyProjectId: activeId ?? base.likelyProjectId ?? null,
        projects: base.projects, capabilities: base.capabilities,
        references: [...base.references, project?.reference].filter(Boolean),
        refresh: { due: count >= turns || (size >= contextChars && size > sizeAtRefresh), turnsSinceRefresh: count, contextChars: size }
      };
    },

    apply(envelope, awake, allowUpdates = true) {
      validateAwake(awake, envelope);
      const { action } = awake;
      const current = envelope.context.currentProjectId;
      let outcome = { status: "conversation", route: "conversation" };
      if (!allowUpdates) return { action, outcome: { status: "excluded" }, applied: [] };
      count++;
      if (action.uncertainty !== null || action.kind === "ask_for_help") {
        outcome = { status: "needs_clarification", route: "clarification" };
      } else if (action.kind === "switch_project") {
        const target = envelope.context.projects.find(entry => entry.id === action.target);
        const requested = /^\s*(?:please\s+|let['’]s\s+)?(?:switch to|open project|select project|change project to|resume project)\s+(?:project\s+)?(.+?)\s*[.!?]?\s*$/i
          .exec(envelope.user.text)?.[1].toLowerCase();
        const exactTarget = target && [target.id, target.name.toLowerCase()].includes(requested);
        if (exactTarget && action.sources.includes(envelope.user.source)) {
          activeId = action.target;
          project = undefined;
          refreshNext = true;
          outcome = { status: "project_selected", projectId: activeId };
        } else {
          outcome = { status: "needs_clarification", route: "project_selection" };
        }
      } else if (action.kind === "continue_project") {
        outcome = action.target === current && current
          ? { status: "project_continued", projectId: current } : { status: "needs_clarification", route: "project_selection" };
      } else if (action.kind === "propose_project" || action.kind === "discover_capability") {
        outcome = { status: "proposed", route: action.kind };
      } else if (action.kind === "request_capability") {
        const capability = envelope.context.capabilities.find(entry => entry.id === action.target);
        const names = action.arguments.map(arg => arg.name);
        if (!capability || capability.availability !== "available") outcome = { status: "unavailable" };
        else if (names.some(name => !capability.arguments.some(arg => arg.name === name)) ||
            capability.arguments.some(arg => arg.required && !names.includes(arg.name))) {
          outcome = { status: "invalid_arguments", route: capability.route };
        } else {
          outcome = { status: {
            conversation: capability.id === "ask_for_help" ? "needs_clarification" : "conversation",
            confirmation: "confirmation_required", "review-only": "proposed"
          }[capability.authorization], route: capability.route };
        }
      }

      const due = envelope.context.refresh.due || (awake.rebuild && awake.rebuild !== "threshold");
      const applied = [];
      if (due && action.uncertainty === null) {
        for (const change of awake.changes) {
          const key = change.scope === "global" ? "global" : `project:${current}`;
          const update = { ...change, projectId: change.scope === "project" ? current : null,
            source: `awake:${envelope.user.source}:${applied.length}` };
          add(key, update);
          applied.push(update);
        }
        count = 0;
        sizeAtRefresh = envelope.context.refresh.contextChars;
        refreshNext = true;
      }
      return { action, outcome, rebuild: awake.rebuild, refreshDue: envelope.context.refresh.due,
        proposed: awake.changes, candidates: awake.candidates, contradictions: awake.contradictions, applied };
    }
  };
}
