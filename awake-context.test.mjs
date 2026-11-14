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
    assert.deepEqual(envelope.context.capabilities.map(item => item.id), ["just_keep_talking", "ask_for_help"]);
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
  await assert.rejects(session.send("Switch to Imaginary Atlas-not"), /No registered project/);
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
  await assert.rejects(chat(createAwakeSteward(duplicate.source), noCall).send(phrase), /Which project.*other/);
  for (const continuity of [null, { projectId: id, unreadable: true }, { projectId: "wrong" }]) {
    const broken = fixture({ ...docs, [path]: continuity });
    await assert.rejects(chat(createAwakeSteward(broken.source), noCall).send(phrase),
      /Cannot load project continuity.*(?:missing|refused|mismatch)/);
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
    error.projectRead.status === "ambiguous" && /other/.test(error.message));
  for (const continuity of [null, { projectId: id, unreadable: true }, { projectId: "wrong" }]) {
    const broken = fixture({ ...docs, [path]: continuity });
    await assert.rejects(chat(createAwakeSteward(broken.source), noCall).send(question), error =>
      error.projectRead.projectId === id && error.projectRead.status === "unavailable");
  }
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
      assert.ok(schema.required.includes("awake"));
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
  let candidateSource;
  let actionKind = "propose_project";
  const session = chat(createAwakeSteward(open()), envelope => {
    if (!selectStory) return answer(envelope);
    const story = envelope.memory.recent.find(item => item.text === "The scouts guard the gate until dawn.");
    return answer(envelope, {
      action: requested(envelope, actionKind, "fictional-gate", {
        arguments: [{ name: "name", value: "Fictional Gate" }, { name: "scope", value: "fictional" }]
      }),
      rebuild: "project_change",
      changes: [
        { scope: "project", layer: "short", text: "The scouts guard the gate until dawn.", sources: [story.source], rationale: "Current situation." },
        { scope: "global", layer: "short", text: "Unrelated global change.", sources: [envelope.user.source], rationale: "Must stay out." }
      ],
      candidates: ["facts", "insights"].map(layer => ({
        scope: "project", layer, text: "Candidate only.",
        sources: [candidateSource ?? story.source], rationale: "A provisional reading of the story."
      }))
    });
  });
  await session.send("What is seven times eight?");
  await session.send("The scouts guard the gate until dawn.");
  selectStory = true;
  candidateSource = "turn:fabricated:user";
  await assert.rejects(session.send("Create Fictional Gate."), /validation failed.*source|validation failed.*evidence/);
  candidateSource = undefined;
  actionKind = "just_keep_talking";
  await assert.rejects(session.send("Continue."), /validation failed.*scoped awake/);
  actionKind = "propose_project";
  const proposed = await session.send("I changed my mind. Create Fictional Gate and preserve the story.");
  const { preview } = proposed.receipt;
  assert.equal(proposed.receipt.outcome.status, "confirmation_required");
  assert.deepEqual(proposed.receipt.applied, []);
  assert.equal(writes.length, 4);
  assert.equal(preview.entry.scope, "fictional");
  assert.equal(preview.evidence.length, 2);
  assert.ok(preview.evidence.every(item => !item.text.includes("seven")));
  assert.deepEqual(preview.continuity.short[0].sources, [preview.evidence[0].source]);
  assert.deepEqual(preview.continuity.long, []);
  assert.deepEqual(preview.continuity.recent, []);
  assert.equal(proposed.response.awake.candidates.length, 2);
  assert.deepEqual(preview.continuity.facts, []);
  assert.deepEqual(preview.continuity.insights, []);
  assert.ok(!JSON.stringify(preview).includes("Candidate only."));
  assert.equal(journalReceipt(proposed)?.preview, undefined);

  failCatalogUpdate = true;
  await assert.rejects(open().createProject(preview), /503/);
  assert.equal(writes.length, 5);
  assert.ok(!catalog.record.projects.some(item => item.id === preview.entry.id));
  const saved = await open().createProject(preview);
  assert.equal(saved.projectId, preview.entry.id);
  assert.deepEqual(await open().createProject(preview), saved);
  assert.equal(writes.length, 5);
  const record = docs.get(saved.continuityReference.slice(6)).record;
  assert.deepEqual(record.evidence, preview.evidence);
  assert.deepEqual(record.short, preview.continuity.short);
  assert.deepEqual(record.facts, []);
  assert.deepEqual(record.insights, []);
  assert.ok(!JSON.stringify(record).includes("Candidate only."));
  assert.deepEqual(global.record.short, []);
  await assert.rejects(open().createProject({ ...preview, continuity: {
    ...preview.continuity, short: [{ ...preview.continuity.short[0], text: "A dragon appeared." }]
  } }), /differs from the preview/);
});
