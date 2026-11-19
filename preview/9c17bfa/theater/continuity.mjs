import { plays } from './contracts.mjs';
const layers = ['long', 'short', 'recent'];
const exact = (x, keys) => x && typeof x === 'object' && !Array.isArray(x) &&
  Object.keys(x).length === keys.length && keys.every(k => Object.hasOwn(x, k));
const identifier = x => typeof x === 'string' && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(x);
export function emptyPlay(playId) {
  if (!plays.some(p => p.id === playId)) throw Error('Unknown Theater play.');
  const portfolio = () => ({ long: [], short: [], recent: [] });
  return { schema: 'theater-play@1', playId, events: [], meta: portfolio(), game: portfolio() };
}
export function validatePlay(play) {
  if (!exact(play, ['schema', 'playId', 'events', 'meta', 'game']) || play.schema !== 'theater-play@1' ||
      !plays.some(p => p.id === play.playId) || !Array.isArray(play.events) || play.events.length > 500) throw Error('Invalid play envelope.');
  const ids = new Set();
  for (const e of play.events) {
    if (!exact(e, ['id', 'playId', 'sequence', 'timestamp', 'scope', 'text']) || !identifier(e.id) || ids.has(e.id) ||
        e.playId !== play.playId || e.sequence !== ids.size + 1 || !['meta', 'game'].includes(e.scope) ||
        typeof e.timestamp !== 'string' || !Number.isFinite(Date.parse(e.timestamp)) ||
        typeof e.text !== 'string' || !e.text.trim() || e.text.length > 2000) throw Error('Invalid play source event.');
    ids.add(e.id);
  }
  for (const scope of ['meta', 'game']) {
    const p = play[scope];
    const fail = () => { throw Error(scope.toUpperCase() + ' portfolio failed validation; retained state was not replaced.'); };
    if (!exact(p, layers)) fail();
    for (const layer of layers) {
      if (!Array.isArray(p[layer]) || p[layer].length > 100) fail();
      for (const item of p[layer]) {
        if (!exact(item, ['text', 'sources']) || typeof item.text !== 'string' || !item.text.trim() || item.text.length > 2000 ||
            !Array.isArray(item.sources) || !item.sources.length || new Set(item.sources).size !== item.sources.length ||
            item.sources.some(id => !play.events.some(e => e.id === id && (scope === 'meta' || e.scope === 'game')))) fail();
      }
    }
  }
  return play;
}
export function appendEvent(play, scope, text, eventId = crypto.randomUUID(), timestamp = new Date().toISOString()) {
  validatePlay(play);
  const next = structuredClone(play);
  next.events.push({ id: eventId, playId: play.playId, sequence: play.events.length + 1, timestamp, scope, text: text.trim() });
  next.meta.recent.push({ text: text.trim(), sources: [eventId] });
  if (scope === 'game') next.game.recent.push({ text: text.trim(), sources: [eventId] });
  return validatePlay(next);
}
export function setEntry(play, scope, layer, text, sources) {
  validatePlay(play);
  if (!['meta', 'game'].includes(scope) || !layers.includes(layer)) throw Error('Invalid portfolio destination.');
  const next = structuredClone(play);
  next[scope][layer].push({ text: text.trim(), sources: [...sources] });
  return validatePlay(next);
}
export function portfolioView(play, scope) {
  validatePlay(play);
  if (!['meta', 'game'].includes(scope)) throw Error('Unknown portfolio.');
  return structuredClone({ playId: play.playId, portfolio: play[scope],
    events: play.events.filter(e => scope === 'meta' || e.scope === 'game') });
}
