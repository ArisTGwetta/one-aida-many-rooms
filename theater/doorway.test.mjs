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
test('room navigation selects and recovers a play without host conversation access', async () => {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, { dataset: {}, value: '', textContent: '', children: [], handlers: {},
      append(child) { this.children.push(child); }, addEventListener(type, fn) { this.handlers[type] = fn; },
      dispatchEvent(event) { this.handlers[event.type]?.(event); } });
    return elements.get(id);
  };
  const previous = globalThis.document;
  globalThis.document = { getElementById: element, createElement: () => ({}) };
  try {
    element('message').value = 'Unsent everyday draft';
    element('theater-portfolio').value = 'meta';
    let entered = 0, exited = 0;
    element('theater-room').addEventListener('theater-enter', () => entered++);
    element('theater-room').addEventListener('theater-exit', () => {
      exited++; element('theater-room').dispatchEvent(new CustomEvent('theater-leave'));
    });
    const requests = [];
    const registry = createSkillRegistry([rpgBinding()]);
    setupTheater({ registry: { async dispatch(request, context, phase) {
      requests.push(structuredClone({ request, context, phase }));
      return registry.dispatch(request, context, phase);
    } }, storage: { loadPlay: async () => null } });
    await element('theater-open').handlers.click();
    assert.equal(entered, 1);
    element('theater-play').value = 'doorway-demo';
    await element('theater-play').handlers.change();
    element('theater-return').handlers.click();
    assert.equal(exited, 1);
    assert.equal(validReceipt(JSON.parse(element('theater-receipt').textContent)), true);
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

test('actual room navigation leaves Theater for Chat Library Glasses and restores composer visibility', async () => {
  const { runInNewContext } = await import('node:vm');
  const source = readFileSync(new URL('../mobile-view.mjs', import.meta.url), 'utf8');
  const start = source.indexOf('function leaveTheater()');
  const end = source.indexOf('byId("mobile-palace").addEventListener', start);
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, { hidden: true, handlers: {}, attrs: {},
      addEventListener(type, fn) { this.handlers[type] = fn; },
      dispatchEvent(e) { this.handlers[e.type]?.(e); },
      setAttribute(key, value) { this.attrs[key] = value; }, focus() {} });
    return nodes.get(id);
  };
  let receipts = 0;
  node('theater-room').addEventListener('theater-leave', () => receipts++);
  const context = { byId: node, CustomEvent, openSettings() {}, message: { focus() {} },
    room: { classList: { add() {}, toggle() {} } }, matchMedia: () => ({ matches: true }) };
  runInNewContext(source.slice(start, end), context);
  node('theater-room').dispatchEvent(new CustomEvent('theater-enter'));
  assert.equal(node('theater-room').hidden, false);
  assert.equal(node('mobile-compose').hidden, true);
  context.showPalace(true);
  assert.equal(node('theater-room').hidden, true);
  assert.equal(node('mind-palace').hidden, false);
  assert.equal(node('mobile-compose').hidden, false);
  assert.equal(receipts, 1);
  node('theater-room').dispatchEvent(new CustomEvent('theater-enter'));
  node('theater-room').dispatchEvent(new CustomEvent('theater-exit'));
  assert.equal(node('theater-room').hidden, true);
  assert.equal(node('mind-palace').hidden, true);
  assert.equal(receipts, 2);
  // The unchanged Glasses handler goes through showPalace before opening its panel.
  assert.match(source, /const previous = byId\("mind-palace"\)\.hidden \? "chat" : "library";\s+showPalace\(false\);/);
});
