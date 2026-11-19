const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const id = value => typeof value === 'string' && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(value);
export const plays = Object.freeze([Object.freeze({ id: 'doorway-demo', title: 'Doorway demonstration' })]);
export function validEntry(value) {
  return Boolean(exact(value, ['schema', 'operation', 'playId', 'resumeRef']) &&
    value.schema === 'theater-entry@1' && value.operation === 'open' && value.resumeRef === null &&
    (value.playId === null || plays.some(play => play.id === value.playId)));
}
export function validReceipt(value) {
  return Boolean(exact(value, ['schema', 'source', 'playId', 'visitId', 'orientation', 'resumeRef']) &&
    value.schema === 'theater-visit-receipt@1' && value.source === 'rpg@1' &&
    plays.some(play => play.id === value.playId) && id(value.visitId) &&
    value.orientation === 'Synthetic doorway visit; no story was played.' && value.resumeRef === null);
}
export function finishVisit(entry, visitId) {
  if (!validEntry(entry) || entry.playId === null) throw new Error('Select a valid demonstration play.');
  const receipt = { schema: 'theater-visit-receipt@1', source: 'rpg@1', playId: entry.playId,
    visitId, orientation: 'Synthetic doorway visit; no story was played.', resumeRef: null };
  if (!validReceipt(receipt)) throw new Error('Invalid Theater receipt.');
  return receipt;
}
