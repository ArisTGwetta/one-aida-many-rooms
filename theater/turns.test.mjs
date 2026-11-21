import test from 'node:test';
import assert from 'node:assert/strict';
import { beginTurn, createTurnRunner, rolePacket, validateWork } from './turns.mjs';
import { createRoleRouter, defaultTurnPolicy } from './providers.mjs';
import { theaterStorage } from './drive-store.mjs';
import { emptyPlay, appendEvent, appendCharacterReply, portfolioView, validatePlay } from './continuity.mjs';
import { proposeRestore } from './restore.mjs';
import { buildMemoryReport } from './reports.mjs';
import { createEvidencePacket } from './rehearsal.mjs';
function fixture() {
  const files = new Map(); let writeFailure = null;
  const drive = {
    verifyFolder: async () => {}, generateId: async () => crypto.randomUUID(),
    async list(query) {
      const q = query.get('q'), ns = q.match(/key='theaterNamespace' and value='([^']+)'/)[1], playId = q.match(/key='playId' and value='([^']+)'/)[1];
      return { files: [...files].filter(([, f]) => f.appProperties.theaterNamespace === ns && f.appProperties.playId === playId)
        .map(([id, { name, appProperties }]) => ({ id, name, appProperties })) };
    },
    async readJson(id) { if (!files.has(id)) throw Error('Not found'); return structuredClone(files.get(id).value); },
    async uploadJson(id, name, appProperties, value) {
      if (writeFailure?.(value, 'before')) throw Error('Interrupted write');
      files.set(id, { name, appProperties, value: structuredClone(value) });
      if (writeFailure?.(value, 'after')) throw Error('Lost write response');
    }
  };
  let storage = theaterStorage(drive);
  const policy = { ...defaultTurnPolicy(), cloudConsent: true,
    game: [{ id: 'openai', provider: 'openai', model: 'fixture-model', endpoint: null, cloudAllowed: true, pricing: { inputPerMillion: 1, outputPerMillion: 2, version: 'fixture' } }],
    meta: [{ id: 'ollama', provider: 'ollama', model: 'fixture-local', endpoint: 'http://127.0.0.1:11434', cloudAllowed: false, pricing: { inputPerMillion: 0, outputPerMillion: 0, version: 'fixture' } }] };
  const calls = []; let behavior = null;
  function runner() {
    const router = createRoleRouter({ operations: storage, inventory: async r => [r.model], transport: async request => {
      calls.push(structuredClone({ ...request, signal: undefined }));
      if (behavior) { const custom = await behavior(request); if (custom) return custom; }
      return { raw: JSON.stringify({ decision: 'speak', text: request.input.role === 'game_character' ? 'Rias answers the greeting.' : 'Aida offers a brief observation.', sources: [request.input.evidence.at(-1).alias] }), usage: { inputTokens: 80, outputTokens: 25 }, model: request.model };
    } });
    return createTurnRunner({ storage, router });
  }
  return { files, policy, calls, runner, get storage() { return storage; },
    reload() { storage = theaterStorage(drive); }, behavior: fn => { behavior = fn; }, fail: fn => { writeFailure = fn; } };
}
test('Send stages one action, Rias and Aida, then verifies a single canonical save with v4 attribution', async () => {
  const f = fixture(), runner = f.runner(), original = emptyPlay('doorway-demo');
  const work = beginTurn(original, 0, 'game', 'Hello, Rias.', 'session-1');
  await runner.start(work);
  assert.equal(await f.storage.loadPlay('doorway-demo'), null);
  const saved = await runner.run(f.policy);
  assert.equal(saved.revision, 1); assert.equal(saved.snapshot.schema, 'theater-play@4');
  assert.equal(saved.snapshot.checkpoints.length, 1); assert.equal(saved.snapshot.events.length, 3);
  assert.deepEqual(saved.snapshot.events.map(e => e.speaker?.id ?? 'francisco'), ['francisco', 'rias', 'aida']);
  assert.deepEqual(f.calls.map(c => c.input.role), ['game_character', 'game_narrator']);
  assert.ok(!JSON.stringify(f.calls).includes('baseRevision'));
  assert.equal(await f.storage.loadWork('doorway-demo'), null);
  validatePlay((await f.storage.loadPlay('doorway-demo')).snapshot);
  await assert.rejects(runner.run(f.policy), /No pending/);
});
test('character and onstage narrator receive only expressly visible active evidence; META sees labeled history', async () => {
  let play = appendEvent(emptyPlay('doorway-demo'), 'meta', 'SYNTHETIC_BACKSTAGE_SECRET', 'secret');
  play = appendEvent(play, 'game', 'UNCLASSIFIED_GAME_KNOWLEDGE', 'unclassified');
  const work = beginTurn(play, 0, 'game', 'A visible greeting.', 'session-1');
  const character = JSON.stringify(rolePacket(work.staged, 'game_character'));
  assert.ok(character.includes('A visible greeting.')); assert.ok(!character.includes('BACKSTAGE_SECRET')); assert.ok(!character.includes('UNCLASSIFIED'));
  assert.ok(!JSON.stringify(rolePacket(work.staged, 'game_narrator')).includes('BACKSTAGE_SECRET'));
  assert.ok(JSON.stringify(rolePacket(work.staged, 'meta_aida')).includes('BACKSTAGE_SECRET'));
  assert.throws(() => beginTurn(play, 0, 'game', 'Private content', 'session-1', 'private_thought'), /do not authorize/);
  assert.throws(() => rolePacket(emptyPlay('doorway-demo'), 'game_character'), /No safely authorized/);
  assert.throws(() => validateWork({ ...work, diagnostics: 'do not store here' }));
});
test('successful partial work recovers on a fresh client without regenerating Rias or changing the verified scene', async () => {
  const f = fixture(), runner = f.runner();
  f.behavior(request => { if (request.input.role === 'game_narrator') throw Object.assign(Error('private diagnostic'), { code: 'provider_http' }); });
  await runner.start(beginTurn(emptyPlay('doorway-demo'), 0, 'game', 'Hello, Rias.', 'session-1'));
  await assert.rejects(runner.run(f.policy));
  assert.deepEqual(runner.current().completed, ['game_character']);
  assert.equal(await f.storage.loadPlay('doorway-demo'), null);
  const pending = JSON.stringify(await f.storage.loadWork('doorway-demo')); assert.ok(!pending.includes('private diagnostic'));
  f.reload(); const resumed = f.runner(); await resumed.recover('doorway-demo');
  f.policy.game.push({ ...f.policy.game[0], id: 'alternate', model: 'fixture-alternate' }); f.behavior(null);
  const saved = await resumed.run(f.policy, { sessionId: 'session-2' });
  assert.equal(saved.snapshot.events.filter(e => e.speaker?.id === 'rias').length, 1);
  assert.equal(f.calls.filter(c => c.input.role === 'game_character').length, 1);
  assert.equal(saved.revision, 1);
  const records = await f.storage.loadLedger('doorway-demo');
  assert.ok(records.some(r => r.sessionId === 'session-2' && r.context === 'game_narrator'));
});
test('Stop preserves a completed contribution and blocks the next request; explicit partial acceptance is verified', async () => {
  const f = fixture(); let runner;
  f.behavior(request => { if (request.input.role === 'game_character') queueMicrotask(() => runner.stop()); });
  runner = f.runner(); await runner.start(beginTurn(emptyPlay('doorway-demo'), 0, 'game', 'A visible action.', 'session-1'));
  await assert.rejects(runner.run(f.policy), /Stopped/);
  assert.equal(f.calls.length, 1); assert.deepEqual(runner.current().completed, ['game_character']);
  assert.equal(await f.storage.loadPlay('doorway-demo'), null);
  const saved = await runner.commit(true);
  assert.equal(saved.snapshot.events.length, 2); assert.equal(saved.revision, 1);
});
test('uncertain attempts require explicit retry, stay bounded and never contaminate later roles across provider changes', async () => {
  const f = fixture(), runner = f.runner(); let first = true;
  f.behavior(() => { if (first) { first = false; throw Object.assign(Error('REFUSAL_PRIVATE_BODY'), { code: 'transport_uncertain' }); } });
  await runner.start(beginTurn(emptyPlay('doorway-demo'), 0, 'game', 'Hello there.', 'session-1'));
  await assert.rejects(runner.run(f.policy), /uncertain/); await assert.rejects(runner.run(f.policy), /Explicit Retry/);
  assert.equal(f.calls.length, 1);
  let saved = await runner.run(f.policy, { retryUncertain: true });
  f.policy.game = [{ ...f.policy.meta[0] }];
  for (let n = 0; n < 2; n++) {
    await runner.start(beginTurn(saved.snapshot, saved.revision, 'game', 'Another visible greeting ' + n, 'session-1'));
    saved = await runner.run(f.policy);
  }
  assert.ok(!JSON.stringify(f.calls).includes('REFUSAL_PRIVATE_BODY'));
  for (const role of ['game_character', 'game_narrator', 'meta_aida']) {
    const packet = JSON.stringify(rolePacket(saved.snapshot, role));
    assert.ok(!packet.includes('transport_uncertain')); assert.ok(!packet.includes('execution-ledger'));
  }
  assert.ok(!buildMemoryReport(saved.snapshot, 'meta', { verifiedRevision: 3, unsavedChanges: false, pendingRestore: false }).includes('REFUSAL_PRIVATE_BODY'));
});
test('failed pending writes and lost responses preserve the previous scene and recover without duplicate calls or events', async () => {
  const f = fixture(), runner = f.runner(); let once = true;
  f.fail((value, phase) => {
    if (once && phase === 'after' && value.schema === 'theater-turn-work@1' && value.completed.includes('game_character')) { once = false; return true; }
  });
  await runner.start(beginTurn(emptyPlay('doorway-demo'), 0, 'game', 'A visible greeting.', 'session-1'));
  await assert.rejects(runner.run(f.policy), /Lost write response/);
  assert.equal(f.calls.length, 1); assert.equal(await f.storage.loadPlay('doorway-demo'), null);
  f.fail(null); f.reload(); const resumed = f.runner(); await resumed.recover('doorway-demo');
  const saved = await resumed.run(f.policy);
  assert.equal(f.calls.length, 2); assert.equal(saved.snapshot.events.length, 3);
});
test('canonical save interrupted after upload is retried idempotently, and revision conflicts retain pending work', async () => {
  const f = fixture(), runner = f.runner(); let once = true;
  f.fail((value, phase) => { if (once && phase === 'after' && value.schema === 'theater-snapshots-v1') { once = false; return true; } });
  await runner.start(beginTurn(emptyPlay('doorway-demo'), 0, 'game', 'A visible greeting.', 'session-1'));
  await assert.rejects(runner.run(f.policy), /Lost write response/);
  const saved = await runner.run(f.policy); assert.equal(saved.revision, 1); assert.equal(f.calls.length, 2);
  await runner.start(beginTurn(saved.snapshot, 1, 'game', 'Another greeting.', 'session-1'));
  await f.storage.savePlay('doorway-demo', 1, saved.snapshot, 'foreign-operation');
  await assert.rejects(runner.run(f.policy), /Canonical scene changed/);
  assert.equal(f.calls.length, 2); assert.equal(runner.current().status, 'pending');
});
test('v4 rewind, retell, reports and rehearsal exclude abandoned contributions; META labels them after save/reload', async () => {
  const f = fixture(), runner = f.runner(); let saved;
  for (let n = 0; n < 2; n++) {
    await runner.start(beginTurn(saved?.snapshot ?? emptyPlay('doorway-demo'), saved?.revision ?? 0, 'game', 'Visible greeting ' + n, 'session-1'));
    saved = await runner.run(f.policy);
  }
  const abandoned = saved.snapshot.events.slice(3).map(e => e.id);
  const restored = proposeRestore(saved.snapshot, saved.snapshot.checkpoints.at(-1).id, saved.revision);
  await f.storage.savePlay('doorway-demo', saved.revision, restored.snapshot, restored.operationId);
  const recovered = (await f.storage.loadPlay('doorway-demo')).snapshot;
  const game = portfolioView(recovered, 'game'), meta = portfolioView(recovered, 'meta');
  assert.ok(abandoned.every(id => !JSON.stringify(game).includes(id)));
  assert.ok(meta.events.filter(e => abandoned.includes(e.id)).every(e => e.branchStatus === 'discarded'));
  const packet = await createEvidencePacket(game, 'game', { playSchema: recovered.schema, verifiedRevision: 3, unsavedChanges: false, pendingRestore: false });
  assert.ok(abandoned.every(id => !JSON.stringify(packet).includes(id)));
  const retell = beginTurn(recovered, 3, 'game', 'A replacement visible greeting.', 'session-1', 'speech', true);
  assert.equal(retell.base.events.length, recovered.events.length);
  assert.equal(retell.staged.checkpoints.length, 1); validatePlay(retell.staged);
});
test('operational stores reject duplicate/conflicting records, missing work versions and cross-play envelopes', async () => {
  const f = fixture(), work = beginTurn(emptyPlay('doorway-demo'), 0, 'game', 'Hello.', 'session-1');
  await f.storage.saveWork(work); await f.storage.saveWork(work);
  assert.equal(f.files.size, 1);
  await assert.rejects(f.storage.saveWork({ ...work, sessionId: 'session-2' }), /identity conflict/);
  const gap = { ...work, sequence: 3 }; await f.storage.saveWork(gap);
  await assert.rejects(f.storage.loadWork('doorway-demo'), /Missing pending/);
  assert.throws(() => validateWork({ ...work, playId: 'foreign-play' }));
});

test('a provider refusal two turns earlier stays isolated after fallback, provider switching and reload', async () => {
  const f = fixture(), runner = f.runner(); let refuse = true;
  f.policy.game.push({ ...f.policy.meta[0] });
  f.behavior(() => { if (refuse) { refuse = false; throw Object.assign(Error('SYNTHETIC_PROVIDER_REFUSAL_DETAILS'), { code: 'provider_refusal' }); } });
  await runner.start(beginTurn(emptyPlay('doorway-demo'), 0, 'game', 'An audible greeting.', 'session-1'));
  let saved = await runner.run(f.policy);
  f.reload(); const resumed = f.runner(); f.policy.game = [{ ...f.policy.meta[0] }];
  for (let n = 0; n < 2; n++) {
    await resumed.start(beginTurn(saved.snapshot, saved.revision, 'game', 'A new audible greeting ' + n, 'session-2'));
    saved = await resumed.run(f.policy);
  }
  for (const context of ['game_character', 'game_narrator', 'meta_aida']) {
    const prompt = JSON.stringify(rolePacket(saved.snapshot, context));
    assert.doesNotMatch(prompt, /PROVIDER_REFUSAL|provider_refusal|execution-ledger/);
  }
  const ledger = await f.storage.loadLedger('doorway-demo');
  assert.ok(ledger.some(row => row.status === 'refused'));
  assert.doesNotMatch(JSON.stringify(ledger), /SYNTHETIC_PROVIDER_REFUSAL_DETAILS/);
  for (const scope of ['game', 'meta']) {
    const projection = portfolioView(saved.snapshot, scope);
    const packet = await createEvidencePacket(projection, scope, { playSchema: saved.snapshot.schema, verifiedRevision: saved.revision, unsavedChanges: false, pendingRestore: false });
    assert.doesNotMatch(JSON.stringify(packet), /PROVIDER_REFUSAL|provider_refusal/);
  }
});

test('existing v1/v2/v3 snapshots remain readable and are upgraded only by a newly verified turn save', async () => {
  for (const schema of ['theater-play@1', 'theater-play@2', 'theater-play@3']) {
    const f = fixture();
    const source = emptyPlay('doorway-demo');
    if (schema !== 'theater-play@1') Object.assign(source, { schema, branchId: 'initial', activeGameIds: [], checkpoints: [] });
    await f.storage.savePlay('doorway-demo', 0, source, 'original');
    const bytes = JSON.stringify([...f.files.values()][0].value);
    const runner = f.runner();
    await runner.start(beginTurn(source, 1, 'game', 'A new visible greeting.', 'session-1'));
    const saved = await runner.run(f.policy);
    assert.equal(saved.snapshot.schema, 'theater-play@4');
    assert.equal(JSON.stringify([...f.files.values()][0].value), bytes);
  }
});

test('automatic character context preserves the exact historical approval boundary rather than widening to a full GAME source', () => {
  let play = appendEvent(emptyPlay('doorway-demo'), 'game', 'A visitor is visible. SYNTHETIC_CONCEALED_OBJECT.', 'source-1');
  play = appendCharacterReply(play, 'Who is there?', { origin: 'manually_supplied_model_proposal', attemptId: 'manual-attempt', packetFingerprint: 'a'.repeat(64),
    sourceReferences: [{ alias: 'visible-1', sourceId: 'source-1', excerpt: 'A visitor is visible.' }], acceptedBy: 'francisco', acceptedAt: '2026-11-21T12:00:00Z', verifiedRevision: 1 });
  const work = beginTurn(play, 1, 'game', 'Hello, Rias.', 'session-1');
  const packet = JSON.stringify(rolePacket(work.staged, 'game_character'));
  assert.match(packet, /A visitor is visible/); assert.match(packet, /Who is there/);
  assert.doesNotMatch(packet, /SYNTHETIC_CONCEALED_OBJECT/);
  assert.deepEqual(rolePacket(work.staged, 'game_character').input.memory, { long: [], short: [] });
});

test('META Send calls only Aida and cannot change GAME or invoke retell', async () => {
  const f = fixture(), runner = f.runner();
  await runner.start(beginTurn(emptyPlay('doorway-demo'), 0, 'meta', 'A synthetic backstage planning question.', 'session-1'));
  const saved = await runner.run(f.policy);
  assert.deepEqual(f.calls.map(call => call.input.role), ['meta_aida']);
  assert.equal(saved.snapshot.events.at(-1).speaker.id, 'aida');
  assert.deepEqual(portfolioView(saved.snapshot, 'game'), { playId: 'doorway-demo', events: [], portfolio: { long: [], short: [], recent: [] } });
  assert.throws(() => beginTurn(saved.snapshot, 1, 'meta', 'Change the last action.', 'session-1', 'speech', true), /Onstage/);
});

test('the advanced manual clipboard fallback still accepts attributed replies on v4 without adding a checkpoint', async () => {
  const { createCharacterRehearsal } = await import('./characters.mjs');
  const f = fixture(), runner = f.runner();
  await runner.start(beginTurn(emptyPlay('doorway-demo'), 0, 'game', 'An audible greeting.', 'session-1'));
  const saved = await runner.run(f.policy), manual = createCharacterRehearsal();
  const metadata = { playSchema: saved.snapshot.schema, verifiedRevision: saved.revision, unsavedChanges: false, pendingRestore: false };
  manual.update(portfolioView(saved.snapshot, 'game'), metadata);
  manual.approve([{ sourceId: saved.snapshot.events[0].id, excerpt: 'An audible greeting.' }]);
  const packet = await manual.prepare();
  manual.validateReply({ schema: 'theater-character-reply@1', characterId: 'rias', attemptId: packet.attemptId, fingerprint: packet.fingerprint, dialogue: 'A manually supplied fictional answer.' });
  const next = await manual.accept(saved.snapshot, metadata);
  assert.equal(next.schema, 'theater-play@4'); assert.equal(next.checkpoints.length, 1);
  assert.equal(next.events.at(-1).provenance.origin, 'manually_supplied_model_proposal');
  assert.equal(f.calls.length, 2);
});
