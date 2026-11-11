import assert from "node:assert/strict";
import test from "node:test";
import { createJournal, makeJournalEvent } from "./recent-journal.mjs";
import { createSleepCycle, createSleepStore } from "./sleep.mjs";
import { createProviders, openAIModel } from "./providers.mjs";

function fakeDrive() {
  const files = new Map();
  let id = 0;
  let failure;
  let time = Date.now();
  async function fetchRequest(input, options) {
    const url = new URL(input);
    assert.equal(options.cache, "no-store");
    if (url.pathname.endsWith("/generateIds")) return Response.json({ ids: [`file-${++id}`] });
    if (url.pathname === "/upload/drive/v3/files") {
      const boundary = options.headers["Content-Type"].split("boundary=")[1];
      const [metadata, record] = options.body.split("--" + boundary).slice(1, 3)
        .map(part => JSON.parse(part.split("\r\n\r\n")[1]));
      assert.deepEqual(metadata.parents, ["fixture-folder"]);
      if (files.has(metadata.id)) return new Response(null, { status: 409 });
      const lose = metadata.appProperties.kind === "run" ? failure : null;
      if (lose) failure = undefined;
      if (lose !== "before") files.set(metadata.id, { ...metadata, record });
      if (lose) throw new Error("Lost connection");
      return Response.json({ id: metadata.id });
    }
    if (url.pathname === "/drive/v3/files") {
      const query = url.searchParams.get("q");
      assert.match(query, /^'fixture-folder' in parents and trashed = false/);
      const filters = [...query.matchAll(/key='([^']+)' and value='([^']+)'/g)];
      const optional = filters.filter(([, key]) => key.startsWith("p") && key !== "proposal" || key === "disposition");
      const required = filters.filter(filter => !optional.includes(filter));
      const cutoff = query.match(/createdTime > '([^']+)'/)?.[1];
      const eligible = [...files.values()].reverse().filter(file => required.every(([, key, value]) => file.appProperties[key] === value) &&
        (!optional.length || optional.some(([, key, value]) => file.appProperties[key] === value &&
          (key !== "disposition" || value !== "provisional" || file.record.savedAt > cutoff))));
      const offset = Number(url.searchParams.get("pageToken") ?? 0);
      const size = Number(url.searchParams.get("pageSize"));
      return Response.json({
        files: eligible.slice(offset, offset + size).map(({ id, appProperties }) => ({ id, appProperties })),
        nextPageToken: eligible.length > offset + size ? String(offset + size) : undefined
      });
    }
    const file = files.get(url.pathname.split("/").at(-1));
    assert.equal(url.searchParams.get("alt"), "media");
    return file ? Response.json(file.record) : new Response(null, { status: 404 });
  }
  const connect = () => ({
    journal: createJournal("fixture-folder", () => "fixture-token", fetchRequest, () => time),
    store: createSleepStore("fixture-folder", () => "fixture-token", fetchRequest)
  });
  return { connect, files, fail: phase => { failure = phase; }, setTime: value => { time = value; } };
}

const conversationId = crypto.randomUUID();
const chaos = "For a continuity test, Chaos is appointed Chief Inspector of Sardine Shipments.";
const description = "Chaos is an electronic cat, referred to as she, and we playfully blame her for household mishaps.";
const question = "What is a staphylococcus?";
async function journalTurn(journal, text, disposition = "candidate", time = Date.now()) {
  const turnId = crypto.randomUUID();
  const at = new Date(time).toISOString();
  const turn = {
    conversationId, turnId, order: time, startedAt: at, completedAt: at,
    user: { role: "user", source: `turn:${turnId}:user`, text },
    aida: { role: "aida", source: `turn:${turnId}:aida`, text: "Understood." }
  };
  await journal.save({ event: makeJournalEvent(conversationId, turn, disposition, undefined, time) });
  return turn;
}

function proposal(category, text, source) {
  return { category, text, sources: [source], confidence: "medium", reason: "The cited exchange supports this proposal." };
}
const response = proposals => ({ raw: JSON.stringify({ proposals }), provider: "fixture" });

test("Drive-only sleep classifies the Chaos fixtures, persists evidence and recovers the queue on a fresh device", async () => {
  const drive = fakeDrive();
  const client = drive.connect();
  const a = await journalTurn(client.journal, chaos);
  const b = await journalTurn(client.journal, description);
  const c = await journalTurn(client.journal, question);
  const now = Date.now();
  const yesterday = now - 25 * 3600000;
  drive.setTime(yesterday);
  await journalTurn(client.journal, "The temporary detail has expired.", "provisional", yesterday);
  drive.setTime(now);
  await journalTurn(client.journal, "I chose a synthetic workshop title.");
  let calls = 0;
  const provider = async ({ evidence }) => {
    calls++;
    assert.equal(evidence.length, 6);
    assert.ok(evidence.some(item => item.source === a.user.source));
    assert.ok(evidence.some(item => item.source === b.user.source));
    assert.ok(!evidence.some(item => item.source === c.user.source || item.text.includes("expired")));
    return response([
      proposal("DIARY", "A synthetic continuity scenario assigned Chaos a playful role.", a.user.source),
      proposal("FACT", b.user.text, b.user.source),
      proposal("INSIGHT", "The household blame appears to be a recurring joke.", b.user.source)
    ]);
  };
  const runSleep = createSleepCycle({ ...client, provider });
  const { run } = await runSleep();
  assert.equal(run.examined.length, 8);
  assert.equal(run.examined.find(item => item.source === c.user.source).incidental, true);
  assert.deepEqual(run.noUpdates, ["SHORT", "LONG"]);
  assert.equal(run.proposals[0].synthetic, true);
  assert.equal(run.proposals[0].evidence[0].source, a.user.source);
  assert.equal(run.proposals[1].text, description);
  assert.equal(run.proposals[1].evidence[0].text, description);
  assert.equal(run.proposals[1].status, "pending");
  const fresh = drive.connect();
  assert.equal((await fresh.store.queue()).runs[0].id, run.id);
  const repeated = await createSleepCycle({ ...fresh, provider })();
  assert.equal(repeated.reused, true);
  assert.equal(calls, 1);
  assert.equal([...drive.files.values()].filter(file => file.record.kind === "run").length, 1);
});

test("rejects invented sources, incidental references, and inferred facts before saving", async () => {
  const drive = fakeDrive();
  const client = drive.connect();
  const b = await journalTurn(client.journal, description);
  const c = await journalTurn(client.journal, question);
  for (const candidate of [
    proposal("FACT", description, "turn:invented:user"),
    proposal("INSIGHT", "The user has a health condition.", c.user.source),
    proposal("FACT", "Chaos causes household mishaps.", b.user.source),
    proposal("FACT", b.aida.text, b.aida.source)
  ]) {
    await assert.rejects(createSleepCycle({ ...client, provider: async () => response([candidate]) })(), /source|FACT/);
  }
  assert.equal((await client.store.queue()).runs.length, 0);
});

test("no-update is durable and safe to repeat without invoking the provider for a quick question", async () => {
  const drive = fakeDrive();
  const client = drive.connect();
  await journalTurn(client.journal, question);
  const cycle = createSleepCycle({ ...client, provider: async () => assert.fail("Incidental evidence reached provider") });
  const { run } = await cycle();
  assert.deepEqual(run.proposals, []);
  assert.deepEqual(run.noUpdates, ["DIARY", "FACT", "INSIGHT", "SHORT", "LONG"]);
  assert.equal((await cycle()).reused, true);
});

test("interrupted atomic run retries and review history preserves the proposal as new journal activity continues", async () => {
  for (const phase of ["before", "after"]) {
    const drive = fakeDrive();
    const client = drive.connect();
    const b = await journalTurn(client.journal, description);
    let calls = 0;
    const provider = async () => { calls++; return response([proposal("FACT", b.user.text, b.user.source)]); };
    const cycle = createSleepCycle({ ...client, provider });
    drive.fail(phase);
    await assert.rejects(cycle(), /reach Google Drive/);
    const { run } = await cycle();
    assert.equal(calls, 1);
    const original = run.proposals[0];
    await journalTurn(client.journal, "A separate workshop decision was made.");
    const followUp = await cycle();
    assert.equal(followUp.run.proposals.length, 0);
    assert.deepEqual(followUp.run.existingProposalIds, [original.id]);
    const { store } = drive.connect();
    const corrected = await store.review({ proposalId: original.id, status: "corrected", correction: "Reviewed wording." });
    await store.review({ proposalId: original.id, status: "rejected", previous: corrected.id });
    const history = await drive.connect().store.reviewPage(original.id);
    assert.deepEqual(history.decisions.map(item => item.status), ["rejected", "corrected"]);
    assert.equal(history.decisions[0].previous, corrected.id);
    assert.equal(history.decisions[1].authority, "proposal-review-only");
    assert.deepEqual(await store.findProposal(original.id), original);
    assert.equal([...drive.files.values()].filter(file => file.record.proposals?.some(item => item.id === original.id)).length, 1);
  }
});

test("selected OpenAI and Ollama adapters use the sleep schema without changing the chat contract", async () => {
  const providers = createProviders({
    apiKey: "fixture-key", ollamaEndpoint: "http://127.0.0.1:11434",
    async fetchRequest(url, options) {
      const body = JSON.parse(options.body);
      const raw = '{"proposals":[]}';
      if (url.includes("openai.com")) {
        assert.equal(body.text.format.name, "aida_sleep_v01");
        assert.equal(body.text.format.strict, true);
        return Response.json({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: raw }] }] });
      }
      assert.deepEqual(body.format.required, ["proposals"]);
      return Response.json({ done: true, message: { content: raw } });
    }
  });
  for (const [provider, model] of [["openai", openAIModel], ["ollama", "local-model"]]) {
    const result = await providers({ provider, model, sleep: { version: "sleep-v0.1", evidence: [] } });
    assert.deepEqual(JSON.parse(result.raw), { proposals: [] });
  }
});
