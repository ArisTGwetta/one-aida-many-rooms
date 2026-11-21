import { createCharacterRehearsal } from './characters.mjs';
import { createEvidencePacket, validateProposal, useHypotheticalBaseline } from './rehearsal.mjs';
import { buildMemoryReport } from './reports.mjs';
import { playerAction, proposeRestore, commitRestore } from './restore.mjs';
import { plays, finishVisit } from './contracts.mjs';
import { emptyPlay, appendEvent, setEntry, portfolioView, upgradePlay, eventAttribution } from './continuity.mjs';
import { beginTurn, createTurnRunner } from './turns.mjs';
import { createRoleRouter, defaultTurnPolicy, validateTurnPolicy } from './providers.mjs';
import { spendingView } from './ledger.mjs';
export function setupTheater({ registry, storage, provider }) {
  const el = id => document.getElementById(id);
  const button = el('theater-open');
  if (button.dataset.ready) return;
  button.dataset.ready = 'true';
  button.disabled = false;
  let entry, play, revision = 0, visitId, resumeRef = null, pending, busy = false, dirty = false;
  let automatic = false, policy = defaultTurnPolicy(), sessionId = crypto.randomUUID();
  const sessionDay = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  let sessionDate = sessionDay();
  let runner, router, generating = false, draftScope = el('theater-scope').value || 'meta';
  const drafts = { meta: '', game: '' };
  const status = text => { el('theater-status').textContent = text; };
  el('theater-policy').value = JSON.stringify(policy, null, 2);
  const hasPendingTurn = () => runner?.current()?.status === 'pending';
  function currentSession() {
    if (sessionDate !== sessionDay()) { sessionDate = sessionDay(); sessionId = crypto.randomUUID(); router?.beginSession(sessionId); }
    return sessionId;
  }
  function ensureRunner() {
    if (!provider || !['loadWork', 'saveWork', 'loadLedger', 'appendLedger'].every(method => typeof storage[method] === 'function'))
      throw Error('The supervised provider/storage bridge is unavailable. Manual mode remains available.');
    if (!runner) {
      router = createRoleRouter({ transport: provider.call, inventory: provider.inventory, available: provider.available, operations: storage });
      runner = createTurnRunner({ storage, router, onState: paintTurn });
    }
  }
  function paintTurn() {
    const work = runner?.current();
    el('theater-stop').hidden = !generating;
    el('theater-pending').hidden = work?.status !== 'pending';
    el('theater-pending-data').textContent = work?.status === 'pending' ? JSON.stringify({
      turnId: work.turnId, completed: work.completed, attempts: work.attempts.length,
      contributions: work.staged.events.filter(event => event.turnId === work.turnId).map(event => ({ speaker: eventAttribution(event).speaker, text: event.text }))
    }, null, 2) : '';
    if (work?.status === 'pending') document.querySelector('#theater-room .theater-backstage').open = true;
    for (const name of ['theater-resume-turn', 'theater-retry-uncertain', 'theater-partial-turn', 'theater-discard-turn'])
      el(name).disabled = busy || !hasPendingTurn();
    el('theater-retell').disabled = busy || !automatic || dirty || hasPendingTurn() || !play?.checkpoints?.length || el('theater-scope').value !== 'game';
    for (const name of ['theater-auto', 'theater-policy-apply', 'theater-unlock', 'theater-inventory', 'theater-reset-routes', 'theater-new-session'])
      el(name).disabled = busy;
    el('theater-input-kind').disabled = busy || !automatic;
  }
  function useSavedTurn(saved) {
    play = saved.snapshot; revision = saved.revision; resumeRef = `theater:${play.playId}:${revision}`; dirty = false;
    const work = runner.current(), submitted = work?.staged.events.find(event => event.turnId === work.turnId && !event.speaker)?.text;
    if (el('theater-text').value.trim() === submitted) el('theater-text').value = '';
    drafts[draftScope] = el('theater-text').value;
    status('Turn saved and verified at revision ' + revision + '.');
  }
  async function runTurn(retryUncertain = false) {
    generating = true; status('Generating the supervised turn. The previous verified scene remains intact until save/readback.'); paintTurn();
    try { useSavedTurn(await runner.run(policy, { retryUncertain, sessionId: currentSession() })); }
    finally { generating = false; paintTurn(); }
  }
  async function sendTurn(retell = false) {
    ensureRunner();
    if (dirty || pending) throw Error('Save or resolve existing local work before a supervised turn.');
    if (hasPendingTurn()) throw Error('Resume or discard the existing pending turn.');
    if (retell && !confirm('Generate a replacement for the last action? The verified scene remains intact until the replacement is saved.')) return;
    const work = beginTurn(play, revision, el('theater-scope').value, el('theater-text').value, currentSession(), el('theater-input-kind').value || 'speech', retell);
    await runner.start(work); await runTurn();
  }
  el('theater-auto').addEventListener('change', () => task(async () => {
    if (hasPendingTurn() && !el('theater-auto').checked) { el('theater-auto').checked = true; throw Error('Resolve the pending turn before manual mode.'); }
    if (el('theater-auto').checked) {
      try { ensureRunner(); if (play) await runner.recover(play.playId); automatic = true; }
      catch (error) { el('theater-auto').checked = false; throw error; }
    } else automatic = false;
    status(automatic ? 'Supervised turns enabled. Review routes, disclosure and budgets before Send. New GAME Sends are player-action boundaries.' : 'Manual mode. No provider generation.');
  }));
  el('theater-policy-apply').addEventListener('click', () => task(async () => {
    let next; try { next = JSON.parse(el('theater-policy').value); } catch { throw Error('Configuration is not valid JSON.'); }
    policy = structuredClone(validateTurnPolicy(next)); router?.reset();
    status('Separate GAME/META lineups validated. No generation or audition performed.');
  }));
  el('theater-unlock').addEventListener('click', () => task(async () => {
    const code = el('theater-unlock-code').value; el('theater-unlock-code').value = '';
    try { ensureRunner(); await provider.unlock(el('theater-unlock-provider').value || 'openai', code); }
    catch { throw Error('Existing private provider route unavailable. Check Drive authorization, route code and owned credential file. No credential was copied or created.'); }
    router.reset(); status('Existing route unlocked in browser memory only.');
  }));
  el('theater-inventory').addEventListener('click', () => task(async () => {
    ensureRunner(); const results = [], seen = new Set();
    for (const route of [...policy.game, ...policy.meta]) {
      const key = JSON.stringify([route.provider, route.endpoint]); if (seen.has(key)) continue; seen.add(key);
      try { results.push({ provider: route.provider, endpoint: route.endpoint, installedOrAccountModels: await provider.inventory(route) }); }
      catch { results.push({ provider: route.provider, status: 'inventory_unavailable' }); }
    }
    router.reset(); el('theater-inventories').textContent = JSON.stringify(results, null, 2); status('Read-only inventories checked. No model generation.');
  }));
  el('theater-reset-routes').addEventListener('click', () => { if (!busy) { router?.reset(); status('Session provider preferences reset to configured order.'); } });
  el('theater-new-session').addEventListener('click', () => {
    if (busy || hasPendingTurn()) { status('Resolve the pending turn first.'); return; }
    sessionId = crypto.randomUUID(); sessionDate = sessionDay(); router?.beginSession(sessionId); status('New session. Configured preferred providers restored; durable spending history retained.');
  });
  el('theater-stop').addEventListener('click', () => { runner?.stop(); status('Stopping generation. Completed work is retained; remote cancellation cannot be guaranteed.'); });
  el('theater-resume-turn').addEventListener('click', () => task(() => runTurn()));
  el('theater-retry-uncertain').addEventListener('click', () => task(async () => {
    if (confirm('The previous request may have incurred a charge. Explicitly retry only unfinished work within the remaining attempt budget?')) await runTurn(true);
  }));
  el('theater-partial-turn').addEventListener('click', () => task(async () => {
    if (confirm('Accept and save only the validated completed fictional work?')) useSavedTurn(await runner.commit(true));
  }));
  el('theater-discard-turn').addEventListener('click', () => task(async () => { await runner.discard(); status('Pending turn discarded. Previous verified scene retained.'); }));
  el('theater-retell').addEventListener('click', () => task(() => sendTurn(true)));
  el('theater-spending-refresh').addEventListener('click', () => task(async () => {
    if (!play) throw Error('Choose a play first.'); ensureRunner();
    currentSession();
    el('theater-spending').textContent = JSON.stringify({ sessionId, preferences: router.preferences(), ...spendingView(await storage.loadLedger(play.playId), {
      playId: play.playId, sessionId, scope: el('theater-spending-scope').value || 'session', period: el('theater-spending-period').value || 'all-time'
    }) }, null, 2);
    status('Operational ledger displayed only here, never supplied to narrative roles. Global Aida accounting remains separate.');
  }));
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
  characterNotice.textContent = 'Proposed replies are session-local, unsaved and noncanonical. Nothing is sent or accepted automatically. Explicit acceptance changes only local GAME; Save play is required for durable persistence. Approve only what Rias can know, then use a fresh external model conversation for each independent test.';
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
    characterProposal.textContent = view.proposal ? view.proposal.status + '\n\nRias — proposed reply\n' + view.proposal.dialogue : 'No proposed Rias reply. Only explicit acceptance can add dialogue to local GAME.';
    characterSource.disabled = characterExcerpt.disabled = busy || !play || !characterSources.length;
    characterReply.disabled = busy || !view.packet;
    for (const { button, requires } of characterActions)
      button.disabled = busy || !play || Boolean(pending) || (requires === 'proposal' && !view.proposal) || (requires === 'selected' && !characterSelections.length) ||
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
  characterButton('Accept Rias reply into GAME', 'proposal', async () => {
    const next = await characterSession.accept(play, { playSchema: play.schema, verifiedRevision: revision,
      unsavedChanges: dirty, pendingRestore: pending?.kind === 'restore' });
    play = next; dirty = true;
    characterReply.value = '';
    status('Rias reply accepted locally — unsaved. Use Save play for verified durable persistence.');
  });
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
    for (const event of play ? portfolioView(play, 'meta').events.filter(event => !automatic || !gameAudience || event.scope === 'game' && event.branchStatus === 'accepted') : []) {
      const item = document.createElement('article');
      item.dataset.audience = event.scope;
      const label = document.createElement('strong');
      const attribution = eventAttribution(event);
      label.textContent = (event.speaker ? attribution.speaker + ' · ' + attribution.origin + ' · accepted by ' + attribution.acceptedBy + ' · ' : 'Francisco · submitted by user · ') + (event.scope === 'game' ? 'GAME / Onstage · ' + event.branchStatus : 'META / Backstage');
      const text = document.createElement('p');
      text.textContent = event.text;
      const portrait = document.createElement('span');
      portrait.className = 'theater-portrait';
      portrait.textContent = event.speaker ? attribution.speaker === 'Rias' ? 'R' : 'A' : 'F';
      portrait.setAttribute('aria-label', attribution.speaker);
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
    if (hasPendingTurn()) {
      for (const name of ['theater-add', 'theater-save', 'theater-entry-add', 'theater-play', 'theater-restore-last', 'theater-restore-previous']) el(name).disabled = true;
      for (const { button } of characterActions) button.disabled = true;
    }
    el('theater-scope').disabled = busy || hasPendingTurn();
    paintTurn();
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
    if (provider && typeof storage.loadWork === 'function') { ensureRunner(); await runner.recover(entry.playId); }
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
    if (automatic) { await sendTurn(); return; }
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
  el('theater-scope').addEventListener('change', () => {
    drafts[draftScope] = el('theater-text').value;
    draftScope = el('theater-scope').value;
    el('theater-text').value = drafts[draftScope] ?? ''; render();
  });
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
