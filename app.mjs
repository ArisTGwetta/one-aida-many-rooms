import { authorize, createMemoryStore, validateConfig } from "./memory.mjs";
import { createConversationSession, ConversationTransportError } from "./conversation.mjs";

const byId = id => document.getElementById(id);
const connect = byId("connect");
const remember = byId("remember");
const recall = byId("recall");
const status = byId("status");
const evidence = byId("evidence");
let token;
let store;
let session;
const send = byId("send");
const localDevelopment = location.origin === "http://127.0.0.1:8787";

function show(result) {
  byId("file-id").textContent = result.fileId;
  byId("saved-at").textContent = result.record.updated_at;
  byId("record").textContent = JSON.stringify(result.record, null, 2);
  evidence.hidden = false;
}

async function run(label, action, target = status) {
  if (target === status) evidence.hidden = true;
  connect.disabled = remember.disabled = recall.disabled = send.disabled = true;
  target.textContent = label;
  try {
    target.textContent = await action();
  } catch (error) {
    if (error.status === 401) token = undefined;
    target.textContent = error.message;
  } finally {
    connect.disabled = false;
    remember.disabled = recall.disabled = !token;
    send.disabled = !token || !session;
  }
}

async function setupChat() {
  const configuration = await fetch("./dev-config", { cache: "no-store" });
  if (!configuration.ok) throw new Error("The local chat server is unavailable.");
  const dev = await configuration.json();
  const select = byId("provider");
  const model = byId("model");
  const message = byId("message");
  const transcript = byId("transcript");
  const details = byId("conversation-details");
  const chatStatus = byId("chat-status");
  const preferenceKey = "aida.development.provider";
  let ollamaModel = dev.ollamaModel;
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
    model.value = ollama ? ollamaModel : dev.openAIModel;
    model.readOnly = !ollama;
    byId("provider-status").textContent = ollama
      ? (dev.ollamaConfigured ? "Enter a model installed on the configured Ollama server." : "Ollama requires a configured local server endpoint.")
      : "OpenAI receives this turn’s message and the memory context needed to answer.";
  }
  select.addEventListener("change", () => { showSelection(); savePreference(); });
  model.addEventListener("input", () => { ollamaModel = model.value; savePreference(); });
  showSelection();
  byId("chat").hidden = false;
  chatStatus.textContent = "Authorize Google Drive to start chatting.";

  let selection;
  let evidence;
  function resetChat() {
    transcript.replaceChildren();
    details.hidden = true;
    byId("conversation-evidence").textContent = "";
    chatStatus.textContent = "Enter a message to start.";
    session = createConversationSession({
      memoryStore: store,
      async provider(envelope) {
        const response = await fetch("./dev-chat", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...selection, envelope })
        });
        const result = await response.json();
        if (!response.ok) throw new ConversationTransportError(result.error ?? "The local chat server rejected the request.");
        evidence = { provider: result.provider, model: result.model, usage: result.usage };
        return result.raw;
      }
    });
  }

  byId("chat-form").addEventListener("submit", event => {
    event.preventDefault();
    if (send.disabled) return;
    selection = { provider: select.value, model: model.value.trim() };
    const submitted = message.value;
    run("Reading Drive and preparing a reply…", async () => {
      const result = await session.send(submitted);
      for (const [speaker, text] of [["You", result.envelope.user.text], ["Aida", result.response.reply]]) {
        const line = document.createElement("p");
        line.textContent = `${speaker}: ${text}`;
        transcript.append(line);
      }
      byId("conversation-evidence").textContent = JSON.stringify({
        ...evidence, driveEvidence: result.envelope.memory.facts.map(({ source, recordId, savedAt }) => ({ source, recordId, savedAt })),
        recentMessageCount: result.envelope.memory.recent.length, response: result.response
      }, null, 2);
      details.hidden = false;
      if (message.value === submitted) message.value = "";
      return "Reply received.";
    }, chatStatus);
  });
  return resetChat;
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
  if (localDevelopment) {
    try {
      resetChat = await setupChat();
    } catch (error) {
      byId("chat").hidden = false;
      byId("chat-status").textContent = error.message;
    }
  }
  connect.addEventListener("click", () => run("Waiting for Google authorization…", async () => {
    token = undefined;
    token = await authorize(oauth, config.google);
    try {
      await store.verifyFolder();
    } catch (error) {
      token = undefined;
      throw error;
    }
    resetChat?.();
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
