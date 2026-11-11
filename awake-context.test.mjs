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
      if (parsed.searchParams.has("q")) {
        const query = parsed.searchParams.get("q");
        assert.match(query, /^'fixture-folder' in parents and trashed = false/);
        const name = /name = '([^']+)'/.exec(query)[1];
        reads.push(name);
        return Response.json({ files: docs[name] ? [{ id: name.replace(/\.json$/, "") }] : [] });
      }
      const id = parsed.pathname.split("/").at(-1);
      return Response.json({ schema_version: 1, ...docs[id + ".json"] });
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
