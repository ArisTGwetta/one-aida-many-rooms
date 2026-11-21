import test from 'node:test';
import assert from 'node:assert/strict';
import { createRoleRouter, defaultTurnPolicy, parseFiction } from './providers.mjs';
import { roleContract } from './turns.mjs';
function route(id, provider = 'openai') { return { id, provider, model: id, endpoint: provider === 'ollama' ? 'http://127.0.0.1:11434' : null, cloudAllowed: true,
  pricing: { inputPerMillion: 1, outputPerMillion: 2, version: 'synthetic-price' } }; }
function fixture(transport) {
  const records = [], called = [], inventoryCalls = [];
  const policy = { ...defaultTurnPolicy(), cloudConsent: true, game: [route('preferred'), route('local', 'ollama'), route('last', 'xai')], meta: [route('meta-preferred'), route('meta-local', 'ollama')] };
  let date = '2026-11-21T15:00:00Z', unavailable = '';
  const operations = { loadLedger: async () => structuredClone(records), appendLedger: async record => { records.push(structuredClone(record)); } };
  const router = createRoleRouter({ operations, now: () => date, available: r => r.model !== unavailable,
    inventory: async r => { inventoryCalls.push(r.model); return [r.model]; },
    transport: async request => { called.push(request.model); return transport ? transport(request) : { raw: JSON.stringify({ decision: 'speak', text: 'A grounded fictional reply.', sources: ['e1'] }), usage: { inputTokens: 50, outputTokens: 20 } }; } });
  async function run(context = 'game_character', options = {}) {
    const attempts = options.attempts ?? [];
    return router.run({ playId: 'doorway-demo', sessionId: 'session-1', turnId: crypto.randomUUID(), context, policy, attempts,
      input: { evidence: [{ alias: 'e1', text: 'A visible greeting.' }] }, contract: roleContract(100), onDispatch: async a => attempts.push(a), onResult: async () => {}, ...options });
  }
  return { router, policy, called, records, inventoryCalls, run, day: value => { date = value; }, unavailable: value => { unavailable = value; } };
}
test('successful routes stick separately per role, retain configured order, reset by session/day/configuration and never probe paid comparisons', async () => {
  let preferredFailed = false;
  const f = fixture(async request => {
    if (request.model === 'preferred' && !preferredFailed) { preferredFailed = true; throw Object.assign(Error('private refusal body'), { code: 'provider_refusal' }); }
    return { raw: JSON.stringify({ decision: 'speak', text: 'No, I will not open that door.', sources: ['e1'] }) };
  });
  await f.run(); assert.deepEqual(f.called, ['preferred', 'local']);
  await f.run(); assert.deepEqual(f.called.slice(-1), ['local']);
  await f.run('game_narrator'); assert.equal(f.called.at(-1), 'preferred');
  await f.run('meta_aida'); assert.equal(f.called.at(-1), 'meta-preferred');
  assert.deepEqual(f.policy.game.map(r => r.model), ['preferred', 'local', 'last']);
  const count = f.called.length; f.router.preferences(); assert.equal(f.called.length, count);
  await f.run('game_character', { sessionId: 'session-2' }); assert.equal(f.called.at(-1), 'preferred');
  f.day('2026-11-22T15:00:00Z'); await f.run(); assert.equal(f.called.at(-1), 'preferred');
  f.policy.game.reverse(); await f.run(); assert.equal(f.called.at(-1), 'last');
  f.router.reset(); assert.deepEqual(f.router.preferences(), {});
  assert.ok(!JSON.stringify(f.records).includes('private refusal body'));
});
test('fallback is duplicate-free, GAME roles share four attempts and META has its own ceiling', async () => {
  const f = fixture(async () => { throw Object.assign(Error('failure'), { code: 'provider_http' }); });
  f.policy.game = [route('a'), route('b'), route('b-duplicate'), route('c'), route('d')];
  f.policy.game[2].model = 'b';
  const attempts = [];
  await assert.rejects(f.run('game_character', { attempts }), /four-attempt/);
  assert.deepEqual(f.called, ['a', 'b', 'c', 'd']);
  await assert.rejects(f.run('game_narrator', { attempts }), /four-attempt/);
  assert.equal(f.called.length, 4);
  await assert.rejects(f.run('meta_aida'), /No remaining/);
  assert.deepEqual(f.called.slice(-2), ['meta-preferred', 'meta-local']);
});
test('silence succeeds without fallback; provider refusal and invalid citations do not become fictional contributions', async () => {
  const f = fixture(async () => ({ raw: JSON.stringify({ decision: 'silent', text: null, sources: [] }) }));
  await f.run(); await f.run(); assert.deepEqual(f.called, ['preferred', 'preferred']);
  assert.throws(() => parseFiction(JSON.stringify({ decision: 'speak', text: 'Made up', sources: ['fabricated'] }), ['e1']));
  assert.throws(() => parseFiction(JSON.stringify({ decision: 'silent', text: 'transport diagnostic', sources: [] }), ['e1']));
  assert.throws(() => parseFiction(JSON.stringify({ decision: 'provider_refusal', text: null, sources: [] }), ['e1']), error => error.code === 'provider_refusal');
  assert.throws(() => parseFiction(JSON.stringify({ decision: 'provider_refusal', text: 'PRIVATE_REFUSAL', sources: [] }), ['e1']), error => error.code === 'reply_invalid');
});
test('authorization, verified model inventory, unknown prices and budgets gate dispatch before a charge', async () => {
  const f = fixture(); f.policy.cloudConsent = false;
  await f.run(); assert.deepEqual(f.called, ['local']);
  f.unavailable('local'); await assert.rejects(f.run()); assert.equal(f.called.length, 1);
  f.policy.cloudConsent = true; f.policy.game = [route('preferred')]; f.policy.game[0].pricing = null;
  await assert.rejects(f.run()); assert.equal(f.called.length, 1);
  f.policy.game[0].pricing = route('preferred').pricing; f.policy.turnBudgetUsd = 0;
  await assert.rejects(f.run(), /spending ceiling/); assert.equal(f.called.length, 1);
  assert.equal(f.records.filter(r => r.status === 'planned').length, 1);
  const r = createRoleRouter({ operations: { loadLedger: async () => [], appendLedger: async () => assert.fail('must not reserve') }, inventory: async () => ['different-model'], transport: async () => assert.fail('must not call') });
  await assert.rejects(r.run({ playId: 'doorway-demo', sessionId: 'session-1', turnId: 'turn-1', context: 'game_character', policy: f.policy, attempts: [], input: {}, contract: roleContract(100) }), /No remaining/);
});
test('uncertain transport stops automatic fallback and Stop prevents the next provider', async () => {
  const f = fixture(async () => { throw Object.assign(Error('secret details'), { code: 'transport_uncertain' }); });
  await assert.rejects(f.run(), /uncertain/); assert.equal(f.called.length, 1);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(f.run('meta_aida', { signal: controller.signal }), /stopped/); assert.equal(f.called.length, 1);
  assert.equal(f.records.at(-1).status, 'uncertain');
});
