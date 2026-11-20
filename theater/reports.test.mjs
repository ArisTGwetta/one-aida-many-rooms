import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyPlay, appendEvent, setEntry, portfolioView } from './continuity.mjs';
import { playerAction, proposeRestore, commitRestore } from './restore.mjs';
import { buildMemoryReport, formatGameReport } from './reports.mjs';
import { theaterStorage } from './drive-store.mjs';
const state = { verifiedRevision: 5, unsavedChanges: false, pendingRestore: false };
function story() {
  let p = appendEvent(emptyPlay('doorway-demo'), 'meta', 'SECRET: the dragon is an actor.', 'private-secret');
  p = playerAction(p, 'Sneak into the lair.', 'sneak', 'checkpoint-sneak');
  p = appendEvent(p, 'game', 'Caught in the lair.', 'caught');
  p = playerAction(p, 'Impersonate the dragon father.', 'father', 'checkpoint-father');
  p = appendEvent(p, 'game', 'Discarded barbecue outcome.', 'barbecue');
  for (const layer of ['long', 'short', 'recent']) p = setEntry(p, 'game', layer, 'Derived barbecue consequence.', ['barbecue']);
  p = proposeRestore(p, 'checkpoint-sneak', 0, 'restored-branch').snapshot;
  p = playerAction(p, 'Invite the dragon for a burger.', 'burger', 'checkpoint-burger');
  for (const layer of ['long', 'short', 'recent']) p = setEntry(p, 'game', layer, 'Accepted burger continuity for ' + layer, ['burger']);
  return p;
}
test('GAME report uses complete active projection and excludes private and discarded evidence', () => {
  const p = story(), before = structuredClone(p);
  const report = buildMemoryReport(p, 'game', state);
  for (const secret of ['SECRET', 'private-secret', 'barbecue', 'sneak', 'father', 'checkpoint', 'restored-branch'])
    assert.ok(!report.includes(secret), secret);
  for (const layer of ['LONG', 'SHORT', 'RECENT']) assert.ok(report.includes(layer));
  for (const layer of ['long', 'short', 'recent']) assert.ok(report.includes('Accepted burger continuity for ' + layer));
  assert.match(report, /Source IDs: burger/); assert.match(report, /Source ID: burger/);
  assert.match(report, /Last verified revision: 5/); assert.match(report, /Unsaved changes: no/);
  const header = { playId: p.playId, playSchema: p.schema, ...state };
  assert.equal(formatGameReport(portfolioView(p, 'game'), header), report);
  assert.throws(() => formatGameReport(p, header));
  assert.throws(() => formatGameReport(portfolioView(p, 'meta'), header));
  assert.throws(() => formatGameReport(portfolioView(p, 'game'), { ...header, checkpoints: p.checkpoints }));
  assert.deepEqual(p, before);
});
test('META report distinguishes authorized backstage history and discarded attempts from accepted canon', () => {
  const report = buildMemoryReport(story(), 'meta', state);
  assert.match(report, /SECRET: the dragon is an actor/);
  assert.match(report, /Source ID: barbecue\nTimestamp: .*\nAudience: GAME\nBranch status: discarded/);
  assert.match(report, /Source ID: burger\nTimestamp: .*\nAudience: GAME\nBranch status: accepted/);
  assert.match(report, /contains_discarded_attempt/);
  assert.ok(!report.includes('checkpoint-father'));
});
test('invalid portfolios, foreign play sources and unsupported metadata fail before a report exists', () => {
  const p = story();
  p.game.long.push({ text: 'Unauthorized', sources: ['private-secret'] });
  assert.throws(() => buildMemoryReport(p, 'game', state), /GAME portfolio/);
  assert.throws(() => buildMemoryReport(p, 'meta', state), /GAME portfolio/);
  const foreign = story(); foreign.events[0].playId = 'another-play';
  assert.throws(() => buildMemoryReport(foreign, 'game', state));
  assert.throws(() => buildMemoryReport(story(), 'game', { ...state, token: 'excluded' }));
  assert.throws(() => buildMemoryReport(story(), 'game', { ...state, verifiedRevision: -1 }));
});
test('v1 empty reports and unsaved or pending-restore headers are explicit', () => {
  const legacy = emptyPlay('doorway-demo');
  const empty = buildMemoryReport(legacy, 'game', { ...state, verifiedRevision: 0 });
  assert.match(empty, /theater-play@1/); assert.match(empty, /none \(0\)/);
  assert.equal((empty.match(/\(empty\)/g) ?? []).length, 4);
  const p = story();
  const report = buildMemoryReport(p, 'game', { ...state, unsavedChanges: true, pendingRestore: true });
  assert.match(report, /Unsaved changes: YES/); assert.match(report, /original displayed state/);
});
test('reports remain isolated after two-turn rewind, verified Drive save and fresh-client reload', async () => {
  const files = new Map(); let id = 0;
  const drive = { verifyFolder: async () => {}, list: async () => ({ files: [...files.values()].map(f => f.meta) }),
    generateId: async () => 'file-' + (++id),
    uploadJson: async (fileId, name, appProperties, record) => files.set(fileId, { meta: { id: fileId, name, appProperties }, record: structuredClone(record) }),
    readJson: async fileId => structuredClone(files.get(fileId).record) };
  let p = playerAction(emptyPlay('doorway-demo'), 'Sneak into the lair.', 'sneak', 'cp-one');
  p = appendEvent(p, 'meta', 'A private backstage secret.', 'secret');
  p = playerAction(p, 'Impersonate father.', 'father', 'cp-two');
  p = appendEvent(p, 'game', 'Barbecue outcome.', 'barbecue');
  const store = theaterStorage(drive);
  await store.savePlay(p.playId, 0, p, 'save-original');
  await commitRestore(store, p.playId, proposeRestore(p, 'cp-one', 1, 'save-restore'));
  const saved = await theaterStorage(drive).loadPlay(p.playId);
  const metadata = { ...state, verifiedRevision: saved.revision };
  const game = buildMemoryReport(saved.snapshot, 'game', metadata);
  assert.doesNotMatch(game, /secret|father|Barbecue|sneak|cp-one|cp-two/);
  assert.match(game, /Last verified revision: 2/);
  const meta = buildMemoryReport(saved.snapshot, 'meta', metadata);
  assert.match(meta, /private backstage secret/); assert.match(meta, /Branch status: discarded/);
});

test('v3 reports attribute accepted character dialogue and preserve active GAME isolation after rewind', async () => {
  const { createCharacterRehearsal } = await import('./characters.mjs');
  let p = appendEvent(emptyPlay('doorway-demo'), 'meta', 'PRIVATE synthetic backstage detail.', 'private');
  p = playerAction(p, 'A visitor approaches in dim light.', 'visible', 'before-visitor');
  const session = createCharacterRehearsal();
  const info = { playSchema: p.schema, verifiedRevision: 5, unsavedChanges: false, pendingRestore: false };
  session.update(portfolioView(p, 'game'), info); session.approve([{ sourceId: 'visible', excerpt: 'A visitor approaches in dim light.' }]);
  const packet = await session.prepare(); session.validateReply({ schema: 'theater-character-reply@1', characterId: 'rias',
    attemptId: packet.attemptId, fingerprint: packet.fingerprint, dialogue: 'Rias asks who is there.' });
  const accepted = await session.accept(p, info);
  const game = buildMemoryReport(accepted, 'game', { ...state, unsavedChanges: true });
  assert.match(game, /theater-play@3/); assert.match(game, /Speaker: Rias.*accepted by Francisco/);
  assert.match(game, /Provider\/model identity: unverified/); assert.match(game, new RegExp(packet.attemptId));
  assert.match(game, /Unsaved changes: YES/); assert.doesNotMatch(game, /PRIVATE synthetic/);
  const restored = proposeRestore(accepted, 'before-visitor', 5, 'restore-character').snapshot;
  assert.doesNotMatch(buildMemoryReport(restored, 'game', state), /Rias asks|Speaker: Rias/);
  const meta = buildMemoryReport(restored, 'meta', state);
  assert.match(meta, /Branch status: discarded/); assert.match(meta, /Speaker: Rias/);
});
