import assert from "node:assert/strict";
import test from "node:test";
import { createGlassesState, maxImageBytes } from "./glasses.mjs";
import { createAwakeSteward } from "./awake-context.mjs";
import { createConversationSession } from "./conversation.mjs";
import { createProviders, openAIModel } from "./providers.mjs";

// A synthetic PNG with a red pixel to the left of a blue pixel.
import { deflateSync } from "node:zlib";
function fixturePng(pixels) {
  const chunk = (type, content) => {
    const bytes = Buffer.concat([Buffer.from(type), content]);
    let crc = 0xffffffff;
    for (const byte of bytes) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    const header = Buffer.alloc(4);
    const footer = Buffer.alloc(4);
    header.writeUInt32BE(content.length);
    footer.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([header, bytes, footer]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(2, 0);
  header.writeUInt32BE(1, 4);
  header.set([8, 2], 8);
  return Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.from([0, ...pixels]))), chunk("IEND", Buffer.alloc(0))]);
}
const original = fixturePng([255, 0, 0, 0, 0, 255]);
const replacement = fixturePng([0, 255, 0, 255, 255, 0]);
const sample = (bytes, name = "synthetic.png") => new File([bytes], name, { type: "image/png" });

test("image replacement discards old evidence on errors, Clear, and superseded loads", async () => {
  const prior = globalThis.Image;
  globalThis.Image = class {
    naturalWidth = 2;
    naturalHeight = 1;
    async decode() {}
  };
  try {
    const desk = createGlassesState();
    desk.enter("atlas", "library");
    await desk.replace(sample(original));
    assert.equal(desk.snapshot().image.split(",")[1], original.toString("base64"));
    assert.match(desk.snapshot().evidence.source.sha256, /^[a-f0-9]{64}$/);
    assert.equal(desk.snapshot().evidence.source.location, undefined);
    desk.changeProject("orchard");
    assert.equal(desk.snapshot().evidence.initiatingRoom, "library");
    assert.equal(desk.snapshot().evidence.initiatingProjectId, "atlas");
    assert.equal(desk.snapshot().evidence.projectId, "orchard");
    assert.equal(desk.snapshot().evidence.changed, true);
    const invalid = desk.replace(sample("not PNG"));
    assert.equal(desk.snapshot().image, undefined);
    await invalid;
    assert.equal(desk.snapshot().evidence.status, "failed");
    await desk.replace(sample(Buffer.alloc(maxImageBytes + 1)));
    assert.equal(desk.snapshot().image, undefined);
    await desk.replace(sample(replacement, "replacement.png"));
    assert.equal(desk.snapshot().image.split(",")[1], replacement.toString("base64"));
    desk.clear();
    assert.equal(desk.snapshot().evidence.source, null);
    assert.equal(desk.snapshot().image, undefined);

    let finish;
    const racing = createGlassesState(() => new Promise(resolve => { finish = resolve; }));
    const first = racing.replace(sample(original));
    racing.clear();
    finish({ dataUrl: "stale", metadata: {} });
    await first;
    assert.equal(racing.snapshot().image, undefined);
    assert.equal(racing.snapshot().evidence.status, "empty");
  } finally {
    if (prior === undefined) delete globalThis.Image;
    else globalThis.Image = prior;
  }
});

test("Glasses uses the authorized multipart route for follow-ups and keeps pixels out of conversation state", async () => {
  const empty = { long: [], short: [], recent: [], facts: [], insights: [] };
  const project = { id: "atlas", name: "Atlas", scope: "fictional" };
  const steward = createAwakeSteward({
    async load() { return { global: empty, projects: [project], capabilities: [], references: [] }; },
    async project(id) { assert.equal(id, "atlas"); return { continuity: empty, reference: "drive:atlas" }; }
  });
  const requests = [];
  const invoke = createProviders({ apiKey: "fixture-key", async fetchRequest(url, options) {
    assert.equal(url, "https://api.openai.com/v1/responses");
    assert.equal(options.headers.Authorization, "Bearer fixture-key");
    const body = JSON.parse(options.body);
    const pixelPart = Array.isArray(body.input) ? body.input[0].content[1] : null;
    const wire = pixelPart ? body.input[0].content[0].text : body.input;
    assert.ok(!wire.includes("base64,"));
    const envelope = JSON.parse(wire);
    assert.match(body.instructions, /active image|active visual source/);
    assert.equal(envelope.context.currentProjectId, pixelPart ? "atlas" : null);
    requests.push(pixelPart?.image_url ?? null);
    const reply = { version: "0.2", reply: "Fixture visual reply.", intent: "conversation", route: "reply",
      affect: envelope.affect, candidates: { facts: [], insights: [], short: [], long: [] }, tools: [],
      awake: { action: { kind: "just_keep_talking", target: null, arguments: [], sources: [], uncertainty: null },
        rebuild: null, changes: [], candidates: [], contradictions: [] } };
    return Response.json({ status: "completed", output: [{ type: "message", content: [
      { type: "output_text", text: JSON.stringify(reply) }
    ] }] });
  } });
  const data = bytes => "data:image/png;base64," + bytes.toString("base64");
  const inspect = image => ({ image, evidence: { kind: "glasses_image", projectId: image ? "atlas" : null,
    source: image ? { name: "synthetic.png" } : null, status: image ? "ready" : "empty" } });
  const session = createConversationSession({
    steward, memoryStore: { recall: async () => null },
    async provider(envelope, image) { return (await invoke({ provider: "openai", model: openAIModel, envelope, image })).raw; }
  });
  const first = await session.send("What do you see?", { visual: inspect(data(original)) });
  await session.send("Which color is on the right?", { visual: inspect(data(original)) });
  await session.send("What changed?", { visual: inspect(data(replacement)) });
  const cleared = await session.send("What is active now?", { visual: inspect() });
  assert.ok(!JSON.stringify(cleared).includes("base64,"));
  assert.equal(first.receipt.outcome.status, "excluded");
  assert.equal(steward.activeProjectId, null);
  assert.deepEqual(requests, [data(original), data(original), data(replacement), null]);
  await assert.rejects(invoke({ provider: "ollama", model: "fixture", envelope: first.envelope, image: data(original) }), /selected route/);
  await assert.rejects(invoke({ provider: "openai", model: openAIModel, envelope: first.envelope }), /image is unavailable/);
  assert.equal(requests.length, 4);
});
