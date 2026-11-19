import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyPlay, appendEvent, setEntry, portfolioView, validatePlay } from './continuity.mjs';
import { theaterStorage, createTheaterStorage } from './drive-store.mjs';
function fixture() {
  const files = new Map(); let count = 0, fail = false;
  const drive = {
    verifyFolder: async () => {},
    list: async () => ({ files: [...files.values()].map(x => x.meta) }),
    generateId: async () => 'file-' + (++count),
    uploadJson: async (id, name, appProperties, record) => {
      files.set(id, { meta: { id, name, appProperties }, record: structuredClone(record) });
      if (fail) { fail = false; throw Error('Interrupted after upload'); }
    },
    readJson: async id => structuredClone(files.get(id).record)
  };
  return { files, drive, interrupt() { fail = true; } };
}
function story() {
  let p = appendEvent(emptyPlay('doorway-demo'), 'meta', 'The shadowed figure is the keeper.', 'secret');
  p = appendEvent(p, 'game', 'Rias sees a shadowed figure.', 'visible');
  p = setEntry(p, 'meta', 'long', 'The keeper is hidden.', ['secret']);
  p = setEntry(p, 'game', 'long', 'A figure remains unidentified.', ['visible']);
  p = setEntry(p, 'meta', 'short', 'Decide when to reveal identity.', ['secret']);
  return setEntry(p, 'game', 'short', 'A figure is visible.', ['visible']);
}
test('META sees authorized full play; GAME and each section exclude backstage sources', () => {
  const p = story();
  assert.equal(portfolioView(p, 'meta').events.length, 2);
  const game = portfolioView(p, 'game');
  assert.equal(game.events.length, 1);
  assert.doesNotMatch(JSON.stringify(game), /keeper|secret/);
  for (const section of ['long', 'short', 'recent'])
    assert.throws(() => setEntry(p, 'game', section, 'Hidden identity', ['secret']), /GAME portfolio/);
  assert.throws(() => setEntry(p, 'meta', 'long', 'Invented evidence', ['fabricated']), /META portfolio/);
  const foreign = structuredClone(p); foreign.events[0].playId = 'another-play';
  assert.throws(() => validatePlay(foreign), /source event/);
});
test('fresh clients recover separate LONG SHORT RECENT and retries do not duplicate snapshots', async () => {
  const f = fixture(); const store = theaterStorage(f.drive); const p = story();
  f.interrupt();
  await assert.rejects(store.savePlay(p.playId, 0, p, 'save-1'), /Interrupted/);
  const saved = await store.savePlay(p.playId, 0, p, 'save-1');
  assert.equal(f.files.size, 1);
  assert.equal(saved.revision, 1);
  const recovered = await theaterStorage(f.drive).loadPlay(p.playId);
  assert.deepEqual(recovered.snapshot, p);
  assert.notEqual(recovered.snapshot.meta, recovered.snapshot.game);
  assert.deepEqual(recovered.snapshot.meta.long, p.meta.long);
  assert.deepEqual(recovered.snapshot.game.short, p.game.short);
  assert.equal(recovered.snapshot.game.recent.length, 1);
  await assert.rejects(store.savePlay(p.playId, 0, p, 'save-other'), /another device/);
});
test('malformed META or GAME stops recovery and preserves previous immutable record and caller state', async () => {
  for (const scope of ['meta', 'game']) {
    const f = fixture(); const store = theaterStorage(f.drive); const p = story();
    await store.savePlay(p.playId, 0, p, 'save-1');
    const original = structuredClone(f.files.get('file-1'));
    const activeBefore = structuredClone(p);
    await store.savePlay(p.playId, 1, p, 'save-2');
    f.files.get('file-2').record.snapshot[scope].long = null;
    await assert.rejects(store.loadPlay(p.playId), new RegExp(scope.toUpperCase() + ' portfolio'));
    await assert.rejects(store.savePlay(p.playId, 2, p, 'save-3'));
    assert.deepEqual(f.files.get('file-1'), original);
    assert.equal(f.files.size, 2);
    assert.deepEqual(p, activeBefore);
  }
});
test('conflicting revisions are reported without choosing or overwriting a snapshot', async () => {
  const f = fixture(); const store = theaterStorage(f.drive); const p = story();
  await store.savePlay(p.playId, 0, p, 'save-1');
  const duplicate = structuredClone(f.files.get('file-1'));
  duplicate.meta.id = 'conflict'; duplicate.meta.name = 'theater-doorway-demo-save-2.json';
  duplicate.record.operationId = 'save-2'; f.files.set('conflict', duplicate);
  await assert.rejects(store.loadPlay(p.playId), /Conflicting/);
  assert.equal(f.files.size, 2);
});
test('Drive discovery is constrained to authorized development folder and Theater namespace', async () => {
  const urls = [];
  const store = createTheaterStorage('folder123', () => 'fixture-token', async url => {
    urls.push(new URL(url));
    return Response.json(url.includes('/files/folder123') ? { id: 'folder123', name: 'AIDA — ONE AIDA MANY ROOMS — DEV', mimeType: 'application/vnd.google-apps.folder', trashed: false } : { files: [] });
  });
  assert.equal(await store.loadPlay('doorway-demo'), null);
  const q = urls.at(-1).searchParams.get('q');
  assert.match(q, /'folder123' in parents/);
  assert.match(q, /theater-snapshots-v1/);
});

test('failed readback preserves preceding valid snapshot and a retry verifies the same operation', async () => {
  const f = fixture(); const store = theaterStorage(f.drive); const p = story();
  await store.savePlay(p.playId, 0, p, 'save-1');
  const before = structuredClone(f.files.get('file-1'));
  const originalRead = f.drive.readJson;
  let fail = true;
  f.drive.readJson = async id => {
    if (id === 'file-2' && fail) { fail = false; throw Error('Readback unavailable'); }
    return originalRead(id);
  };
  await assert.rejects(store.savePlay(p.playId, 1, p, 'save-2'), /Readback unavailable/);
  assert.deepEqual(f.files.get('file-1'), before);
  assert.equal((await store.savePlay(p.playId, 1, p, 'save-2')).revision, 2);
  assert.equal(f.files.size, 2);
});

test('v1 saved revisions remain readable alongside later v2 play snapshots', async () => {
  const { upgradePlay, portfolioView } = await import('./continuity.mjs');
  const f = fixture(); const store = theaterStorage(f.drive); const old = story();
  await store.savePlay(old.playId, 0, old, 'old-save');
  assert.equal((await store.loadPlay(old.playId)).snapshot.schema, 'theater-play@1');
  const updated = upgradePlay(old);
  await store.savePlay(old.playId, 1, updated, 'new-save');
  const recovered = await theaterStorage(f.drive).loadPlay(old.playId);
  assert.equal(recovered.snapshot.schema, 'theater-play@2');
  assert.deepEqual(portfolioView(recovered.snapshot, 'game').portfolio, old.game);
  assert.deepEqual(f.files.get('file-1').record.snapshot, old);
});
