import { plays, finishVisit } from './contracts.mjs';
import { emptyPlay, appendEvent, setEntry, portfolioView } from './continuity.mjs';
export function setupTheater({ registry, storage }) {
  const el = id => document.getElementById(id);
  const button = el('theater-open');
  if (button.dataset.ready) return;
  button.dataset.ready = 'true';
  button.disabled = false;
  let entry, play, revision = 0, visitId, resumeRef = null, pending, busy = false, dirty = false;
  const status = text => { el('theater-status').textContent = text; };
  for (const item of plays) {
    const option = document.createElement('option');
    option.value = item.id; option.textContent = item.title; el('theater-play').append(option);
  }
  function render() {
    const gameAudience = el('theater-scope').value === 'game';
    const recipient = el('theater-recipient-portrait');
    recipient.replaceChildren();
    const fallback = document.createElement('span');
    fallback.textContent = gameAudience ? 'Stage' : 'A';
    recipient.append(fallback);
    if (!gameAudience) {
      const image = document.createElement('img');
      image.src = new URL('../portraits/neutral1.png', import.meta.url).href;
      image.alt = 'Aida, backstage recipient';
      image.addEventListener('load', () => { fallback.hidden = true; });
      image.addEventListener('error', () => { image.hidden = true; fallback.hidden = false; });
      recipient.append(image);
    }
    el('theater-recipient-label').textContent = gameAudience ? 'Recipient: Stage / ensemble · GAME / Onstage' : 'Recipient: Aida · META / Backstage';
    el('theater-add').textContent = el('theater-scope').value === 'game' ? 'Send to GAME' : 'Send to META';
    el('theater-unsaved').hidden = !dirty;
    const timeline = el('theater-timeline');
    const following = timeline.scrollHeight - timeline.scrollTop - timeline.clientHeight < 40;
    timeline.replaceChildren();
    for (const event of play?.events ?? []) {
      const item = document.createElement('article');
      item.dataset.audience = event.scope;
      const label = document.createElement('strong');
      label.textContent = 'Francisco · submitted by user · ' + (event.scope === 'game' ? 'GAME / Onstage' : 'META / Backstage');
      const text = document.createElement('p');
      text.textContent = event.text;
      const portrait = document.createElement('span');
      portrait.className = 'theater-portrait';
      portrait.textContent = 'F';
      portrait.setAttribute('aria-label', 'Francisco');
      const message = document.createElement('div');
      message.append(label, text);
      item.append(portrait, message);
      timeline.append(item);
    }
    if (following) timeline.scrollTop = timeline.scrollHeight;
    el('theater-data').textContent = play ? JSON.stringify(portfolioView(play, el('theater-portfolio').value), null, 2) : '';
    for (const name of ['theater-save', 'theater-add', 'theater-entry-add']) el(name).disabled = busy || !play || Boolean(pending);
    el('theater-save').disabled = busy || !play;
    el('theater-play').disabled = busy || Boolean(pending) || dirty;
    el('theater-recover').disabled = busy || !entry?.playId || dirty;
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
    dirty = true;
    el('theater-text').value = ''; status('Source event added locally. Save explicitly to retain it.');
  }));
  el('theater-entry-add').addEventListener('click', () => task(async () => {
    play = setEntry(play, el('theater-portfolio').value, el('theater-layer').value,
      el('theater-entry-text').value, el('theater-sources').value.split(',').map(x => x.trim()).filter(Boolean));
    dirty = true;
    el('theater-entry-text').value = ''; status('Portfolio entry added locally with source references.');
  }));
  el('theater-portfolio').addEventListener('change', render);
  el('theater-scope').addEventListener('change', render);
  el('theater-save').addEventListener('click', () => task(async () => {
    pending ??= { operationId: crypto.randomUUID(), snapshot: structuredClone(play), revision };
    const saved = await storage.savePlay(entry.playId, pending.revision, pending.snapshot, pending.operationId);
    play = saved.snapshot; revision = saved.revision; resumeRef = `theater:${entry.playId}:${revision}`;
    dirty = false;
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
