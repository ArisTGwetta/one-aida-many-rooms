import test from 'node:test';
import assert from 'node:assert/strict';
import { ledgerRecord, latestAttempts, reservedSpend, spendingView, validateLedger } from './ledger.mjs';
const route = { provider: 'openai', model: 'fixture-model', pricing: { inputPerMillion: 1, outputPerMillion: 2 } };
const base = { attemptId: 'attempt-1', playId: 'doorway-demo', sessionId: 'session-1', turnId: 'turn-1', context: 'game_character', route, reservation: .01 };
test('operational phases count each attempt once and reserve unknown outcomes conservatively', () => {
  const planned = ledgerRecord({ ...base, status: 'planned', dispatched: false, now: '2026-11-21T12:00:00Z' });
  assert.equal(reservedSpend([planned]), .01);
  const uncertain = ledgerRecord({ ...base, status: 'uncertain', dispatched: true, diagnostic: 'transport_uncertain', now: '2026-11-21T12:00:01Z' });
  assert.equal(reservedSpend([planned, uncertain]), .01);
  const success = ledgerRecord({ ...base, status: 'succeeded', dispatched: true, usage: { inputTokens: 100, outputTokens: 20 }, now: '2026-11-21T12:00:02Z' });
  assert.equal(latestAttempts([success, planned, uncertain, success]).length, 1);
  assert.equal(reservedSpend([planned, uncertain, success]), .00014);
  assert.throws(() => latestAttempts([success, { ...success, model: 'other-model' }]), /Conflicting/);
});
test('session/story calendar views retain failed and uncertain attempts without treating local computation as free', () => {
  const records = [
    ledgerRecord({ ...base, status: 'failed', dispatched: true, now: '2026-11-20T15:00:00Z' }),
    ledgerRecord({ ...base, attemptId: 'attempt-2', sessionId: 'session-2', route: { provider: 'ollama', model: 'fixture-local' }, status: 'succeeded', dispatched: true, now: '2026-11-21T15:00:00Z' }),
    ledgerRecord({ ...base, attemptId: 'attempt-3', status: 'stopped', dispatched: false, now: '2026-10-01T15:00:00Z' })
  ];
  const filter = { playId: base.playId, sessionId: 'session-2', anchor: '2026-11-21T16:00:00Z' };
  assert.equal(spendingView(records, { ...filter, scope: 'session' }).attempts, 1);
  for (const period of ['week', 'month', 'year']) assert.equal(spendingView(records, { ...filter, period }).dispatched, 2);
  assert.equal(spendingView(records, { ...filter, period: 'day' }).attempts, 1);
  const all = spendingView(records, filter);
  assert.equal(all.unknownAttempts, 1); assert.equal(all.reservedUnknownUsd, .01);
  assert.equal(all.localApiChargeUsd, 0); assert.equal(all.localComputationalCost, 'unmeasured');
  assert.throws(() => validateLedger({ ...records[0], rawResponse: 'private' }));
  assert.throws(() => validateLedger({ ...records[0], diagnostic: 'raw error with private dialogue' }));
  assert.throws(() => validateLedger({ ...records[0], diagnostic: 'private_secret_disguised_as_code' }));
});
