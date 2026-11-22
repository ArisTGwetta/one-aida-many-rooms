import { ledgerRecord, reservedSpend, operationalDiagnostics } from './ledger.mjs';
const contexts = ['game_character', 'game_narrator', 'meta_aida'];
export const auditionCandidates = Object.freeze([
  { label: 'OpenAI', provider: 'openai', model: 'gpt-6-luna' },
  { label: 'Phi-4 (verify inventory)', provider: 'ollama', model: 'phi4:14b' },
  { label: 'Anubis (verify inventory)', provider: 'ollama', model: 'hf.co/TheDrummer/Anubis-Mini-8B-v1-GGUF:Q4_K_M' },
  { label: 'Mistral (select installed ID)', provider: 'ollama', model: '' },
  { label: 'Grok (verify account)', provider: 'xai', model: 'grok-4.3' }
]);
export function defaultTurnPolicy() {
  const routes = auditionCandidates.map((candidate, index) => ({ id: 'route-' + index, provider: candidate.provider, model: candidate.model,
    endpoint: candidate.provider === 'ollama' ? 'http://127.0.0.1:11434' : null, cloudAllowed: false,
    pricing: candidate.provider === 'openai' ? { inputPerMillion: 0.10, outputPerMillion: 0.50, version: 'existing-aida-estimate-confirm-before-use' } :
      candidate.provider === 'ollama' ? { inputPerMillion: 0, outputPerMillion: 0, version: 'zero-api-charge' } : null }));
  return { game: structuredClone(routes), meta: structuredClone(routes), cloudConsent: false,
    turnBudgetUsd: 0.02, sessionBudgetUsd: 0.25, storyBudgetUsd: 2, maxTokens: 350, tone: 'PG-13' };
}
export function validateTurnPolicy(policy) {
  if (!policy || typeof policy.cloudConsent !== 'boolean' || !['G', 'PG', 'PG-13', 'R', 'NC-17'].includes(policy.tone) ||
      !Number.isInteger(policy.maxTokens) || policy.maxTokens < 32 || policy.maxTokens > 900 ||
      !['turnBudgetUsd', 'sessionBudgetUsd', 'storyBudgetUsd'].every(key => Number.isFinite(policy[key]) && policy[key] >= 0 && policy[key] <= 100)) throw Error('Invalid Theater policy.');
  for (const lineup of [policy.game, policy.meta]) {
    if (!Array.isArray(lineup) || !lineup.length || lineup.length > 8 || new Set(lineup.map(route => route.id)).size !== lineup.length) throw Error('Invalid provider lineup.');
    for (const route of lineup) {
      if (!/^[a-z0-9_-]{1,40}$/.test(route.id) || !['openai', 'ollama', 'xai'].includes(route.provider) || typeof route.model !== 'string' || route.model.length > 120 ||
          route.model && !/^[\w][\w.:/-]{0,119}$/.test(route.model) ||
          typeof route.cloudAllowed !== 'boolean' || (route.provider === 'ollama' && typeof route.endpoint !== 'string') ||
          (route.pricing !== null && (!route.pricing || !Number.isFinite(route.pricing.inputPerMillion) || route.pricing.inputPerMillion < 0 ||
            !Number.isFinite(route.pricing.outputPerMillion) || route.pricing.outputPerMillion < 0 || typeof route.pricing.version !== 'string'))) throw Error('Invalid provider configuration.');
    }
    for (const route of lineup.filter(route => route.provider === 'ollama')) {
      let url; try { url = new URL(route.endpoint); } catch { throw Error('Invalid local-model endpoint.'); }
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash ||
          !['/', '/api/chat'].includes(url.pathname) || url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
        throw Error('Local-model endpoints require loopback HTTP or trusted HTTPS without credentials.');
    }
  }
  return policy;
}
export function parseFiction(raw, aliases) {
  let value;
  try { value = JSON.parse(raw); } catch { throw Object.assign(Error('Reply validation failed.'), { code: 'reply_invalid' }); }
  if (value && Object.keys(value).sort().join() === 'decision,sources,text' && value.decision === 'provider_refusal' &&
      value.text === null && Array.isArray(value.sources) && !value.sources.length)
    throw Object.assign(Error('Provider declined this request.'), { code: 'provider_refusal' });
  if (!value || Object.keys(value).sort().join() !== 'decision,sources,text' || !['speak', 'silent'].includes(value.decision) ||
      !Array.isArray(value.sources) || value.sources.length > 8 || new Set(value.sources).size !== value.sources.length || value.sources.some(id => !aliases.includes(id)) ||
      (value.decision === 'silent' ? value.text !== null || value.sources.length !== 0 : typeof value.text !== 'string' || !value.text.trim() || value.text.length > 2000 || !value.sources.length))
    throw Object.assign(Error('Reply validation failed.'), { code: 'reply_invalid' });
  return value;
}
const routeKey = route => JSON.stringify([route.provider, route.model, route.endpoint]);
export function createRoleRouter({ transport, inventory, available = () => true, operations, now = () => new Date().toISOString() }) {
  const sticky = new Map(), inventories = new Map(); let sessionKey = '', policyKey = '';
  function beginSession(sessionId) {
    const key = sessionId + ':' + new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now()));
    if (key !== sessionKey) { sticky.clear(); inventories.clear(); sessionKey = key; }
  }
  return {
    beginSession,
    reset(context) { if (context) sticky.delete(context); else sticky.clear(); inventories.clear(); },
    preferences: () => Object.fromEntries(sticky),
    async run({ playId, sessionId, turnId, context, policy, attempts, input, contract, signal, onDispatch, onResult, retryAttemptIds = [] }) {
      validateTurnPolicy(policy); beginSession(sessionId);
      if (!contexts.includes(context)) throw Error('Unknown role context.');
      const configuration = JSON.stringify(policy);
      if (configuration !== policyKey) { sticky.clear(); inventories.clear(); policyKey = configuration; }
      const lineup = context === 'meta_aida' ? policy.meta : policy.game;
      const preferred = sticky.get(context);
      const ordered = [...lineup.filter(route => routeKey(route) === preferred), ...lineup.filter(route => routeKey(route) !== preferred)];
      const tried = new Set(attempts.filter(attempt => attempt.context === context && !retryAttemptIds.includes(attempt.attemptId)).map(attempt => attempt.routeKey));
      const unique = new Set();
      for (const route of ordered) {
        const key = routeKey(route);
        if (signal?.aborted) throw Error('Generation stopped; completed work retained.');
        if (attempts.length >= 4) throw Error('This Send reached its four-attempt ceiling.');
        if (unique.has(key) || tried.has(key)) continue;
        unique.add(key);
        const remote = route.provider !== 'ollama' || !['localhost', '127.0.0.1', '[::1]'].includes(new URL(route.endpoint).hostname);
        if (!route.model || !route.pricing || remote && (!policy.cloudConsent || !route.cloudAllowed)) continue;
        if (!await available(route)) { if (sticky.get(context) === key) sticky.delete(context); continue; }
        try {
          if (!inventories.has(key)) inventories.set(key, await inventory(route));
          if (!inventories.get(key).includes(route.model)) { if (sticky.get(context) === key) sticky.delete(context); continue; }
        } catch { inventories.delete(key); if (sticky.get(context) === key) sticky.delete(context); continue; }
        const bytes = new TextEncoder().encode(JSON.stringify({ input, contract })).length + 2048;
        const reservation = route.provider === 'ollama' ? 0 : (bytes * route.pricing.inputPerMillion + contract.maxTokens * route.pricing.outputPerMillion) / 1000000;
        const records = await operations.loadLedger(playId);
        if (reservedSpend(records.filter(row => row.turnId === turnId)) + reservation > policy.turnBudgetUsd ||
            reservedSpend(records.filter(row => row.sessionId === sessionId)) + reservation > policy.sessionBudgetUsd ||
            reservedSpend(records) + reservation > policy.storyBudgetUsd) throw Error('Theater spending ceiling reached. Unknown attempts retain their reservations.');
        const attemptId = crypto.randomUUID();
        const base = { attemptId, playId, sessionId, turnId, context, route, reservation };
        await operations.appendLedger(ledgerRecord({ ...base, status: 'planned', dispatched: false, now: now() }));
        await onDispatch({ attemptId, context, routeKey: key });
        if (signal?.aborted) {
          await operations.appendLedger(ledgerRecord({ ...base, status: 'stopped', dispatched: false, diagnostic: 'stopped', now: now() }));
          throw Error('Generation stopped before dispatch.');
        }
        await operations.appendLedger(ledgerRecord({ ...base, status: 'dispatched', dispatched: true, now: now() }));
        let result, fiction;
        try {
          result = await transport({ provider: route.provider, model: route.model, endpoint: route.endpoint, input, contract, signal });
          fiction = parseFiction(result.raw, input.evidence.map(event => event.alias));
        } catch (error) {
          const code = operationalDiagnostics.includes(error.code) ? error.code : 'transport_uncertain';
          const status = code === 'provider_refusal' ? 'refused' : code.includes('uncertain') ? 'uncertain' : signal?.aborted ? 'stopped' : 'failed';
          await operations.appendLedger(ledgerRecord({ ...base, status, dispatched: error.dispatched !== false, usage: error.usage ?? result?.usage ?? null, diagnostic: code, now: now() }));
          if (sticky.get(context) === key) sticky.delete(context);
          inventories.delete(key);
          if (status === 'uncertain' || signal?.aborted) throw Error('Provider outcome uncertain or stopped. Inspect pending work before explicit retry.');
          continue;
        }
        // Persist validated fictional work before accounting finalization or another role call.
        await onResult({ fiction, receipt: { attemptId, provider: route.provider, model: result.model ?? route.model, timestamp: now() } });
        sticky.set(context, key);
        await operations.appendLedger(ledgerRecord({ ...base, status: 'succeeded', dispatched: true, usage: result.usage, reportedModel: result.model ?? route.model, now: now() }));
        return fiction;
      }
      if (attempts.length >= 4) throw Error('This Send reached its four-attempt ceiling.');
      throw Error('No remaining eligible provider. Resume after configuration review, commit validated partial work, or discard.');
    }
  };
}
