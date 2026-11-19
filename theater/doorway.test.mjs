import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSkillRegistry } from '../skill-registry.mjs';
import { rpgBinding } from './capability.mjs';
import { validEntry, validReceipt, finishVisit } from './contracts.mjs';
import { setupTheater } from './app.mjs';
const entry = { schema: 'theater-entry@1', operation: 'open', playId: 'doorway-demo', resumeRef: null };
test('doorway dispatch validates entry and rejects host data, foreign plays and unsupported operations', async () => {
  const registry = createSkillRegistry([rpgBinding()]);
  const dispatch = (input, context = {}, phase = 'manual') => registry.dispatch({ id: 'rpg', version: 1, input }, context, phase);
  assert.deepEqual(await dispatch(entry), entry);
  for (const input of [{ ...entry, playId: 'foreign-play' }, { ...entry, resumeRef: 'legacy-path' },
    { ...entry, operation: 'save' }, { ...entry, memory: 'private' }]) {
    assert.equal(validEntry(input), false);
    await assert.rejects(dispatch(input));
  }
  await assert.rejects(dispatch(entry, { memory: 'private' }));
  await assert.rejects(dispatch(entry, {}, 'read'));
});
test('exit permits only an attributed synthetic receipt and no memory or transcript', () => {
  const receipt = finishVisit(entry, 'visit-1');
  assert.equal(validReceipt(receipt), true);
  for (const extra of ['transcript', 'meta', 'long', 'short', 'recent', 'relationship'])
    assert.equal(validReceipt({ ...receipt, [extra]: 'private dramatic scene' }), false);
  assert.equal(validReceipt({ ...receipt, orientation: 'A private relationship was established.' }), false);
  assert.equal(validReceipt({ ...receipt, playId: 'foreign-play' }), false);
  assert.equal(validReceipt({ ...receipt, resumeRef: 'foreign-record' }), false);
  assert.throws(() => finishVisit({ ...entry, playId: null }, 'visit-1'));
});
test('opening, choosing and returning uses empty host context and preserves everyday draft', async () => {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, { dataset: {}, value: '', textContent: '', children: [], handlers: {},
      append(child) { this.children.push(child); }, addEventListener(type, fn) { this.handlers[type] = fn; },
      showModal() { this.open = true; }, close() { this.open = false; } });
    return elements.get(id);
  };
  const previous = globalThis.document;
  globalThis.document = { getElementById: element, createElement: () => ({}) };
  try {
    element('message').value = 'Unsent everyday draft';
    const requests = [];
    const registry = createSkillRegistry([rpgBinding()]);
    setupTheater({ registry: { async dispatch(request, context, phase) {
      requests.push(structuredClone({ request, context, phase }));
      return registry.dispatch(request, context, phase);
    } } });
    await element('theater-open').handlers.click();
    assert.equal(element('theater-doorway').open, true);
    element('theater-play').value = 'doorway-demo';
    await element('theater-play').handlers.change();
    element('theater-return').handlers.click();
    assert.equal(element('theater-doorway').open, false);
    assert.equal(validReceipt(JSON.parse(element('theater-status').textContent)), true);
    assert.equal(element('message').value, 'Unsent everyday draft');
    assert.equal(requests.length, 2);
    assert.ok(requests.every(request => Object.keys(request.context).length === 0));
  } finally { globalThis.document = previous; }
});
test('Theater modules have no provider, persistence or everyday memory dependencies', () => {
  for (const name of ['app.mjs', 'capability.mjs', 'contracts.mjs']) {
    const source = readFileSync(new URL(name, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /fetch\(|localStorage|sessionStorage|indexedDB|\.\/memory|\.\/providers|\.\/sleep|\.\/conversation/);
  }
});
