import assert from "node:assert/strict";
import test from "node:test";
import { loadOpenAIKey } from "./browser-credentials.mjs";
import { createProviders, openAIModel } from "./providers.mjs";
import { createConversationSession } from "./conversation.mjs";

const fixture = {
  routes: { "739": { provider: "openai", prefix: "sk-", segments: { "3": "Middle", "7": "First", "9": "Last" } } }
};
const fixtureKey = ["sk", "FirstMiddleLast"].join("-");

test("private Drive route loads without caching and orders fragments by the entered code", async () => {
  const requests = [];
  const key = await loadOpenAIKey("new-folder", "739", "google-test-token", async (url, options) => {
    assert.equal(options.cache, "no-store");
    assert.equal(options.redirect, "error");
    assert.equal(options.headers.Authorization, "Bearer google-test-token");
    const parsed = new URL(url);
    assert.equal(parsed.origin, "https://www.googleapis.com");
    requests.push(parsed);
    if (requests.length === 1) {
      assert.match(parsed.searchParams.get("q"), /^'new-folder' in parents and trashed = false/);
      assert.match(parsed.searchParams.get("q"), /aida-openai-fragments\.json/);
      return Response.json({ files: [{ id: "fixture-file" }] });
    }
    assert.equal(parsed.pathname, "/drive/v3/files/fixture-file");
    assert.equal(parsed.searchParams.get("alt"), "media");
    return Response.json(fixture);
  });

  assert.equal(key, fixtureKey);
  assert.equal(requests.length, 2);

  const invoke = createProviders({
    apiKey: key, ollamaEndpoint: "https://ollama.example",
    async fetchRequest(url, options) {
      const openai = url === "https://api.openai.com/v1/responses";
      assert.equal(options.headers.Authorization, openai ? `Bearer ${fixtureKey}` : undefined);
      assert.equal(options.body.includes(fixtureKey), false);
      assert.equal(options.body.includes("google-test-token"), false);
      const raw = JSON.stringify({
        version: "0.2", reply: "Hello.", intent: "conversation", route: "reply",
        affect: { valence: 0, arousal: 0.2, label: "calm", expression: null },
        candidates: { facts: [], insights: [], short: [], long: [] }, tools: []
      });
      return Response.json(openai
        ? { status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: raw }] }] }
        : { done: true, message: { content: raw } });
    }
  });
  let selection = { provider: "openai", model: openAIModel };
  const session = createConversationSession({
    memoryStore: { recall: async () => null },
    async provider(envelope) { return (await invoke({ ...selection, envelope })).raw; }
  });
  await session.send("Hello");
  selection = { provider: "ollama", model: "local" };
  const second = await session.send("Hello again");
  assert.equal(second.envelope.memory.recent.length, 2);
  assert.equal(JSON.stringify(second).includes(fixtureKey), false);
});

test("credential loading fails closed on missing, ambiguous, unauthorized, or mismatched data", async () => {
  for (const files of [[], [{ id: "one" }, { id: "two" }]]) {
    await assert.rejects(loadOpenAIKey("folder", "739", "token", async () => Response.json({ files })), /exactly one/);
  }
  await assert.rejects(loadOpenAIKey("folder", "739", "token", async () => new Response(null, { status: 401 })), { status: 401 });
  await assert.rejects(loadOpenAIKey("folder", "001", "token", async url =>
    Response.json(url.endsWith("?alt=media") ? fixture : { files: [{ id: "one" }] })
  ), /did not match/);
});
