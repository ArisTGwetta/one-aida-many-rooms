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
      append(...children) { this.children.push(...children); }, replaceChildren() { this.children = []; }, addEventListener(type, fn) { this.handlers[type] = fn; },
      dispatchEvent(event) { this.handlers[event.type]?.(event); } });
    return elements.get(id);
  };
  const previous = globalThis.document;
  globalThis.document = { getElementById: element, querySelector: () => element('backstage'), createElement: () => ({ dataset: {}, children: [], replaceChildren() { this.children = []; }, setAttribute() {}, addEventListener() {}, append(...children) { this.children.push(...children); } }) };
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
test('Theater doorway has no direct transport, browser persistence or shared memory dependencies', () => {
  for (const name of ['app.mjs', 'capability.mjs', 'contracts.mjs']) {
    const source = readFileSync(new URL(name, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /fetch\(|localStorage|sessionStorage|indexedDB|\.\.\/(?:memory|providers|sleep|conversation)/);
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

test('timeline names audiences; unsaved indicator survives navigation and failed save until verified success', async () => {
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, { dataset: {}, value: '', textContent: '', children: [], handlers: {},
      scrollHeight: 500, scrollTop: 400, clientHeight: 100,
      append(...children) { this.children.push(...children); }, replaceChildren() { this.children = []; },
      addEventListener(type, fn) { this.handlers[type] = fn; }, dispatchEvent(e) { this.handlers[e.type]?.(e); } });
    return nodes.get(id);
  };
  const previous = globalThis.document;
  globalThis.document = { getElementById: node, querySelector: () => node('backstage'), createElement: () => ({ dataset: {}, children: [], replaceChildren() { this.children = []; }, setAttribute() {}, addEventListener() {}, append(...children) { this.children.push(...children); } }) };
  try {
    node('theater-portfolio').value = 'meta'; node('theater-scope').value = 'meta';
    node('message').value = 'Everyday draft';
    let fail = true, writes = 0;
    setupTheater({ registry: createSkillRegistry([rpgBinding()]), storage: {
      loadPlay: async () => null,
      savePlay: async (_id, revision, snapshot) => {
        writes++; if (fail) throw Error('Readback failed');
        return { snapshot, revision: revision + 1 };
      }
    } });
    await node('theater-open').handlers.click();
    node('theater-play').value = 'doorway-demo'; await node('theater-play').handlers.change();
    assert.equal(node('theater-add').textContent, 'Send to META');
    node('theater-text').value = 'Private example'; await node('theater-add').handlers.click();
    assert.equal(node('theater-unsaved').hidden, false);
    assert.equal(writes, 0);
    node('theater-scope').value = 'game'; node('theater-scope').handlers.change();
    assert.equal(node('theater-add').textContent, 'Send to GAME');
    assert.match(node('theater-recipient-label').textContent, /Stage.*ensemble/);
    assert.equal(node('theater-recipient-portrait').children.length, 1);
    node('theater-text').value = 'Visible example'; await node('theater-add').handlers.click();
    const messages = node('theater-timeline').children;
    assert.equal(messages.length, 2);
    assert.match(messages[0].children[1].children[0].textContent, /Francisco.*META \/ Backstage/);
    assert.match(messages[1].children[1].children[0].textContent, /Francisco.*GAME \/ Onstage/);
    assert.equal(messages[0].children[1].children[1].textContent, 'Private example');
    node('theater-text').value = 'Unsent Theater draft';
    node('theater-room').dispatchEvent(new CustomEvent('theater-leave'));
    await node('theater-open').handlers.click();
    assert.equal(node('theater-text').value, 'Unsent Theater draft');
    assert.equal(node('message').value, 'Everyday draft');
    assert.equal(node('theater-unsaved').hidden, false);
    assert.equal(node('theater-play').disabled, true);
    assert.equal(node('theater-recover').disabled, true);
    await node('theater-save').handlers.click();
    assert.equal(node('theater-unsaved').hidden, false);
    assert.match(node('theater-status').textContent, /Readback failed/);
    fail = false; await node('theater-save').handlers.click();
    assert.equal(node('theater-unsaved').hidden, true);
    assert.equal(writes, 2);
    assert.match(node('theater-status').textContent, /Saved and verified/);
  } finally { globalThis.document = previous; }
});

test('explicit player boundary preserves failed-send draft and restore is invisible until verified save', async () => {
  const nodes = new Map();
  const make = () => ({ dataset: {}, value: '', textContent: '', checked: false, children: [], handlers: {},
    append(...children) { this.children.push(...children); }, replaceChildren() { this.children = []; },
    setAttribute() {}, addEventListener(type, fn) { this.handlers[type] = fn; },
    dispatchEvent(event) { this.handlers[event.type]?.(event); } });
  const node = id => { if (!nodes.has(id)) nodes.set(id, make()); return nodes.get(id); };
  const previousDocument = globalThis.document, previousConfirm = globalThis.confirm;
  globalThis.document = { getElementById: node, querySelector: () => node('backstage'), createElement: make }; globalThis.confirm = () => true;
  try {
    node('theater-scope').value = 'game'; node('theater-portfolio').value = 'game';
    let fail = true; const writes = [];
    setupTheater({ registry: createSkillRegistry([rpgBinding()]), storage: {
      loadPlay: async () => null,
      savePlay: async (id, revision, snapshot, operationId) => {
        writes.push(structuredClone({ id, revision, snapshot, operationId }));
        if (fail) throw Error('Readback failed');
        return { snapshot, revision: revision + 1 };
      }
    } });
    await node('theater-open').handlers.click();
    node('theater-play').value = 'doorway-demo'; await node('theater-play').handlers.change();
    assert.equal(node('theater-restore-last').hidden, true);
    node('theater-player-action').checked = true;
    node('theater-text').value = '   '; await node('theater-add').handlers.click();
    assert.equal(node('theater-text').value, '   ');
    assert.equal(node('theater-player-action').checked, true);
    assert.equal(node('theater-scope').value, 'game');
    assert.equal(node('theater-restore-last').hidden, true);
    node('theater-text').value = 'Enter the lair'; await node('theater-add').handlers.click();
    assert.equal(node('theater-player-action').checked, false);
    assert.equal(node('theater-restore-last').hidden, false);
    assert.equal(node('theater-restore-previous').hidden, true);
    node('theater-text').value = 'Caught'; await node('theater-add').handlers.click();
    node('theater-text').value = 'Draft after consequences';
    const before = node('theater-data').textContent;
    await node('theater-restore-last').handlers.click();
    assert.equal(node('theater-data').textContent, before);
    assert.equal(node('theater-text').value, 'Draft after consequences');
    assert.equal(node('theater-save').textContent, 'Retry restore');
    assert.equal(node('theater-add').disabled, true);
    assert.match(node('theater-status').textContent, /Readback failed/);
    fail = false; await node('theater-save').handlers.click();
    assert.deepEqual(writes[0], writes[1]);
    assert.equal(node('theater-restore-last').hidden, true);
    assert.equal(JSON.parse(node('theater-data').textContent).events.length, 0);
    assert.equal(node('theater-unsaved').hidden, true);
    const labels = node('theater-timeline').children.map(x => x.children[1].children[0].textContent);
    assert.ok(labels.every(label => label.includes('discarded')));
  } finally { globalThis.document = previousDocument; globalThis.confirm = previousConfirm; }
});

test('report controls copy projected working memory and clipboard failure preserves play and drafts', async () => {
  const nodes = new Map();
  const make = () => ({ dataset: {}, value: '', textContent: '', children: [], handlers: {},
    append(...children) { this.children.push(...children); }, replaceChildren() { this.children = []; },
    setAttribute() {}, addEventListener(type, fn) { this.handlers[type] = fn; },
    dispatchEvent(event) { this.handlers[event.type]?.(event); } });
  const node = id => { if (!nodes.has(id)) nodes.set(id, make()); return nodes.get(id); };
  const originalDocument = globalThis.document;
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const copied = []; let fail = true;
  globalThis.document = { getElementById: node, querySelector: () => node('backstage'), createElement: make };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard: {
    async writeText(text) { if (fail) throw Error('Clipboard denied'); copied.push(text); }
  } } });
  try {
    node('theater-portfolio').value = 'game'; node('theater-scope').value = 'meta';
    let writes = 0;
    setupTheater({ registry: createSkillRegistry([rpgBinding()]), storage: {
      loadPlay: async () => null, savePlay: async () => { writes++; throw Error('Unexpected write'); }
    } });
    const [meta, game] = node('backstage').children;
    assert.equal(meta.textContent, 'Copy full META report');
    assert.equal(game.textContent, 'Copy full GAME report');
    assert.equal(game.disabled, true);
    await node('theater-open').handlers.click();
    node('theater-play').value = 'doorway-demo'; await node('theater-play').handlers.change();
    node('theater-text').value = 'PRIVATE backstage secret'; await node('theater-add').handlers.click();
    node('theater-scope').value = 'game'; node('theater-scope').handlers.change();
    node('theater-text').value = 'Visible lantern'; await node('theater-add').handlers.click();
    node('theater-text').value = 'Unsent Theater draft'; node('message').value = 'Everyday draft';
    const before = node('theater-data').textContent;
    await game.handlers.click();
    assert.match(node('theater-status').textContent, /Could not copy.*Allow clipboard/);
    assert.equal(copied.length, 0);
    assert.equal(node('theater-data').textContent, before);
    assert.equal(node('theater-unsaved').hidden, false);
    assert.equal(node('theater-text').value, 'Unsent Theater draft');
    assert.equal(node('message').value, 'Everyday draft');
    fail = false; await game.handlers.click(); await meta.handlers.click();
    assert.match(copied[0], /Visible lantern/); assert.doesNotMatch(copied[0], /PRIVATE backstage secret/);
    assert.match(copied[0], /Unsaved changes: YES/); assert.match(copied[0], /none \(0\)/);
    assert.match(copied[1], /PRIVATE backstage secret/);
    assert.equal(writes, 0); assert.equal(node('theater-data').textContent, before);
  } finally {
    globalThis.document = originalDocument;
    if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
    else delete globalThis.navigator;
  }
});

test('rehearsal UI inspects separate packets, preserves validated state on errors and never writes play data', async () => {
  const nodes = new Map();
  const make = tagName => ({ tagName, dataset: {}, value: '', textContent: '', children: [], handlers: {},
    append(...children) { this.children.push(...children); }, replaceChildren() { this.children = []; },
    setAttribute() {}, addEventListener(type, fn) { this.handlers[type] = fn; },
    dispatchEvent(event) { this.handlers[event.type]?.(event); } });
  const node = id => { if (!nodes.has(id)) nodes.set(id, make('node')); return nodes.get(id); };
  const originalDocument = globalThis.document;
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  globalThis.document = { getElementById: node, querySelector: () => node('backstage'), createElement: make };
  const copies = []; let clipboardFails = true;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard: {
    async writeText(text) { if (clipboardFails) throw Error('Clipboard denied'); copies.push(text); }
  } } });
  try {
    node('theater-portfolio').value = 'game'; node('theater-scope').value = 'meta'; let writes = 0;
    setupTheater({ registry: createSkillRegistry([rpgBinding()]), storage: {
      loadPlay: async () => null, savePlay: async () => { writes++; throw Error('Unexpected persistence'); }
    } });
    await node('theater-open').handlers.click();
    node('theater-play').value = 'doorway-demo'; await node('theater-play').handlers.change();
    node('theater-text').value = 'PRIVATE synthetic backstage secret'; await node('theater-add').handlers.click();
    node('theater-scope').value = 'game'; node('theater-scope').handlers.change();
    node('theater-text').value = 'A guest brought flowers.'; await node('theater-add').handlers.click();
    node('theater-text').value = 'Unsent Theater draft'; node('message').value = 'Everyday draft';
    const before = node('theater-data').textContent;
    const panel = node('backstage').children.find(child => child.tagName === 'details');
    const find = label => panel.children.find(child => child.textContent === label);
    const [packetView, resultView] = panel.children.filter(child => child.tagName === 'pre');
    const proposalField = panel.children.find(child => child.id === 'theater-rehearsal-proposal');
    const audience = panel.children.find(child => child.id === 'theater-rehearsal-audience');
    assert.equal(find('Copy inspected evidence packet').disabled, true);
    await find('Inspect rehearsal evidence').handlers.click();
    const packet = JSON.parse(packetView.textContent);
    assert.equal(packet.audience, 'game');
    assert.doesNotMatch(packetView.textContent, /PRIVATE synthetic backstage secret/);
    const source = packet.evidence[0];
    proposalField.value = JSON.stringify({ schema: 'theater-rehearsal-proposal@1', audience: 'game', playId: packet.playId,
      baselineFingerprint: packet.baselineFingerprint, operations: [{ layer: 'short', kind: 'add', target: null,
        text: 'A guest brought flowers.', classification: 'accepted', evidence: [{ sourceId: source.sourceId, excerpt: source.text }], reason: 'Scene continuity.' }] });
    await find('Validate rehearsal proposal').handlers.click();
    const validated = resultView.textContent;
    assert.match(validated, /NOT APPROVED/);
    await find('Copy inspected evidence packet').handlers.click();
    assert.match(node('theater-status').textContent, /Could not copy rehearsal/);
    assert.equal(resultView.textContent, validated);
    assert.equal(packetView.textContent, JSON.stringify(packet, null, 2));
    await find('Copy rehearsal result').handlers.click();
    assert.equal(resultView.textContent, validated);
    assert.equal(copies.length, 0);
    proposalField.value = '{invalid'; await find('Validate rehearsal proposal').handlers.click();
    assert.equal(resultView.textContent, validated);
    clipboardFails = false;
    await find('Copy inspected evidence packet').handlers.click(); await find('Copy rehearsal result').handlers.click();
    assert.equal(copies.length, 2); assert.doesNotMatch(copies.join(''), /PRIVATE synthetic backstage secret/);
    await find('Use as next hypothetical rehearsal baseline').handlers.click();
    const next = JSON.parse(packetView.textContent);
    assert.equal(next.hypothetical, true); assert.equal(next.baseline.short.length, 1);
    assert.notEqual(next.baselineFingerprint, packet.baselineFingerprint);
    assert.equal(node('theater-data').textContent, before);
    node('theater-text').value = 'A new event changes context.'; await node('theater-add').handlers.click();
    assert.match(packetView.textContent, /Inspect current evidence/);
    assert.equal(find('Copy rehearsal result').disabled, true);
    audience.value = 'meta'; audience.handlers.change(); await find('Inspect rehearsal evidence').handlers.click();
    const meta = JSON.parse(packetView.textContent);
    assert.equal(meta.audience, 'meta'); assert.match(packetView.textContent, /PRIVATE synthetic backstage secret/);
    assert.equal(meta.hypothetical, false);
    assert.equal(writes, 0);
    assert.equal(node('message').value, 'Everyday draft');
  } finally {
    globalThis.document = originalDocument;
    if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
    else delete globalThis.navigator;
  }
});

test('Rias UI requires explicit approval, copies only approved excerpts and never writes or canonizes replies', async () => {
  const nodes = new Map();
  const make = tagName => ({ tagName, dataset: {}, value: '', textContent: '', children: [], handlers: {},
    append(...children) { this.children.push(...children); }, replaceChildren() { this.children = []; },
    setAttribute() {}, addEventListener(type, fn) { this.handlers[type] = fn; },
    dispatchEvent(event) { this.handlers[event.type]?.(event); } });
  const node = id => { if (!nodes.has(id)) nodes.set(id, make('node')); return nodes.get(id); };
  const originalDocument = globalThis.document, originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  globalThis.document = { getElementById: node, querySelector: () => node('backstage'), createElement: make };
  const copied = []; let clipboardFails = true;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard: {
    async writeText(text) { if (clipboardFails) throw Error('Clipboard denied'); copied.push(text); }
  } } });
  try {
    node('theater-portfolio').value = 'game'; node('theater-scope').value = 'meta'; let writes = 0;
    setupTheater({ registry: createSkillRegistry([rpgBinding()]), storage: {
      loadPlay: async () => null, savePlay: async () => { writes++; throw Error('Unexpected persistence'); }
    } });
    const panel = node('backstage').children.find(child => child.children.some(item => item.textContent === 'Rias · supervised reply rehearsal'));
    const find = label => panel.children.find(child => child.textContent === label);
    const byId = id => panel.children.find(child => child.id === id);
    const [sourceView, selectionView, packetView, proposalView] = panel.children.filter(child => child.tagName === 'pre');
    assert.ok(panel); assert.equal(find('Prepare Rias packet').disabled, true);
    assert.equal(find('Accept Rias reply into GAME').disabled, true);
    await node('theater-open').handlers.click(); node('theater-play').value = 'doorway-demo'; await node('theater-play').handlers.change();
    node('theater-text').value = 'Private synthetic backstage secret.'; await node('theater-add').handlers.click();
    node('theater-scope').value = 'game'; node('theater-scope').handlers.change();
    node('theater-text').value = 'An unidentified figure approaches. An omniscient note reveals a hidden map.'; await node('theater-add').handlers.click();
    node('theater-text').value = 'Unsent Theater draft'; node('message').value = 'Everyday draft';
    const before = node('theater-data').textContent;
    assert.match(sourceView.textContent, /omniscient/);
    byId('theater-character-excerpt').value = 'An unidentified figure approaches.';
    await find('Select visible excerpt').handlers.click();
    assert.equal(find('Prepare Rias packet').disabled, true);
    assert.match(selectionView.textContent, /Not approved/);
    await find('Approve selected excerpts for Rias').handlers.click(); await find('Prepare Rias packet').handlers.click();
    const first = JSON.parse(packetView.textContent);
    assert.deepEqual(first.approvedEvidence, [{ alias: 'visible-1', text: 'An unidentified figure approaches.' }]);
    assert.doesNotMatch(packetView.textContent, /hidden map|omniscient|Private synthetic/);
    await find('Copy inspected Rias packet').handlers.click();
    assert.match(node('theater-status').textContent, /Could not copy Rias/);
    assert.deepEqual(JSON.parse(packetView.textContent), first);
    clipboardFails = false; await find('Copy inspected Rias packet').handlers.click();
    assert.equal(copied.length, 1); assert.deepEqual(JSON.parse(copied[0]), first);
    const response = { schema: 'theater-character-reply@1', characterId: 'rias', attemptId: first.attemptId,
      fingerprint: first.fingerprint, dialogue: 'Rias tilts her head. “Who is there?”' };
    byId('theater-character-reply').value = JSON.stringify(response); await find('Show proposed Rias reply').handlers.click();
    assert.match(proposalView.textContent, /PROPOSED.*noncanonical/);
    assert.match(proposalView.textContent, /Who is there/);
    assert.equal(node('theater-data').textContent, before);
    await find('Regenerate Rias attempt').handlers.click(); const second = JSON.parse(packetView.textContent);
    assert.notEqual(first.attemptId, second.attemptId); assert.match(proposalView.textContent, /No proposed Rias reply/);
    byId('theater-character-reply').value = JSON.stringify(response); await find('Show proposed Rias reply').handlers.click();
    assert.match(node('theater-status').textContent, /Invalid or stale/);
    assert.match(proposalView.textContent, /No proposed Rias reply/);
    await find('Discard Rias attempt').handlers.click(); assert.match(packetView.textContent, /No packet prepared/);
    await find('Prepare Rias packet').handlers.click();
    node('theater-text').value = 'A new visible bell rings.'; await node('theater-add').handlers.click();
    assert.match(packetView.textContent, /No packet prepared/); assert.match(selectionView.textContent, /Not approved/);
    assert.equal(find('Prepare Rias packet').disabled, true);
    assert.equal(writes, 0); assert.equal(node('message').value, 'Everyday draft');
    assert.doesNotMatch(node('theater-data').textContent, /Who is there/);
  } finally {
    globalThis.document = originalDocument;
    if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
    else delete globalThis.navigator;
  }
});

test('accept UI adds one unsaved Rias event, consumes the attempt and preserves it on save conflict', async () => {
  const nodes = new Map();
  const make = tagName => ({ tagName, dataset: {}, value: '', textContent: '', children: [], handlers: {},
    append(...children) { this.children.push(...children); }, replaceChildren() { this.children = []; },
    setAttribute() {}, addEventListener(type, fn) { this.handlers[type] = fn; }, dispatchEvent(event) { this.handlers[event.type]?.(event); } });
  const node = id => { if (!nodes.has(id)) nodes.set(id, make('node')); return nodes.get(id); };
  const originalDocument = globalThis.document; globalThis.document = { getElementById: node, querySelector: () => node('backstage'), createElement: make };
  try {
    node('theater-scope').value = 'game'; node('theater-portfolio').value = 'game';
    let writes = 0, conflict = true;
    setupTheater({ registry: createSkillRegistry([rpgBinding()]), storage: {
      loadPlay: async () => null,
      savePlay: async (_id, revision, snapshot) => {
        writes++; if (conflict) throw Error('Theater changed on another device; recover before saving.');
        return { snapshot, revision: revision + 1 };
      }
    } });
    const panel = node('backstage').children.find(child => child.children.some(item => item.textContent === 'Rias · supervised reply rehearsal'));
    const find = label => panel.children.find(child => child.textContent === label);
    const byId = id => panel.children.find(child => child.id === id);
    const pre = panel.children.filter(child => child.tagName === 'pre');
    await node('theater-open').handlers.click(); node('theater-play').value = 'doorway-demo'; await node('theater-play').handlers.change();
    node('theater-player-action').checked = true; node('theater-text').value = 'An unidentified figure approaches.';
    await node('theater-add').handlers.click();
    byId('theater-character-excerpt').value = 'An unidentified figure approaches.';
    await find('Select visible excerpt').handlers.click(); await find('Approve selected excerpts for Rias').handlers.click();
    await find('Prepare Rias packet').handlers.click(); const packet = JSON.parse(pre[2].textContent);
    const envelope = { schema: 'theater-character-reply@1', characterId: 'rias', attemptId: packet.attemptId,
      fingerprint: packet.fingerprint, dialogue: 'Rias asks, “Who is there?”' };
    byId('theater-character-reply').value = JSON.stringify(envelope);
    assert.equal(find('Accept Rias reply into GAME').disabled, true);
    await find('Show proposed Rias reply').handlers.click();
    assert.equal(find('Accept Rias reply into GAME').disabled, false);
    node('theater-text').value = 'Unsent Theater draft'; node('message').value = 'Everyday draft';
    await find('Accept Rias reply into GAME').handlers.click();
    assert.match(node('theater-status').textContent, /accepted locally.*unsaved/);
    const accepted = JSON.parse(node('theater-data').textContent);
    assert.equal(accepted.events.length, 2); assert.equal(accepted.events.at(-1).speaker.id, 'rias');
    assert.equal(node('theater-restore-last').hidden, false); assert.equal(node('theater-restore-previous').hidden, true);
    assert.equal(node('theater-unsaved').hidden, false); assert.equal(writes, 0);
    const label = node('theater-timeline').children.at(-1).children[1].children[0].textContent;
    assert.match(label, /^Rias.*accepted by Francisco/);
    assert.equal(find('Accept Rias reply into GAME').disabled, true);
    await find('Accept Rias reply into GAME').handlers.click();
    assert.equal(JSON.parse(node('theater-data').textContent).events.length, 2);
    await node('theater-save').handlers.click();
    assert.match(node('theater-status').textContent, /another device/);
    assert.deepEqual(JSON.parse(node('theater-data').textContent), accepted);
    assert.equal(node('theater-unsaved').hidden, false);
    assert.equal(node('theater-text').value, 'Unsent Theater draft'); assert.equal(node('message').value, 'Everyday draft');
    conflict = false; await node('theater-save').handlers.click();
    assert.equal(node('theater-unsaved').hidden, true); assert.match(node('theater-status').textContent, /Saved and verified/);
  } finally { globalThis.document = originalDocument; }
});


test('supervised Send is opt-in, preserves drafts and canonical scene on failure, and exposes Stop and recoverable pending work', async () => {
  const nodes = new Map();
  const make = tagName => ({ tagName, dataset: {}, value: '', textContent: '', children: [], handlers: {},
    append(...children) { this.children.push(...children); }, replaceChildren() { this.children = []; }, setAttribute() {},
    addEventListener(type, fn) { this.handlers[type] = fn; }, dispatchEvent(event) { this.handlers[event.type]?.(event); } });
  const node = id => { if (!nodes.has(id)) nodes.set(id, make('node')); return nodes.get(id); };
  const originalDocument = globalThis.document;
  globalThis.document = { getElementById: node, querySelector: () => node('backstage'), createElement: make };
  try {
    node('theater-scope').value = 'meta'; node('theater-portfolio').value = 'game';
    let canonical = null, work = null, failNarrator = true, calls = 0, privateWrites = 0;
    const ledger = [];
    const storage = {
      loadPlay: async () => structuredClone(canonical),
      savePlay: async (_id, revision, snapshot, operationId) => { canonical = { snapshot: structuredClone(snapshot), revision: revision + 1, operationId }; return structuredClone(canonical); },
      saveWork: async next => { privateWrites++; work = structuredClone(next); },
      loadWork: async () => work?.status === 'pending' ? structuredClone(work) : null,
      loadLedger: async () => structuredClone(ledger), appendLedger: async row => { ledger.push(structuredClone(row)); }
    };
    setupTheater({ registry: createSkillRegistry([rpgBinding()]), storage, provider: {
      available: () => true, inventory: async route => [route.model], unlock: async () => {},
      call: async request => {
        calls++; assert.equal(node('theater-stop').hidden, false);
        if (request.input.role === 'game_narrator' && failNarrator) throw Object.assign(Error('PRIVATE_TRANSPORT_DETAILS'), { code: 'provider_http' });
        return { raw: JSON.stringify({ decision: 'speak', text: 'A fictional reply.', sources: [request.input.evidence.at(-1).alias] }), usage: { inputTokens: 20, outputTokens: 12 } };
      }
    } });
    await node('theater-open').handlers.click(); node('theater-play').value = 'doorway-demo'; await node('theater-play').handlers.change();
    assert.equal(calls, 0); assert.equal(privateWrites, 0);
    node('theater-text').value = 'A backstage draft';
    node('theater-scope').value = 'game'; node('theater-scope').handlers.change(); node('theater-text').value = 'An onstage draft';
    node('theater-scope').value = 'meta'; node('theater-scope').handlers.change(); assert.equal(node('theater-text').value, 'A backstage draft');
    node('theater-scope').value = 'game'; node('theater-scope').handlers.change(); assert.equal(node('theater-text').value, 'An onstage draft');
    const policy = JSON.parse(node('theater-policy').value);
    policy.cloudConsent = true; policy.game = [policy.game[0]]; policy.game[0].cloudAllowed = true;
    node('theater-policy').value = JSON.stringify(policy); await node('theater-policy-apply').handlers.click();
    node('theater-auto').checked = true; await node('theater-auto').handlers.change();
    node('theater-input-kind').value = 'speech'; node('theater-text').value = 'Hello, Rias.';
    await node('theater-add').handlers.click();
    assert.equal(calls, 2); assert.equal(canonical, null); assert.equal(node('theater-text').value, 'Hello, Rias.');
    assert.equal(node('theater-pending').hidden, false); assert.equal(node('theater-save').disabled, true);
    assert.match(node('theater-pending-data').textContent, /A fictional reply/);
    assert.doesNotMatch(node('theater-pending-data').textContent, /PRIVATE_TRANSPORT_DETAILS/);
    assert.equal(node('theater-stop').hidden, true);
    failNarrator = false; policy.game.push({ ...policy.game[0], id: 'alternate', model: 'fixture-alternate' });
    node('theater-policy').value = JSON.stringify(policy); await node('theater-policy-apply').handlers.click();
    node('theater-text').value = 'My next unsent message';
    await node('theater-resume-turn').handlers.click();
    assert.equal(calls, 3); assert.equal(canonical.revision, 1); assert.equal(canonical.snapshot.events.length, 3);
    assert.equal(node('theater-pending').hidden, true); assert.equal(node('theater-text').value, 'My next unsent message');
    assert.match(node('theater-status').textContent, /saved and verified/);
    assert.ok(node('theater-timeline').children.some(item => item.children[1].children[0].textContent.startsWith('Rias')));
    assert.ok(node('theater-timeline').children.some(item => item.children[1].children[0].textContent.startsWith('Aida')));
    node('theater-spending-scope').value = 'story'; node('theater-spending-period').value = 'all-time';
    await node('theater-spending-refresh').handlers.click(); assert.equal(JSON.parse(node('theater-spending').textContent).attempts, 3);
    assert.doesNotMatch(node('theater-data').textContent, /provider_http|PRIVATE_TRANSPORT_DETAILS/);
  } finally { globalThis.document = originalDocument; }
});
