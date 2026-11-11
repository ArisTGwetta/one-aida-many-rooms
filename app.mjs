import { authorize, createMemoryStore, validateConfig } from "./memory.mjs";

const byId = id => document.getElementById(id);
const connect = byId("connect");
const remember = byId("remember");
const recall = byId("recall");
const status = byId("status");
const evidence = byId("evidence");
let token;
let store;

function show(result) {
  byId("file-id").textContent = result.fileId;
  byId("saved-at").textContent = result.record.updated_at;
  byId("record").textContent = JSON.stringify(result.record, null, 2);
  evidence.hidden = false;
}

async function run(label, action) {
  evidence.hidden = true;
  connect.disabled = remember.disabled = recall.disabled = true;
  status.textContent = label;
  try {
    status.textContent = await action();
  } catch (error) {
    if (error.status === 401) token = undefined;
    status.textContent = error.message;
  } finally {
    connect.disabled = false;
    remember.disabled = recall.disabled = !token;
  }
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
  connect.addEventListener("click", () => run("Waiting for Google authorization…", async () => {
    token = undefined;
    token = await authorize(oauth, config.google);
    try {
      await store.verifyFolder();
    } catch (error) {
      token = undefined;
      throw error;
    }
    return "Google Drive connected.";
  }));
  connect.disabled = false;
  status.textContent = "Authorize Google Drive to continue.";
} catch (error) {
  status.textContent = error.message;
}

document.querySelector("form").addEventListener("submit", event => {
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
