import { authorize, createMemoryStore, validateConfig } from "./memory.mjs";
import { createConversationSession, ConversationTransportError } from "./conversation.mjs";
import { availableSupport, createJournal, dispositionFor, makeJournalEvent } from "./recent-journal.mjs";
import { setupSleepPanel } from "./sleep-panel.mjs";
import { createSleepStore } from "./sleep.mjs";

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
let canSend = () => Boolean(session);
let refreshJournalControls = () => {};
const send = byId("send");
const localDevelopment = location.origin === "http://127.0.0.1:8787";

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
  try {
    target.textContent = await action();
  } catch (error) {
    if (error.status === 401) {
      token = undefined;
      browserKey = undefined;
    }
    target.textContent = error.message;
  } finally {
    running = false;
    connect.disabled = false;
    remember.disabled = recall.disabled = !token;
    send.disabled = !token || !canSend();
    refreshJournalControls();
  }
}

async function setupChat(folderId) {
  const journal = createJournal(folderId, () => token);
  const sleepStore = createSleepStore(folderId, () => token);
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
  let evidence;

  async function invokeProvider(input) {
    if (localDevelopment) {
      const response = await fetch("./dev-chat", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input)
      });
      const result = await response.json();
      if (!response.ok) throw new ConversationTransportError(result.error ?? "The local server rejected the request.");
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
        throw new ConversationTransportError(error.message);
      }
      throw error;
    }
  }

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
      browserKey = await loadOpenAIKey(folderId, code, token);
      showSelection();
    }
    return selected;
  }

  const clearSleepPanel = setupSleepPanel({
    store: sleepStore, journal, run,
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
      line.textContent = `${speaker}: ${text}`;
      transcript.append(line);
    }
  }

  function resetChat({ id, turns, entries }) {
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
      loadCanonicalFacts: sleepStore.canonicalFacts,
      recoveredTurns: turns,
      async provider(envelope) {
        const result = await invokeProvider({ ...selection, envelope });
        evidence = { provider: result.provider, model: result.model, usage: result.usage };
        return result.raw;
      }
    });
    showJournalContext();
  }

  async function recover(id) {
    const recovered = await journal.recover(id);
    resetChat(recovered);
    return recovered.turns.length
      ? `Recovered ${recovered.turns.length} exchange(s) from Drive.`
      : "No saved exchanges for this conversation.";
  }

  async function savePending() {
    try {
      if (pending.event.expiresAt && Date.parse(pending.event.expiresAt) <= Date.now()) {
        pending = undefined;
        return "The pending provisional exchange expired. Check Drive if its earlier save was uncertain.";
      }
      const stored = await journal.save(pending);
      pending = undefined;
      return `Saved and verified in Drive. File ID ${stored.fileId}.`;
    } catch (error) {
      journalStatus.textContent = "Journal save unconfirmed. Retry uses the same exchange and file ID.";
      throw error;
    }
  }

  byId("journal-resume").addEventListener("click", () =>
    run("Recovering conversation from Drive…", () => recover(conversationField.value.trim()), journalStatus));
  byId("journal-new").addEventListener("click", () => run("Starting a conversation…", async () => {
    resetChat({ id: crypto.randomUUID(), turns: [], entries: [] });
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

  byId("chat-form").addEventListener("submit", event => {
    event.preventDefault();
    if (send.disabled) return;
    const submitted = message.value;
    const chosenDisposition = dispositionFor(submitted, retention.value);
    const supportingTurn = support.checked ? availableSupport(preceding, chosenDisposition) : undefined;
    run("Reading Drive and preparing a reply…", async () => {
      selection = await prepareSelection();
      if (chosenDisposition === "excluded" && availableSupport(preceding, "candidate")) {
        session.omitTurn(preceding.turn);
        preceding = undefined;
      }
      const result = await session.send(submitted, { keepInContext: chosenDisposition !== "excluded" });
      const turn = { ...result.turn, conversationId };
      appendExchange(turn);
      disposition = chosenDisposition;
      preceding = { turn, disposition };
      sources = [turn.user.source, turn.aida.source];
      showJournalContext();
      byId("conversation-evidence").textContent = JSON.stringify({
        ...evidence, driveEvidence: result.envelope.memory.facts.map(({ source, recordId, savedAt, destination, proposalId, reviewId, sources }) =>
          ({ source, recordId, savedAt, destination, proposalId, reviewId, sources })),
        recentMessageCount: result.envelope.memory.recent.length, response: result.response
      }, null, 2);
      details.hidden = false;
      if (message.value === submitted) message.value = "";
      retention.value = "auto";
      if (disposition === "candidate" || disposition === "provisional") {
        pending = { event: makeJournalEvent(conversationId, turn, disposition, supportingTurn) };
        preceding.expiresAt = pending.event.expiresAt;
        sources = pending.event.turns.flatMap(item => [item.user.source, item.aida.source]);
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
        journalStatus.textContent = disposition === "excluded"
          ? "Exchange excluded from future context and Drive."
          : "Exchange kept in page context only.";
      }
      return "Reply received.";
    }, chatStatus);
  });
  return async () => {
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
    try {
      await journal.trashExpired();
    } catch {
      journalStatus.textContent += " Expired entries were excluded. Drive cleanup could not finish.";
    }
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
    browserKey = undefined;
    token = await authorize(oauth, config.google);
    try {
      await store.verifyFolder();
    } catch (error) {
      token = undefined;
      throw error;
    }
    await resetChat?.();
    return "Google Drive connected.";
  }));
  connect.disabled = false;
  status.textContent = "Authorize Google Drive to continue.";
} catch (error) {
  status.textContent = error.message;
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
