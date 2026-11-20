import { createCharacterRehearsal } from './characters.mjs';
import { createEvidencePacket, validateProposal, useHypotheticalBaseline } from './rehearsal.mjs';
import { buildMemoryReport } from './reports.mjs';
import { playerAction, proposeRestore, commitRestore } from './restore.mjs';
import { plays, finishVisit } from './contracts.mjs';
import { emptyPlay, appendEvent, setEntry, portfolioView, upgradePlay } from './continuity.mjs';
export function setupTheater({ registry, storage }) {
  const el = id => document.getElementById(id);
  const button = el('theater-open');
  if (button.dataset.ready) return;
  button.dataset.ready = 'true';
  button.disabled = false;
  let entry, play, revision = 0, visitId, resumeRef = null, pending, busy = false, dirty = false;
  const status = text => { el('theater-status').textContent = text; };
  const reportButtons = ['meta', 'game'].map(audience => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Copy full ' + audience.toUpperCase() + ' report';
    button.addEventListener('click', () => task(async () => {
      const report = buildMemoryReport(play, audience, { verifiedRevision: revision, unsavedChanges: dirty,
        pendingRestore: pending?.kind === 'restore' });
      try {
        if (!navigator.clipboard?.writeText) throw Error('Clipboard unavailable');
        await navigator.clipboard.writeText(report);
      } catch {
        throw Error('Could not copy the Theater report. Allow clipboard access and try again.');
      }
      status(audience.toUpperCase() + ' report copied from the current working projection.');
    }));
    document.querySelector('#theater-room .theater-backstage').append(button);
    return button;
  });
  const rehearsalStates = new Map();
  const rehearsalPanel = document.createElement('details');
  const rehearsalTitle = document.createElement('summary');
  rehearsalTitle.textContent = 'Memory rehearsal · hypothetical, never saved or applied';
  rehearsalPanel.append(rehearsalTitle);
  const rehearsalNotice = document.createElement('p');
  rehearsalNotice.textContent = 'Inspect the selected audience and evidence before copying. Copying may disclose private play content to the external summarizer you choose. No model is called here. Validation checks structure and sources; human semantic review is still required.';
  rehearsalPanel.append(rehearsalNotice);
  const audienceLabel = document.createElement('label');
  audienceLabel.textContent = 'Rehearsal audience'; audienceLabel.htmlFor = 'theater-rehearsal-audience';
  const rehearsalAudience = document.createElement('select'); rehearsalAudience.id = 'theater-rehearsal-audience';
  for (const audience of ['game', 'meta']) {
    const option = document.createElement('option'); option.value = audience; option.textContent = audience.toUpperCase();
    rehearsalAudience.append(option);
  }
  rehearsalAudience.value = 'game'; rehearsalPanel.append(audienceLabel, rehearsalAudience);
  const rehearsalPacket = document.createElement('pre');
  const proposalLabel = document.createElement('label');
  proposalLabel.textContent = 'Paste proposed JSON for the selected audience'; proposalLabel.htmlFor = 'theater-rehearsal-proposal';
  const rehearsalProposal = document.createElement('textarea'); rehearsalProposal.id = 'theater-rehearsal-proposal';
  rehearsalProposal.rows = 5; rehearsalProposal.maxLength = 150000;
  const rehearsalResult = document.createElement('pre');
  const rehearsalActions = [];
  function rehearsalContext() {
    const audience = rehearsalAudience.value;
    const projection = portfolioView(play, audience);
    const metadata = { playSchema: play.schema, verifiedRevision: revision, unsavedChanges: dirty,
      pendingRestore: pending?.kind === 'restore' };
    const sourceKey = JSON.stringify({ projection, metadata });
    let state = rehearsalStates.get(audience);
    if (!state || state.sourceKey !== sourceKey) {
      state = { sourceKey, hypothesis: null, packet: null, result: null };
      rehearsalStates.set(audience, state);
    }
    return { audience, projection, metadata, state };
  }
  async function freshRehearsalPacket(context) {
    const packet = await createEvidencePacket(context.projection, context.audience, context.metadata, context.state.hypothesis);
    if (!context.state.packet || packet.baselineFingerprint !== context.state.packet.baselineFingerprint)
      throw Error('Rehearsal evidence changed. Inspect a new packet and validate again.');
    return packet;
  }
  function paintRehearsal() {
    const state = play ? rehearsalContext().state : null;
    rehearsalPacket.textContent = state?.packet ? JSON.stringify(state.packet, null, 2) : 'Inspect current evidence to prepare a separate audience packet. Earlier proposals become stale when evidence changes.';
    rehearsalResult.textContent = state?.result ? JSON.stringify(state.result, null, 2) : 'No validated proposal for this baseline. Hypothetical rehearsal only.';
    for (const { button, requires } of rehearsalActions)
      button.disabled = busy || !play || (requires === 'packet' && !state?.packet) || (requires === 'result' && !state?.result);
    rehearsalAudience.disabled = busy || !play;
  }
  function rehearsalButton(label, requires, action) {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
    button.addEventListener('click', () => task(action));
    rehearsalActions.push({ button, requires }); rehearsalPanel.append(button);
  }
  rehearsalButton('Inspect rehearsal evidence', null, async () => {
    const context = rehearsalContext();
    const packet = await createEvidencePacket(context.projection, context.audience, context.metadata, context.state.hypothesis);
    context.state.packet = packet;
    status(context.audience.toUpperCase() + ' packet ready for inspection. Nothing saved or applied.');
  });
  rehearsalPanel.append(rehearsalPacket);
  async function copyRehearsal(text) {
    try {
      if (!navigator.clipboard?.writeText) throw Error('Clipboard unavailable');
      await navigator.clipboard.writeText(text);
    } catch { throw Error('Could not copy rehearsal content. Allow clipboard access and try again.'); }
  }
  rehearsalButton('Copy inspected evidence packet', 'packet', async () => {
    const context = rehearsalContext(); await freshRehearsalPacket(context);
    await copyRehearsal(JSON.stringify(context.state.packet, null, 2));
    status(context.audience.toUpperCase() + ' evidence packet copied.');
  });
  rehearsalPanel.append(proposalLabel, rehearsalProposal);
  rehearsalButton('Validate rehearsal proposal', 'packet', async () => {
    const context = rehearsalContext(); const current = await freshRehearsalPacket(context);
    let proposal;
    try { proposal = JSON.parse(rehearsalProposal.value); } catch { throw Error('Proposal is not valid JSON; previous rehearsal result retained.'); }
    const result = await validateProposal(context.state.packet, proposal, current);
    context.state.result = result;
    status('Structure and sources validated. Human semantic approval is still required. Nothing saved or applied.');
  });
  rehearsalPanel.append(rehearsalResult);
  rehearsalButton('Copy rehearsal result', 'result', async () => {
    const context = rehearsalContext(); await freshRehearsalPacket(context);
    await copyRehearsal(JSON.stringify(context.state.result, null, 2));
    status(context.audience.toUpperCase() + ' hypothetical rehearsal result copied.');
  });
  rehearsalButton('Use as next hypothetical rehearsal baseline', 'result', async () => {
    const context = rehearsalContext(); await freshRehearsalPacket(context);
    const hypothesis = useHypotheticalBaseline(context.state.packet, context.state.result);
    const packet = await createEvidencePacket(context.projection, context.audience, context.metadata, hypothesis);
    context.state.hypothesis = hypothesis; context.state.packet = packet; context.state.result = null;
    status('Next baseline is hypothetical and session-local. Actual Theater memory remains unchanged.');
  });
  rehearsalAudience.addEventListener('change', () => { rehearsalProposal.value = ''; paintRehearsal(); });
  document.querySelector('#theater-room .theater-backstage').append(rehearsalPanel);
  const characterSession = createCharacterRehearsal();
  let characterSelections = [], characterSources = [];
  const characterPanel = document.createElement('details');
  const characterTitle = document.createElement('summary'); characterTitle.textContent = 'Rias · supervised reply rehearsal';
  const characterNotice = document.createElement('p');
  characterNotice.textContent = 'Proposed replies are session-local, unsaved and noncanonical. Nothing is sent automatically or accepted into the story. Approve only what Rias can know, then use a fresh external model conversation for each independent test.';
  characterPanel.append(characterTitle, characterNotice);
  const sourceLabel = document.createElement('label'); sourceLabel.textContent = 'Active GAME evidence'; sourceLabel.htmlFor = 'theater-character-source';
  const characterSource = document.createElement('select'); characterSource.id = 'theater-character-source';
  const characterSourceText = document.createElement('pre');
  const excerptLabel = document.createElement('label'); excerptLabel.textContent = 'Exact excerpt Rias may perceive or know'; excerptLabel.htmlFor = 'theater-character-excerpt';
  const characterExcerpt = document.createElement('textarea'); characterExcerpt.id = 'theater-character-excerpt'; characterExcerpt.maxLength = 2000; characterExcerpt.rows = 2;
  const characterSelected = document.createElement('pre');
  const characterPacket = document.createElement('pre');
  const replyLabel = document.createElement('label'); replyLabel.textContent = 'Paste proposed Rias reply JSON'; replyLabel.htmlFor = 'theater-character-reply';
  const characterReply = document.createElement('textarea'); characterReply.id = 'theater-character-reply'; characterReply.maxLength = 12000; characterReply.rows = 3;
  const characterProposal = document.createElement('pre');
  const characterActions = [];
  function paintCharacters() {
    if (play) {
      const projection = portfolioView(play, 'game');
      const changed = characterSession.update(projection, { playSchema: play.schema, verifiedRevision: revision,
        unsavedChanges: dirty, pendingRestore: pending?.kind === 'restore' });
      if (changed) {
        characterSelections = []; characterSources = projection.events;
        const previous = characterSource.value;
        characterSource.replaceChildren();
        for (const [index, event] of characterSources.entries()) {
          const option = document.createElement('option'); option.value = event.id;
          option.textContent = 'Event ' + (index + 1) + ' · ' + event.text.slice(0, 70);
          characterSource.append(option);
        }
        characterSource.value = characterSources.some(event => event.id === previous) ? previous : characterSources[0]?.id ?? '';
      }
    } else { characterSession.reset(); characterSelections = []; characterSources = []; }
    const view = characterSession.view();
    characterSourceText.textContent = characterSources.find(event => event.id === characterSource.value)?.text ?? 'No active GAME evidence available. Fail closed until suitable evidence exists.';
    characterSelected.textContent = (view.approved ? 'APPROVED for Rias in this current GAME state' : 'Not approved for Rias') + '\n' +
      (characterSelections.length ? characterSelections.map((item, index) => 'visible-' + (index + 1) + ': ' + item.excerpt).join('\n') : 'Select exact excerpts, then explicitly approve them.');
    characterPacket.textContent = view.packet ? JSON.stringify(view.packet, null, 2) : 'No packet prepared. Inspect the packet here before explicitly copying it.';
    characterProposal.textContent = view.proposal ? view.proposal.status + '\n\nRias — proposed reply\n' + view.proposal.dialogue : 'No proposed Rias reply. This panel cannot add dialogue to canon.';
    characterSource.disabled = characterExcerpt.disabled = busy || !play || !characterSources.length;
    characterReply.disabled = busy || !view.packet;
    for (const { button, requires } of characterActions)
      button.disabled = busy || !play || (requires === 'selected' && !characterSelections.length) ||
        (requires === 'approved' && !view.approved) || (requires === 'packet' && !view.packet);
  }
  function characterButton(label, requires, action) {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
    button.addEventListener('click', () => task(action)); characterActions.push({ button, requires }); characterPanel.append(button);
  }
  characterPanel.append(sourceLabel, characterSource, characterSourceText, excerptLabel, characterExcerpt);
  characterButton('Select visible excerpt', null, async () => {
    const selected = characterSession.checkExcerpts([...characterSelections, { sourceId: characterSource.value, excerpt: characterExcerpt.value }]);
    characterSession.clearApproval(); characterSelections = selected; characterExcerpt.value = '';
    status('Excerpt selected locally. Explicit approval for Rias is still required.');
  });
  characterPanel.append(characterSelected);
  characterButton('Approve selected excerpts for Rias', 'selected', async () => {
    characterSession.approve(characterSelections);
    status('Visible excerpts approved for Rias. Prepare a packet to inspect before copying.');
  });
  characterButton('Clear character excerpts', null, async () => {
    characterSession.clearApproval(); characterSelections = [];
    status('Character approvals, packet and proposal cleared.');
  });
  characterButton('Prepare Rias packet', 'approved', async () => {
    await characterSession.prepare(); characterReply.value = '';
    status('Rias packet prepared for inspection. Nothing transmitted.');
  });
  characterPanel.append(characterPacket);
  characterButton('Copy inspected Rias packet', 'packet', async () => {
    const packet = characterSession.view().packet;
    if (!packet) throw Error('No current Rias packet.');
    try {
      if (!navigator.clipboard?.writeText) throw Error('Clipboard unavailable');
      await navigator.clipboard.writeText(JSON.stringify(packet, null, 2));
    } catch { throw Error('Could not copy Rias packet. Allow clipboard access and try again.'); }
    status('Rias packet copied. Use a fresh external model conversation.');
  });
  characterPanel.append(replyLabel, characterReply);
  characterButton('Show proposed Rias reply', 'packet', async () => {
    let reply;
    try { reply = JSON.parse(characterReply.value); } catch { throw Error('Rias reply must be valid JSON matching the current packet.'); }
    characterSession.validateReply(reply);
    status('Rias reply is proposed, session-local, unsaved and noncanonical. Review for unsupported knowledge.');
  });
  characterPanel.append(characterProposal);
  characterButton('Regenerate Rias attempt', 'packet', async () => {
    await characterSession.prepare(); characterReply.value = '';
    status('Fresh Rias attempt prepared. Previous attempt invalidated; no dialogue entered GAME.');
  });
  characterButton('Discard Rias attempt', 'packet', async () => {
    characterSession.discard(); characterReply.value = '';
    status('Rias attempt and proposal discarded. Play memory unchanged.');
  });
  characterSource.addEventListener('change', paintCharacters);
  document.querySelector('#theater-room .theater-backstage').append(characterPanel);
  for (const item of plays) {
    const option = document.createElement('option');
    option.value = item.id; option.textContent = item.title; el('theater-play').append(option);
  }
  function render() {
    paintRehearsal();
    paintCharacters();
    for (const button of reportButtons) button.disabled = busy || !play;
    const checkpoints = play?.checkpoints ?? [];
    for (const [id, offset] of [['theater-restore-last', 1], ['theater-restore-previous', 2]]) {
      el(id).hidden = checkpoints.length < offset;
      el(id).disabled = busy || Boolean(pending);
    }
    el('theater-player-action').disabled = busy || el('theater-scope').value !== 'game' || Boolean(pending);
    el('theater-save').textContent = pending?.kind === 'restore' ? 'Retry restore' : 'Save play';
    const gameAudience = el('theater-scope').value === 'game';
    const recipient = el('theater-recipient-portrait');
    recipient.replaceChildren();
    const fallback = document.createElement('span');
    fallback.textContent = gameAudience ? 'Stage' : 'A';
    recipient.append(fallback);
    if (!gameAudience) {
      const image = document.createElement('img');
      image.src = new URL('../portraits/neutral1.png', import.meta.url).href;
      image.alt = 'Aida, backstage recipient';
      image.addEventListener('load', () => { fallback.hidden = true; });
      image.addEventListener('error', () => { image.hidden = true; fallback.hidden = false; });
      recipient.append(image);
    }
    el('theater-recipient-label').textContent = gameAudience ? 'Recipient: Stage / ensemble · GAME / Onstage' : 'Recipient: Aida · META / Backstage';
    el('theater-add').textContent = el('theater-scope').value === 'game' ? 'Send to GAME' : 'Send to META';
    el('theater-unsaved').hidden = !dirty;
    const timeline = el('theater-timeline');
    const following = timeline.scrollHeight - timeline.scrollTop - timeline.clientHeight < 40;
    timeline.replaceChildren();
    for (const event of play ? portfolioView(play, 'meta').events : []) {
      const item = document.createElement('article');
      item.dataset.audience = event.scope;
      const label = document.createElement('strong');
      label.textContent = 'Francisco · submitted by user · ' + (event.scope === 'game' ? 'GAME / Onstage · ' + event.branchStatus : 'META / Backstage');
      const text = document.createElement('p');
      text.textContent = event.text;
      const portrait = document.createElement('span');
      portrait.className = 'theater-portrait';
      portrait.textContent = 'F';
      portrait.setAttribute('aria-label', 'Francisco');
      const message = document.createElement('div');
      message.append(label, text);
      item.append(portrait, message);
      timeline.append(item);
    }
    if (following) timeline.scrollTop = timeline.scrollHeight;
    el('theater-data').textContent = play ? JSON.stringify(portfolioView(play, el('theater-portfolio').value), null, 2) : '';
    for (const name of ['theater-save', 'theater-add', 'theater-entry-add']) el(name).disabled = busy || !play || Boolean(pending);
    el('theater-save').disabled = busy || !play;
    el('theater-play').disabled = busy || Boolean(pending) || dirty;
    el('theater-recover').disabled = busy || !entry?.playId || dirty;
  }
  async function task(action) {
    if (busy) return;
    busy = true; render();
    try { await action(); } catch (error) { status(error.message); }
    finally { busy = false; render(); }
  }
  button.addEventListener('click', () => task(async () => {
    entry = await registry.dispatch({ id: 'rpg', version: 1, input: {
      schema: 'theater-entry@1', operation: 'open', playId: play?.playId ?? null, resumeRef: null
    } }, {}, 'manual');
    visitId = crypto.randomUUID();
    status('Choose the demonstration play. META is Aida’s play-scoped working context.');
    el('theater-room').dispatchEvent(new CustomEvent('theater-enter'));
  }));
  async function recover() {
    const saved = await storage.loadPlay(entry.playId);
    if (!saved && revision > 0) throw Error('Expected Theater snapshots are missing; retained state was not reset.');
    const next = upgradePlay(saved?.snapshot ?? emptyPlay(entry.playId));
    play = next; revision = saved?.revision ?? 0;
    resumeRef = saved ? `theater:${entry.playId}:${revision}` : null;
    pending = undefined;
    status(saved ? `Recovered verified Theater revision ${revision}.` : 'No saved play found. Empty portfolios are ready; Save creates the first snapshot.');
  }
  el('theater-play').addEventListener('change', () => task(async () => {
    const requested = await registry.dispatch({ id: 'rpg', version: 1, input: {
      schema: 'theater-entry@1', operation: 'open', playId: el('theater-play').value || null, resumeRef: null
    } }, {}, 'manual');
    entry = requested;
    if (entry.playId) await recover();
    else { play = undefined; resumeRef = null; status('Choose a play.'); }
  }));
  el('theater-recover').addEventListener('click', () => task(async () => {
    if (play && !confirm('Recover saved Theater state and discard unsaved local edits?')) return;
    await recover();
  }));
  el('theater-add').addEventListener('click', () => task(async () => {
    const beginsTurn = el('theater-scope').value === 'game' && el('theater-player-action').checked;
    const current = upgradePlay(play);
    play = beginsTurn ? playerAction(current, el('theater-text').value) :
      appendEvent(current, el('theater-scope').value, el('theater-text').value);
    if (beginsTurn) el('theater-player-action').checked = false;
    dirty = true;
    el('theater-text').value = ''; status('Source event added locally. Save explicitly to retain it.');
  }));
  el('theater-entry-add').addEventListener('click', () => task(async () => {
    play = setEntry(play, el('theater-portfolio').value, el('theater-layer').value,
      el('theater-entry-text').value, el('theater-sources').value.split(',').map(x => x.trim()).filter(Boolean));
    dirty = true;
    el('theater-entry-text').value = ''; status('Portfolio entry added locally with source references.');
  }));
  el('theater-portfolio').addEventListener('change', render);
  el('theater-scope').addEventListener('change', render);
  el('theater-save').addEventListener('click', () => task(async () => {
    pending ??= { operationId: crypto.randomUUID(), snapshot: structuredClone(play), revision };
    const saved = pending.kind === 'restore' ? await commitRestore(storage, entry.playId, pending) :
      await storage.savePlay(entry.playId, pending.revision, pending.snapshot, pending.operationId);
    play = saved.snapshot; revision = saved.revision; resumeRef = `theater:${entry.playId}:${revision}`;
    dirty = false;
    pending = undefined; status(`Saved and verified Theater revision ${revision}.`);
  }));
  async function restore(offset) {
    if (pending) throw Error('Retry or recover the pending operation first.');
    const checkpoint = play?.checkpoints?.at(-offset);
    if (!checkpoint) throw Error('Restore point unavailable.');
    if (!confirm('Restore before this action and save the selected story branch to Drive?')) return;
    pending = proposeRestore(play, checkpoint.id, revision);
    const saved = await commitRestore(storage, entry.playId, pending);
    play = saved.snapshot; revision = saved.revision;
    resumeRef = 'theater:' + entry.playId + ':' + revision;
    pending = undefined; dirty = false;
    status('Restored and verified Theater revision ' + revision + '.');
  }
  el('theater-restore-last').addEventListener('click', () => task(() => restore(1)));
  el('theater-restore-previous').addEventListener('click', () => task(() => restore(2)));
  function receipt() {
    if (busy) return;
    const receipt = entry?.playId ? finishVisit(entry, visitId, resumeRef) : null;
    el('theater-receipt').textContent = receipt ? JSON.stringify(receipt, null, 2) : 'No play selected.';
  }
  el('theater-room').addEventListener('theater-leave', receipt);
  el('theater-return').addEventListener('click', () => {
    if (!busy) el('theater-room').dispatchEvent(new CustomEvent('theater-exit'));
  });
  render();
}
