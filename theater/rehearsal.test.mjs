import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyPlay, appendEvent, setEntry, portfolioView } from './continuity.mjs';
import { playerAction, proposeRestore } from './restore.mjs';
import { createEvidencePacket, validateProposal, useHypotheticalBaseline } from './rehearsal.mjs';
const metadata = { playSchema: 'theater-play@2', verifiedRevision: 5, unsavedChanges: false, pendingRestore: false };
function fixture() {
  let p = appendEvent(emptyPlay('doorway-demo'), 'game', 'Synthetic guest brought red flowers.', 'flowers');
  p = setEntry(p, 'game', 'long', 'A guest brought red flowers.', ['flowers']);
  p = appendEvent(p, 'meta', 'Synthetic secret: the cave is a painted set.', 'secret');
  p = playerAction(p, 'Synthetic first cave action.', 'cave-one', 'cp-one');
  p = playerAction(p, 'Synthetic second cave action.', 'cave-two', 'cp-two');
  return proposeRestore(p, 'cp-one', 0, 'discarded-branch').snapshot;
}
const packetFor = (p, audience = 'game', info = metadata, hypothesis = null) => createEvidencePacket(portfolioView(p, audience), audience, info, hypothesis);
function proposal(packet, operations = []) {
  return { schema: 'theater-rehearsal-proposal@1', audience: packet.audience, playId: packet.playId,
    baselineFingerprint: packet.baselineFingerprint, operations };
}
function operation(overrides = {}) {
  return { layer: 'short', kind: 'add', target: null, text: 'Flowers were brought by a guest.', classification: 'accepted',
    evidence: [{ sourceId: 'flowers', excerpt: 'guest brought red flowers' }], reason: 'Relevant scene continuity.', ...overrides };
}
test('audience packets contain only eligible projection and allowlisted metadata with reproducible fingerprints', async () => {
  const p = fixture(), before = structuredClone(p), game = await packetFor(p), meta = await packetFor(p, 'meta');
  const text = JSON.stringify(game);
  for (const forbidden of ['painted set', 'secret', 'cave-one', 'cave-two', 'cp-one', 'discarded-branch', 'checkpoints'])
    assert.ok(!text.includes(forbidden), forbidden);
  assert.deepEqual(game.baseline.long[0].sources, ['flowers']);
  assert.match(game.baselineFingerprint, /^[0-9a-f]{64}$/);
  assert.equal((await packetFor(p)).baselineFingerprint, game.baselineFingerprint);
  assert.equal(meta.evidence.find(e => e.sourceId === 'secret').status, 'backstage');
  assert.equal(meta.evidence.find(e => e.sourceId === 'cave-one').status, 'discarded');
  assert.equal(meta.evidence.find(e => e.sourceId === 'flowers').status, 'accepted');
  await assert.rejects(createEvidencePacket(p, 'game', metadata));
  await assert.rejects(createEvidencePacket(portfolioView(p, 'meta'), 'game', metadata));
  await assert.rejects(packetFor(p, 'game', { ...metadata, token: 'excluded' }));
  assert.deepEqual(p, before);
});
test('keep add correction and no-update preserve unaddressed memories and show explicit before and after', async () => {
  let p = appendEvent(fixture(), 'game', 'Correction: the flowers were blue, not red.', 'correction');
  const packet = await packetFor(p);
  const unchanged = await validateProposal(packet, proposal(packet), packet);
  assert.deepEqual(unchanged.before, unchanged.proposed);
  const keep = operation({ layer: 'long', kind: 'keep', target: 0, text: null, classification: null, evidence: [] });
  const noUpdate = operation({ kind: 'no_update', text: null, classification: null, evidence: [] });
  const kept = await validateProposal(packet, proposal(packet, [keep, noUpdate]), packet);
  assert.deepEqual(kept.proposed, packet.baseline);
  const update = operation({ layer: 'long', kind: 'correct', target: 0, text: 'The flowers were blue.',
    evidence: [{ sourceId: 'correction', excerpt: 'flowers were blue, not red' }] });
  const result = await validateProposal(packet, proposal(packet, [update, operation()]), packet);
  assert.match(result.before.long[0].text, /red/);
  assert.equal(result.proposed.long[0].text, 'The flowers were blue.');
  assert.deepEqual(result.proposed.long[0].sources, ['correction']);
  assert.equal(result.proposed.short.length, 1);
  assert.match(result.semanticApproval, /NOT APPROVED/);
  assert.equal(p.game.long[0].text, 'A guest brought red flowers.');
  assert.ok(result.supportingEvidence.every(e => ['flowers', 'correction'].includes(e.sourceId)));
  const replaced = await validateProposal(packet, proposal(packet, [operation({ layer: 'long', kind: 'replace', target: 0 })]), packet);
  assert.equal(replaced.proposed.long.length, 1);
});
test('fabricated references and excerpts, wrong audience and inconsistent operations fail closed', async () => {
  const packet = await packetFor(fixture());
  const validResult = await validateProposal(packet, proposal(packet, [operation()]), packet);
  const original = JSON.stringify(validResult);
  const invalidOperations = [
    operation({ evidence: [{ sourceId: 'secret', excerpt: 'painted set' }] }),
    operation({ evidence: [{ sourceId: 'cave-one', excerpt: 'Synthetic first cave action.' }] }),
    operation({ evidence: [{ sourceId: 'invented', excerpt: 'flowers' }] }),
    operation({ evidence: [{ sourceId: 'flowers', excerpt: 'not actually in evidence' }] }),
    operation({ classification: 'backstage' }),
    operation({ kind: 'replace', target: 999 }),
    operation({ kind: 'keep', target: 0 }),
    operation({ evidence: [] }),
    operation({ layer: 'recent' }),
    operation({ permission: 'write' })
  ];
  for (const invalid of invalidOperations) await assert.rejects(validateProposal(packet, proposal(packet, [invalid]), packet));
  await assert.rejects(validateProposal(packet, { ...proposal(packet), audience: 'meta' }, packet));
  await assert.rejects(validateProposal(packet, { ...proposal(packet), playId: 'another-play' }, packet));
  const keep = operation({ layer: 'long', kind: 'keep', target: 0, text: null, classification: null, evidence: [] });
  await assert.rejects(validateProposal(packet, proposal(packet, [keep, keep]), packet));
  const noUpdate = operation({ kind: 'no_update', text: null, classification: null, evidence: [] });
  await assert.rejects(validateProposal(packet, proposal(packet, [noUpdate, operation()]), packet));
  assert.equal(JSON.stringify(validResult), original);
});
test('META proposals must distinguish accepted canon from backstage and discarded attempts', async () => {
  const packet = await packetFor(fixture(), 'meta');
  const secret = operation({ text: 'The cave is a painted set backstage.', classification: 'backstage',
    evidence: [{ sourceId: 'secret', excerpt: 'the cave is a painted set' }] });
  const discarded = operation({ layer: 'long', text: 'We discarded the first cave action.', classification: 'discarded',
    evidence: [{ sourceId: 'cave-one', excerpt: 'Synthetic first cave action.' }] });
  const result = await validateProposal(packet, proposal(packet, [secret, discarded]), packet);
  assert.equal(result.proposed.short[0].classification, 'backstage');
  assert.equal(result.proposed.long.at(-1).classification, 'discarded');
  await assert.rejects(validateProposal(packet, proposal(packet, [{ ...discarded, classification: 'accepted' }]), packet));
  await assert.rejects(validateProposal(packet, proposal(packet, [{ ...secret, classification: 'discarded' }]), packet));
  const uncertain = await validateProposal(packet, proposal(packet, [{ ...secret, classification: 'uncertain' }]), packet);
  assert.equal(uncertain.proposed.short[0].classification, 'uncertain');
});
test('new evidence, revision, reload metadata and rewind invalidate stale proposals and hypothetical baselines', async () => {
  const p = fixture(), packet = await packetFor(p), input = proposal(packet, [operation()]);
  const result = await validateProposal(packet, input, packet), hypothesis = useHypotheticalBaseline(packet, result);
  for (const current of [
    await packetFor(appendEvent(p, 'game', 'New visible event.', 'new-event')),
    await packetFor(p, 'game', { ...metadata, verifiedRevision: 6 }),
    await packetFor(p, 'game', { ...metadata, unsavedChanges: true }),
    await packetFor(p, 'game', { ...metadata, pendingRestore: true })
  ]) await assert.rejects(validateProposal(packet, input, current), /Stale/);
  const withAction = playerAction(p, 'Open another door.', 'door', 'cp-door');
  const actionPacket = await packetFor(withAction);
  const restored = proposeRestore(withAction, 'cp-door', 5, 'rewind').snapshot;
  await assert.rejects(validateProposal(actionPacket, proposal(actionPacket), await packetFor(restored)), /Stale/);
  await assert.rejects(packetFor(appendEvent(p, 'game', 'Changed evidence.', 'changed'), 'game', metadata, hypothesis), /stale/);
  const invalid = structuredClone(p); invalid.game.long[0].sources = ['secret'];
  await assert.rejects(async () => packetFor(invalid), /GAME portfolio/);
});
test('explicit hypothetical baseline is session-only, source-grounded and cannot be forged or mutated', async () => {
  const p = fixture(), before = structuredClone(p), packet = await packetFor(p);
  const result = await validateProposal(packet, proposal(packet, [operation()]), packet);
  const hypothesis = useHypotheticalBaseline(packet, result);
  const next = await packetFor(p, 'game', metadata, hypothesis);
  assert.equal(next.hypothetical, true); assert.equal(next.hypotheticalGeneration, 1);
  assert.deepEqual(next.baseline, result.proposed);
  assert.notEqual(next.baselineFingerprint, packet.baselineFingerprint);
  await assert.rejects(validateProposal(next, proposal(packet), next));
  const noChange = await validateProposal(next, proposal(next), next);
  assert.deepEqual(noChange.proposed, result.proposed);
  assert.throws(() => useHypotheticalBaseline(packet, structuredClone(result)));
  const tampered = structuredClone(hypothesis); tampered.baseline.short[0].text = 'Forged';
  await assert.rejects(packetFor(p, 'game', metadata, tampered));
  assert.deepEqual(p, before);
});
