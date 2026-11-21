import { projectSkills } from "./project-skills.mjs";
import { createDriveClient } from "./memory.mjs";
import { createJournal } from './recent-journal.mjs';
import { changeFields, validateOperation, evolve, validateSnapshot, validateReview, scopeAllowed, fingerprint, validateCheckpoint } from './memory-bridge.mjs';

const layers = ["long", "short", "recent", "facts", "insights"];
const kinds = ["just_keep_talking", "ask_for_help", "continue_project", "switch_project", "propose_project", "request_capability", "discover_capability"];
const reasons = ["meaningful_event", "project_change", "correction", "explicit_request", "threshold"];
const stableIdPattern = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const stableId = value => typeof value === "string" && stableIdPattern.test(value);
const bounded = (value, max) => typeof value === "string" && Boolean(value.trim()) && value.length <= max;
const string = { type: "string" };
const nullable = { type: ["string", "null"] };
const array = items => ({ type: "array", items });
const enumeration = (...values) => ({ type: "string", enum: values });
const object = properties => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
const scope = enumeration("global", "project");
const sources = array(string);
const item = object({ scope, text: string, sources, rationale: string });

const optionalSources = ["just_keep_talking", "ask_for_help"];
const citedKinds = kinds.filter(kind => ![...optionalSources, "propose_project"].includes(kind));
const actionSchema = (choices, minItems) => object({
  kind: enumeration(...choices), target: nullable,
  arguments: { ...array(object({
    name: { ...string, pattern: stableIdPattern.source },
    value: { ...string, pattern: "\\S" }
  })), maxItems: 8 },
  sources: { ...sources, minItems, maxItems: 4 }, uncertainty: nullable
});

export const awakeSchema = object({
  action: { anyOf: [actionSchema(optionalSources, 0), actionSchema(citedKinds, 1)] },
  rebuild: { anyOf: [enumeration(...reasons), { type: "null" }] },
  changes: array(object({ ...item.properties, layer: enumeration("long", "short", "recent"), ...changeFields })),
  candidates: array(object({ ...item.properties, layer: enumeration("facts", "insights") })),
  contradictions: array(item)
});

export const awakeInstructions = [
  "Return the awake section. Default to just_keep_talking when conversation needs no action.",
  "Use ask_for_help when uncertain. An implied request can propose a capability, but never grants permission.",
  "Use switch_project only when the user asks to switch and cite the current user message. A mention is not a switch.",
  "When context.projectSelection is present, the steward already loaded the requested project. Use its continuity in this reply.",
  "Use context.lookupProject to answer this turn only. After a completed lookup, use just_keep_talking unless you genuinely need clarification. Keep retrieved material separate from global memory and the active room.",
  "Use continue_project only for an explicitly intended continuation of context.currentProjectId. Set target to that stable ID and cite the current user message.",
  "Every action except just_keep_talking and ask_for_help requires one to four distinct supplied source IDs. Those two may use an empty sources array. Use null for absent target or uncertainty. Use at most eight uniquely named arguments, with stable slug names and nonblank values of at most 240 characters. Non-null target and uncertainty have limits of 120 and 240 characters.",
  "For ordinary conversation or a clarification, use arguments: []. For an action that needs arguments, use only its named arguments, once each, with nonblank values. Omit unused arguments instead of sending placeholders.",
  "Use stable project and capability IDs. Discovery is a request, never invent a capability.",
  "If the catalog lists ask_uncle_chatt and the user explicitly asks or outside help would be useful, offer a user-reviewed draft via request_capability with the question and current user source. Never claim a draft was copied or sent.",
  "Describe requested external actions as proposals. Never claim a tool ran or an order was placed.",
  "Propose source-grounded changes only when context meaning changes or refresh is due. LONG is purpose and enduring direction, SHORT is current situation and next steps, RECENT is meaningful events.",
  "Use separate global and active-project scopes. Changes add a current observation to a bounded working layer, not a canonical commit.",
  "Use exact visible source IDs. Return empty arrays and null rebuild when there is no update. Report consequential unresolved contradictions and keep candidate facts separate from working context."
  ,"LONG, SHORT and RECENT are current interpretations, not age buckets. Each change supplies operation KEEP, EXPAND, REVISE or UNCLEAR and a meaning array. KEEP has no meaning changes. EXPAND preserves previous meanings and adds compatible ones. UNCLEAR preserves competing claims and adds an uncertainty. REVISE explicitly replaces a prior meaning ID using new evidence, preserving unrelated meanings. New information is not automatically a contradiction."
  ,"Each meaning has a fresh stable id, kind event/claim/belief/interpretation/uncertainty, text, exact supplied sources, and replaces (prior meaning ID only for REVISE, otherwise null). Distinguish a reported claim from confirmation; never promote a candidate to a canonical fact. Supply the complete coherent current text, at most 400 characters, for the changed view. Preserve prior relevant meaning even when summarizing in different words. Legacy entries without meaning have IDs legacy-0, legacy-1, etc. Normalize multiple legacy entries into one current interpretation when making an eligible checkpoint."
  ,"Only awake.changes and awake.candidates drive the memory bridge; top-level candidates remain compatibility proposals. Use no update for disposable questions. Meaningful, permitted changes can checkpoint without a Remember button. Explicit opt-out overrides all proposals."
  ,"Inside an active project, keep private developments in project scope. A global update there requires sources solely from context.approvedReceipts explicitly authorized for global awareness. Those receipts contain approved outcomes only, never a room's private internals."
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
  const result = Object.fromEntries(layers.map(layer => [layer, list(doc ? doc[layer] : [], 4, `${layer} context`).map(entry => {
    if (!bounded(entry?.source, 150) || !bounded(entry?.text, 400)) throw new Error("Invalid continuity entry.");
    return { source: entry.source, text: entry.text, ...(entry.meaning ? { meaning: structuredClone(entry.meaning) } : {}) };
  })]));
  validateSnapshot(result);
  if (doc?.memoryBridge) {
    const meta = doc.memoryBridge;
    if (meta.version !== 1 || !Number.isInteger(meta.revision) || meta.revision < 1 || typeof meta.operationId !== 'string' || !/^drive:[\w-]+$/.test(meta.journalReference)) throw Error('Invalid durable context metadata.');
    result.review = structuredClone(validateReview(meta.review));
  }
  return result;
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
  const journal = createJournal(folderId, token, fetchRequest);
  const loaded = new Map();
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
    const record = { doc, id, ref: `drive:${id}` };
    loaded.set(name, structuredClone(record));
    return record;
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
    async checkpointStatus(checkpoint) {
      validateCheckpoint(checkpoint);
      const properties = await drive.folderProperties();
      for (const plan of checkpoint.plans) {
        const key = plan.scope === 'global' ? 'ctxGlobalV1' : `ctxProject-${plan.projectId}`;
        if (properties[key] !== plan.fileId) throw Error('Recovered checkpoint context identity changed.');
        const doc = await drive.readJson(plan.fileId); continuity(doc);
        if (doc.memoryBridge?.operationId !== checkpoint.operationId ||
            layers.some(layer=>JSON.stringify(doc[layer])!==JSON.stringify(plan.after[layer]))) return 'unconfirmed';
      }
      return 'verified';
    },
    async prepareCheckpoint(result) {
      const { receipt, envelope } = result;
      const targets = [...new Set([...receipt.applied.filter(x => x.operation && x.operation !== 'KEEP'), ...receipt.candidates, ...receipt.contradictions]
        .map(x => x.scope))];
      const pool = new Map([[envelope.user.source, envelope.user.text]]);
      for (const entry of [...envelope.memory.recent, ...envelope.memory.facts, ...(envelope.context.approvedReceipts ?? [])]) pool.set(entry.source, entry.text);
      for (const track of [envelope.context.global, envelope.context.activeProject?.continuity]) if (track)
        for (const layer of layers) for (const entry of track[layer]) pool.set(entry.source, entry.text);
      const plans = [];
      for (const scope of targets) {
        const projectId = scope === 'project' ? envelope.context.currentProjectId : null;
        const name = scope === 'global' ? ownedRecords[0][1] : `aida-context-project-${projectId}.json`;
        const original = loaded.get(name);
        if (!original) throw Error('The current owned context record is required before checkpointing.');
        const canonical = continuity(original.doc);
        const before = Object.fromEntries(layers.map(layer => [layer, structuredClone(canonical[layer])]));
        const after = structuredClone(before);
        const changes = receipt.applied.filter(x => x.scope === scope && x.operation && x.operation !== 'KEEP');
        for (const update of changes) after[update.layer] = [{ source: update.source, text: update.text, meaning: structuredClone(update.meaning) }];
        const candidate = receipt.candidates.filter(x => x.scope === scope), questions = receipt.contradictions.filter(x => x.scope === scope);
        const oldReview = original.doc.memoryBridge?.review ?? { candidates: [], questions: [] };
        const merge = (old, next) => [...new Map([...old, ...next].map(item => [JSON.stringify([item.text,item.sources,item.layer]),item])).values()];
        const review = { candidates: merge(oldReview.candidates,candidate), questions: merge(oldReview.questions,questions) };
        const refs = [...new Set([...changes, ...candidate, ...questions].flatMap(item => item.sources))];
        if (refs.some(ref => !pool.has(ref))) throw Error('Checkpoint evidence is not available; no source text will be reconstructed.');
        plans.push({ scope, projectId, fileId: original.id, baseHash: await fingerprint(original.doc), revision: original.doc.memoryBridge?.revision ?? 0,
          before, after, review, evidence: refs.map(ref => ({source:ref,text:pool.get(ref)})), previousJournalReference: original.doc.memoryBridge?.journalReference ?? null });
      }
      return validateCheckpoint({ version:1, operationId:result.turn.turnId, plans });
    },
    async commitCheckpoint(checkpoint, journalReference) {
      validateCheckpoint(checkpoint);
      // A verified existing journal entry is the authority and historical evidence
      // for this write. Model output cannot invent a direct context-write request.
      const saved = await journal.readReference(journalReference);
      const archived = saved.event.turns.find(turn => turn.turnId === checkpoint.operationId)?.awakeReceipt?.bridge;
      if (JSON.stringify(archived) !== JSON.stringify(checkpoint)) throw Error('Checkpoint is not backed by the verified journal evidence.');
      const properties = await drive.folderProperties();
      if (properties[initializedKey] !== '1') throw Error('Owned context records must be initialized first.');
      const verified = [];
      for (const plan of checkpoint.plans) {
        const key = plan.scope === 'global' ? 'ctxGlobalV1' : `ctxProject-${plan.projectId}`;
        if (properties[key] !== plan.fileId) throw Error('Checkpoint context identity changed.');
        if (plan.scope === 'project') {
          const projects = await read(ownedRecords[1][1], readyId(properties,'ctxProjectsV1',ownedRecords[1][1]));
          if (!catalog(projects.doc,'projects').some(entry => entry.id === plan.projectId)) throw Error('Checkpoint project is not registered.');
        }
        const current = await drive.readVersioned(plan.fileId);
        continuity(current.record);
        const meta = current.record.memoryBridge;
        const targetMeta = { version:1, revision:plan.revision+1, operationId:checkpoint.operationId, journalReference,
          previousJournalReference:plan.previousJournalReference, review:plan.review };
        if (meta?.operationId === checkpoint.operationId) {
          if (JSON.stringify(meta) !== JSON.stringify(targetMeta) || layers.some(layer => JSON.stringify(current.record[layer]) !== JSON.stringify(plan.after[layer])))
            throw Error('Checkpoint retry content changed.');
        } else {
          if ((meta?.revision ?? 0) !== plan.revision || await fingerprint(current.record) !== plan.baseHash)
            throw Error('Memory changed on another client. Stale checkpoint retained for review; no overwrite attempted.');
          const record = { ...current.record, ...plan.after, memoryBridge:targetMeta };
          await drive.replaceVersioned(plan.fileId, record, current.etag);
          const readback = await drive.readVersioned(plan.fileId);
          if (JSON.stringify(readback.record) !== JSON.stringify(record)) throw Error('Memory checkpoint readback failed; persistence is unconfirmed.');
        }
        verified.push({ scope:plan.scope, projectId:plan.projectId, revision:plan.revision+1, reference:`drive:${plan.fileId}` });
      }
      revision++;
      return { status:'verified', operationId:checkpoint.operationId, records:verified };
    },
    async projectEvidence(id, wanted = null) {
      if (!stableId(id)) throw Error('Invalid evidence project.');
      const base = await load();
      if (!base.projects.some(entry => entry.id === id)) throw Error('Evidence project is not registered.');
      await source.project(id);
      const doc = loaded.get(`aida-context-project-${id}.json`).doc;
      const entries = new Map((doc.evidence ?? []).filter(e => bounded(e.source,150) && bounded(e.text,4000)).map(e => [e.source,{source:e.source,text:e.text}]));
      let reference = doc.memoryBridge?.journalReference ?? null, hops = 0;
      const visited = new Set();
      while (reference && hops++ < 12) {
        if (visited.has(reference)) throw Error('Cyclic project evidence history.'); visited.add(reference);
        const record = await journal.readReference(reference);
        const plans = record.event.turns.flatMap(turn => turn.awakeReceipt?.bridge?.plans ?? []).filter(p => p.scope === 'project' && p.projectId === id);
        if (plans.length !== 1) throw Error('Journal evidence does not belong to this project.');
        for (const e of plans[0].evidence) entries.set(e.source,e);
        if (wanted && layers.some(layer=>plans[0].after[layer].some(item=>item.source===wanted)))
          return {projectId:id,entries:plans[0].evidence,bounded:false};
        if (wanted && entries.has(wanted)) break;
        reference = plans[0].previousJournalReference;
      }
      const selected = wanted ? [...entries.values()].filter(e => e.source === wanted) : [...entries.values()].slice(0,12);
      if (wanted && !selected.length) throw Error('Requested source not found within the bounded project evidence history.');
      return { projectId:id, entries:selected, bounded:reference !== null && hops >= 12 };
    },
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
  for (const receipt of envelope.context.approvedReceipts ?? []) known.add(receipt.source);
  for (const entry of envelope.context.skillResult?.evidence?.entries ?? []) known.add(entry.source);
  for (const track of [envelope.memory, envelope.context.global, envelope.context.activeProject?.continuity, envelope.context.lookupProject?.continuity]) {
    if (track) for (const layer of layers) for (const entry of track[layer] ?? []) known.add(entry.source);
  }
  const validSources = (refs, required) => Array.isArray(refs) && refs.length <= 4 && (!required || refs.length > 0) &&
    new Set(refs).size === refs.length && refs.every(ref => known.has(ref));
  const action = awake?.action;
  const reject = (diagnostic, message = "Invalid awake action or refresh request.") => {
    throw Object.assign(new Error(message), { diagnostic });
  };
  if (!exact(awake, ["action", "rebuild", "changes", "candidates", "contradictions"])) reject("awake_shape");
  if (!exact(action, ["kind", "target", "arguments", "sources", "uncertainty"])) reject("awake_action_shape");
  if (!kinds.includes(action.kind)) reject("awake_action_kind");
  if (action.target !== null && !bounded(action.target, 120)) reject("awake_action_target");
  if (action.uncertainty !== null && !bounded(action.uncertainty, 240)) reject("awake_action_uncertainty");
  if (!validSources(action.sources, !optionalSources.includes(action.kind))) reject("awake_action_sources");
  if (!Array.isArray(action.arguments) || action.arguments.length > 8) reject("awake_action_argument_count");
  for (const arg of action.arguments) {
    if (!exact(arg, ["name", "value"])) reject("awake_action_argument_shape");
    if (!stableId(arg.name)) reject("awake_action_argument_name");
    if (!bounded(arg.value, 240)) reject("awake_action_argument_value");
  }
  if (new Set(action.arguments.map(arg => arg.name)).size !== action.arguments.length) reject("awake_action_argument_duplicate");
  if (awake.rebuild !== null && !reasons.includes(awake.rebuild)) reject("awake_rebuild");
  for (const [group, allowed] of [["changes", ["long", "short", "recent"]], ["candidates", ["facts", "insights"]], ["contradictions", null]]) {
    if (!Array.isArray(awake[group]) || awake[group].length > 6) reject("awake_collection", "Invalid awake collection.");
    for (const entry of awake[group]) {
      const fields = ["scope", "text", "sources", "rationale"];
      if (allowed) fields.push("layer");
      if (group === 'changes' && Object.hasOwn(entry,'operation')) fields.push('operation','meaning');
      if (!exact(entry, fields) || !["global", "project"].includes(entry.scope) ||
          (allowed && !allowed.includes(entry.layer)) ||
          (entry.scope === "project" && !(envelope.context.activeProject || envelope.context.lookupProject) &&
            !(allowed && action.kind === "propose_project")) ||
          !bounded(entry.text, 400) || !bounded(entry.rationale, 240) || !validSources(entry.sources, true)) {
        reject("awake_scoped_evidence", "Invalid scoped awake update or evidence.");
      }
      if (group === 'changes' && entry.operation) validateOperation(entry,known);
    }
  }
  if (new Set(awake.changes.map(item=>item.scope+':'+item.layer)).size !== awake.changes.length)
    reject('awake_duplicate_view','Return one current interpretation per scope and view.');
}

export function journalReceipt(result, supportingTurn) {
  const receipt = result.receipt;
  if (!receipt || receipt.outcome.status === "excluded" || (receipt.preview || receipt.action.kind === "propose_project")) return undefined;
  if (!receipt.applied.length && !receipt.proposed.length && !receipt.candidates.length &&
      !receipt.contradictions.length && receipt.action.kind === "just_keep_talking") return undefined;
  const { envelope } = result;
  const allowed = new Set([envelope.user.source, supportingTurn?.user.source, supportingTurn?.aida.source,
    ...envelope.context.references, ...envelope.memory.facts.map(item => item.source)]);
  for (const value of envelope.context.approvedReceipts ?? []) allowed.add(value.source);
  if (receipt.bridge) for (const plan of receipt.bridge.plans) for (const evidence of plan.evidence) allowed.add(evidence.source);
  const groups = ["proposed", "applied", "candidates", "contradictions"];
  if (!receipt.action.sources.every(ref => allowed.has(ref))) return undefined;
  const safe = Object.fromEntries(groups.map(group =>
    [group, receipt[group].filter(item => item.sources.every(ref => allowed.has(ref)))]));
  const { preview, ...journalFields } = receipt;
  return { ...journalFields, ...safe, ...(envelope.context.approvedReceipts?.length ? { approvedReceipts:envelope.context.approvedReceipts } : {}), contextReferences: envelope.context.references,
    projectId: envelope.context.currentProjectId, userSource: envelope.user.source };
}

export function createAwakeSteward(source, { turns = 4, contextChars = 12000, recoveredTurns = [], skills = projectSkills(source) } = {}) {
  let pendingPreview;
  let pendingWrite;
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
    return { ...seed, ...Object.fromEntries(layers.map(layer => {
      let entries = seed[layer];
      for (const update of changes.filter(item => item.layer === layer)) entries = update.operation ?
        [{ source:update.source,text:update.text,meaning:update.meaning }] : [...entries,update].slice(-4);
      return [layer,entries];
    })) };
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
      if (item.operation) continue; // Durable current context, not a short receipt window, owns typed snapshots.
      if (!bounded(item?.text, 400) || !bounded(item.source, 150) ||
          !["long", "short", "recent"].includes(item.layer)) continue;
      if (item.scope === "global") add("global", item);
      if (item.scope === "project" && stableId(item.projectId)) add(`project:${item.projectId}`, item);
    }
  }

  return {
    get activeProjectId() { return activeId; },
    async assemble(recent, user, inspectionProjectId) {
      if (!base || refreshNext || sourceRevision !== source.revision) {
        base = await source.load();
        sourceRevision = source.revision;
        if (activeId && !base.projects.some(entry => entry.id === activeId)) activeId = null;
        project = undefined;
        refreshNext = false;
      }
      const inspecting = inspectionProjectId !== undefined;
      const scopedId = inspecting ? inspectionProjectId : activeId;
      const entry = base.projects.find(item => item.id === scopedId);
      if (inspecting && scopedId && !entry) throw new Error("The inspection project is no longer registered.");
      let scopedProject;
      if (inspecting && entry) {
        scopedProject = await source.project(entry.id);
        if (!scopedProject.reference) throw new Error("Inspection project continuity is unavailable.");
      } else if (entry) {
        project ??= await source.project(entry.id);
        scopedProject = project;
      }
      const global = track("global", base.global);
      const activeProject = entry ? { ...entry, continuity: track(`project:${entry.id}`, scopedProject.continuity) } : null;
      const size = JSON.stringify({ global, activeProject, recent }).length;
      const capabilities = skills.available(base.capabilities, { projects: base.projects, currentProjectId: activeId })
        .filter(skill => !skill.libraryOnly);
      const context = {
        global, activeProject, currentProjectId: scopedId,
        likelyProjectId: inspecting ? scopedId : activeId ?? base.likelyProjectId ?? null,
        projects: base.projects, capabilities: inspecting ? [] : capabilities,
        references: [...base.references, scopedProject?.reference].filter(Boolean),
        refresh: { due: count >= turns || (size >= contextChars && size > sizeAtRefresh), turnsSinceRefresh: count, contextChars: size }
      };
      if (inspecting) return context;
      const request = skills.plan({ user, context }, "read");
      return request ? this.resolveSkill(context, user, request) : context;
    },

    async resolveSkill(context, user, request, envelope, allowPreview = true) {
      const skill = context.capabilities.find(item => item.id === request.id && item.version === request.version);
      if (context.retrievalComplete || !["read", "preview"].includes(skill?.phase) ||
          (skill.phase === "preview" && (!allowPreview || !envelope))) {
        throw new Error("Skill is not advertised for this turn.");
      }
      const result = await skills.dispatch(request, { user, context, envelope }, skill.phase);
      if (skill.phase === "preview") {
        return { ...context, retrievalComplete: true, skillPreview: { request: structuredClone(request), proposal: result.preview } };
      }
      return { ...skills.integrate(request, result, context, { track }), retrievalComplete: true };
    },

    cancelPreview(preview) {
      if (preview === pendingPreview) pendingPreview = pendingWrite = undefined;
    },

    async confirm(preview) {
      if (!pendingPreview || preview !== pendingPreview) throw new Error("Confirm the current capability preview.");
      const result = await skills.dispatch(pendingWrite,
        { confirmed: true }, "preview");
      pendingPreview = pendingWrite = undefined;
      return result;
    },

    async apply(envelope, awake, allowUpdates = true) {
      validateAwake(awake, envelope);
      const { action } = awake;
      const current = envelope.context.currentProjectId;
      let outcome = { status: "conversation", route: "conversation" };
      if (!allowUpdates) return { action, outcome: { status: "excluded" }, applied: [] };
      if (envelope.context.skillPreview) {
        const { request, proposal } = envelope.context.skillPreview;
        const preview = proposal ? { id: request.id, version: request.version,
          arguments: structuredClone(request.input), proposal } : null;
        pendingPreview = preview;
        pendingWrite = preview ? { id: request.id, version: request.version, input: { phase: "confirm",
          arguments: structuredClone(request.input), preview: structuredClone(proposal) } } : undefined;
        return { action, outcome: { status: preview ? "confirmation_required" : "proposed", route: request.id },
          preview, proposed: [], candidates: [], contradictions: [], applied: [] };
      }
      count++;
      if (envelope.context.lookupProject || envelope.context.projectEvidenceRead) {
        return { action, outcome: { status: "project_looked_up", projectId: envelope.context.lookupProject?.id ?? envelope.context.projectEvidenceRead.projectId },
          proposed: awake.changes, candidates: [], contradictions: awake.contradictions, applied: [] };
      }
      if (envelope.context.projectSelection) {
        activeId = current;
        project = undefined;
        outcome = { status: "project_selected", projectId: current };
      } else if (action.uncertainty !== null || action.kind === "ask_for_help") {
        outcome = { status: "needs_clarification", route: "clarification" };
      } else {
        const skillContext = { envelope, awake, context: envelope.context };
        const capabilityOutcome = skills.action(skillContext);
        if (capabilityOutcome?.suppressUpdates) {
          const { suppressUpdates, ...outcome } = capabilityOutcome;
          return { action, outcome, proposed: awake.changes, candidates: [], contradictions: awake.contradictions, applied: [] };
        }
        if (capabilityOutcome) outcome = capabilityOutcome;
        if (!capabilityOutcome && action.kind === "discover_capability") {
          outcome = { status: "proposed", route: action.kind };
        } else if (!capabilityOutcome && action.kind === "request_capability") {
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

      }

      const due = envelope.context.refresh.due || (awake.rebuild && awake.rebuild !== "threshold");
      const applied = [];
      const rejected = [];
      if (due && action.uncertainty === null) {
        for (const change of awake.changes) {
          if (!scopeAllowed(change,envelope)) { rejected.push({scope:change.scope,layer:change.layer,reason:'scope_transfer_denied'}); continue; }
          if (change.operation === 'KEEP') continue;
          const update = { ...change, projectId: change.scope === "project" ? current : null,
            source: `awake:${envelope.user.source}:${applied.length}` };
          if (change.operation) {
            const seed = change.scope === 'global' ? envelope.context.global : envelope.context.activeProject.continuity;
            update.meaning = evolve(seed[change.layer],change,update.source).meaning;
          }
          applied.push(update);
        }
        // Validate the complete set before changing any working view.
        for (const update of applied) add(update.scope==='global'?'global':`project:${current}`,update);
        count = 0;
        sizeAtRefresh = envelope.context.refresh.contextChars;
        refreshNext = true;
      }
      return { action, outcome, rebuild: awake.rebuild, refreshDue: envelope.context.refresh.due,
        proposed: awake.changes, candidates: awake.candidates.filter(x=>scopeAllowed(x,envelope)),
        contradictions: awake.contradictions.filter(x=>scopeAllowed(x,envelope)), applied, rejected };
    }
  };
}
