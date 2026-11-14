import { projectSkills } from "./project-skills.mjs";
import { skillDescriptor } from "./skill-registry.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { createAwakeSteward, createContextSource, journalReceipt } from "./awake-context.mjs";
import { createConversationSession } from "./conversation.mjs";
import { createProviders, openAIModel } from "./providers.mjs";

const files = {
  "aida-context-global.json": { long: [{ source: "global:purpose", text: "Maintain a reliable working relationship." }] },
  "aida-context-projects.json": { likelyProjectId: "atlas", projects: [
    { id: "atlas", name: "Atlas", description: "Synthetic map project.", status: "active", routingSummary: "Map-making work." }
  ] },
  "aida-context-capabilities.json": { capabilities: [{
    id: "order_supplies", purpose: "Request a supply order.", route: "supply-review", availability: "available",
    authorization: "confirmation", arguments: [{ name: "item", description: "Supply to order.", required: true }]
  }] },
  "aida-context-project-atlas.json": { projectId: "atlas",
    long: [{ source: "atlas:purpose", text: "Make a town map." }],
    short: [{ source: "atlas:state", text: "Survey the east side." }],
    recent: [{ source: "atlas:event", text: "The survey started." }]
  }
};

function fixture(docs = files) {
  const reads = [];
  return {
    reads,
    source: createContextSource("fixture-folder", () => "fixture-token", async (url, options) => {
      assert.equal(options.method, undefined);
      const parsed = new URL(url);
      if (parsed.pathname.endsWith("/fixture-folder")) return Response.json({ id: "fixture-folder" });
      if (parsed.searchParams.has("q")) {
        const query = parsed.searchParams.get("q");
        assert.match(query, /^'fixture-folder' in parents and trashed = false/);
        const name = /name = '([^']+)'/.exec(query)[1];
        reads.push(name);
        return Response.json({ files: docs[name] ? [{ id: name.replace(/\.json$/, "") }] : [] });
      }
      const id = parsed.pathname.split("/").at(-1);
      const doc = docs[id + ".json"];
      if (doc?.unreadable) return new Response(null, { status: 403 });
      const seed = doc.projects || doc.capabilities ? {} : { long: [], short: [], recent: [], facts: [], insights: [] };
      return Response.json({ schema_version: 1, ...seed, ...doc });
    })
  };
}

function answer(envelope, awake = {}) {
  const action = { kind: "just_keep_talking", target: null, arguments: [], sources: [], uncertainty: null };
  return {
    version: "0.2", reply: "Understood.", intent: "conversation", route: "reply",
    affect: envelope.affect, candidates: { facts: [], insights: [], short: [], long: [] }, tools: [],
    awake: { action, rebuild: null, changes: [], candidates: [], contradictions: [], ...awake }
  };
}

function chat(steward, provider) {
  return createConversationSession({
    steward, memoryStore: { recall: async () => ({ fileId: "first", record: { id: "first", text: "Original memory." } }) },
    loadCanonicalFacts: async () => [{ source: "drive:fact", text: "The user's name is Morgan." }],
    provider: async envelope => JSON.stringify(await provider(envelope))
  });
}

const requested = (envelope, kind, target, options = {}) =>
  ({ kind, target, arguments: [], sources: [envelope.user.source], uncertainty: null, ...options });

test("ordinary conversation and help tolerate missing Drive catalogs", async () => {
  const { source } = fixture({});
  const session = chat(createAwakeSteward(source), envelope => {
    assert.deepEqual(envelope.context.capabilities.map(item => item.id), ["just_keep_talking", "ask_for_help", "create_project"]);
    assert.deepEqual(envelope.context.projects, []);
    assert.equal(envelope.memory.facts.length, 2);
    return answer(envelope, envelope.user.text === "Help" ? {
      action: requested(envelope, "ask_for_help", null, { uncertainty: "No source available." })
    } : {});
  });
  assert.equal((await session.send("Hello")).receipt.outcome.status, "conversation");
  assert.equal((await session.send("Help")).receipt.outcome.status, "needs_clarification");
});

test("project selection requires a known stable ID and an explicit switch; scoped context evolves on the next turn", async () => {
  const { source, reads } = fixture();
  const session = chat(createAwakeSteward(source), envelope => {
    const message = envelope.user.text;
    if (message.includes("Atlas")) {
      return answer(envelope, { action: requested(envelope, "switch_project", "atlas") });
    }
    if (message === "A bridge has closed") {
      assert.equal(envelope.context.activeProject.id, "atlas");
      return answer(envelope, {
        rebuild: "meaningful_event",
        changes: [
          { scope: "project", layer: "short", text: "Survey the west side next.", sources: [envelope.user.source], rationale: "The bridge closed." },
          { scope: "global", layer: "short", text: "Help with the next map survey.", sources: [envelope.user.source], rationale: "The survey route changed." }
        ]
      });
    }
    if (message === "We decided to map the county") {
      assert.equal(envelope.context.activeProject.continuity.short.at(-1).text, "Survey the west side next.");
      assert.equal(envelope.context.global.short.at(-1).text, "Help with the next map survey.");
      return answer(envelope, { rebuild: "meaningful_event", changes: [
        { scope: "project", layer: "long", text: "Map the whole county.", sources: [envelope.user.source], rationale: "The project expanded." }
      ] });
    }
    assert.equal(envelope.context.activeProject.continuity.long.at(-1).text, "Map the whole county.");
    assert.equal(envelope.context.global.long[0].text, "Maintain a reliable working relationship.");
    assert.equal(envelope.context.activeProject.continuity.recent[0].source, "atlas:event");
    assert.ok(envelope.memory.recent.every(item => item.source.startsWith("turn:")));
    return answer(envelope);
  });
  assert.equal((await session.send("Atlas is interesting")).receipt.outcome.status, "needs_clarification");
  assert.equal((await session.send("Switch to Imaginary Atlas-not")).receipt.outcome.status, "needs_clarification");
  assert.ok(!reads.includes("aida-context-project-atlas.json"));
  const selected = await session.send("Switch to Atlas");
  assert.equal(selected.receipt.outcome.projectId, "atlas");
  const local = await session.send("A bridge has closed");
  assert.equal(local.receipt.applied.length, 2);
  await session.send("We decided to map the county");
  assert.deepEqual((await session.send("Thanks")).receipt.applied, []);

  const restored = createAwakeSteward(source, { recoveredTurns: [
    { ...selected.turn, awakeReceipt: journalReceipt(selected) }, { ...local.turn, awakeReceipt: journalReceipt(local) }
  ] });
  const restoredContext = await restored.assemble([]);
  assert.equal(restoredContext.currentProjectId, "atlas");
  assert.equal(restoredContext.activeProject.continuity.short.at(-1).text, "Survey the west side next.");
});

test("explicit and implied capability requests are proposals with mechanical checks and no external execution", async () => {
  const session = chat(createAwakeSteward(fixture().source), envelope => {
    const message = envelope.user.text;
    if (message === "Find a weather tool") return answer(envelope, { action: requested(envelope, "discover_capability", "weather") });
    return answer(envelope, { action: requested(envelope, "request_capability",
      message === "Unlisted" ? "weather" : "order_supplies", {
        arguments: message === "Missing" ? [] : [{ name: "item", value: "sardines" }],
        uncertainty: message === "Maybe order something" ? "The request is ambiguous." : null
      }) });
  });
  for (const [message, status] of [
    ["Order sardines", "confirmation_required"], ["We are out of sardines", "confirmation_required"],
    ["Maybe order something", "needs_clarification"], ["Missing", "invalid_arguments"],
    ["Unlisted", "unavailable"], ["Find a weather tool", "proposed"]
  ]) {
    assert.equal((await session.send(message)).receipt.outcome.status, status);
  }
});

test("configurable refresh can apply a grounded update and rejects invented evidence", async () => {
  const session = chat(createAwakeSteward(fixture({}).source, { turns: 1 }), envelope => {
    if (envelope.user.text === "Invented") return answer(envelope, { rebuild: "meaningful_event", changes: [
      { scope: "global", layer: "short", text: "Invented", rationale: "Unsupported", sources: ["turn:invented:user"] }
    ] });
    return answer(envelope, envelope.context.refresh.due ? { changes: [
      { scope: "global", layer: "short", text: "Continue planning.", rationale: "The user asked to continue.", sources: [envelope.user.source] }
    ] } : {});
  });
  assert.equal((await session.send("Hello")).receipt.refreshDue, false);
  assert.equal((await session.send("Continue planning")).receipt.applied.length, 1);
  await assert.rejects(session.send("Invented"), /evidence/);
  const excluded = await session.send("Do not retain this", { keepInContext: false });
  assert.equal(excluded.receipt.outcome.status, "excluded");
  assert.equal(journalReceipt(excluded), undefined);
});

test("OpenAI and Ollama opt into the same v0.2 awake response schema", async () => {
  const steward = createAwakeSteward(fixture({}).source);
  const session = chat(steward, envelope => answer(envelope));
  const { envelope } = await session.send("Hello");
  const provider = createProviders({
    apiKey: "fixture-key", ollamaEndpoint: "http://127.0.0.1:11434",
    async fetchRequest(url, options) {
      const body = JSON.parse(options.body);
      const openai = url.includes("openai.com");
      const schema = openai ? body.text.format.schema : body.format;
      assert.ok(schema.properties.result.anyOf[0].required.includes("awake"));
      assert.ok(!schema.properties.result.anyOf[0].properties.awake.properties.action.properties.kind.enum.includes("propose_project"));
      assert.ok(schema.properties.result.anyOf.some(variant =>
        variant.properties.skillRequest?.properties.id.enum.includes("create_project")));
      assert.equal(JSON.parse(openai ? body.input : body.messages[1].content).version, "0.2");
      const raw = JSON.stringify(answer(envelope));
      return Response.json(openai ? { status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: raw }] }] }
        : { done: true, message: { content: raw } });
    }
  });
  await provider({ provider: "openai", model: openAIModel, envelope });
  await provider({ provider: "ollama", model: "fixture", envelope });
});

test("owned context initialization survives interruption and flags missing, malformed, duplicate and inaccessible records", async () => {
  const folder = "fixture-folder";
  const properties = {};
  const docs = new Map();
  let nextId = 0;
  let failUpload = true;
  let failCatalogUpdate = false;
  const writes = [];
  const open = () => createContextSource(folder, () => "fixture-token", async (input, options) => {
    const url = new URL(input);
    const id = url.pathname.split("/").at(-1);
    if (id === folder) {
      if (options.method === "PATCH") Object.assign(properties, JSON.parse(options.body).appProperties);
      return Response.json({ id: folder, name: "AIDA — ONE AIDA MANY ROOMS — DEV",
        mimeType: "application/vnd.google-apps.folder", trashed: false, appProperties: properties });
    }
    if (id === "generateIds") return Response.json({ ids: [`file-${++nextId}`] });
    if (url.pathname.startsWith("/upload/")) {
      if (options.method === "PATCH") {
        if (failCatalogUpdate) {
          failCatalogUpdate = false;
          return new Response(null, { status: 503 });
        }
        const file = docs.get(id);
        assert.equal(file.name, "aida-context-projects.json");
        file.record = JSON.parse(options.body);
        return Response.json({ id });
      }
      if (failUpload) {
        failUpload = false;
        throw new Error("connection lost before write");
      }
      const boundary = options.headers["Content-Type"].split("boundary=")[1];
      const parts = options.body.split("--" + boundary);
      const [metadata, record] = parts.slice(1, 3).map(part => JSON.parse(part.split("\r\n\r\n")[1]));
      assert.deepEqual(metadata.parents, [folder]);
      assert.equal(metadata.appProperties.aidaMemory, "context-v1");
      writes.push(metadata.name);
      docs.set(metadata.id, { ...metadata, record });
      return Response.json({ id: metadata.id });
    }
    if (url.searchParams.has("q")) {
      assert.match(url.searchParams.get("q"), /^'fixture-folder' in parents and trashed = false/);
      const name = /name = '([^']+)'/.exec(url.searchParams.get("q"))[1];
      return Response.json({ files: [...docs.values()].filter(file => file.name === name).map(file => ({ id: file.id })) });
    }
    const doc = docs.get(id);
    return doc?.denied ? new Response(null, { status: 403 }) : Response.json(doc.record);
  });
  const before = await open().load();
  assert.equal(before.initialized, false);
  assert.equal(before.capabilities.length, 2);
  assert.ok(Object.values(before.records).every(id => id === null));
  assert.equal(writes.length, 0);
  await assert.rejects(open().initialize(), /reach Google Drive/);
  const initialized = await open().initialize();
  assert.equal(initialized.initialized, true);
  assert.equal(nextId, 3);
  assert.equal(writes.length, 3);
  assert.deepEqual((await open().initialize()).records, initialized.records);
  assert.equal(writes.length, 3);
  assert.deepEqual(initialized.global, { long: [], short: [], recent: [], facts: [], insights: [] });

  const catalog = docs.get(initialized.records["aida-context-projects.json"]);
  catalog.record.projects.push(files["aida-context-projects.json"].projects[0]);
  await assert.rejects(open().project("atlas"), /Project context is missing/);
  const created = await open().initializeProject("atlas");
  assert.deepEqual(created.continuity, initialized.global);
  assert.deepEqual(await open().initializeProject("atlas"), created);
  assert.equal(writes.length, 4);
  docs.delete(created.reference.replace("drive:", ""));
  await assert.rejects(open().initializeProject("atlas"), /Expected Drive context record is missing/);
  assert.equal(writes.length, 4);

  const globalId = initialized.records["aida-context-global.json"];
  const global = docs.get(globalId);
  docs.set("duplicate", { ...global, id: "duplicate" });
  await assert.rejects(open().load(), /ambiguous.*global/);
  docs.delete("duplicate");
  global.denied = true;
  await assert.rejects(open().load(), /Cannot read.*global.*refused/);
  global.denied = false;
  delete global.record.short;
  await assert.rejects(open().load(), /Invalid short context/);
  docs.delete(globalId);
  await assert.rejects(open().initialize(), /Expected Drive context record is missing.*global/);
  assert.equal(writes.length, 4);
  docs.set(globalId, global);
  global.record.short = [];

  let selectStory = false;
  const steward = createAwakeSteward(open());
  const session = chat(steward, envelope => {
    if (!selectStory || envelope.context.retrievalComplete) return answer(envelope);
    const story = envelope.memory.recent.find(item => item.text === "The scouts guard the gate until dawn.");
    return { skillRequest: { id: "create_project", version: 1, input: {
      projectId: "fictional-gate", name: "Fictional Gate", scope: "fictional", evidence: envelope.user.text,
      entries: [{ layer: "short", text: story.text, sources: [story.source] }]
    } } };
  });
  await session.send("What is seven times eight?");
  await session.send("The scouts guard the gate until dawn.");
  selectStory = true;
  const proposed = await session.send("I changed my mind. Create Fictional Gate and preserve the story.");
  const { preview: pending } = proposed.receipt;
  assert.equal(pending.id, "create_project");
  assert.equal(pending.version, 1);
  assert.equal(pending.arguments.projectId, "fictional-gate");
  const preview = pending.proposal;
  assert.equal(proposed.receipt.outcome.status, "confirmation_required");
  assert.deepEqual(proposed.receipt.applied, []);
  assert.equal(writes.length, 4);
  assert.equal(preview.entry.scope, "fictional");
  assert.equal(preview.evidence.length, 2);
  assert.ok(preview.evidence.every(item => !item.text.includes("seven")));
  assert.deepEqual(preview.continuity.short[0].sources, [preview.evidence[0].source]);
  assert.deepEqual(preview.continuity.long, []);
  assert.deepEqual(preview.continuity.recent, []);
  assert.equal(journalReceipt(proposed)?.preview, undefined);

  await assert.rejects(steward.confirm(structuredClone(pending)), /current capability preview/);
  failCatalogUpdate = true;
  await assert.rejects(steward.confirm(pending), /503/);
  assert.equal(writes.length, 5);
  assert.ok(!catalog.record.projects.some(item => item.id === preview.entry.id));
  const saved = await steward.confirm(pending);
  await assert.rejects(steward.confirm(pending), /current capability preview/);
  assert.equal(saved.projectId, preview.entry.id);
  assert.deepEqual(await open().createProject(preview), saved);
  assert.equal(writes.length, 5);
  const record = docs.get(saved.continuityReference.slice(6)).record;
  assert.deepEqual(record.evidence, preview.evidence);
  assert.deepEqual(record.short, preview.continuity.short);
  assert.deepEqual(global.record.short, []);
  await assert.rejects(open().createProject({ ...preview, continuity: {
    ...preview.continuity, short: [{ ...preview.continuity.short[0], text: "A dragon appeared." }]
  } }), /differs from the preview/);
});

test("multiline Lighthouse request can read once before the final response", async () => {
  const id = "clockwork-lighthouse";
  const name = "The Clockwork Lighthouse";
  const path = "aida-context-project-" + id + ".json";
  const entry = { id, name, description: "Fictional lighthouse.", status: "active", routingSummary: "Lighthouse story.", scope: "fictional" };
  const short = { source: "fiction:clock", text: "The clock stopped at midnight." };
  const docs = { ...files, "aida-context-projects.json": { projects: [entry] }, [path]: { projectId: id, short: [short] } };
  const command = "Aida, let's return to The Clockwork Lighthouse.";
  const multiline = "Hello, Aida!\n" + command + "\nWhat do you remember about where we left off?";
  const question = "Hello, Aida!\nWhat had we decided about The Clockwork Lighthouse?";
  function run({ operation = "enter", message = multiline, target = id, evidence = command,
    records = docs, failure, read = true } = {}) {
    const { source, reads } = fixture(records);
    const requests = [];
    const costs = [];
    const usage = { input_tokens: 100, output_tokens: 20 };
    const provider = createProviders({ apiKey: "fixture-key", async fetchRequest(_url, options) {
      const body = JSON.parse(options.body);
      const envelope = JSON.parse(body.input);
      requests.push(envelope);
      assert.equal(envelope.identity.name, "Aida");
      assert.deepEqual(envelope.context.global.long, files["aida-context-global.json"].long);
      if (requests.length <= 2) assert.equal(envelope.user.text, message);
      let modelOutput = answer(envelope);
      if (requests.length === 1) {
        assert.match(body.instructions, /result\.skillRequest/);
        assert.ok(body.text.format.schema.properties.result.anyOf);
        assert.equal(envelope.context.activeProject, null);
        modelOutput = { result: read ? { skillRequest: { id: "find_project", version: 1, input: { projectId: target, operation, evidence } } } : modelOutput };
      } else if (requests.length === 2) {
        assert.equal(envelope.user.source, requests[0].user.source);
        assert.deepEqual(envelope.affect, requests[0].affect);
        assert.deepEqual(envelope.memory, requests[0].memory);
        assert.equal(envelope.context.retrievalComplete, true);
        assert.equal(envelope.context.currentProjectId, operation === "enter" ? id : null);
        assert.equal(envelope.context.projectRead.sectionCounts.short, 1);
        const project = operation === "enter" ? envelope.context.activeProject : envelope.context.lookupProject;
        assert.equal(project.scope, "fictional");
        assert.deepEqual(project.continuity.short, [short]);
        if (failure === "transport") return new Response(null, { status: 502 });
        if (failure === "repeat") modelOutput = { skillRequest: { id: "find_project", version: 1, input: { projectId: id, operation, evidence } } };
      }
      return Response.json({ status: "completed", usage, output: [{ type: "message", content: [
        { type: "output_text", text: JSON.stringify(modelOutput) }
      ] }] });
    } });
    const session = createConversationSession({
      steward: createAwakeSteward(source), memoryStore: { recall: async () => null },
      async provider(envelope) {
        const response = await provider({ provider: "openai", model: openAIModel, envelope });
        costs.push(response.usage.estimatedUsd);
        return response.raw;
      }
    });
    return { session, requests, reads, costs, send: () => session.send(message) };
  }

  for (const config of [{}, { operation: "lookup", message: question, evidence: name }]) {
    const attempt = run(config);
    const result = await attempt.send();
    assert.deepEqual(attempt.costs, [0.00002, 0.00002]);
    assert.equal(attempt.requests.length, 2);
    assert.equal(attempt.reads.filter(file => file === path).length, 1);
    assert.equal(attempt.session.recentTurnCount, 1);
    assert.equal(result.receipt.outcome.status, config.operation ? "project_looked_up" : "project_selected");
    await attempt.session.send("Continue.");
    assert.equal(attempt.requests[2].context.currentProjectId, config.operation ? null : id);
    assert.equal(attempt.requests[2].context.lookupProject, undefined);
  }

  const ordinary = run({ message: "Good morning, Aida.", read: false });
  await ordinary.send();
  assert.equal(ordinary.requests.length, 1);
  assert.ok(!ordinary.reads.includes(path));

  for (const [config, error] of [
    [{ target: "invented" }, /Invalid or unauthorized skill request/],
    [{ evidence: "Not in the message" }, /Invalid or unauthorized skill request/],
    [{ message: question, evidence: name }, /Explicitly name/],
    [{ records: { ...docs, "aida-context-projects.json": { projects: [entry, { ...entry, id: "other" }] } } }, /Which project/],
    [{ records: { ...docs, [path]: null } }, /continuity record is missing/]
  ]) {
    const attempt = run(config);
    await assert.rejects(attempt.send(), error);
    assert.equal(attempt.requests.length, 1);
    assert.equal(attempt.session.recentTurnCount, 0);
  }
  for (const failure of ["transport", "repeat"]) {
    const attempt = run({ failure });
    await assert.rejects(attempt.send(), error => error.skillFailure?.id === "find_project");
    assert.equal(attempt.requests.length, 2);
    assert.equal(attempt.session.recentTurnCount, 0);
    await attempt.session.send("Continue.");
    assert.equal(attempt.requests[2].context.currentProjectId, null);
  }
});

test("fresh Lighthouse return sends verified project continuity and global context on the first model call", async () => {
  const id = "the-clockwork-lighthouse";
  const name = "The Clockwork Lighthouse";
  const path = `aida-context-project-${id}.json`;
  const entry = { id, name, description: "Fictional fixture.", status: "active", routingSummary: "Lighthouse story." };
  const short = { source: "fixture:lighthouse", text: "The lighthouse clock stopped at midnight." };
  const docs = { ...files, "aida-context-projects.json": { projects: [entry] }, [path]: { projectId: id, short: [short] } };
  const phrase = "Aida, let's return to The Clockwork Lighthouse.";
  const { source, reads } = fixture(docs);
  let calls = 0;
  const provider = createProviders({ apiKey: "fixture-key", async fetchRequest(_url, options) {
    calls++;
    const envelope = JSON.parse(JSON.parse(options.body).input);
    assert.equal(envelope.identity.name, "Aida");
    assert.equal(envelope.context.currentProjectId, id);
    assert.deepEqual(envelope.context.activeProject.continuity.short, [short]);
    assert.deepEqual(envelope.context.global.long, files["aida-context-global.json"].long);
    assert.ok(envelope.context.references.includes(`drive:${path.replace(/\.json$/, "")}`));
    assert.equal(envelope.memory.facts[0].text, "Original memory.");
    return Response.json({ status: "completed", output: [{ type: "message", content: [
      { type: "output_text", text: JSON.stringify(answer(envelope)) }
    ] }] });
  } });
  const session = createConversationSession({
    steward: createAwakeSteward(source),
    memoryStore: { recall: async () => ({ fileId: "first", record: { id: "first", text: "Original memory." } }) },
    provider: async envelope => (await provider({ provider: "openai", model: openAIModel, envelope })).raw
  });
  assert.equal((await session.send(phrase)).receipt.outcome.projectId, id);
  assert.equal(calls, 1);
  await session.send("What happens now?");
  assert.equal(calls, 2);
  assert.ok(reads.includes(path));

  const mention = fixture(docs);
  await chat(createAwakeSteward(mention.source), envelope => {
    assert.equal(envelope.context.currentProjectId, null);
    return answer(envelope);
  }).send("I remember The Clockwork Lighthouse.");
  assert.ok(!mention.reads.includes(path));

  const noCall = () => assert.fail("The model must not receive unresolved continuity");
  const duplicate = fixture({ ...docs, "aida-context-projects.json": { projects: [entry, { ...entry, id: "other" }] } });
  await assert.rejects(chat(createAwakeSteward(duplicate.source), noCall).send(phrase), /Which project/);
  for (const continuity of [null, { projectId: id, unreadable: true }, { projectId: "wrong" }]) {
    const broken = fixture({ ...docs, [path]: continuity });
    await assert.rejects(chat(createAwakeSteward(broken.source), noCall).send(phrase),
      /(?:missing|refused|mismatch)/);
  }
});

test("named detail requests read only the selected fictional project without entering it", async () => {
  const id = "the-clockwork-lighthouse";
  const name = "The Clockwork Lighthouse";
  const path = "aida-context-project-" + id + ".json";
  const entry = { id, name, description: "Fictional fixture.", status: "active", routingSummary: "Lighthouse story.", scope: "fictional" };
  const detail = { source: "fixture:lighthouse", text: "The clock stopped at midnight." };
  const docs = { ...files, "aida-context-projects.json": { projects: [entry] }, [path]: { projectId: id, short: [detail] } };
  const { source, reads } = fixture(docs);
  const question = "What had we decided about The Clockwork Lighthouse?";
  let calls = 0;
  const session = chat(createAwakeSteward(source), envelope => {
    calls++;
    assert.equal(envelope.identity.name, "Aida");
    assert.deepEqual(envelope.context.global.long, files["aida-context-global.json"].long);
    assert.equal(envelope.context.currentProjectId, null);
    if (calls <= 2) {
      assert.equal(envelope.context.activeProject, null);
      assert.equal(envelope.context.lookupProject.scope, "fictional");
      assert.deepEqual(envelope.context.lookupProject.continuity.short, [detail]);
      assert.ok(envelope.context.references.includes("drive:aida-context-project-" + id));
      return answer(envelope, { rebuild: "meaningful_event", changes: [
        { scope: "global", layer: "short", text: detail.text, rationale: "Must remain fictional.", sources: [detail.source] }
      ] });
    }
    assert.equal(envelope.context.lookupProject, undefined);
    assert.equal(envelope.context.global.short.length, 0);
    return answer(envelope);
  });
  const result = await session.send(question);
  assert.equal(calls, 1);
  assert.equal(result.receipt.outcome.status, "project_looked_up");
  assert.deepEqual(result.receipt.applied, []);
  assert.deepEqual(result.envelope.context.projectRead, { operation: "lookup", status: "looked_up", projectId: id,
    reference: "drive:aida-context-project-" + id, sectionCounts: { long: 0, short: 1, recent: 0, facts: 0, insights: 0 } });
  await session.send("Recap the-clockwork-lighthouse.");
  const readsAfterLookup = reads.length;
  await session.send("I saw a poster for The Clockwork Lighthouse.");
  assert.equal(reads.length, readsAfterLookup);

  const noCall = () => assert.fail("Unresolved lookup must stop before calling the provider");
  const duplicate = fixture({ ...docs, "aida-context-projects.json": { projects: [entry, { ...entry, id: "other" }] } });
  await assert.rejects(chat(createAwakeSteward(duplicate.source), noCall).send(question), error =>
    /Which project/.test(error.message));
  for (const continuity of [null, { projectId: id, unreadable: true }, { projectId: "wrong" }]) {
    const broken = fixture({ ...docs, [path]: continuity });
    await assert.rejects(chat(createAwakeSteward(broken.source), noCall).send(question), error =>
      /(?:missing|refused|mismatch)/.test(error.message));
  }
});

test("an independently registered third capability can preload or dispatch without Director changes", async () => {
  const { source, reads } = fixture();
  let executions = 0;
  const descriptor = skillDescriptor("fixture_status", 2, "read", "Read a synthetic status.", []);
  const skills = projectSkills(source, [{
    descriptor,
    plan: ({ user }) => user?.text === "Show fixture status" ? {} : null,
    validate: input => input && Object.keys(input).length === 0,
    authorize: (_input, { user }) => user.text.includes("status"),
    run() { executions++; return { value: "ready" }; },
    validateResult: result => result.value === "ready"
  }]);
  let calls = 0;
  const session = chat(createAwakeSteward(source, { skills }), envelope => {
    calls++;
    assert.equal(envelope.identity.name, "Aida");
    assert.deepEqual(envelope.context.global.long, files["aida-context-global.json"].long);
    assert.ok(envelope.context.capabilities.some(item => item.id === descriptor.id && item.version === 2));
    if (calls === 2) {
      return { skillRequest: { id: descriptor.id, version: 2, input: {} } };
    }
    assert.deepEqual(envelope.context.skillResult, { value: "ready" });
    assert.equal(envelope.context.retrievalComplete, true);
    assert.equal(envelope.context.currentProjectId, null);
    return answer(envelope);
  });
  await session.send("Show fixture status");
  assert.equal(calls, 1);
  await session.send("Could you check fixture status?");
  assert.equal(calls, 3);
  assert.equal(executions, 2);
  assert.ok(!reads.includes("aida-context-project-atlas.json"));
});

test("a registered confirmation skill previews and commits without a capability-specific route", async () => {
  const { source } = fixture();
  let committed;
  let calls = 0;
  const descriptor = skillDescriptor("fixture_confirm", 2, "preview", "Prepare a test action.", [
    { name: "label", required: true }
  ]);
  const skills = projectSkills(source, [{
    descriptor,
    validate: input => input.phase === "confirm"
      ? input.arguments.label === input.preview.label : input.label === "test action",
    authorize: (input, context) => input.phase !== "confirm" || context.confirmed === true,
    run(input) {
      if (input.phase !== "confirm") return { preview: { label: input.label } };
      committed = input;
      return { done: true };
    },
    validateResult: result => Boolean(result.preview || result.done)
  }]);
  const steward = createAwakeSteward(source, { skills });
  const session = chat(steward, envelope => {
    calls++;
    if (!envelope.context.retrievalComplete) {
      return { skillRequest: { id: descriptor.id, version: 2, input: { label: "test action" } } };
    }
    assert.equal(envelope.context.skillPreview.proposal.label, "test action");
    assert.deepEqual(envelope.context.global.long, files["aida-context-global.json"].long);
    return answer(envelope);
  });
  await assert.rejects(session.send("Preview the test action", { keepInContext: false }), /not advertised/);
  assert.equal(calls, 1);
  const result = await session.send("Preview the test action");
  assert.equal(calls, 3);
  assert.equal(committed, undefined);
  assert.equal(journalReceipt(result), undefined);
  const preview = result.receipt.preview;
  assert.deepEqual(preview, { id: descriptor.id, version: 2,
    arguments: { label: "test action" }, proposal: { label: "test action" } });
  await assert.rejects(steward.confirm({ ...preview }), /current capability preview/);
  preview.proposal.label = "tampered";
  assert.deepEqual(await steward.confirm(preview), { done: true });
  assert.deepEqual(committed.preview, { label: "test action" });
  await assert.rejects(steward.confirm(preview), /current capability preview/);
});
