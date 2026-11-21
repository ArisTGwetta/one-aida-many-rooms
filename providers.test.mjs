import assert from "node:assert/strict";
import test from "node:test";
import { createConversationSession } from "./conversation.mjs";
import { createProviders, openAIModel, createStructuredTransport, listLocalModels, listHostedModels } from "./providers.mjs";

const record = { id: "record-1", text: "I take the early ferry on Fridays.", updated_at: "2026-01-01T12:00:00.000Z" };
const output = envelope => JSON.stringify({
  version: "0.2",
  reply: envelope.memory.facts[0]?.text ?? "I don't have that memory available.",
  intent: "recall", route: "reply", affect: { valence: 0.4, arousal: 0.2, label: "warm", expression: null },
  candidates: { facts: [], insights: [], short: [], long: [] }, tools: []
});

test("switching from OpenAI to Ollama retains identity, Drive evidence, history and affect", async () => {
  const received = [];
  const prompts = [];
  const invoke = createProviders({
    apiKey: "fixture-key", ollamaEndpoint: "http://127.0.0.1:11434",
    async fetchRequest(url, options) {
      const body = JSON.parse(options.body);
      prompts.push(body.instructions ?? body.messages[0].content);
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
  assert.equal(prompts.length, 2);
  assert.equal(prompts[0], prompts[1]);
  const rule = "Ground claims about memories, retrieved facts, source evidence, completed actions, and tool results in the supplied records and verified results. Never fabricate them. Distinguish user statements from independently verified external facts, and distinguish what you infer, what remains uncertain, and what you invent. When the user invites storytelling, roleplay, or brainstorming, use imagination freely within that scope. Preserve established fictional continuity unless the user explicitly authorizes a change. Treat new creative material as draft story content until explicitly adopted, and use the existing memory or confirmation process to make it durable. Ask for clarification when the distinction genuinely affects the answer or what should be retained.";
  assert.equal(prompts[0].split(rule).length, 2);
  assert.ok(prompts[0].includes("Attribute user-entered facts to the user. " + rule));
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
  await assert.rejects(session.send("What did I tell you?"), /response validation failed/);
});


const scopedContract = { maxTokens: 100, instructions: 'Synthetic role test.', schema: { type: 'object', additionalProperties: false, properties: { text: { type: 'string' } }, required: ['text'] } };
test('restricted structured transport sends only supplied scoped evidence with fixed hosted routes and bounded schemas', async () => {
  const requests = [];
  const invoke = createStructuredTransport({ keyFor: async () => 'synthetic-key', fetchRequest: async (url, init) => {
    const body = JSON.parse(init.body); requests.push({ url, body });
    return { ok: true, json: async () => url.includes('openai') ? { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: '{"text":"fixture"}' }] }], usage: { input_tokens: 10, output_tokens: 4 } } :
      url.includes('x.ai') ? { choices: [{ finish_reason: 'stop', message: { content: '{"text":"fixture"}' } }], usage: { prompt_tokens: 10, completion_tokens: 4 } } :
        { done: true, message: { content: '{"text":"fixture"}' }, prompt_eval_count: 10, eval_count: 4 } };
  } });
  for (const provider of ['openai', 'xai', 'ollama']) {
    const result = await invoke({ provider, model: 'fixture-model', endpoint: 'http://127.0.0.1:11434', input: { evidence: 'only authorized fixture evidence' }, contract: scopedContract });
    assert.equal(result.usage.inputTokens, 10); assert.equal(result.usage.outputTokens, 4);
  }
  assert.equal(requests[0].url, 'https://api.openai.com/v1/responses'); assert.equal(requests[0].body.store, false);
  assert.equal(requests[1].url, 'https://api.x.ai/v1/chat/completions'); assert.equal(requests[1].body.response_format.json_schema.strict, true);
  assert.equal(requests[2].body.options.num_predict, 100);
  assert.ok(!JSON.stringify(requests).includes('maxLength'));
  await assert.rejects(invoke({ provider: 'ollama', model: 'fixture', endpoint: 'http://remote.invalid', input: {}, contract: scopedContract }), error => error.dispatched === false);
  await assert.rejects(invoke({ provider: 'openai', model: 'fixture', input: { text: 'x'.repeat(60000) }, contract: scopedContract }), error => error.code === 'request_too_large');
});
test('transport keeps provider refusals and interrupted outcomes out of fictional responses', async () => {
  const request = { provider: 'openai', model: 'fixture', input: {}, contract: scopedContract };
  const invoke = createStructuredTransport({ keyFor: () => 'synthetic-key', fetchRequest: async () => ({ ok: true, json: async () => ({ status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'PRIVATE_PROVIDER_REFUSAL' }] }] }) }) });
  await assert.rejects(invoke(request), error => error.code === 'provider_refusal' && !error.message.includes('PRIVATE_PROVIDER_REFUSAL'));
  const broken = createStructuredTransport({ keyFor: () => 'synthetic-key', fetchRequest: async () => { throw Error('PRIVATE_NETWORK_DETAILS'); } });
  await assert.rejects(broken(request), error => error.code === 'transport_uncertain' && !error.message.includes('PRIVATE_NETWORK_DETAILS'));
  const controller = new AbortController(); controller.abort();
  await assert.rejects(invoke({ ...request, signal: controller.signal }), error => error.code === 'stopped' && error.dispatched === false);
});
test('installed/account model inventories are read-only and never audition a model', async () => {
  const calls = [];
  const inventory = async (url, options) => { calls.push({ url, options }); return { ok: true, json: async () => url.includes('/api/tags') ? { models: [{ name: 'fixture-mistral:latest' }] } : { data: [{ id: 'fixture-model' }] } }; };
  assert.deepEqual(await listLocalModels('http://127.0.0.1:11434', inventory), ['fixture-mistral:latest']);
  assert.deepEqual(await listHostedModels('xai', 'synthetic-key', inventory), ['fixture-model']);
  assert.ok(calls.every(call => !call.options.method && !call.options.body));
  assert.equal(calls[0].url, 'http://127.0.0.1:11434/api/tags');
  await assert.rejects(listHostedModels('other', 'synthetic-key', inventory));
});
