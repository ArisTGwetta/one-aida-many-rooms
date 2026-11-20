import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyPlay, appendEvent, setEntry, portfolioView } from './continuity.mjs';
import { playerAction, proposeRestore } from './restore.mjs';
import { createCharacterRehearsal } from './characters.mjs';
const metadata = { playSchema: 'theater-play@2', verifiedRevision: 5, unsavedChanges: false, pendingRestore: false };
const excerpt = 'An unidentified figure approaches through dim light.';
function fixture() {
  let p = appendEvent(emptyPlay('doorway-demo'), 'game', excerpt + ' A distant observer knows the visitor is an archivist carrying a sealed map.', 'identity-archivist-map');
  p = appendEvent(p, 'meta', 'Private synthetic backstage password: amber.', 'backstage-secret');
  p = playerAction(p, 'Abandoned secret passage attempt.', 'abandoned', 'cp-abandoned');
  p = proposeRestore(p, 'cp-abandoned', 0, 'rewind').snapshot;
  p = setEntry(p, 'game', 'long', 'A distant observer knows the visitor identity.', ['identity-archivist-map']);
  return p;
}
const grant = () => [{ sourceId: 'identity-archivist-map', excerpt }];
function reply(packet, dialogue = 'Rias pauses. “Who goes there?”') {
  return { schema: 'theater-character-reply@1', characterId: 'rias', attemptId: packet.attemptId, fingerprint: packet.fingerprint, dialogue };
}
test('explicit excerpt approval is required and packets contain only approved text with local aliases', async () => {
  const p = fixture(), before = structuredClone(p), session = createCharacterRehearsal();
  session.update(portfolioView(p, 'game'), metadata);
  await assert.rejects(session.prepare(), /Explicitly approve/);
  session.checkExcerpts(grant());
  await assert.rejects(session.prepare(), /Explicitly approve/);
  session.approve(grant());
  const packet = await session.prepare(), serialized = JSON.stringify(packet);
  assert.deepEqual(packet.approvedEvidence, [{ alias: 'visible-1', text: excerpt }]);
  for (const forbidden of ['archivist', 'sealed map', 'amber', 'backstage-secret', 'abandoned', 'identity-archivist-map', 'cp-abandoned', 'checkpoints', 'portfolio', 'long', 'short', 'recent'])
    assert.ok(!serialized.includes(forbidden), forbidden);
  assert.match(packet.fingerprint, /^[0-9a-f]{64}$/);
  assert.match(packet.portrayal.brief, /naturally and expressively/);
  assert.deepEqual(p, before);
  const shown = session.validateReply(reply(packet));
  assert.match(shown.status, /PROPOSED.*noncanonical/);
  assert.deepEqual(p, before);
});
test('private, discarded, fabricated and modified excerpts fail closed', () => {
  const p = fixture(), session = createCharacterRehearsal();
  session.update(portfolioView(p, 'game'), metadata);
  for (const selections of [[], [{ sourceId: 'backstage-secret', excerpt: 'amber' }],
    [{ sourceId: 'abandoned', excerpt: 'Abandoned secret passage attempt.' }],
    [{ sourceId: 'missing', excerpt }], [{ sourceId: 'identity-archivist-map', excerpt: 'Known visitor approaches' }],
    [{ ...grant()[0], permission: 'all' }], [...grant(), ...grant()]]) assert.throws(() => session.approve(selections));
  assert.equal(session.view().approved, false);
  assert.throws(() => session.update(portfolioView(p, 'meta'), metadata));
  assert.throws(() => session.update(p, metadata));
  const foreign = portfolioView(p, 'game'); foreign.events[0].playId = 'another-play';
  assert.throws(() => session.update(foreign, metadata));
});
test('regeneration replaces attempts, discard clears proposals and no abandoned reply enters GAME', async () => {
  const p = fixture(), session = createCharacterRehearsal();
  session.update(portfolioView(p, 'game'), metadata); session.approve(grant());
  const first = await session.prepare(); session.validateReply(reply(first));
  const second = await session.prepare();
  assert.notEqual(first.attemptId, second.attemptId); assert.notEqual(first.fingerprint, second.fingerprint);
  assert.equal(session.view().proposal, null);
  assert.throws(() => session.validateReply(reply(first)), /stale/);
  session.validateReply(reply(second));
  const visible = session.view(); visible.packet.approvedEvidence[0].text = 'Tampered copy';
  assert.equal(session.view().packet.approvedEvidence[0].text, excerpt);
  session.discard(); assert.equal(session.view().packet, null); assert.equal(session.view().proposal, null);
  assert.throws(() => session.validateReply(reply(second)), /No current/);
  assert.doesNotMatch(JSON.stringify(p), /Who goes there/);
});
test('new GAME context, revision, restore or invalid inputs invalidate approval and stale replies', async () => {
  const p = fixture();
  for (const change of [
    s => s.update(portfolioView(appendEvent(p, 'game', 'A visible bell rings.', 'bell'), 'game'), metadata),
    s => s.update(portfolioView(p, 'game'), { ...metadata, verifiedRevision: 6 }),
    s => s.update(portfolioView(p, 'game'), { ...metadata, pendingRestore: true }),
    s => s.update(portfolioView(setEntry(p, 'game', 'short', 'Observer knowledge changes.', ['identity-archivist-map']), 'game'), metadata),
    s => { try { s.update(portfolioView(p, 'game'), { ...metadata, token: 'excluded' }); } catch {} }
  ]) {
    const session = createCharacterRehearsal(); session.update(portfolioView(p, 'game'), metadata); session.approve(grant());
    const packet = await session.prepare(); change(session);
    assert.equal(session.view().approved, false); assert.equal(session.view().packet, null);
    assert.throws(() => session.validateReply(reply(packet)));
  }
  let active = playerAction(p, 'An additional scene action.', 'action', 'cp-action');
  const session = createCharacterRehearsal(); session.update(portfolioView(active, 'game'), metadata); session.approve(grant());
  const packet = await session.prepare(); active = proposeRestore(active, 'cp-action', 5, 'restored').snapshot;
  session.update(portfolioView(active, 'game'), metadata); assert.throws(() => session.validateReply(reply(packet)));
});
test('reply envelopes reject mismatched attempts, characters, extra fields and invalid dialogue without replacing a valid proposal', async () => {
  const session = createCharacterRehearsal(); session.update(portfolioView(fixture(), 'game'), metadata); session.approve(grant());
  const packet = await session.prepare(); session.validateReply(reply(packet)); const before = session.view();
  for (const input of [{ ...reply(packet), characterId: 'other' }, { ...reply(packet), fingerprint: 'wrong' },
    { ...reply(packet), attemptId: 'wrong' }, { ...reply(packet), dialogue: '   ' }, { ...reply(packet), dialogue: 'x'.repeat(2001) },
    { ...reply(packet), accepted: true }]) assert.throws(() => session.validateReply(input));
  assert.deepEqual(session.view(), before);
});
test('reload starts empty and async preparation cannot resurrect invalidated approval', async () => {
  const session = createCharacterRehearsal(); session.update(portfolioView(fixture(), 'game'), metadata); session.approve(grant());
  const preparing = session.prepare(); session.clearApproval(); await assert.rejects(preparing, /changed/);
  assert.equal(session.view().packet, null);
  const fresh = createCharacterRehearsal();
  assert.equal(fresh.view().approved, false); assert.equal(fresh.view().packet, null);
  await assert.rejects(fresh.prepare());
});

test('explicit acceptance upgrades only the returned working copy and consumes an attributed attempt once', async () => {
  const { validatePlay } = await import('./continuity.mjs');
  const p = fixture(), original = structuredClone(p), session = createCharacterRehearsal();
  session.update(portfolioView(p, 'game'), metadata); session.approve(grant());
  const packet = await session.prepare(); session.validateReply(reply(packet));
  const next = await session.accept(p, metadata);
  assert.deepEqual(p, original);
  assert.equal(next.schema, 'theater-play@3'); assert.equal(validatePlay(next), next);
  assert.equal(next.events.length, p.events.length + 1); assert.deepEqual(next.checkpoints, p.checkpoints);
  const event = next.events.at(-1);
  assert.deepEqual(event.speaker, { id: 'rias', kind: 'character' });
  assert.equal(event.scope, 'game'); assert.equal(event.provenance.origin, 'manually_supplied_model_proposal');
  assert.equal(event.provenance.attemptId, packet.attemptId); assert.equal(event.provenance.packetFingerprint, packet.fingerprint);
  assert.equal(event.provenance.acceptedBy, 'francisco'); assert.equal(event.provenance.acceptedAt, event.timestamp);
  assert.equal(event.provenance.verifiedRevision, 5);
  assert.deepEqual(event.provenance.sourceReferences, [{ alias: 'visible-1', ...grant()[0] }]);
  assert.ok(!Object.hasOwn(event.provenance, 'model')); assert.ok(!Object.hasOwn(event.provenance, 'provider'));
  assert.equal(session.view().packet, null); assert.equal(session.view().proposal, null);
  await assert.rejects(session.accept(next, { ...metadata, playSchema: next.schema, unsavedChanges: true }));
  const { appendCharacterReply } = await import('./continuity.mjs');
  assert.throws(() => appendCharacterReply(next, event.text, event.provenance), /already accepted/);
});
test('v1 and v2 reading remains unchanged; failed acceptance preserves validated proposal and input state', async () => {
  const { validatePlay } = await import('./continuity.mjs');
  for (const p of [appendEvent(emptyPlay('doorway-demo'), 'game', excerpt, 'identity-archivist-map'), fixture()]) {
    const before = structuredClone(p), info = { ...metadata, playSchema: p.schema }, session = createCharacterRehearsal();
    validatePlay(p); session.update(portfolioView(p, 'game'), info); session.approve(grant());
    const packet = await session.prepare(); session.validateReply(reply(packet));
    const accepted = await session.accept(p, info);
    assert.equal(accepted.schema, 'theater-play@3'); assert.deepEqual(p, before);
  }
  let full = fixture();
  while (full.game.recent.length < 100) full = setEntry(full, 'game', 'recent', 'Supported repeated context.', ['identity-archivist-map']);
  const before = structuredClone(full), session = createCharacterRehearsal();
  session.update(portfolioView(full, 'game'), metadata); session.approve(grant());
  const packet = await session.prepare(); session.validateReply(reply(packet)); const proposalBefore = session.view();
  await assert.rejects(session.accept(full, metadata), /GAME portfolio/);
  assert.deepEqual(full, before); assert.deepEqual(session.view(), proposalBefore);
});
test('acceptance rejects stale sources, changed revision, discard, regeneration and in-flight context changes', async () => {
  const p = fixture();
  for (const change of [
    s => s.discard(),
    async s => { await s.prepare(); },
    s => s.update(portfolioView(p, 'game'), { ...metadata, verifiedRevision: 6 })
  ]) {
    const session = createCharacterRehearsal(); session.update(portfolioView(p, 'game'), metadata); session.approve(grant());
    const packet = await session.prepare(); session.validateReply(reply(packet)); await change(session);
    await assert.rejects(session.accept(p, metadata));
  }
  const session = createCharacterRehearsal(); session.update(portfolioView(p, 'game'), metadata); session.approve(grant());
  const packet = await session.prepare(); session.validateReply(reply(packet));
  const changed = appendEvent(p, 'game', 'A new sound changes the scene.', 'new-sound');
  await assert.rejects(session.accept(changed, metadata));
  const fresh = createCharacterRehearsal(); fresh.update(portfolioView(p, 'game'), metadata); fresh.approve(grant());
  const nextPacket = await fresh.prepare(); fresh.validateReply(reply(nextPacket));
  const pending = fresh.accept(p, metadata); fresh.discard(); await assert.rejects(pending, /changed/);
});
test('v3 source provenance and active dependencies reject forged authority, private sources and replay', async () => {
  const { validatePlay } = await import('./continuity.mjs');
  const p = fixture(), session = createCharacterRehearsal(); session.update(portfolioView(p, 'game'), metadata); session.approve(grant());
  const packet = await session.prepare(); session.validateReply(reply(packet)); const accepted = await session.accept(p, metadata);
  for (const mutate of [
    x => { x.events.at(-1).speaker.id = 'francisco'; },
    x => { x.events.at(-1).speaker = null; },
    x => { x.events.at(-1).provenance.acceptedBy = 'model'; },
    x => { x.events.at(-1).provenance.provider = 'unverified-claim'; },
    x => { x.events.at(-1).provenance.sourceReferences[0].sourceId = 'backstage-secret'; },
    x => { x.events.at(-1).provenance.sourceReferences[0].excerpt = 'Fabricated'; },
    x => { x.activeGameIds = x.activeGameIds.filter(id => id !== 'identity-archivist-map'); x.game.long = []; x.game.recent = x.game.recent.filter(item => !item.sources.includes('identity-archivist-map')); }
  ]) { const invalid = structuredClone(accepted); mutate(invalid); assert.throws(() => validatePlay(invalid)); }
  const fresh = createCharacterRehearsal(); fresh.update(portfolioView(accepted, 'game'), { ...metadata, playSchema: accepted.schema });
  fresh.approve([{ sourceId: accepted.events.at(-1).id, excerpt: accepted.events.at(-1).text }]);
  const nextPacket = await fresh.prepare();
  assert.doesNotMatch(JSON.stringify(nextPacket), /identity-archivist-map|backstage-secret|sealed map/);
});

test('mixed v1/v2/v3 immutable Drive history survives reload and remote conflicts preserve local acceptance', async () => {
  const { upgradePlay } = await import('./continuity.mjs');
  const { theaterStorage } = await import('./drive-store.mjs');
  const files = new Map(); let nextId = 0;
  const drive = { verifyFolder: async () => {}, list: async () => ({ files: [...files.values()].map(file => file.meta) }),
    generateId: async () => 'file-' + (++nextId),
    uploadJson: async (id, name, appProperties, record) => files.set(id, { meta: { id, name, appProperties }, record: structuredClone(record) }),
    readJson: async id => structuredClone(files.get(id).record) };
  const store = theaterStorage(drive);
  const legacy = appendEvent(emptyPlay('doorway-demo'), 'game', excerpt, 'identity-archivist-map');
  await store.savePlay(legacy.playId, 0, legacy, 'save-v1');
  const v2 = upgradePlay(legacy); await store.savePlay(v2.playId, 1, v2, 'save-v2');
  const session = createCharacterRehearsal(), info = { ...metadata, verifiedRevision: 2 };
  session.update(portfolioView(v2, 'game'), info); session.approve(grant()); const packet = await session.prepare(); session.validateReply(reply(packet));
  const local = await session.accept(v2, info), localBefore = structuredClone(local);
  const remote = appendEvent(v2, 'meta', 'Remote backstage update.', 'remote');
  await store.savePlay(remote.playId, 2, remote, 'save-remote');
  await assert.rejects(store.savePlay(local.playId, 2, local, 'save-local'), /another device/);
  assert.deepEqual(local, localBefore); assert.equal(files.size, 3);
  const fresh = createCharacterRehearsal(), currentInfo = { ...metadata, verifiedRevision: 3 };
  fresh.update(portfolioView(remote, 'game'), currentInfo); fresh.approve(grant()); const currentPacket = await fresh.prepare(); fresh.validateReply(reply(currentPacket));
  const currentAccepted = await fresh.accept(remote, currentInfo);
  await store.savePlay(currentAccepted.playId, 3, currentAccepted, 'save-v3');
  const recovered = await theaterStorage(drive).loadPlay(currentAccepted.playId);
  assert.equal(recovered.revision, 4); assert.equal(recovered.snapshot.schema, 'theater-play@3');
  assert.deepEqual(recovered.snapshot.events.at(-1).provenance, currentAccepted.events.at(-1).provenance);
  assert.deepEqual(files.get('file-1').record.snapshot, legacy); assert.deepEqual(files.get('file-2').record.snapshot, v2);
  const reloadedSession = createCharacterRehearsal();
  await assert.rejects(reloadedSession.accept(recovered.snapshot, { ...metadata, playSchema: 'theater-play@3', verifiedRevision: 4 }));
});
test('simultaneous acceptance attempts can consume a pending reply only once', async () => {
  const p = fixture(), session = createCharacterRehearsal();
  session.update(portfolioView(p, 'game'), metadata); session.approve(grant()); const packet = await session.prepare(); session.validateReply(reply(packet));
  const outcomes = await Promise.allSettled([session.accept(p, metadata), session.accept(p, metadata)]);
  assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(outcomes.filter(result => result.status === 'rejected').length, 1);
});
