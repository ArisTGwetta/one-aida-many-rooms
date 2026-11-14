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
  "When context.projectSelection is present, the steward already loaded the requested project. Use its continuity in this reply.",
  "Use stable project and capability IDs. Discovery is a request, never invent a capability.",
  "Describe requested external actions as proposals. Never claim a tool ran or an order was placed.",
  "For an explicit request to create a project from this conversation, use propose_project with a stable slug target and arguments name and scope (fictional or real).",
  "Cite the current request and use project-scoped changes to propose concise LONG purpose, SHORT current situation, and RECENT developments, each with exact conversation sources. Cite only excerpts relevant to the named project. Preserve fictional scope and leave unsupported layers empty. The steward will preview the transfer for confirmation.",
  "Say that project creation is proposed and awaits confirmation. Never claim a project has been created by proposing it.",
  "Propose source-grounded changes only when context meaning changes or refresh is due. LONG is purpose and enduring direction, SHORT is current situation and next steps, RECENT is meaningful events.",
  "Use separate global and active-project scopes. Changes add a current observation to a bounded working layer, not a canonical commit.",
  "Use exact visible source IDs. Return empty arrays and null rebuild when there is no update. Report consequential unresolved contradictions and keep candidate facts separate from working context."
].join(" ");

const builtins = [
  { id: "just_keep_talking", purpose: "Continue conversation without an external action.", arguments: [], availability: "available", authorization: "conversation", route: "conversation" },
  { id: "ask_for_help", purpose: "Explain uncertainty or ask the user for help.", arguments: [], availability: "available", authorization: "conversation", route: "clarification" }
];
const emptyContinuity = () => Object.fromEntries(layers.map(layer => [layer, []]));
const ownedRecords = [
  ["ctxGlobalV1", "aida-context-global.json", emptyContinuity, continuity],
  ["ctxProjectsV1", "aida-context-projects.json", () => ({ projects: [] }), doc => catalog(doc, "projects")],
  ["ctxCapabilitiesV1", "aida-context-capabilities.json", () => ({ capabilities: [] }), doc => catalog(doc, "capabilities")]
];
const initializedKey = "aidaContextInitialized";

function list(value, max, label) {
  if (!Array.isArray(value) || value.length > max) throw new Error(`Invalid ${label}.`);
  return value;
}

function continuity(doc) {
  return Object.fromEntries(layers.map(layer => [layer, list(doc ? doc[layer] : [], 4, `${layer} context`).map(entry => {
    if (!bounded(entry?.source, 150) || !bounded(entry?.text, 400)) throw new Error("Invalid continuity entry.");
    return { source: entry.source, text: entry.text };
  })]));
}

function catalog(doc, kind) {
  const seen = new Set(kind === "capabilities" ? builtins.map(item => item.id) : []);
  return list(doc ? doc[kind] : [], 12, kind).map(entry => {
    if (!stableId(entry?.id) || seen.has(entry.id)) throw new Error(`Invalid or duplicate ${kind} ID.`);
    seen.add(entry.id);
    if (kind === "projects") {
      if (![entry.name, entry.description, entry.status, entry.routingSummary].every(value => bounded(value, 200))) {
        throw new Error("Invalid project catalog entry.");
      }
      if (entry.scope !== undefined && !["fictional", "real"].includes(entry.scope)) throw new Error("Invalid project scope.");
      return { id: entry.id, name: entry.name, description: entry.description, status: entry.status, routingSummary: entry.routingSummary,
        ...(entry.scope ? { scope: entry.scope } : {}) };
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
  let revision = 0;
  async function read(name, expectedId = null) {
    const query = new URLSearchParams({
      q: `'${folderId}' in parents and trashed = false and mimeType = 'application/json' and name = '${name}'`,
      fields: "files(id),nextPageToken,incompleteSearch", pageSize: "2"
    });
    const page = await drive.list(query);
    if (page?.incompleteSearch || page?.nextPageToken || !Array.isArray(page?.files) || page.files.length > 1) {
      throw new Error(`Drive context lookup is incomplete or ambiguous for ${name}.`);
    }
    if (!page.files.length) {
      if (expectedId) throw new Error(`Expected Drive context record is missing: ${name}.`);
      return null;
    }
    const { id } = page.files[0];
    if (expectedId && id !== expectedId) throw new Error(`Drive context file ID changed for ${name}.`);
    let doc;
    try {
      doc = await drive.readJson(id);
    } catch (error) {
      throw Object.assign(new Error(`Cannot read ${name}. ${error.message}`), { status: error.status });
    }
    if (doc?.schema_version !== 1) throw new Error(`Unsupported Drive context version for ${name}.`);
    return { doc, id, ref: `drive:${id}` };
  }

  function readyId(properties, key, name) {
    const id = properties[key];
    if (typeof id !== "string" || !/^[\w-]+$/.test(id)) {
      throw new Error(`Missing or invalid initialization reference for ${name}.`);
    }
    return id;
  }

  async function ensure(properties, [key, name, seed, validate]) {
    const existing = await read(name, null);
    if (existing) {
      if (properties[key] && existing.id !== properties[key]) throw new Error(`Drive context file ID changed for ${name}.`);
      validate(existing.doc);
      if (!properties[key]) return drive.setFolderProperties({ [key]: existing.id });
      return properties;
    }
    const id = properties[key] ? readyId(properties, key, name) : await drive.generateId();
    // Reserve the ID in Drive before uploading. A fresh browser can finish an interrupted initialization.
    if (!properties[key]) properties = await drive.setFolderProperties({ [key]: id });
    const doc = { schema_version: 1, ...seed() };
    await drive.uploadJson(id, name, { aidaMemory: "context-v1" }, doc);
    const saved = await drive.readJson(id);
    if (JSON.stringify(saved) !== JSON.stringify(doc)) throw new Error(`Drive readback did not match ${name}.`);
    validate(saved);
    return properties;
  }

  async function load() {
    const properties = await drive.folderProperties();
    if (properties[initializedKey] && properties[initializedKey] !== "1") {
      throw new Error("Unknown Drive context initialization version.");
    }
    const initialized = properties[initializedKey] === "1";
    const [global, projects, capabilities] = await Promise.all(ownedRecords.map(([key, name]) =>
      read(name, initialized ? readyId(properties, key, name) : null)));
    const projectEntries = catalog(projects?.doc, "projects");
    return { global: continuity(global?.doc), projects: projectEntries,
      likelyProjectId: projectEntries.find(entry => entry.id === projects?.doc.likelyProjectId)?.id ?? null,
      capabilities: [...builtins, ...catalog(capabilities?.doc, "capabilities")],
      references: [global?.ref, projects?.ref, capabilities?.ref].filter(Boolean),
      initialized, records: Object.fromEntries(ownedRecords.map(([, name], index) =>
        [name, [global, projects, capabilities][index]?.id ?? null])) };
  }

  const source = {
    get revision() { return revision; },
    load,
    async initialize() {
      await drive.verifyFolder();
      let properties = await drive.folderProperties();
      if (properties[initializedKey]) return load();
      for (const record of ownedRecords) properties = await ensure(properties, record);
      await Promise.all(ownedRecords.map(([key, name]) => read(name, properties[key])));
      await drive.setFolderProperties({ [initializedKey]: "1" });
      const result = await load();
      revision++;
      return result;
    },
    async initializeProject(id) {
      if (!stableId(id)) throw new Error("Enter a valid registered project ID.");
      await drive.verifyFolder();
      const base = await load();
      if (!base.initialized || !base.projects.some(item => item.id === id)) {
        throw new Error("Initialize the context and register this project in the Drive catalog first.");
      }
      const key = `ctxProject-${id}`;
      const ready = `ctxReady-${id}`;
      const name = `aida-context-project-${id}.json`;
      const properties = await drive.folderProperties();
      if (!properties[ready]) {
        await ensure(properties, [key, name, () => ({ projectId: id, ...emptyContinuity() }), doc => {
          if (doc.projectId !== id) throw new Error("Project context ID mismatch.");
          continuity(doc);
        }]);
        const pinned = await drive.folderProperties();
        await read(name, readyId(pinned, key, name));
        await drive.setFolderProperties({ [ready]: "1" });
      }
      const result = await source.project(id);
      revision++;
      return result;
    },
    async createProject(preview) {
      const { entry, continuity: seed, evidence, authorizationSource } = preview;
      const id = entry.id;
      catalog({ projects: [entry] }, "projects");
      continuity(seed);
      await drive.verifyFolder();
      const properties = await drive.folderProperties();
      if (properties[initializedKey] !== "1") throw new Error("Initialize the base Drive context records first.");
      const [catalogKey, catalogName] = ownedRecords[1];
      const catalogId = readyId(properties, catalogKey, catalogName);
      const name = `aida-context-project-${id}.json`;
      const key = `ctxProject-${id}`;
      const ready = `ctxReady-${id}`;
      const initial = { projectId: id, scope: entry.scope, ...seed, evidence, authorizationSource };
      function verifyProject(doc) {
        if (JSON.stringify(doc) !== JSON.stringify({ schema_version: 1, ...initial })) {
          throw new Error("That project ID is already in use or its continuity differs from the preview.");
        }
      }
      const current = await read(catalogName, catalogId);
      const existing = catalog(current.doc, "projects").find(project => project.id === id);
      if (existing && JSON.stringify(existing) !== JSON.stringify(entry)) throw new Error("That project ID is already registered.");
      if (!existing && current.doc.projects.length >= 12) throw new Error("The project catalog is full.");
      if (existing && !properties[key]) throw new Error("That project ID is already registered.");
      if (properties[ready]) verifyProject((await read(name, readyId(properties, key, name))).doc);
      else {
        const pinned = await ensure(properties, [key, name, () => initial, verifyProject]);
        verifyProject((await read(name, readyId(pinned, key, name))).doc);
        await drive.setFolderProperties({ [ready]: "1" });
      }
      // Publish the catalog entry only after its continuity has been verified.
      const latest = await read(catalogName, catalogId);
      const registered = catalog(latest.doc, "projects").find(project => project.id === id);
      if (!registered) {
        const doc = { ...latest.doc, projects: [...latest.doc.projects, entry] };
        catalog(doc, "projects");
        await drive.replaceJson(catalogId, doc);
      }
      const verified = await load();
      if (JSON.stringify(verified.projects.find(project => project.id === id)) !== JSON.stringify(entry)) {
        throw new Error("Project catalog readback did not match the preview.");
      }
      const project = await source.project(id);
      verifyProject((await read(name, project.reference.slice(6))).doc);
      revision++;
      return { projectId: id, catalogReference: `drive:${catalogId}`, continuityReference: project.reference };
    },
    async project(id) {
      if (!stableId(id)) throw new Error("Invalid project context ID.");
      const properties = await drive.folderProperties();
      const name = `aida-context-project-${id}.json`;
      const result = await read(name, properties[`ctxReady-${id}`] ? readyId(properties, `ctxProject-${id}`, name) : null);
      if (!result && properties[initializedKey] === "1") {
        throw new Error(`Project context is missing: ${name}. Initialize the registered project before opening it.`);
      }
      if (result && result.doc.projectId !== id) throw new Error("Project context ID mismatch.");
      return { continuity: continuity(result?.doc), reference: result?.ref ?? null };
    }
  };
  return source;
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
          (entry.scope === "project" && !envelope.context.activeProject &&
            !(allowed && action.kind === "propose_project")) ||
          !bounded(entry.text, 400) || !bounded(entry.rationale, 240) || !validSources(entry.sources, true)) {
        throw new Error("Invalid scoped awake update or evidence.");
      }
    }
  }
}

export function projectPreview(envelope, awake) {
  const { action, changes } = awake;
  if (action.kind !== "propose_project" || action.uncertainty !== null ||
      !action.sources.includes(envelope.user.source) || !stableId(action.target)) return null;
  const args = Object.fromEntries(action.arguments.map(arg => [arg.name, arg.value]));
  if (Object.keys(args).length !== 2 || !bounded(args.name, 120) || !["fictional", "real"].includes(args.scope)) return null;
  const visible = new Map([...envelope.memory.recent, envelope.user].map(message => [message.source, message]));
  const selected = changes.filter(change => change.scope === "project");
  if (!selected.length || selected.some(change => change.sources.some(ref => !visible.has(ref)))) return null;
  const seed = emptyContinuity();
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

export function journalReceipt(result, supportingTurn) {
  const receipt = result.receipt;
  if (!receipt || receipt.outcome.status === "excluded" || receipt.action.kind === "propose_project") return undefined;
  if (!receipt.applied.length && !receipt.proposed.length && !receipt.candidates.length &&
      !receipt.contradictions.length && receipt.action.kind === "just_keep_talking") return undefined;
  const { envelope } = result;
  const allowed = new Set([envelope.user.source, supportingTurn?.user.source, supportingTurn?.aida.source,
    ...envelope.context.references, ...envelope.memory.facts.map(item => item.source)]);
  const groups = ["proposed", "applied", "candidates", "contradictions"];
  if (!receipt.action.sources.every(ref => allowed.has(ref))) return undefined;
  const safe = Object.fromEntries(groups.map(group =>
    [group, receipt[group].filter(item => item.sources.every(ref => allowed.has(ref)))]));
  const { preview, ...journalFields } = receipt;
  return { ...journalFields, ...safe, contextReferences: envelope.context.references,
    projectId: envelope.context.currentProjectId, userSource: envelope.user.source };
}

function requestedProject(text) {
  return /^\s*(?:aida\s*,\s*)?(?:please\s+)?(?:let['’]s\s+)?(?:return to|go back to|switch to|open project|select project|change project to|resume project)\s+(.+?)\s*[.!?]?\s*$/i
    .exec(text)?.[1].trim().toLowerCase();
}

export function createAwakeSteward(source, { turns = 4, contextChars = 12000, recoveredTurns = [] } = {}) {
  let base;
  let activeId = null;
  let project;
  let count = 0;
  let refreshNext = false;
  let sizeAtRefresh = 0;
  let sourceRevision;
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
    async assemble(recent, user) {
      const requested = requestedProject(user?.text ?? "");
      if (!base || requested || refreshNext || sourceRevision !== source.revision) {
        base = await source.load();
        sourceRevision = source.revision;
        if (activeId && !base.projects.some(entry => entry.id === activeId)) activeId = null;
        project = undefined;
        refreshNext = false;
      }
      let selected;
      if (requested) {
        const matches = base.projects.filter(entry => [entry.id, entry.name.toLowerCase()].some(name =>
          requested === name || requested === `project ${name}`));
        if (matches.length > 1) throw new Error(`Which project did you mean? Use its project ID: ${matches.map(entry => entry.id).join(", ")}.`);
        if (!matches.length) throw new Error("No registered project matches that request. Use its exact name or project ID.");
        [selected] = matches;
      }
      const entry = selected ?? base.projects.find(item => item.id === activeId);
      let loaded = project;
      if (selected) {
        try {
          loaded = await source.project(selected.id);
          if (!loaded.reference) throw new Error("The dedicated continuity record is missing.");
        } catch (error) {
          throw Object.assign(new Error(`Cannot load project continuity for ${selected.name}. ${error.message}`), { status: error.status });
        }
        project = activeId === selected.id ? loaded : undefined;
      } else if (entry && !loaded) {
        project = loaded = await source.project(entry.id);
      }
      const global = track("global", base.global);
      const activeProject = entry ? { ...entry, continuity: track(`project:${entry.id}`, loaded.continuity) } : null;
      const size = JSON.stringify({ global, activeProject, recent }).length;
      return {
        global, activeProject, currentProjectId: entry?.id ?? null,
        likelyProjectId: entry?.id ?? base.likelyProjectId ?? null,
        ...(selected ? { projectSelection: { projectId: selected.id, source: user.source } } : {}),
        projects: base.projects, capabilities: base.capabilities,
        references: [...base.references, loaded?.reference].filter(Boolean),
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
      if (envelope.context.projectSelection) {
        activeId = current;
        outcome = { status: "project_selected", projectId: current };
      } else if (action.uncertainty !== null || action.kind === "ask_for_help") {
        outcome = { status: "needs_clarification", route: "clarification" };
      } else if (action.kind === "switch_project") {
        outcome = { status: "needs_clarification", route: "project_selection" };
      } else if (action.kind === "continue_project") {
        outcome = action.target === current && current
          ? { status: "project_continued", projectId: current } : { status: "needs_clarification", route: "project_selection" };
      } else if (action.kind === "propose_project") {
        const preview = projectPreview(envelope, awake);
        return { action, outcome: { status: preview ? "confirmation_required" : "proposed", route: "project_creation" },
          preview, proposed: awake.changes, candidates: [], contradictions: awake.contradictions, applied: [] };
      } else if (action.kind === "discover_capability") {
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
