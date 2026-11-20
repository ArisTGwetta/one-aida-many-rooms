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
function validatePortfolio(portfolio, eligible, scope) {
  const fail = () => { throw Error(scope + ' portfolio failed validation; retained state was not replaced.'); };
  if (!exact(portfolio, layers)) fail();
  for (const layer of layers) {
    if (!Array.isArray(portfolio[layer]) || portfolio[layer].length > 100) fail();
    for (const item of portfolio[layer]) {
      if (!exact(item, ['text', 'sources']) || typeof item.text !== 'string' || !item.text.trim() || item.text.length > 2000 ||
          !Array.isArray(item.sources) || !item.sources.length || new Set(item.sources).size !== item.sources.length ||
          item.sources.some(id => !eligible.has(id))) fail();
    }
  }
}
function validActive(ids, events) {
  if (!Array.isArray(ids) || new Set(ids).size !== ids.length) return false;
  const selected = events.filter(e => ids.includes(e.id));
  return selected.length === ids.length && selected.every((e, i) => e.scope === 'game' && e.id === ids[i]);
}
export function validatePlay(play) {
  const v2 = play?.schema === 'theater-play@2';
  const keys = ['schema', 'playId', 'events', 'meta', 'game'];
  if (v2) keys.push('branchId', 'activeGameIds', 'checkpoints');
  if (!exact(play, keys) || !['theater-play@1', 'theater-play@2'].includes(play.schema) ||
      !plays.some(p => p.id === play.playId) || !Array.isArray(play.events) || play.events.length > 500) throw Error('Invalid play envelope.');
  const ids = new Set();
  for (const e of play.events) {
    if (!exact(e, ['id', 'playId', 'sequence', 'timestamp', 'scope', 'text']) || !identifier(e.id) || ids.has(e.id) ||
        e.playId !== play.playId || e.sequence !== ids.size + 1 || !['meta', 'game'].includes(e.scope) ||
        typeof e.timestamp !== 'string' || !Number.isFinite(Date.parse(e.timestamp)) ||
        typeof e.text !== 'string' || !e.text.trim() || e.text.length > 2000) throw Error('Invalid play source event.');
    ids.add(e.id);
  }
  const active = v2 ? play.activeGameIds : play.events.filter(e => e.scope === 'game').map(e => e.id);
  if (!validActive(active, play.events)) throw Error('Invalid active GAME branch.');
  validatePortfolio(play.meta, ids, 'META');
  validatePortfolio(play.game, new Set(active), 'GAME');
  if (v2) {
    if (!identifier(play.branchId) || !Array.isArray(play.checkpoints) || play.checkpoints.length > 2) throw Error('Invalid GAME checkpoint window.');
    let previousAction = -1;
    const checkpointIds = new Set();
    for (const cp of play.checkpoints) {
      const position = active.indexOf(cp?.beforeActionId);
      if (!exact(cp, ['id', 'playId', 'branchId', 'beforeActionId', 'events', 'game']) || !identifier(cp.id) || checkpointIds.has(cp.id) ||
          cp.playId !== play.playId || !identifier(cp.branchId) || position <= previousAction ||
          !Array.isArray(cp.events) || JSON.stringify(cp.events) !== JSON.stringify(play.events.filter(e => active.slice(0, position).includes(e.id))))
        throw Error('Invalid or foreign GAME checkpoint.');
      validatePortfolio(cp.game, new Set(cp.events.map(e => e.id)), 'Checkpoint GAME');
      checkpointIds.add(cp.id); previousAction = position;
    }
  }
  return play;
}
export function upgradePlay(play) {
  validatePlay(play);
  if (play.schema === 'theater-play@2') return structuredClone(play);
  return { ...structuredClone(play), schema: 'theater-play@2', branchId: 'initial',
    activeGameIds: play.events.filter(e => e.scope === 'game').map(e => e.id), checkpoints: [] };
}
export function appendEvent(play, scope, text, eventId = crypto.randomUUID(), timestamp = new Date().toISOString()) {
  validatePlay(play);
  const next = structuredClone(play);
  next.events.push({ id: eventId, playId: play.playId, sequence: play.events.length + 1, timestamp, scope, text: text.trim() });
  next.meta.recent.push({ text: text.trim(), sources: [eventId] });
  if (scope === 'game') {
    next.game.recent.push({ text: text.trim(), sources: [eventId] });
    if (next.schema === 'theater-play@2') next.activeGameIds.push(eventId);
  }
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
  const active = new Set(play.schema === 'theater-play@2' ? play.activeGameIds : play.events.filter(e => e.scope === 'game').map(e => e.id));
  if (scope === 'game') return structuredClone({ playId: play.playId, portfolio: play.game, events: play.events.filter(e => active.has(e.id)) });
  const status = e => e.scope === 'meta' ? 'backstage' : active.has(e.id) ? 'accepted' : 'discarded';
  const portfolio = Object.fromEntries(layers.map(layer => [layer, play.meta[layer].map(item => ({ ...item,
    branchStatus: item.sources.some(id => status(play.events.find(e => e.id === id)) === 'discarded') ? 'contains_discarded_attempt' : 'current_or_backstage' }))]));
  return structuredClone({ playId: play.playId, portfolio, events: play.events.map(e => ({ ...e, branchStatus: status(e) })) });
}
