import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyPlay, upgradePlay, appendEvent, setEntry, portfolioView, validatePlay } from './continuity.mjs';
import { playerAction, proposeRestore, commitRestore } from './restore.mjs';
import { theaterStorage } from './drive-store.mjs';
function dragon() {
  let p = upgradePlay(emptyPlay('doorway-demo'));
  p = appendEvent(p, 'meta', 'Discuss a plan.', 'plan');
  p = playerAction(p, 'Sneak into the lair.', 'sneak', 'before-sneak');
  p = appendEvent(p, 'game', 'Caught and trapped in the lair.', 'caught');
  p = setEntry(p, 'game', 'short', 'Trapped inside.', ['caught']);
  p = playerAction(p, 'Pretend to be the dragon father.', 'pretend', 'before-pretend');
  p = appendEvent(p, 'game', 'The real father watches. Player becomes barbecue.', 'barbecue');
  for (const section of ['long', 'short', 'recent']) p = setEntry(p, 'game', section, 'Barbecue outcome.', ['barbecue']);
  return p;
}
function storageFixture() {
  const files = new Map(); let sequence = 0, interrupt = false;
  const drive = {
    verifyFolder: async () => {}, list: async () => ({ files: [...files.values()].map(x => x.meta) }),
    generateId: async () => 'file-' + (++sequence),
    uploadJson: async (id, name, appProperties, record) => {
      files.set(id, { meta: { id, name, appProperties }, record: structuredClone(record) });
      if (interrupt) { interrupt = false; throw Error('Interrupted restore save'); }
    }, readJson: async id => structuredClone(files.get(id).record)
  };
  return { files, drive, interrupt() { interrupt = true; } };
}
test('dragon one-turn restore replaces complete GAME state and labels discarded META evidence', () => {
  const original = dragon(); const before = structuredClone(original);
  const { snapshot: p } = proposeRestore(original, 'before-pretend', 0, 'restore-one');
  const game = portfolioView(p, 'game');
  assert.deepEqual(game.events.map(e => e.id), ['sneak', 'caught']);
  assert.match(JSON.stringify(game.portfolio), /Trapped inside/);
  assert.doesNotMatch(JSON.stringify(game), /barbecue|father/);
  assert.deepEqual(p.checkpoints.map(cp => cp.id), ['before-sneak']);
  assert.deepEqual(p.meta, original.meta);
  const meta = portfolioView(p, 'meta');
  assert.equal(meta.events.find(e => e.id === 'barbecue').branchStatus, 'discarded');
  assert.equal(meta.events.find(e => e.id === 'caught').branchStatus, 'accepted');
  assert.equal(meta.portfolio.recent.find(e => e.sources.includes('barbecue')).branchStatus, 'contains_discarded_attempt');
  assert.deepEqual(original, before);
  assert.throws(() => setEntry(p, 'game', 'long', 'Discarded outcome', ['barbecue']), /GAME portfolio/);
  assert.throws(() => proposeRestore(p, 'before-pretend', 1), /unavailable/);
});
test('two-turn restore and replacement branch exclude all abandoned consequences', () => {
  let p = proposeRestore(dragon(), 'before-sneak', 0, 'restore-two').snapshot;
  assert.equal(portfolioView(p, 'game').events.length, 0);
  assert.deepEqual(p.game, { long: [], short: [], recent: [] });
  assert.equal(p.checkpoints.length, 0);
  p = playerAction(p, 'Invite the dragon for a burger.', 'burger', 'before-burger');
  assert.deepEqual(portfolioView(p, 'game').events.map(e => e.id), ['burger']);
  assert.deepEqual(p.checkpoints.map(cp => cp.id), ['before-burger']);
  assert.equal(portfolioView(p, 'meta').events.find(e => e.id === 'sneak').branchStatus, 'discarded');
});
test('successful redo, rolling window and non-action messages preserve precise boundaries', () => {
  let p = playerAction(emptyPlay('doorway-demo'), 'Open a door successfully.', 'one', 'cp-one');
  p = appendEvent(p, 'game', 'Door opens.', 'opened');
  p = appendEvent(p, 'meta', 'Discuss how to tell it.', 'meta');
  p = appendEvent(p, 'game', 'Clarifying the scene.', 'clarification');
  assert.equal(p.checkpoints.length, 1);
  const redo = proposeRestore(p, 'cp-one', 0, 'redo').snapshot;
  assert.equal(portfolioView(redo, 'game').events.length, 0);
  p = playerAction(p, 'Second action.', 'two', 'cp-two');
  p = playerAction(p, 'Third action.', 'three', 'cp-three');
  assert.deepEqual(p.checkpoints.map(cp => cp.id), ['cp-two', 'cp-three']);
  assert.throws(() => proposeRestore(p, 'cp-one', 0));
  const restored = proposeRestore(p, 'cp-three', 0, 'back').snapshot;
  const replacement = playerAction(restored, 'Different third action.', 'new-three', 'cp-new');
  assert.deepEqual(replacement.checkpoints.map(cp => cp.id), ['cp-two', 'cp-new']);
});
test('v1 reading and v2 checkpoint validation reject foreign, malformed and private checkpoint state', () => {
  const legacy = appendEvent(emptyPlay('doorway-demo'), 'game', 'Existing story.', 'old');
  const original = structuredClone(legacy); const upgraded = upgradePlay(legacy);
  assert.deepEqual(legacy, original);
  assert.equal(upgraded.schema, 'theater-play@2');
  assert.deepEqual(upgraded.activeGameIds, ['old']); assert.deepEqual(upgraded.checkpoints, []);
  for (const mutate of [
    p => { p.checkpoints[0].playId = 'foreign'; },
    p => { p.checkpoints[1].events.push(p.events[0]); },
    p => { p.checkpoints[1].game.long.push({ text: 'Private plan', sources: ['plan'] }); },
    p => { p.activeGameIds.push('plan'); },
    p => { p.checkpoints[1].beforeActionId = 'missing'; }
  ]) { const p = dragon(); mutate(p); assert.throws(() => validatePlay(p)); }
});
test('verified restore persistence, failure retry, reload and stale revision keep discarded GAME excluded', async () => {
  const f = storageFixture(); const store = theaterStorage(f.drive);
  const original = dragon();
  await store.savePlay(original.playId, 0, original, 'initial-save');
  const pending = proposeRestore(original, 'before-pretend', 1, 'restore-save');
  f.interrupt(); await assert.rejects(commitRestore(store, original.playId, pending), /Interrupted/);
  assert.match(JSON.stringify(portfolioView(original, 'game')), /barbecue/);
  assert.equal(f.files.get('file-1').record.snapshot.checkpoints.length, 2);
  const saved = await commitRestore(store, original.playId, pending);
  assert.equal(saved.revision, 2);
  assert.deepEqual(await commitRestore(store, original.playId, pending), saved);
  assert.equal(f.files.size, 2);
  const recovered = await theaterStorage(f.drive).loadPlay(original.playId);
  assert.doesNotMatch(JSON.stringify(portfolioView(recovered.snapshot, 'game')), /barbecue|father/);
  assert.equal(portfolioView(recovered.snapshot, 'meta').events.find(e => e.id === 'barbecue').branchStatus, 'discarded');
  const stale = proposeRestore(original, 'before-sneak', 1, 'stale-restore');
  await assert.rejects(commitRestore(store, original.playId, stale), /another device/);
  assert.equal(f.files.size, 2);
  const wrongPlay = { ...pending, snapshot: { ...pending.snapshot, playId: 'foreign' } };
  await assert.rejects(commitRestore(store, 'doorway-demo', wrongPlay));
});

test('v3 accepted replies persist with provenance and one/two-action rewind removes replies and derived memory', async () => {
  const { createCharacterRehearsal } = await import('./characters.mjs');
  let p = playerAction(emptyPlay('doorway-demo'), 'Open the outer door.', 'outer', 'cp-outer');
  async function accept(play, sourceId, dialogue) {
    const session = createCharacterRehearsal(), metadata = { playSchema: play.schema, verifiedRevision: 0, unsavedChanges: true, pendingRestore: false };
    session.update(portfolioView(play, 'game'), metadata);
    session.approve([{ sourceId, excerpt: play.events.find(event => event.id === sourceId).text }]);
    const packet = await session.prepare(); session.validateReply({ schema: 'theater-character-reply@1', characterId: 'rias', attemptId: packet.attemptId, fingerprint: packet.fingerprint, dialogue });
    return session.accept(play, metadata);
  }
  p = await accept(p, 'outer', 'Rias acknowledges the open door.'); const firstReplyId = p.events.at(-1).id;
  p = playerAction(p, 'Step into the courtyard.', 'courtyard', 'cp-courtyard');
  p = await accept(p, 'courtyard', 'Rias looks around the courtyard.'); const secondReplyId = p.events.at(-1).id;
  for (const section of ['long', 'short', 'recent']) p = setEntry(p, 'game', section, 'Courtyard continuity.', [secondReplyId]);
  assert.equal(p.checkpoints.length, 2);
  const f = storageFixture(), store = theaterStorage(f.drive);
  await store.savePlay(p.playId, 0, p, 'saved-v3');
  const recovered = await theaterStorage(f.drive).loadPlay(p.playId);
  assert.deepEqual(recovered.snapshot.events.at(-1).provenance, p.events.at(-1).provenance);
  const one = proposeRestore(recovered.snapshot, 'cp-courtyard', 1, 'one-turn').snapshot;
  assert.equal(one.schema, 'theater-play@3');
  assert.ok(portfolioView(one, 'game').events.some(event => event.id === firstReplyId));
  assert.ok(!portfolioView(one, 'game').events.some(event => event.id === secondReplyId));
  assert.doesNotMatch(JSON.stringify(portfolioView(one, 'game')), /Courtyard continuity|looks around/);
  const two = proposeRestore(recovered.snapshot, 'cp-outer', 1, 'two-turn').snapshot;
  assert.equal(portfolioView(two, 'game').events.length, 0); assert.deepEqual(two.game, { long: [], short: [], recent: [] });
  assert.equal(portfolioView(two, 'meta').events.find(event => event.id === secondReplyId).branchStatus, 'discarded');
  await store.savePlay(two.playId, 1, two, 'saved-restored-v3');
  const reloaded = await theaterStorage(f.drive).loadPlay(two.playId);
  assert.equal(portfolioView(reloaded.snapshot, 'game').events.length, 0);
  assert.equal(reloaded.snapshot.events.find(event => event.id === secondReplyId).speaker.id, 'rias');
  const next = playerAction(reloaded.snapshot, 'Choose another route.', 'route', 'cp-route');
  assert.equal(next.schema, 'theater-play@3'); assert.doesNotMatch(JSON.stringify(portfolioView(next, 'game')), /looks around|Courtyard/);
});
