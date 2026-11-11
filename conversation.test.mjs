import assert from "node:assert/strict";
import test from "node:test";
import { createConversationSession, parseConversationResponse } from "./conversation.mjs";
import { createMemoryStore, createRecord } from "./memory.mjs";

const firstMeeting = "Hello Aida. Do you remember what I told you when we first met?";
const firstFact = createRecord("I take the early ferry on Fridays.");
const saved = { fileId: "first-file", record: firstFact };

function simulatedResponse(envelope) {
  const first = envelope.memory.facts[0];
  return {
    version: "0.2",
    reply: first ? `You told me: ${first.text}` : "I don't have that memory available.",
    intent: "recall",
    route: "reply",
    affect: { ...envelope.affect, valence: 0.3, label: "warm" },
    candidates: { facts: [], insights: [], short: [], long: [] },
    tools: []
  };
}

test("a fresh session reads the actual Drive adapter before calling the provider and never writes", async () => {
  const calls = [];
  const responses = [
    { id: "dev", name: "AIDA — ONE AIDA MANY ROOMS — DEV", mimeType: "application/vnd.google-apps.folder", trashed: false },
    { files: [{ id: saved.fileId }] },
    firstFact
  ];
  const memoryStore = createMemoryStore("dev", () => "fixture-token", async (url, options) => {
    assert.equal(options.method, undefined);
    assert.equal(options.cache, "no-store");
    calls.push(url);
    assert.ok(responses.length);
    return Response.json(responses.shift());
  });
  const session = createConversationSession({
    memoryStore,
    provider: async envelope => {
      assert.equal(responses.length, 0);
      assert.match(calls.at(-1), /\/first-file\?alt=media$/);
      return JSON.stringify(simulatedResponse(envelope));
    }
  });

  const { envelope, response } = await session.send(firstMeeting);
  assert.deepEqual(envelope.memory.facts, [{
    source: "drive:first-file", recordId: firstFact.id, savedAt: firstFact.updated_at, text: firstFact.text
  }]);
  assert.ok(response.reply.includes(firstFact.text));
  assert.deepEqual(response.affect, { valence: 0.3, arousal: 0.2, label: "warm", expression: null });
  assert.deepEqual(response.candidates, { facts: [], insights: [], short: [], long: [] });
  assert.deepEqual(envelope.memory.recent, []);
  assert.equal(calls.length, 3);
});

test("missing memory is valid and a Drive failure prevents the provider call", async () => {
  let failRead = false;
  let calls = 0;
  const session = createConversationSession({
    memoryStore: { async recall() {
      if (failRead) throw new Error("Drive unavailable");
      return null;
    } },
    provider: async envelope => {
      calls++;
      return JSON.stringify(simulatedResponse(envelope));
    }
  });
  const result = await session.send(firstMeeting);
  assert.deepEqual(result.envelope.memory.facts, []);
  assert.match(result.response.reply, /don't have/);
  failRead = true;
  await assert.rejects(session.send(firstMeeting), /Drive unavailable/);
  assert.equal(calls, 1);
});

test("provider failure and malformed output leave affect and RECENT at the last successful turn", async () => {
  let fail;
  const session = createConversationSession({
    memoryStore: { recall: async () => saved },
    provider: async envelope => {
      if (fail === "network") throw new Error("provider internals");
      if (fail === "json") return "{";
      return JSON.stringify(simulatedResponse(envelope));
    }
  });
  const first = await session.send("First successful turn");
  fail = "network";
  await assert.rejects(session.send("Lost turn"), /provider failed/);
  fail = "json";
  await assert.rejects(session.send("Malformed turn"), /valid JSON/);
  fail = undefined;
  const { envelope } = await session.send("Next turn");
  assert.deepEqual(envelope.affect, first.response.affect);
  assert.deepEqual(envelope.memory.recent.map(event => event.text), [
    "First successful turn", first.response.reply
  ]);
  for (let turn = 0; turn < 4; turn++) await session.send(`Turn ${turn}`);
  const later = await session.send("Check window");
  assert.equal(later.envelope.memory.recent.length, 6);
  assert.deepEqual(later.envelope.memory.recent.filter(event => event.role === "user").map(event => event.text), [
    "Turn 1", "Turn 2", "Turn 3"
  ]);
});

test("response validation enforces version, affect, evidence, correction targets and tool proposals", async () => {
  const session = createConversationSession({
    memoryStore: { recall: async () => saved },
    provider: async envelope => JSON.stringify(simulatedResponse(envelope))
  });
  const { envelope } = await session.send("Actually, I take the ferry on Saturdays.");
  const validate = update => {
    const output = simulatedResponse(envelope);
    update(output);
    return parseConversationResponse(JSON.stringify(output), envelope);
  };
  assert.throws(() => validate(output => { output.version = "0.1"; }), /v0.2/);
  assert.throws(() => validate(output => { output.affect.arousal = 2; }), /v0.2/);
  assert.throws(() => validate(output => { delete output.candidates.long; }), /collections/);
  const candidate = { text: "The user takes the ferry on Saturdays.", sources: [envelope.user.source], supersedes: "drive:first-file" };
  assert.deepEqual(validate(output => { output.candidates.facts.push(candidate); }).candidates.facts, [candidate]);
  assert.throws(() => validate(output => {
    output.candidates.facts.push({ ...candidate, sources: ["drive:invented"] });
  }), /evidence/);
  assert.throws(() => validate(output => {
    output.candidates.facts.push({ ...candidate, sources: ["drive:first-file"] });
  }), /correction/);
  assert.throws(() => validate(output => { output.candidates.short.push(candidate); }), /correction/);
  assert.throws(() => validate(output => { output.tools.push({ tool: "write-drive", purpose: "Save the fact" }); }), /tool proposal/);
});
