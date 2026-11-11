import assert from "node:assert/strict";
import test from "node:test";
import { createConversationSession } from "./conversation.mjs";
import { createProviders, openAIModel } from "./providers.mjs";

const record = { id: "record-1", text: "I take the early ferry on Fridays.", updated_at: "2026-01-01T12:00:00.000Z" };
const output = envelope => JSON.stringify({
  version: "0.2",
  reply: envelope.memory.facts[0]?.text ?? "I don't have that memory available.",
  intent: "recall", route: "reply", affect: { valence: 0.4, arousal: 0.2, label: "warm", expression: null },
  candidates: { facts: [], insights: [], short: [], long: [] }, tools: []
});

test("switching from OpenAI to Ollama retains identity, Drive evidence, history and affect", async () => {
  const received = [];
  const invoke = createProviders({
    apiKey: "fixture-key", ollamaEndpoint: "http://127.0.0.1:11434",
    async fetchRequest(url, options) {
      const body = JSON.parse(options.body);
      if (url === "https://api.openai.com/v1/responses") {
        assert.equal(options.headers.Authorization, "Bearer fixture-key");
        assert.equal(body.model, openAIModel);
        assert.equal(body.store, false);
        assert.equal(body.max_output_tokens, 900);
        assert.equal(body.text.format.strict, true);
        const envelope = JSON.parse(body.input);
        received.push(envelope);
        return Response.json({
          status: "completed", model: openAIModel,
          output: [{ type: "message", content: [{ type: "output_text", text: output(envelope) }] }],
          usage: { input_tokens: 1500, output_tokens: 100, input_tokens_details: { cached_tokens: 1000 } }
        });
      }
      assert.equal(url, "http://127.0.0.1:11434/api/chat");
      assert.equal(options.headers.Authorization, undefined);
      assert.equal(body.model, "local-model:latest");
      assert.equal(body.stream, false);
      assert.equal(body.options.num_predict, 900);
      assert.equal(body.format.properties.version.enum[0], "0.2");
      const envelope = JSON.parse(body.messages[1].content);
      received.push(envelope);
      return Response.json({ done: true, message: { content: output(envelope) } });
    }
  });
  let selection = { provider: "openai", model: openAIModel };
  let last;
  let reads = 0;
  const session = createConversationSession({
    memoryStore: { async recall() { reads++; return { fileId: "file-1", record }; } },
    async provider(envelope) {
      last = await invoke({ ...selection, envelope });
      return last.raw;
    }
  });
  const first = await session.send("Hello Aida. Do you remember what I told you when we first met?");
  assert.equal(first.response.reply, record.text);
  assert.equal(last.provider, "openai");
  assert.ok(Math.abs(last.usage.estimatedUsd - 0.00011) < 1e-10);
  selection = { provider: "ollama", model: "local-model:latest" };
  const second = await session.send("Tell me again.");
  assert.equal(last.provider, "ollama");
  assert.equal(last.usage, null);
  assert.equal(reads, 2);
  assert.deepEqual(received[1].identity, received[0].identity);
  assert.deepEqual(received[1].memory.facts, received[0].memory.facts);
  assert.deepEqual(received[1].affect, first.response.affect);
  assert.deepEqual(received[1].memory.recent.map(entry => entry.text), [received[0].user.text, first.response.reply]);
  assert.deepEqual(second.response, first.response);
});

test("provider errors are explicit and no fallback is called", async () => {
  const { envelope } = await createConversationSession({
    memoryStore: { recall: async () => null }, provider: async input => output(input)
  }).send("Do you remember?");
  let calls = 0;
  const request = (invoke, provider = "openai", model = openAIModel, input = envelope) =>
    invoke({ provider, model, envelope: input });
  const configured = createProviders({
    apiKey: "fixture-key", ollamaEndpoint: "http://127.0.0.1:11434",
    async fetchRequest() { calls++; return new Response(null, { status: 404 }); }
  });
  await assert.rejects(request(configured, "openai", "unknown"), /supported OpenAI model/);
  await assert.rejects(request(configured, "ollama", ""), /model identifier/);
  await assert.rejects(request(configured, "openai", openAIModel, { ...envelope, oversized: "x".repeat(50000) }), /too large/);
  assert.equal(calls, 0);
  await assert.rejects(request(configured, "ollama", "missing-model"), /Ollama returned HTTP 404/);
  assert.equal(calls, 1);
  await assert.rejects(request(createProviders()), /OPENAI_API_KEY/);
  await assert.rejects(request(createProviders(), "ollama", "local-model"), /AIDA_OLLAMA_ENDPOINT/);
  const unreachable = createProviders({ apiKey: "fixture-key", fetchRequest: async () => { throw new Error(); } });
  await assert.rejects(request(unreachable), /OpenAI is unreachable/);
});

test("missing memory is explicit in the model input, and invalid responses are rejected", async () => {
  let invalid;
  const invoke = createProviders({
    apiKey: "fixture-key",
    async fetchRequest(_url, options) {
      const { input, instructions } = JSON.parse(options.body);
      assert.match(instructions, /If absent, say you don't have that memory/);
      const envelope = JSON.parse(input);
      assert.deepEqual(envelope.memory.facts, []);
      const raw = invalid ? '{"reply":"Invented memory"}' : output(envelope);
      return Response.json({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: raw }] }] });
    }
  });
  const session = createConversationSession({
    memoryStore: { recall: async () => null },
    provider: async envelope => (await invoke({ provider: "openai", model: openAIModel, envelope })).raw
  });
  assert.match((await session.send("What did I tell you?")).response.reply, /don't have/);
  invalid = true;
  await assert.rejects(session.send("What did I tell you?"), /provider failed/);
});
