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
export function validateCharacterEvent(event, events) {
  const provenance = event.provenance;
  if (provenance?.origin === 'supervised_provider_turn') return validateGeneratedEvent(event, events);
  if (!exact(event.speaker, ['id', 'kind']) || event.speaker.id !== 'rias' || event.speaker.kind !== 'character' || event.scope !== 'game' ||
      !exact(provenance, ['origin', 'attemptId', 'packetFingerprint', 'sourceReferences', 'acceptedBy', 'acceptedAt', 'verifiedRevision']) ||
      provenance.origin !== 'manually_supplied_model_proposal' || !identifier(provenance.attemptId) ||
      typeof provenance.packetFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(provenance.packetFingerprint) ||
      provenance.acceptedBy !== 'francisco' || provenance.acceptedAt !== event.timestamp || !Number.isFinite(Date.parse(provenance.acceptedAt)) ||
      !Number.isInteger(provenance.verifiedRevision) || provenance.verifiedRevision < 0 ||
      !Array.isArray(provenance.sourceReferences) || !provenance.sourceReferences.length || provenance.sourceReferences.length > 8)
    throw Error('Invalid character event attribution or acceptance provenance.');
  const references = new Set();
  for (const [index, reference] of provenance.sourceReferences.entries()) {
    const source = events.find(source => source.id === reference?.sourceId);
    if (!exact(reference, ['alias', 'sourceId', 'excerpt']) || reference.alias !== 'visible-' + (index + 1) ||
        !source || source.playId !== event.playId || source.scope !== 'game' || source.sequence >= event.sequence ||
        typeof reference.excerpt !== 'string' || !reference.excerpt.trim() || reference.excerpt.length > 2000 ||
        !source.text.includes(reference.excerpt)) throw Error('Invalid character event source provenance.');
    const key = JSON.stringify([reference.sourceId, reference.excerpt]);
    if (references.has(key)) throw Error('Duplicate character source reference.');
    references.add(key);
  }
}
export function eventAttribution(event) {
  if (event.provenance?.origin === 'supervised_provider_turn') return {
    speaker: event.speaker.id === 'rias' ? 'Rias' : 'Aida', origin: 'supervised_provider_turn', acceptedBy: 'Francisco’s turn authorization'
  };
  return event.speaker ? { speaker: 'Rias', origin: 'manually_supplied_model_proposal', acceptedBy: 'Francisco' } :
    { speaker: 'Francisco', origin: 'user_entered', acceptedBy: null };
}
export function validatePlay(play) {
  const v2 = ['theater-play@2', 'theater-play@3', 'theater-play@4'].includes(play?.schema);
  const keys = ['schema', 'playId', 'events', 'meta', 'game'];
  if (v2) keys.push('branchId', 'activeGameIds', 'checkpoints');
  if (!exact(play, keys) || !['theater-play@1', 'theater-play@2', 'theater-play@3', 'theater-play@4'].includes(play.schema) ||
      !plays.some(p => p.id === play.playId) || !Array.isArray(play.events) || play.events.length > 500) throw Error('Invalid play envelope.');
  const ids = new Set(), attempts = new Set();
  for (const e of play.events) {
    const fields = ['id', 'playId', 'sequence', 'timestamp', 'scope', 'text'];
    if (['theater-play@3', 'theater-play@4'].includes(play.schema) && Object.hasOwn(e, 'speaker')) fields.push('speaker', 'provenance');
    if (play.schema === 'theater-play@4' && Object.hasOwn(e, 'visibility')) fields.push('visibility', 'turnId');
    if (!exact(e, fields) || !identifier(e.id) || ids.has(e.id) ||
        e.playId !== play.playId || e.sequence !== ids.size + 1 || !['meta', 'game'].includes(e.scope) ||
        typeof e.timestamp !== 'string' || !Number.isFinite(Date.parse(e.timestamp)) ||
        typeof e.text !== 'string' || !e.text.trim() || e.text.length > 2000) throw Error('Invalid play source event.');
    if (Object.hasOwn(e, 'visibility')) validateVisibility(e);
    if (Object.hasOwn(e, 'speaker')) {
      validateCharacterEvent(e, play.events);
      if (attempts.has(e.provenance.attemptId)) throw Error('Character attempt was already accepted.');
      attempts.add(e.provenance.attemptId);
    }
    ids.add(e.id);
  }
  const active = v2 ? play.activeGameIds : play.events.filter(e => e.scope === 'game').map(e => e.id);
  if (!validActive(active, play.events)) throw Error('Invalid active GAME branch.');
  for (const e of play.events.filter(e => active.includes(e.id) && e.speaker))
    if (e.provenance.sourceReferences.some(reference => !active.includes(reference.sourceId))) throw Error('Active character reply depends on discarded GAME evidence.');
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
          play.events.find(event => event.id === cp.beforeActionId)?.speaker ||
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
  if (play.schema !== 'theater-play@1') return structuredClone(play);
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
    if (next.schema !== 'theater-play@1') next.activeGameIds.push(eventId);
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
  const active = new Set(play.schema !== 'theater-play@1' ? play.activeGameIds : play.events.filter(e => e.scope === 'game').map(e => e.id));
  if (scope === 'game') return structuredClone({ playId: play.playId, portfolio: play.game, events: play.events.filter(e => active.has(e.id)) });
  const status = e => e.scope === 'meta' ? 'backstage' : active.has(e.id) ? 'accepted' : 'discarded';
  const portfolio = Object.fromEntries(layers.map(layer => [layer, play.meta[layer].map(item => ({ ...item,
    branchStatus: item.sources.some(id => status(play.events.find(e => e.id === id)) === 'discarded') ? 'contains_discarded_attempt' : 'current_or_backstage' }))]));
  return structuredClone({ playId: play.playId, portfolio, events: play.events.map(e => ({ ...e, branchStatus: status(e) })) });
}

export function appendCharacterReply(play, dialogue, provenance, eventId = crypto.randomUUID()) {
  const upgraded = upgradePlay(play);
  if (upgraded.schema !== 'theater-play@4') upgraded.schema = 'theater-play@3';
  const next = appendEvent(upgraded, 'game', dialogue, eventId, provenance.acceptedAt);
  const event = next.events.at(-1);
  event.speaker = { id: 'rias', kind: 'character' };
  event.provenance = structuredClone(provenance);
  return validatePlay(next);
}

export function validateVisibility(event) {
  if (!identifier(event.turnId) || !exact(event.visibility, ['kind', 'recipients']) ||
      !['speech', 'observable_action', 'private_thought', 'narration', 'backstage'].includes(event.visibility.kind) ||
      !Array.isArray(event.visibility.recipients) || new Set(event.visibility.recipients).size !== event.visibility.recipients.length ||
      event.visibility.recipients.some(id => !['rias', 'aida'].includes(id)) ||
      (event.scope === 'meta' ? event.visibility.kind !== 'backstage' || event.visibility.recipients.join() !== 'aida' :
        event.visibility.kind === 'backstage' || event.visibility.kind === 'private_thought' && event.visibility.recipients.length))
    throw Error('Invalid event visibility.');
}
function validateGeneratedEvent(event, events) {
  const p = event.provenance;
  validateVisibility(event);
  if (!exact(event.speaker, ['id', 'kind']) || !['rias', 'aida'].includes(event.speaker.id) ||
      event.speaker.kind !== (event.speaker.id === 'rias' ? 'character' : event.scope === 'game' ? 'narrator' : 'companion') ||
      (event.speaker.id === 'rias' && event.scope !== 'game') ||
      !exact(p, ['origin', 'attemptId', 'sourceReferences', 'acceptedBy', 'acceptedAt', 'provider', 'model']) ||
      !identifier(p.attemptId) || p.acceptedBy !== 'francisco_turn_authorization' || p.acceptedAt !== event.timestamp ||
      !['openai', 'ollama', 'xai'].includes(p.provider) || typeof p.model !== 'string' || !/^[\w][\w.:/-]{0,119}$/.test(p.model) ||
      !Array.isArray(p.sourceReferences) || !p.sourceReferences.length || p.sourceReferences.length > 40)
    throw Error('Invalid generated fictional event provenance.');
  const seen = new Set();
  for (const ref of p.sourceReferences) {
    const source = events.find(e => e.id === ref?.sourceId);
    if (!exact(ref, ['alias', 'sourceId', 'excerpt']) || !/^e[1-9][0-9]*$/.test(ref.alias) || seen.has(ref.alias) ||
        !source || source.sequence >= event.sequence || typeof ref.excerpt !== 'string' || !ref.excerpt.trim() || !source.text.includes(ref.excerpt) ||
        (event.scope === 'game' && source.scope !== 'game')) throw Error('Invalid generated source evidence.');
    if (event.speaker.id === 'rias' && !characterCanSee(source, 'rias', events) && !events.some(e =>
      e.sequence < event.sequence && e.speaker?.id === 'rias' && e.provenance?.origin === 'manually_supplied_model_proposal' &&
      e.provenance.sourceReferences.some(approved => approved.sourceId === ref.sourceId && approved.excerpt.includes(ref.excerpt))))
      throw Error('Character source is not authorized.');
    if (event.speaker.kind === 'narrator' && !source.visibility?.recipients.includes('aida')) throw Error('Narrator source is not observable.');
    seen.add(ref.alias);
  }
}
// Legacy GAME text is not automatically character knowledge. Only explicitly approved
// legacy excerpts and the character's own accepted utterances can seed that view.
export function characterCanSee(event, characterId, activeEvents) {
  if (event.scope !== 'game') return false;
  if (event.speaker?.id === characterId) return true;
  return Boolean(event.visibility?.recipients.includes(characterId));
}
export function appendGenerated(play, context, fiction, references, receipt, turnId) {
  if (!['game_character', 'game_narrator', 'meta_aida'].includes(context)) throw Error('Unknown generated contribution role.');
  if (fiction.decision === 'silent') return validatePlay(structuredClone(play));
  const next = upgradePlay(play); next.schema = 'theater-play@4';
  const scope = context === 'meta_aida' ? 'meta' : 'game';
  const added = appendEvent(next, scope, fiction.text, receipt.attemptId, receipt.timestamp);
  const event = added.events.at(-1);
  event.turnId = turnId;
  event.visibility = { kind: scope === 'meta' ? 'backstage' : context === 'game_character' ? 'speech' : 'narration',
    recipients: scope === 'meta' ? ['aida'] : ['rias', 'aida'] };
  event.speaker = { id: context === 'game_character' ? 'rias' : 'aida', kind: context === 'game_character' ? 'character' : scope === 'game' ? 'narrator' : 'companion' };
  event.provenance = { origin: 'supervised_provider_turn', attemptId: receipt.attemptId, sourceReferences: references,
    acceptedBy: 'francisco_turn_authorization', acceptedAt: receipt.timestamp, provider: receipt.provider, model: receipt.model };
  return validatePlay(added);
}
