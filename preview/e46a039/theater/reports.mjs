import { portfolioView } from './continuity.mjs';
const layers = ['long', 'short', 'recent'];
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
function validateInputs(projection, header, game) {
  if (!exact(header, ['playId', 'playSchema', 'verifiedRevision', 'unsavedChanges', 'pendingRestore']) ||
      !['theater-play@1', 'theater-play@2'].includes(header.playSchema) ||
      !Number.isInteger(header.verifiedRevision) || header.verifiedRevision < 0 ||
      typeof header.unsavedChanges !== 'boolean' || typeof header.pendingRestore !== 'boolean' ||
      !exact(projection, ['playId', 'portfolio', 'events']) || projection.playId !== header.playId ||
      !exact(projection.portfolio, layers) || !Array.isArray(projection.events)) throw Error('Invalid Theater report inputs.');
  const sources = new Set(projection.events.map(event => event.id));
  if (sources.size !== projection.events.length) throw Error('Invalid Theater report source IDs.');
  for (const event of projection.events) {
    const keys = ['id', 'playId', 'sequence', 'timestamp', 'scope', 'text'];
    if (!game) keys.push('branchStatus');
    if (!exact(event, keys) || event.playId !== header.playId || typeof event.text !== 'string' ||
        (game ? event.scope !== 'game' : !['accepted', 'discarded', 'backstage'].includes(event.branchStatus)))
      throw Error('Invalid Theater report event projection.');
  }
  for (const layer of layers) {
    if (!Array.isArray(projection.portfolio[layer])) throw Error('Invalid Theater report portfolio.');
    for (const item of projection.portfolio[layer]) {
      if (!exact(item, game ? ['text', 'sources'] : ['text', 'sources', 'branchStatus']) ||
          typeof item.text !== 'string' || !Array.isArray(item.sources) || !item.sources.length ||
          item.sources.some(id => !sources.has(id))) throw Error('Unauthorized Theater report source.');
    }
  }
}
function formatProjection(projection, header, audience) {
  validateInputs(projection, header, audience === 'GAME');
  const lines = ['Theater memory report v1', `Play ID: ${header.playId}`, `Play schema: ${header.playSchema}`,
    `Portfolio audience: ${audience}`, `Last verified revision: ${header.verifiedRevision === 0 ? 'none (0)' : header.verifiedRevision}`,
    `Unsaved changes: ${header.unsavedChanges ? 'YES — working content differs from the last verified revision' : 'no'}`,
    `Pending restore: ${header.pendingRestore ? 'YES — this report describes the original displayed state, not the unverified restore' : 'no'}`,
    'Validation: play and source eligibility validated before projection.',
    audience === 'GAME' ? 'Projection: active GAME canon only.' : 'Projection: authorized META history; discarded attempts are labeled explicitly.',
    'Content is user-entered play evidence and working memory; validation does not independently verify story claims.'];
  for (const layer of layers) {
    lines.push('', layer.toUpperCase());
    if (!projection.portfolio[layer].length) lines.push('(empty)');
    for (const [index, item] of projection.portfolio[layer].entries()) {
      lines.push(`${index + 1}. ${item.text}`, `   Source IDs: ${item.sources.join(', ')}`);
      if (audience === 'META') lines.push(`   Branch status: ${item.branchStatus}`);
    }
  }
  lines.push('', 'AUTHORIZED EVENTS');
  if (!projection.events.length) lines.push('(empty)');
  for (const event of projection.events) {
    lines.push('', `Source ID: ${event.id}`, `Timestamp: ${event.timestamp}`,
      `Audience: ${event.scope.toUpperCase()}`, `Branch status: ${audience === 'GAME' ? 'accepted active GAME canon' : event.branchStatus}`,
      'Submitted by: Francisco (user-entered event)', event.text);
  }
  return lines.join('\n');
}
// This formatter accepts a projection and explicitly limited metadata, never a play snapshot.
export function formatGameReport(projection, header) {
  return formatProjection(projection, header, 'GAME');
}
export function buildMemoryReport(play, audience, state) {
  if (!['meta', 'game'].includes(audience) || !exact(state, ['verifiedRevision', 'unsavedChanges', 'pendingRestore']))
    throw Error('Invalid Theater report request.');
  const projection = portfolioView(play, audience);
  const header = { playId: projection.playId, playSchema: play.schema, verifiedRevision: state.verifiedRevision,
    unsavedChanges: state.unsavedChanges, pendingRestore: state.pendingRestore };
  return audience === 'game' ? formatGameReport(projection, header) : formatProjection(projection, header, 'META');
}
