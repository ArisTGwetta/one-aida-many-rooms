import { plays, finishVisit } from './contracts.mjs';
import { emptyPlay, appendEvent, setEntry, portfolioView } from './continuity.mjs';
export function setupTheater({ registry, storage }) {
  const el = id => document.getElementById(id);
  const button = el('theater-open');
  if (button.dataset.ready) return;
  button.dataset.ready = 'true';
  button.disabled = false;
  let entry, play, revision = 0, visitId, resumeRef = null, pending, busy = false;
  const status = text => { el('theater-status').textContent = text; };
  for (const item of plays) {
    const option = document.createElement('option');
    option.value = item.id; option.textContent = item.title; el('theater-play').append(option);
  }
  function render() {
    el('theater-data').textContent = play ? JSON.stringify(portfolioView(play, el('theater-portfolio').value), null, 2) : '';
    for (const name of ['theater-save', 'theater-add', 'theater-entry-add']) el(name).disabled = busy || !play || Boolean(pending);
    el('theater-save').disabled = busy || !play;
    el('theater-play').disabled = busy || Boolean(pending);
    el('theater-recover').disabled = busy || !entry?.playId;
  }
  async function task(action) {
    if (busy) return;
    busy = true; render();
    try { await action(); } catch (error) { status(error.message); }
    finally { busy = false; render(); }
  }
  button.addEventListener('click', () => task(async () => {
    entry = await registry.dispatch({ id: 'rpg', version: 1, input: {
      schema: 'theater-entry@1', operation: 'open', playId: play?.playId ?? null, resumeRef: null
    } }, {}, 'manual');
    visitId = crypto.randomUUID();
    status('Choose the demonstration play. META is Aida’s play-scoped working context.');
    el('theater-room').dispatchEvent(new CustomEvent('theater-enter'));
  }));
  async function recover() {
    const saved = await storage.loadPlay(entry.playId);
    if (!saved && revision > 0) throw Error('Expected Theater snapshots are missing; retained state was not reset.');
    const next = saved?.snapshot ?? emptyPlay(entry.playId);
    play = next; revision = saved?.revision ?? 0;
    resumeRef = saved ? `theater:${entry.playId}:${revision}` : null;
    pending = undefined;
    status(saved ? `Recovered verified Theater revision ${revision}.` : 'No saved play found. Empty portfolios are ready; Save creates the first snapshot.');
  }
  el('theater-play').addEventListener('change', () => task(async () => {
    const requested = await registry.dispatch({ id: 'rpg', version: 1, input: {
      schema: 'theater-entry@1', operation: 'open', playId: el('theater-play').value || null, resumeRef: null
    } }, {}, 'manual');
    entry = requested;
    if (entry.playId) await recover();
    else { play = undefined; resumeRef = null; status('Choose a play.'); }
  }));
  el('theater-recover').addEventListener('click', () => task(async () => {
    if (play && !confirm('Recover saved Theater state and discard unsaved local edits?')) return;
    await recover();
  }));
  el('theater-add').addEventListener('click', () => task(async () => {
    play = appendEvent(play, el('theater-scope').value, el('theater-text').value);
    el('theater-text').value = ''; status('Source event added locally. Save explicitly to retain it.');
  }));
  el('theater-entry-add').addEventListener('click', () => task(async () => {
    play = setEntry(play, el('theater-portfolio').value, el('theater-layer').value,
      el('theater-entry-text').value, el('theater-sources').value.split(',').map(x => x.trim()).filter(Boolean));
    el('theater-entry-text').value = ''; status('Portfolio entry added locally with source references.');
  }));
  el('theater-portfolio').addEventListener('change', render);
  el('theater-save').addEventListener('click', () => task(async () => {
    pending ??= { operationId: crypto.randomUUID(), snapshot: structuredClone(play), revision };
    const saved = await storage.savePlay(entry.playId, pending.revision, pending.snapshot, pending.operationId);
    play = saved.snapshot; revision = saved.revision; resumeRef = `theater:${entry.playId}:${revision}`;
    pending = undefined; status(`Saved and verified Theater revision ${revision}.`);
  }));
  function receipt() {
    if (busy) return;
    const receipt = entry?.playId ? finishVisit(entry, visitId, resumeRef) : null;
    el('theater-receipt').textContent = receipt ? JSON.stringify(receipt, null, 2) : 'No play selected.';
  }
  el('theater-room').addEventListener('theater-leave', receipt);
  el('theater-return').addEventListener('click', () => {
    if (!busy) el('theater-room').dispatchEvent(new CustomEvent('theater-exit'));
  });
  render();
}
