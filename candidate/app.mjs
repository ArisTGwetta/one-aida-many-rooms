import { createSnailDriveReader, snailMiniBinding } from "./snail-mini.mjs";
import { setupUncleChatt, uncleChattBinding } from "./uncle-chatt.mjs";
import { setupGlasses } from "./glasses.mjs";
import { rememberSearchBinding, setupMindPalace } from "./mind-palace.mjs";
import { projectSkills } from "./project-skills.mjs";
import { authorize, createMemoryStore, validateConfig } from "./memory.mjs";
import { createConversationSession, ConversationTransportError, ConversationValidationError } from "./conversation.mjs";
import { availableSupport, createJournal, dispositionFor, makeJournalEvent, visualReceipt } from "./recent-journal.mjs";
import { setupSleepPanel } from "./sleep-panel.mjs";
import { createSleepStore } from "./sleep.mjs";
import { createAwakeSteward, createContextSource, journalReceipt } from "./awake-context.mjs";
import { checkpointEligible } from './memory-bridge.mjs';

const byId = id => document.getElementById(id);
const connect = byId("connect");
const remember = byId("remember");
const recall = byId("recall");
const status = byId("status");
const evidence = byId("evidence");
let token;
let store;
let session;
let browserKey;
let running = false;
let driveReady = false;
let refreshWelcome = () => {};
let canSend = () => Boolean(session);
let refreshJournalControls = () => {};
const send = byId("send");
const localDevelopment = location.origin === "http://127.0.0.1:8787";
window.addEventListener('beforeunload',event=>{
  const state=session?.memoryStatus;
  if(state&&(state.review.unreviewedSources||state.mode==='temporary'&&state.meaningfulChanges||state.review.pendingCommit)){event.preventDefault();event.returnValue='';}
});

function show(result) {
  byId("file-id").textContent = result.fileId;
  byId("saved-at").textContent = result.record.updated_at;
  byId("record").textContent = JSON.stringify(result.record, null, 2);
  evidence.hidden = false;
}

async function run(label, action, target = status) {
  if (running) return;
  running = true;
  if (target === status) evidence.hidden = true;
  connect.disabled = remember.disabled = recall.disabled = send.disabled = true;
  refreshJournalControls();
  target.textContent = label;
  refreshWelcome();
  try {
    target.textContent = await action();
  } catch (error) {
    if (error.status === 401) {
      token = undefined;
      driveReady = false;
      browserKey = undefined;
    }
    target.textContent = error.message;
    if(error.diagnostic==='mind_checkout_conflict'){
      byId('living-mind-controls').open=true;
      byId('mind-status').textContent=error.message+' Inspect reads the latest committed state without writing. Resume keeps durable state; Take over is explicit.';
      document.dispatchEvent(new CustomEvent('aida-mind-attention'));
    }
    if (target.id === "chat-status" && (error.projectRead || error.providerCalls?.length)) {
      byId("conversation-evidence").textContent = JSON.stringify({ callPhase: error.callPhase ?? null, projectRead: error.projectRead ?? null,
        diagnostic: error.diagnostic ?? null, diagnosticDetails: error.diagnosticDetails, promptBudget:error.promptBudget, skillFailure: error.skillFailure, providerCalls: error.providerCalls }, null, 2);
      byId("conversation-details").hidden = false;
      byId("conversation-evidence-label").textContent = "Development evidence — turn failed";
    } else if (target.id === "chat-status" && !byId("conversation-details").hidden) {
      byId("conversation-evidence-label").textContent = "Development evidence — last successful turn";
    }
  } finally {
    running = false;
    connect.disabled = false;
    remember.disabled = recall.disabled = !token;
    send.disabled = !token || !canSend();
    refreshJournalControls();
    refreshWelcome();
  }
}

async function setupChat(folderId) {
  const journal = createJournal(folderId, () => token);
  const sleepStore = createSleepStore(folderId, () => token);
  const contextSource = createContextSource(folderId, () => token);
  const livingSessionId=crypto.randomUUID();
  let conversationMode='temporary';
  let conversationEpoch=0;
  const archivePending=new Map();
  let mindEvidence={};
  function refreshMindInspector(){
    const state=session?.memoryStatus;if(!state)return;
    byId('mind-inspector-status').textContent=`${state.scopeId} · ${state.mode} · committed revision ${state.committedRevision}; working meaning revision ${state.current?.meaningRevision??0} · ${state.review.last?.status??'not evaluated'} · ${state.review.unreviewedSources} unreviewed source(s)`;
    byId('mind-inspector-state').textContent=JSON.stringify({activeScope:state.scopeId,mode:state.mode,stateKind:state.mode==='temporary'?'temporary working understanding; not saved':'durable working understanding; see verified commit',committedVersion:state.committedRevision,workingMeaningRevision:state.current?.meaningRevision,long:state.current?.long,short:state.current?.short,orientation:state.current?.orientation,pendingMemory:state.review.pendingWork,pendingMemoryScopes:state.review.pendingScopes,recentPlus:state.recentPlus,recentPlusSourceReferences:state.recentPlusSourceReferences,lastMemoryEvaluation:state.review.last,provisionalObservations:state.review.observations,persistence:state.persistence,lastVerifiedCommit:mindEvidence.committed??mindEvidence.review_checkpoint?.committed??mindEvidence.session_ended?.verified??mindEvidence.handoff?.verified??null,diagnostics:state.diagnostics,pendingSources:state.review.pendingSources},null,2);
  }
  function mindTrace(phase,value){if(phase==='checked_out')mindEvidence={};mindEvidence[phase]=value;byId('mind-trace').textContent=JSON.stringify({phase,...mindEvidence},null,2);refreshMindInspector();}
  function mindContext(context){
    const select=byId('mind-scope');select.replaceChildren();
    for(const item of [{id:'',name:'Everyday Aida'},...context.projects]){const option=document.createElement('option');option.value=item.id;option.textContent=item.name;select.append(option);}
    select.value=context.currentProjectId??'';
    byId('mind-status').textContent=`${context.currentState.scopeId}: ${context.inspectionOnly?'read-only inspection; working state unchanged':conversationMode==='temporary'?'read-only recovery; session-local working state':'durable mode; ownership verified separately'}; committed revision ${context.currentState.revision}, meaning revision ${context.currentState.meaningRevision}.`;
    mindTrace('checked_out',{current:context.currentState,global:context.globalState,mode:conversationMode});
    return 'Current state loaded from Drive.';
  }
  const projectPanel = byId("project-preview");
  const projectData = byId("project-preview-data");
  const projectStatus = byId("project-save-status");
  let projectPreview;
  let steward;
  const glasses = setupGlasses({ contextSource, activeProjectId: () => steward?.activeProjectId ?? null,
    authorized: () => Boolean(token), run });
  const skills = projectSkills(contextSource, [rememberSearchBinding(store, () => Boolean(token)),
    uncleChattBinding(() => Boolean(token)), rpgBinding(),
    snailMiniBinding({ getCatalog: createSnailDriveReader(folderId, () => token),
      authorized: () => Boolean(token), cacheKey: () => token })]);
  // Restricted Theater bridge: scoped structured packets, credential unlock and model
  // inventories only. No everyday context, session, memory store or raw credentials.
  const theaterKeys = new Map(); let theaterAuthorization;
  function theaterKey(provider) {
    if (theaterAuthorization !== token) { theaterKeys.clear(); theaterAuthorization = token; }
    return token ? provider === 'openai' ? browserKey ?? theaterKeys.get(provider) : theaterKeys.get(provider) : undefined;
  }
  setupTheater({ registry: skills, storage: createTheaterStorage(folderId, () => token), provider: {
    available: route => route.provider === 'ollama' || Boolean(theaterKey(route.provider)),
    async unlock(provider, routeCode) {
      const credentials = await import('./browser-credentials.mjs');
      theaterKey(provider);
      const authorizedToken = token;
      const key = await credentials.loadProviderKey({ folderId, provider, routeCode, token: authorizedToken });
      if (!token || authorizedToken !== token) throw Error('Authorization changed; unlock again.');
      theaterKeys.set(provider, key);
    },
    async inventory(route) {
      const providers = await import('./providers.mjs');
      return route.provider === 'ollama' ? providers.listLocalModels(route.endpoint) : providers.listHostedModels(route.provider, theaterKey(route.provider));
    },
    async call(request) {
      const providers = await import('./providers.mjs');
      return providers.createStructuredTransport({ keyFor: theaterKey })(request);
    }
  } });
  const chatt = setupUncleChatt({ registry: skills, contextSource, run, recent: () => session?.recentForHandoff() ?? [] });
  const palace = setupMindPalace({ token: () => token, run, contextSource, registry: skills, async suggest(workspace) {
    providerCalls = [];
    showBudget();
    selection = await prepareSelection();
    return session.suggestLibrarySearch(workspace);
  } });
  function clearProjectPreview() {
    steward?.cancelPreview(projectPreview);
    projectPreview = undefined;
    projectData.textContent = projectStatus.textContent = "";
    projectPanel.hidden = true;
  }
  byId("project-cancel").addEventListener("click", clearProjectPreview);
  byId("project-confirm").addEventListener("click", () => {
    if (!projectPreview || !token) return;
    run("Executing confirmed capability…", async () => {
      const saved = await steward.confirm(projectPreview);
      projectPreview = undefined;
      projectData.textContent = JSON.stringify(saved, null, 2);
      return "Capability completed and verified.";
    }, projectStatus);
  });
  const contextStatus = byId("context-status");
  const contextEvidence = byId("context-evidence");
  function showContextRecords(result) {
    contextEvidence.textContent = JSON.stringify(result.records, null, 2);
    contextEvidence.hidden = false;
    return result.initialized ? "Context records verified in Drive." : "First-time context initialization is available.";
  }
  byId("context-check").addEventListener("click", () => run("Checking context records…", async () =>
    showContextRecords(await contextSource.load()), contextStatus));
  byId("context-init").addEventListener("click", () => run("Initializing context records…", async () =>
    showContextRecords(await contextSource.initialize()), contextStatus));
  byId("context-project-init").addEventListener("click", () => run("Initializing project continuity…", async () => {
    const result = await contextSource.initializeProject(byId("context-project-id").value.trim());
    contextEvidence.textContent = result.reference;
    contextEvidence.hidden = false;
    return "Project continuity verified in Drive.";
  }, contextStatus));
  let dev;
  let direct;
  let loadOpenAIKey;
  if (localDevelopment) {
    const configuration = await fetch("./dev-config", { cache: "no-store" });
    if (!configuration.ok) throw new Error("The local chat server is unavailable.");
    dev = await configuration.json();
  } else {
    const [providers, credentials] = await Promise.all([
      import("./providers.mjs"), import("./browser-credentials.mjs")
    ]);
    direct = providers;
    loadOpenAIKey = credentials.loadOpenAIKey;
  }
  const select = byId("provider");
  const model = byId("model");
  const endpoint = byId("ollama-endpoint");
  const routeCode = byId("route-code");
  const message = byId("message");
  const transcript = byId("transcript");
  const details = byId("conversation-details");
  const chatStatus = byId("chat-status");
  const journalStatus = byId("journal-status");
  const conversationField = byId("conversation-id");
  const retention = byId("retention");
  const support = byId("journal-support");
  const records = byId("journal-records");
  const retry = byId("journal-retry");
  const older = byId("journal-older");
  let conversationId;
  let preceding;
  let pending;
  let nextPage;
  let disposition = "ephemeral";
  let sources = [];
  canSend = () => Boolean(session && !pending);
  refreshJournalControls = () => {
    palace.refresh(running, Boolean(session));
    glasses.refresh(running);
    chatt.refresh(running, Boolean(token && session));
    byId("project-confirm").disabled = running || !token || !projectPreview;
    byId("project-cancel").disabled = running;
    byId("context-controls").disabled = running || !token;
    for(const id of ['mind-scope','mind-check','mind-resume','mind-takeover','mind-handoff','mind-sleep','mind-review','mode-temporary','mode-durable'])byId(id).disabled=running||!token||!session||(Boolean(pending)&&!['mind-handoff','mind-sleep'].includes(id));
    refreshMindInspector();
    byId('mind-discard').disabled=running||!session||!(pending||session.memoryStatus.review.pendingCommit);
    byId("sleep-controls").disabled = running || !token;
    for (const id of ["journal-resume", "journal-new", "journal-inspect", "journal-older"]) {
      byId(id).disabled = running || !token || Boolean(pending);
    }
    retry.hidden = !pending;
    retry.disabled = running || !token;
  };
  const preferenceKey = "aida.development.provider";
  let ollamaModel = dev?.ollamaModel ?? "";
  try {
    const preference = JSON.parse(localStorage.getItem(preferenceKey));
    if (preference?.provider === "ollama") select.value = "ollama";
    if (typeof preference?.ollamaModel === "string") ollamaModel = preference.ollamaModel.slice(0, 100);
  } catch {
    // The session still works when browser preference storage is unavailable.
  }
  function savePreference() {
    try {
      localStorage.setItem(preferenceKey, JSON.stringify({ provider: select.value, ollamaModel }));
    } catch {
      // Provider preference is optional.
    }
  }
  function showSelection() {
    const ollama = select.value === "ollama";
    model.value = ollama ? ollamaModel : (dev?.openAIModel ?? direct.openAIModel);
    model.readOnly = !ollama;
    byId("ollama-endpoint-field").hidden = !ollama || localDevelopment;
    endpoint.required = ollama && !localDevelopment;
    endpoint.disabled = !endpoint.required;
    byId("route-code-field").hidden = ollama || localDevelopment || Boolean(browserKey);
    routeCode.required = !byId("route-code-field").hidden;
    routeCode.disabled = !routeCode.required;
    refreshWelcome();
    byId("provider-status").textContent = ollama
      ? (localDevelopment && !dev.ollamaConfigured
        ? "Configure an Ollama endpoint on the development server."
        : "Ollama receives this turn’s message and memory context at the selected endpoint.")
      : "OpenAI receives this turn’s message and the memory context needed to answer.";
  }
  select.addEventListener("change", () => { showSelection(); savePreference(); });
  model.addEventListener("input", () => { ollamaModel = model.value; savePreference(); });
  showSelection();
  byId("chat").hidden = false;
  chatStatus.textContent = "Authorize Google Drive to start chatting.";

  let selection;
  let providerCalls = [];
  let sessionUsd = 0;

  function showBudget() {
    const total = providerCalls.reduce((sum, call) => sum + (call.usage?.estimatedUsd ?? 0), 0);
    const tokens = key => providerCalls.reduce((sum, call) => sum + (call.usage?.[key] ?? 0), 0);
    const incomplete = providerCalls.some(call => !call.usage ||
      (call.provider === "openai" && call.usage.estimatedUsd == null));
    byId("chat-budget").textContent = "Provider calls " + providerCalls.length +
      " · Reported tokens " + tokens("inputTokens") + " in / " + tokens("outputTokens") +
      " out · Estimated cloud cost $" + total.toFixed(7) + " this turn / $" + sessionUsd.toFixed(7) +
      " this page session" + (incomplete ? " · Some usage unavailable" : "");
  }

  async function invokeProvider(input) {
    if (localDevelopment) {
      const response = await fetch("./dev-chat", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input)
      });
      const result = await response.json();
      if (!response.ok) {
        const ErrorType = result.code === "conversation_validation" ? ConversationValidationError : ConversationTransportError;
        throw Object.assign(new ErrorType(result.error ?? "The local server rejected the request."), {
          diagnostic: result.diagnostic, diagnosticDetails:result.diagnosticDetails, promptBudget:result.promptBudget, usage: result.usage
        });
      }
      return result;
    }
    try {
      const invoke = direct.createProviders({
        apiKey: input.provider === "openai" ? browserKey : undefined,
        ollamaEndpoint: input.ollamaEndpoint
      });
      return await invoke(input);
    } catch (error) {
      if (error instanceof direct.ProviderError) {
        if (input.provider === "openai" && error.status === 401) {
          browserKey = undefined;
          showSelection();
        }
        throw Object.assign(new ConversationTransportError(error.message), { usage: error.usage });
      }
      throw error;
    }
  }

  async function unlockProvider(code) {
    browserKey = await loadOpenAIKey(folderId, code, token);
    showSelection();
  }

  refreshWelcome = () => {
    const needsPin = !localDevelopment && select.value === "openai" && !browserKey;
    const entrance = byId("welcome-entrance");
    entrance.dataset.authorization = driveReady && token ? needsPin ? "pin" : "ready" : "drive";
    byId("welcome-drive").disabled = running || connect.disabled;
    byId("welcome-drive").hidden = entrance.dataset.authorization !== "drive";
    byId("welcome-pin").hidden = entrance.dataset.authorization !== "pin";
    byId("welcome-unlock").disabled = running;
  };
  byId("welcome-pin").addEventListener("submit", event => {
    event.preventDefault();
    if (running || !driveReady || !token || byId("welcome-pin").hidden) return;
    const input = byId("welcome-code");
    const code = input.value;
    input.value = "";
    run("Unlocking provider…", async () => {
      await unlockProvider(code);
      return "Provider unlocked.";
    }, byId("welcome-status"));
  });
  refreshWelcome();

  async function prepareSelection() {
    const selected = { provider: select.value, model: model.value.trim() };
    if (localDevelopment) return selected;
    if (selected.provider === "ollama") {
      let url;
      try {
        url = new URL(endpoint.value);
      } catch {
        throw new Error("Enter a valid Ollama endpoint URL.");
      }
      if (url.protocol !== "https:" && !(url.protocol === "http:" &&
          ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) {
        throw new Error("Use a trusted HTTPS Ollama endpoint or an HTTP loopback endpoint.");
      }
      if (url.username || url.password || url.search || url.hash || !["/", "/api/chat"].includes(url.pathname)) {
        throw new Error("Enter the Ollama origin or /api/chat URL without credentials or query parameters.");
      }
      selected.ollamaEndpoint = url.href;
    } else if (!browserKey) {
      const code = routeCode.value;
      routeCode.value = "";
      await unlockProvider(code);
    }
    return selected;
  }

  const clearSleepPanel = setupSleepPanel({
    store: sleepStore, journal, run,
    async beforeRun(){if(!await endConversation())return false;return true;},
    async provider(sleep) { return invokeProvider({ ...await prepareSelection(), sleep }); }
  });
  function showJournalContext() {
    byId("journal-context").textContent = [
      `Conversation ${conversationId}`,
      `Active recent exchanges ${session?.recentTurnCount ?? 0}`,
      `Last disposition ${disposition}`,
      sources.length ? `Sources ${sources.join(", ")}` : ""
    ].filter(Boolean).join("\n");
    byId("support-label").hidden = !availableSupport(preceding, "candidate");
    support.checked = false;
  }

  function appendExchange(turn) {
    for (const [speaker, text] of [["You", turn.user.text], ["Aida", turn.aida.text]]) {
      const line = document.createElement("p");
      const name = document.createElement("span");
      name.textContent = speaker + ": ";
      if (speaker === "You") {
        name.className = "classic-speaker";
        const mobileName = document.createElement("span");
        mobileName.className = "mobile-speaker";
        mobileName.textContent = "Francisco: ";
        line.append(mobileName);
      }
      line.append(name, text);
      line.dataset.speaker = speaker === "Aida" ? "aida" : "francisco";
      transcript.append(line);
    }
  }

  function resetChat({ id, turns, entries,reason='authorized_drive_recovery' }) {
    clearProjectPreview();
    palace.clear();
    glasses.reset();
    chatt.reset();
    conversationId = id;
    conversationField.value = id;
    preceding = undefined;
    disposition = entries[0]?.event.disposition ?? "ephemeral";
    sources = turns.flatMap(turn => [turn.user.source, turn.aida.source]);
    records.hidden = older.hidden = true;
    records.textContent = "";
    nextPage = undefined;
    transcript.replaceChildren();
    turns.forEach(appendExchange);
    details.hidden = true;
    byId("conversation-evidence").textContent = "";
    chatStatus.textContent = "Enter a message to start.";
    showSelection();
    session = createConversationSession({
      memoryStore: store,
      steward: (steward = createAwakeSteward(contextSource, { recoveredTurns: byId('mind-state-only').checked?[]:turns, skills,sessionId:livingSessionId })),
      mode:conversationMode,stateStore:contextSource,consolidation:true,independentMemory:true,
      sessionId:`${livingSessionId}:${++conversationEpoch}`,conversationId:id,resetReason:reason,
      async archiveTurns(results){
        for(const result of results){
          let item=archivePending.get(result.turn.turnId);
          if(!item){item={event:makeJournalEvent(conversationId,{...result.turn,conversationId},'candidate')};archivePending.set(result.turn.turnId,item);}
          if(!item.verified){const saved=await journal.save(item);item.verified=saved.fileId;}
        }
      },
      recoverConversation:!byId('mind-state-only').checked,
      loadCanonicalFacts: sleepStore.canonicalFacts,
      recoveredTurns: turns,
      async provider(envelope, image) {
        const call = { purpose: envelope.context?.memoryReview?.reviewOnly?'memory_review:'+envelope.context.memoryReview.triggers.join(','):envelope.librarySuggestion ? "suggest_library_query" : providerCalls.length ? "answer_with_skill_result" :
          envelope.context.retrievalComplete ? "answer_with_preloaded_context" : "answer_or_request_skill",
          provider: selection.provider, model: selection.model, usage: null };
        providerCalls.push(call);
        try {
          const input = envelope.librarySuggestion ? { librarySuggestion: envelope.librarySuggestion } : { envelope, ...(image ? { image } : {}) };
          const result = await invokeProvider({ ...selection, ...input });
          Object.assign(call, { model: result.model, usage: result.usage, promptBudget:result.promptBudget, status: "completed" });
          return result.raw;
        } catch (error) {
          Object.assign(call, { usage: error.usage ?? null, promptBudget:error.promptBudget, status: "failed" });
          throw error;
        } finally {
          sessionUsd += call.usage?.estimatedUsd ?? 0;
          showBudget();
        }
      }
    });
    showJournalContext();
  }

  async function recover(id) {
    const recovered = await journal.recover(id);
    resetChat(recovered);
    // An interrupted journal-first checkpoint is offered for persistence retry,
    // never regenerated through the conversational provider.
    const latest = recovered.turns.at(-1);
    const checkpoint = latest?.awakeReceipt?.bridge;
    if (checkpoint) {
      await contextSource.load();
      const state = await contextSource.checkpointStatus(checkpoint);
      if(state==='newer_state'){
        session.omitTurn(latest);
        mindContext(await session.checkout());
        mindTrace('recovery_warning',{operationId:checkpoint.operationId,status:'newer_authoritative_state',evidenceRetained:true});
        return 'Newer current understanding recovered. An older journal update was not replayed; its evidence remains in Drive.';
      }
      if (state !== 'verified') {
        const containing = recovered.entries.find(entry=>entry.event.turns.some(turn=>turn.turnId===checkpoint.operationId));
        pending = { event:containing.event,fileId:containing.fileId,journalVerified:containing.fileId,checkpoint };
        return 'Recovered conversation; its memory checkpoint is unconfirmed. Retry persistence without another model call.';
      }
    }
    mindContext(await session.checkout());
    return recovered.turns.length
      ? `Recovered ${recovered.turns.length} exchange(s) from Drive.`
      : "No saved exchanges for this conversation.";
  }

  async function savePending() {
    try {
      if (!pending.event) {
        const { result, turn, disposition, supportingTurn } = pending;
        pending.checkpoint ??= await contextSource.prepareCheckpoint(result);
        result.receipt.bridge = pending.checkpoint;
        const receipt = journalReceipt(result,supportingTurn);
        if (!receipt) throw Error('Checkpoint evidence could not be retained safely.');
        turn.awakeReceipt = receipt;
        pending.event = makeJournalEvent(conversationId,turn,disposition,supportingTurn);
      }
      if (pending.event.expiresAt && Date.parse(pending.event.expiresAt) <= Date.now()) {
        pending = undefined;
        return "The pending provisional exchange expired. Check Drive if its earlier save was uncertain.";
      }
      const stored = pending.journalVerified ? await journal.readReference('drive:'+pending.journalVerified) : await journal.save(pending);
      pending.journalVerified = stored.fileId;
      if (pending.checkpoint) {
        const verified = await contextSource.commitCheckpoint(pending.checkpoint,'drive:'+stored.fileId);
        session.acceptCommit(verified);
        byId('context-status').textContent = 'Memory checkpoint verified: ' + JSON.stringify(verified.records);
        byId('mind-status').textContent='Current state committed and verified in Drive.';
        mindTrace('committed',{operationId:verified.operationId,scopes:verified.records});
      }
      pending = undefined;
      return `Saved and verified in Drive. File ID ${stored.fileId}.`;
    } catch (error) {
      journalStatus.textContent = pending?.journalVerified ? 'Memory checkpoint unconfirmed; journal evidence is safe. Retry does not call the model.' :
        "Journal save unconfirmed. Retry uses the same exchange and file ID.";
      throw error;
    }
  }

  byId("journal-resume").addEventListener("click", () =>
    run("Recovering conversation from Drive…", () => recover(conversationField.value.trim()), journalStatus));
  byId("journal-new").addEventListener("click", () => run("Starting a conversation…", async () => {
    if(!await endConversation())return 'New conversation cancelled; temporary work retained.';
    resetChat({ id: crypto.randomUUID(), turns: [], entries: [],reason:'explicit_new_conversation' });
    mindContext(await session.checkout());
    return "New conversation.";
  }, journalStatus));
  async function inspect(cursor) {
    const page = await journal.page(conversationId, cursor);
    const contents = JSON.stringify(page.entries, null, 2);
    records.textContent = cursor ? `${records.textContent}\n\n${contents}` : contents;
    records.hidden = false;
    nextPage = page.next;
    older.hidden = !nextPage;
    return `Read ${page.entries.length} journal file(s) from Drive.`;
  }
  byId("journal-inspect").addEventListener("click", () => run("Reading saved exchanges…", () => inspect(), journalStatus));
  older.addEventListener("click", () => run("Reading older exchanges…", () => inspect(nextPage), journalStatus));
  retry.addEventListener("click", () => run("Retrying journal save…", savePending, journalStatus));
  function showMode(){
    for(const mode of ['temporary','durable'])byId('mode-'+mode).setAttribute('aria-pressed',String(conversationMode===mode));
    byId('memory-mode-status').textContent=conversationMode==='temporary'?'Just chatting: evolving understanding is session-local, unsaved and not archived.':'Remember with me: meaningful changes and eligible exchanges are saved with readback verification.';
  }
  function preservationChoice(ending=false){
    const dialog=byId('memory-transition');
    const state=session.memoryStatus;
    const understanding=value=>value?Object.fromEntries(['scopeId','revision','long','short','recent','facts','insights','review','affect','orientation'].map(key=>[key,value[key]])):null;
    byId('memory-transition-state').textContent=JSON.stringify({scopeId:state.scopeId,committed:understanding(state.committed),working:understanding(state.current),temporaryExchanges:state.temporaryExchanges,rawConversation:'Not included in Save understanding only.'},null,2);
    byId('memory-transition-explanation').textContent=ending?'Your temporary understanding differs from committed memory. Save understanding only, without archiving raw conversation, or let it go. Cancel keeps the session open.':'Choose exactly what to preserve from temporary conversation before durable mode starts. No temporary content is saved automatically.';
    for(const id of ['preserve-exchanges','preserve-both'])byId(id).hidden=ending;
    dialog.returnValue='cancel';dialog.showModal();
    return new Promise(resolve=>dialog.addEventListener('close',()=>resolve(dialog.returnValue),{once:true}));
  }
  async function changeMode(next){
    try{
    if(pending)await savePending();
    if(session.memoryStatus.review.unreviewedSources){providerCalls=[];selection=await prepareSelection();}
    let result=await session.setMode(next);
    if(result.needsChoice){const choice=await preservationChoice();if(choice==='cancel')return 'Mode unchanged; temporary work retained.';result=await session.setMode(next,choice);}
    conversationMode=next;preceding=undefined;support.checked=false;showMode();mindTrace('mode_changed',result);
    return next==='temporary'?'Just chatting. Future changes remain session-local. Previously committed memory is unchanged.':'Remember with me. Temporary preservation choices completed; see verified receipts.';
    }catch(error){throw Object.assign(error,{providerCalls});}finally{conversationMode=session.memoryStatus.mode;showMode();}
  }
  async function endConversation(){
    try{
    if(pending)await savePending();
    if(session.memoryStatus.review.unreviewedSources||session.recentTurnCount){providerCalls=[];selection=await prepareSelection();}
    let result=await session.endSession();
    if(result.needsDecision){const choice=await preservationChoice(true);if(choice==='cancel')return false;result=await session.endSession(choice==='understanding'?'understanding':'discard');}
    preceding=undefined;mindTrace('session_ended',result);showMode();
    byId('mind-status').textContent=result.verified?'Understanding saved and read back; raw temporary conversation was not archived.':conversationMode==='durable'?'Durable handoff completed. Previously verified understanding retained; no additional commit was needed.':'Session ended. Uncommitted temporary understanding was discarded; durable memory is unchanged.';
    return true;
    }catch(error){throw Object.assign(error,{providerCalls});}
  }
  for(const mode of ['temporary','durable'])byId('mode-'+mode).addEventListener('click',()=>run('Changing conversation privacy mode…',()=>changeMode(mode),byId('mind-status')));
  byId('mind-sleep').addEventListener('click',()=>run('Ending this conversation safely…',async()=>await endConversation()?'Session handoff completed.':'Sleep cancelled; temporary work retained.',byId('sleep-status')));
  byId('mobile-sleep').addEventListener('click',()=>run('Preparing Sleep handoff…',async()=>await endConversation()?'Session handoff completed. Reflective Sleep remains an explicit separate action.':'Sleep cancelled; temporary work retained.',byId('sleep-status')));
  byId('mind-resume').addEventListener('click',()=>run('Resuming latest committed state…',async()=>{
    if(session.memoryStatus.review.pendingCommit){if(!confirm('Discard this reviewed but uncommitted local interpretation and read the latest Drive state? No existing Drive record will be erased.'))return 'Resume cancelled; reviewed work retained.';return mindContext({...await session.discardReviewedUpdate(),inspectionOnly:true});}
    if(session.memoryStatus.temporaryExchanges&&!await endConversation())return 'Resume cancelled.';
    if(session.memoryStatus.review.unreviewedSources){providerCalls=[];selection=await prepareSelection();}
    return mindContext({...await session.discardTemporary(),inspectionOnly:true});
  },byId('mind-status')));
  showMode();
  byId('mind-review').addEventListener('click',()=>run('Reviewing eligible evidence without silently retaining it…',async()=>{
    providerCalls=[];selection=await prepareSelection();
    try{const result=await session.review('explicit_review');const committed=await session.commitReview();mindTrace('review_checkpoint',{...result,committed});byId('conversation-evidence').textContent=JSON.stringify({callPhase:'memory_review',providerCalls,review:result.artifact,committed},null,2);byId('conversation-details').hidden=false;return 'Memory review completed. Review artifact is session-local; any durable understanding requires verified commit.';}
    catch(error){mindTrace('review_failed',{review:session.memoryStatus.review,diagnostic:error.diagnostic});throw Object.assign(error,{providerCalls});}
  },byId('mind-status')));
  byId('mind-check').addEventListener('click',()=>run('Inspecting authoritative current state without writing…',async()=>mindContext(await session.inspect()),byId('mind-status')));
  byId('mind-takeover').addEventListener('click',()=>run('Taking over this scope; other client writes will be rejected…',async()=>{
    if(!confirm('Take over the durable checkout? The latest committed state is retained, but unsaved work in another browser cannot be recovered.'))return 'Takeover cancelled.';
    await steward.checkoutContext(await steward.assemble([],{source:'session:takeover',role:'user',text:'Explicit durable checkout takeover.'}),{takeover:true,preserveWorking:true});
    return mindContext(await session.checkout());
  },byId('mind-status')));
  byId('mind-handoff').addEventListener('click',()=>run('Verifying pending work and releasing current scope…',async()=>{if(pending)await savePending();if(session.memoryStatus.review.unreviewedSources){providerCalls=[];selection=await prepareSelection();}const result=await session.handoff();mindTrace('handoff',result);return 'Verified current state retained. Checkout released for another device.';},byId('mind-status')));
  byId('mind-discard').addEventListener('click',()=>run('Discarding the uncommitted local update only…',async()=>{
    if(session.memoryStatus.review.pendingCommit){if(!confirm('Discard the completed review update that has not been committed? Existing Drive memory remains unchanged.'))return 'Reviewed update retained.';await session.discardReviewedUpdate();mindTrace('discarded_review',session.memoryStatus);return 'Reviewed local update discarded; committed Drive memory unchanged.';}
    const old=pending;if(!old)return 'No pending update.';const turn=old.turn??old.event?.turns.find(t=>t.turnId===(old.checkpoint?.operationId??old.event.eventId));if(turn)session.omitTurn(turn);pending=undefined;mindTrace('discarded_uncommitted',{operationId:old.checkpoint?.operationId??old.event?.eventId,evidenceFileId:old.journalVerified??old.fileId??null,canonicalStateUnchanged:true});return 'Uncommitted local update discarded. Drive evidence and verified current state are unchanged.';
  },byId('mind-status')));
  byId('mind-scope').addEventListener('change',()=>run('Loading selected room continuity…',async()=>{const target=byId('mind-scope').value||null;if(pending)await savePending();if(session.memoryStatus.temporaryExchanges&&!await endConversation()){byId('mind-scope').value=steward.activeProjectId??'';return 'Room change cancelled.';}if(session.memoryStatus.review.unreviewedSources){providerCalls=[];selection=await prepareSelection();}clearProjectPreview();palace.clear();glasses.reset();transcript.replaceChildren();preceding=undefined;return mindContext(await session.enterScope(target));},byId('mind-status')));

  byId("chat-form").addEventListener("submit", event => {
    event.preventDefault();
    if (send.disabled) return;
    const submitted = message.value;
    const libraryEvidence = palace.conversationEvidence();
    const visual = glasses.snapshot();
    if (visual?.evidence.status === "failed" || visual?.evidence.status === "loading") {
      chatStatus.textContent = "Aida could not inspect the image. Choose a valid image or Clear.";
      return;
    }
    if (visual?.image && (localDevelopment || select.value !== "openai")) {
      chatStatus.textContent = "Image inspection is available only on the hosted OpenAI route. No image was sent.";
      return;
    }
    const selectedDisposition=dispositionFor(submitted,'auto');
    const chosenDisposition=conversationMode==='temporary'&&selectedDisposition!=='excluded'?'ephemeral':selectedDisposition;
    let supportingTurn = support.checked ? availableSupport(preceding, chosenDisposition) : undefined;
    run("Reading Drive and preparing a reply…", async () => {
      providerCalls = [];
      showBudget();
      selection = await prepareSelection();
      if (chosenDisposition === "excluded" && availableSupport(preceding, "candidate")) {
        session.omitTurn(preceding.turn);
        preceding = undefined;
      }
      let result;
      try {
        result = await session.send(submitted, { keepInContext: chosenDisposition !== "excluded", libraryEvidence, visual, memoryDisposition:chosenDisposition });
      } catch (error) {
        if (visual?.image) error.message = "Aida could not inspect the current image. " + error.message;
        throw Object.assign(error, { providerCalls });
      }
      if (chosenDisposition === "excluded") clearProjectPreview();
      if (result.receipt.preview) {
        projectPreview = result.receipt.preview;
        projectData.textContent = JSON.stringify(projectPreview, null, 2);
        projectStatus.textContent = "Review the proposed action and its evidence before confirming.";
        projectPanel.hidden = false;
      }
      const turn = { ...result.turn, conversationId };
      if(supportingTurn&&(supportingTurn.scopeId??'everyday')!==(turn.scopeId??'everyday'))supportingTurn=undefined;
      const inspectionReceipt = visualReceipt(result);
      if (inspectionReceipt && chosenDisposition !== "excluded") turn.visualReceipt = inspectionReceipt;
      appendExchange(turn);
      if (result.receipt.outcome.status === "proposed" && result.receipt.outcome.route === "ask_uncle_chatt") {
        chatt.offer(turn.user.text);
      }
      transcript.dispatchEvent(new CustomEvent("aida-affect", { detail: {
        valence: result.response.affect.valence, arousal: result.response.affect.arousal
      } }));
      const needsCheckpoint = conversationMode==='durable'&&checkpointEligible(result,chosenDisposition);
      byId('mind-scope').value=result.envelope.context.currentProjectId??'';
      mindTrace('proposed',{scopeId:result.turn.scopeId,mode:conversationMode,modelRequest:result.requestContext,previous:result.envelope.context.currentState,after:result.memoryStatus.current,proposed:result.receipt.proposed??[],validation:result.receipt.rejected??[],evaluation:result.receipt.evaluation??null,semanticStatus:result.receipt.semanticStatus??'legacy',noUnderstandingChange:result.memoryPending?null:result.receipt.evaluation?.decision==='no_change',longShortUnchanged:JSON.stringify([result.envelope.context.currentState.long,result.envelope.context.currentState.short])===JSON.stringify([result.memoryStatus.current.long,result.memoryStatus.current.short]),personalFactsProposed:result.receipt.candidates?.filter(c=>c.layer==='facts'&&c.scope==='global').length??0,reviewOutcome:result.receipt.evaluation?.outcome,provisionalObservations:result.receipt.evaluation?.observations??[],persistence:needsCheckpoint?'pending':conversationMode==='temporary'?'session-local; not saved or archived':'no durable change',diagnostics:result.memoryStatus.diagnostics});
      disposition = needsCheckpoint && chosenDisposition === 'ephemeral' ? 'candidate' : chosenDisposition;
      preceding = { turn, disposition };
      sources = [turn.user.source, turn.aida.source];
      showJournalContext();
      byId("conversation-evidence").textContent = JSON.stringify({
        ...providerCalls.at(-1), providerCalls, driveEvidence: result.envelope.memory.facts.map(({ source, recordId, savedAt, destination, proposalId, reviewId, sources }) =>
          ({ source, recordId, savedAt, destination, proposalId, reviewId, sources })),
        memoryAcceptance:result.memoryPending??{status:result.receipt.semanticStatus}, recentMessageCount: result.envelope.memory.recent.length, response: result.response,
        awakeContext: { projectId: result.envelope.context.currentProjectId, references: result.envelope.context.references },
        projectRead: result.envelope.context.projectRead ? {
          ...result.envelope.context.projectRead,
          status: result.receipt.outcome.status === "project_selected" ? "activated" : result.envelope.context.projectRead.status
        } : null,
        inspection: result.envelope.visualEvidence ? {
          status: result.envelope.visualEvidence.status, page: result.envelope.visualEvidence.page ?? null,
          adapted: result.envelope.visualEvidence.adapted, projectId: result.envelope.visualEvidence.projectId ?? null,
          initiatingRoom: result.envelope.visualEvidence.initiatingRoom,
          initiatingProjectId: result.envelope.visualEvidence.initiatingProjectId,
          projectChanged: result.envelope.visualEvidence.changed,
          sourceHash: result.envelope.visualEvidence.source?.sha256 ?? null
        } : null,
        stewardReceipt: result.receipt
      }, null, 2);
      details.hidden = false;
      byId("conversation-evidence-label").textContent = "Development evidence";
      if (message.value === submitted) message.value = "";
      retention.value = "auto";
      if (!result.memoryPending&&conversationMode==='durable'&&(disposition === "candidate" || disposition === "provisional")) {
        if (needsCheckpoint) pending = { result,turn,disposition,supportingTurn };
        else {
          const receipt = journalReceipt(result, supportingTurn);
          if (receipt) turn.awakeReceipt = receipt;
          pending = { event: makeJournalEvent(conversationId, turn, disposition, supportingTurn) };
        }
        preceding.expiresAt = disposition === 'provisional' ? new Date(Date.now()+24*60*60*1000).toISOString() : null;
        sources = (supportingTurn ? [supportingTurn,turn] : [turn]).flatMap(item => [item.user.source,item.aida.source]);
        showJournalContext();
        try {
          journalStatus.textContent = await savePending();
        } catch (error) {
          if (error.status === 401) {
            token = undefined;
            browserKey = undefined;
          }
          return `Reply received. Journal save unconfirmed. ${error.message}`;
        }
      } else {
        journalStatus.textContent = result.memoryWarning??(disposition === "excluded"
          ? "Exchange excluded from future context and Drive."
          : conversationMode==='temporary'?"Just chatting: working understanding evolved locally; no Drive memory or archive write.":"No meaningful memory change; no archive write.");
      }
      const outcome = result.receipt.outcome.status;
      if(result.memoryWarning)return result.memoryWarning;
      return {
        project_selected: "Project continuity loaded and room selected.",
        project_looked_up: "Project continuity retrieved.",
        confirmation_required: result.receipt.preview ? "Capability preview is ready for confirmation." :
          "Capability request recorded. It requires your confirmation.",
        proposed: "Request proposed for review.",
        unavailable: "The requested capability is unavailable.",
        invalid_arguments: "The capability request is missing valid arguments.",
        needs_clarification: "The request needs clarification.",
      }[outcome] ?? "Reply received.";
    }, chatStatus);
  });
  return async () => {
    if(session){session.reauthorized();showSelection();mindTrace('authorization_refreshed',session.memoryStatus);journalStatus.textContent='Authorization refreshed; the existing working conversation and pending evidence were preserved.';return;}
    clearProjectPreview();
    contextStatus.textContent = contextEvidence.textContent = "";
    contextEvidence.hidden = true;
    clearSleepPanel();
    if (pending) {
      journalStatus.textContent = "Retry the unconfirmed journal save.";
      showSelection();
      return;
    }
    session = undefined;
    transcript.replaceChildren();
    records.hidden = older.hidden = true;
    records.textContent = byId("conversation-evidence").textContent = "";
    details.hidden = true;
    conversationField.value = byId("journal-context").textContent = "";
    try {
      journalStatus.textContent = await recover();
    } catch (error) {
      journalStatus.textContent = `Journal recovery failed. ${error.message}`;
      return;
    }
    // Authorization/recovery is read-only. Expired entries are excluded by the
    // reader; do not mutate other journal files as a sign-in side effect.
  };
}

function loadGoogle() {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    const timer = setTimeout(() => reject(new Error("Google sign-in did not load. Reload and try again.")), 15000);
    script.src = "https://accounts.google.com/gsi/client";
    script.onload = () => {
      clearTimeout(timer);
      const oauth = globalThis.google?.accounts?.oauth2;
      if (oauth) resolve(oauth);
      else reject(new Error("Google sign-in is unavailable."));
    };
    script.onerror = () => {
      clearTimeout(timer);
      reject(new Error("Could not load Google sign-in. Reload and try again."));
    };
    document.head.append(script);
  });
}

try {
  const response = await fetch("./oauth.config.json", { cache: "no-store" });
  if (!response.ok) throw new Error("Could not load oauth.config.json.");
  const config = validateConfig(await response.json(), location.origin);
  const oauth = await loadGoogle();
  store = createMemoryStore(config.drive.initialMemoryFolderId, () => token);
  let resetChat;
  try {
    resetChat = await setupChat(config.drive.initialMemoryFolderId);
  } catch (error) {
    byId("chat").hidden = false;
    byId("chat-status").textContent = error.message;
  }
  connect.addEventListener("click", () => run("Waiting for Google authorization…", async () => {
    token = undefined;
    driveReady = false;
    browserKey = undefined;
    token = await authorize(oauth, config.google);
    try {
      await store.verifyFolder();
    } catch (error) {
      token = undefined;
      throw error;
    }
    await resetChat?.();
    driveReady = true;
    return "Google Drive connected.";
  }));
  connect.disabled = false;
  status.textContent = "Authorize Google Drive to continue.";
  refreshWelcome();
} catch (error) {
  status.textContent = error.message;
  byId("welcome-status").textContent = error.message;
}

byId("memory-form").addEventListener("submit", event => {
  event.preventDefault();
  if (remember.disabled) return;
  run("Saving and checking the record in Drive…", async () => {
    show(await store.remember(byId("memory").value));
    return "Memory saved and read back from Google Drive.";
  });
});

recall.addEventListener("click", () => run("Reading from Google Drive…", async () => {
  const result = await store.recall();
  if (!result) return "No Aida memory was found in the development folder.";
  show(result);
  return "Memory recalled from Google Drive.";
}));
import { rpgBinding } from "./theater/capability.mjs";
import { setupTheater } from "./theater/app.mjs";

import { createTheaterStorage } from "./theater/drive-store.mjs";
