const contexts = ['game_character', 'game_narrator', 'meta_aida'];
const statuses = ['planned', 'dispatched', 'succeeded', 'failed', 'refused', 'uncertain', 'stopped'];
export const operationalDiagnostics = Object.freeze(['request_invalid', 'request_too_large', 'stopped', 'credential_unavailable', 'endpoint_invalid',
  'transport_uncertain', 'stopped_uncertain', 'provider_http', 'provider_json', 'provider_refusal', 'provider_incomplete', 'reply_invalid']);
const exact = (value, fields) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === fields.length && fields.every(field => Object.hasOwn(value, field));
const id = value => typeof value === 'string' && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(value);
const amount = value => value === null || (Number.isFinite(value) && value >= 0);
export function validateLedger(record) {
  if (!exact(record, ['schema', 'id', 'attemptId', 'playId', 'sessionId', 'turnId', 'context', 'provider', 'model', 'reportedModel', 'timestamp', 'status', 'dispatched', 'usage', 'cost', 'diagnostic']) ||
      record.schema !== 'theater-execution-ledger@1' || !['id', 'attemptId', 'playId', 'sessionId', 'turnId'].every(key => id(record[key])) ||
      !contexts.includes(record.context) || !['openai', 'ollama', 'xai'].includes(record.provider) ||
      typeof record.model !== 'string' || !/^[\w][\w.:/-]{0,119}$/.test(record.model) || !Number.isFinite(Date.parse(record.timestamp)) ||
      (record.reportedModel !== null && (typeof record.reportedModel !== 'string' || !/^[\w][\w.:/-]{0,119}$/.test(record.reportedModel))) ||
      !statuses.includes(record.status) || typeof record.dispatched !== 'boolean' ||
      (record.diagnostic !== null && !operationalDiagnostics.includes(record.diagnostic)) ||
      !exact(record.cost, ['actualUsd', 'estimatedUsd', 'reservedUsd', 'computation']) ||
      !amount(record.cost.actualUsd) || !amount(record.cost.estimatedUsd) || !Number.isFinite(record.cost.reservedUsd) || record.cost.reservedUsd < 0 ||
      record.cost.computation !== 'unmeasured' ||
      (record.usage !== null && (!exact(record.usage, ['inputTokens', 'outputTokens']) || !Object.values(record.usage).every(value => Number.isSafeInteger(value) && value >= 0))))
    throw Error('Invalid operational ledger record.');
  return record;
}
export function latestAttempts(records) {
  const byId = new Map(), ids = new Map();
  for (const row of records) {
    validateLedger(row);
    if (ids.has(row.id) && ids.get(row.id) !== JSON.stringify(row)) throw Error('Conflicting ledger record.');
    ids.set(row.id, JSON.stringify(row));
    const old = byId.get(row.attemptId);
    if (old && ['playId', 'turnId', 'sessionId', 'context', 'provider', 'model'].some(key => old[key] !== row[key])) throw Error('Attempt identity conflict.');
    if (!old || row.timestamp > old.timestamp ||
        (row.timestamp === old.timestamp && statuses.indexOf(row.status) > statuses.indexOf(old.status))) byId.set(row.attemptId, row);
  }
  return [...byId.values()];
}
export function reservedSpend(records) {
  return latestAttempts(records).reduce((sum, row) => sum + (row.cost.actualUsd ?? row.cost.estimatedUsd ?? row.cost.reservedUsd), 0);
}
function calendar(date, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(date)).map(part => [part.type, part.value]));
  return { year: +parts.year, month: +parts.month, day: +parts.day };
}
function bucket(date, period, timeZone) {
  const value = calendar(date, timeZone);
  if (period === 'year') return String(value.year);
  if (period === 'month') return value.year + '-' + value.month;
  const day = new Date(Date.UTC(value.year, value.month - 1, value.day));
  if (period === 'week') day.setUTCDate(day.getUTCDate() - (day.getUTCDay() + 6) % 7);
  return day.toISOString().slice(0, 10);
}
export function spendingView(records, { playId, sessionId, scope = 'story', period = 'all-time', anchor = new Date().toISOString(), timeZone = 'America/New_York' }) {
  if (!['story', 'session'].includes(scope) || !['day', 'week', 'month', 'year', 'all-time'].includes(period)) throw Error('Invalid spending filter.');
  const selected = latestAttempts(records).filter(row => row.playId === playId && (scope === 'story' || row.sessionId === sessionId) &&
    (period === 'all-time' || bucket(row.timestamp, period, timeZone) === bucket(anchor, period, timeZone)));
  return { scope, period, timeZone, attempts: selected.length, dispatched: selected.filter(row => row.dispatched).length,
    actualUsd: selected.reduce((sum, row) => sum + (row.cost.actualUsd ?? 0), 0),
    estimatedUsd: selected.reduce((sum, row) => sum + (row.cost.actualUsd === null ? row.cost.estimatedUsd ?? 0 : 0), 0),
    unknownAttempts: selected.filter(row => row.cost.actualUsd === null && row.cost.estimatedUsd === null).length,
    reservedUnknownUsd: selected.reduce((sum, row) => sum + (row.cost.actualUsd === null && row.cost.estimatedUsd === null ? row.cost.reservedUsd : 0), 0),
    localApiChargeUsd: 0, localComputationalCost: 'unmeasured', records: structuredClone(selected) };
}
export function ledgerRecord({ attemptId, playId, sessionId, turnId, context, route, status, dispatched, reservation, usage = null, diagnostic = null, reportedModel = null, now = new Date().toISOString() }) {
  const tokens = usage && Number.isSafeInteger(usage.inputTokens) && Number.isSafeInteger(usage.outputTokens) && usage.inputTokens >= 0 && usage.outputTokens >= 0
    ? { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens } : null;
  const estimate = route.provider === 'ollama' ? 0 : tokens ?
    (tokens.inputTokens * route.pricing.inputPerMillion + tokens.outputTokens * route.pricing.outputPerMillion) / 1000000 : null;
  return validateLedger({ schema: 'theater-execution-ledger@1', id: attemptId + '-' + status, attemptId, playId, sessionId, turnId, context,
    provider: route.provider, model: route.model, reportedModel, timestamp: now, status, dispatched, usage: tokens,
    cost: { actualUsd: (status !== 'planned' && !dispatched) || route.provider === 'ollama' ? 0 : null, estimatedUsd: estimate, reservedUsd: reservation, computation: 'unmeasured' }, diagnostic });
}
