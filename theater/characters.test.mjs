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
