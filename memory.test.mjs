import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { authorize, createMemoryStore, createRecord, validateConfig } from "./memory.mjs";

const scope = "https://www.googleapis.com/auth/drive";
const folderName = "AIDA — ONE AIDA MANY ROOMS — DEV";
const folderId = "dev_folder";
const origin = "https://aristgwetta.github.io";
const config = JSON.parse(await readFile(new URL("./oauth.config.json", import.meta.url), "utf8"));
const ready = { ...config, drive: { ...config.drive, initialMemoryFolderId: folderId } };
const fact = "The garden gate sticks after heavy rain.";

test("record is inspectable JSON with a unique ID and UTC timestamps", () => {
  const record = createRecord("  " + fact + "  ");
  assert.deepEqual(JSON.parse(JSON.stringify(record)), record);
  assert.equal(record.text, fact);
  assert.equal(record.schema_version, 1);
  assert.equal(record.source, "user-entered");
  assert.equal(record.created_at, new Date(record.created_at).toISOString());
  assert.equal(record.updated_at, record.created_at);
  assert.notEqual(createRecord(fact).id, record.id);
  assert.throws(() => createRecord(" "), /Enter a memory/);
  assert.throws(() => createRecord("a".repeat(4001)), /Enter a memory/);
});

test("configuration preserves full Drive access and requires the correct origin and folder ID", () => {
  assert.deepEqual(config.google.scopes, [scope]);
  assert.equal(validateConfig(ready, origin), ready);
  assert.throws(() => validateConfig(ready, "http://localhost:8080"), /must run on/);
  assert.throws(() => validateConfig({
    ...ready, drive: { ...ready.drive, initialMemoryFolderId: "" }
  }, origin), /verified development folder ID/);
  assert.throws(() => validateConfig({ ...ready, google: { ...ready.google, scopes: [] } }, origin), /invalid/);
  assert.throws(() => createMemoryStore("invalid'folder", () => ""), /invalid/);
});

test("OAuth requests the full scope and handles denied grants and blocked popups", async () => {
  const run = deliver => authorize({
    hasGrantedAllScopes(response, requested) {
      return response.scope === requested;
    },
    initTokenClient(options) {
      assert.equal(options.client_id, config.google.clientId);
      assert.equal(options.scope, scope);
      assert.equal(options.include_granted_scopes, true);
      return { requestAccessToken({ prompt }) {
        assert.equal(prompt, "select_account");
        deliver(options);
      } };
    }
  }, config.google);

  assert.equal(await run(options => options.callback({ access_token: "test-token", scope })), "test-token");
  await assert.rejects(run(options => options.callback({ error: "access_denied" })), /did not grant/);
  await assert.rejects(run(options => options.callback({ access_token: "test-token" })), /did not grant/);
  await assert.rejects(run(options => options.error_callback({ type: "popup_failed_to_open" })), /Allow the/);
  await assert.rejects(run(options => options.error_callback({ type: "popup_closed" })), /did not finish/);
});

function fakeDrive({ loseUploadResponse = false, delayListing = false } = {}) {
  let stored;
  let generated = 0;
  const uploads = [];
  const folder = { id: folderId, name: folderName, mimeType: "application/vnd.google-apps.folder", trashed: false };
  const fetchRequest = async (url, options) => {
    const { hostname, pathname, searchParams } = new URL(url);
    assert.equal(hostname, "www.googleapis.com");
    assert.equal(options.headers.Authorization, "Bearer test-token");
    assert.equal(options.cache, "no-store");
    if (pathname === "/drive/v3/files/" + folderId) return Response.json(folder);
    if (pathname === "/drive/v3/files/generateIds") {
      assert.equal(searchParams.get("count"), "1");
      generated++;
      return Response.json({ ids: ["file-" + generated] });
    }
    if (pathname === "/drive/v3/files") {
      assert.match(searchParams.get("q"), /^'dev_folder' in parents and trashed = false/);
      assert.match(searchParams.get("q"), /name = 'aida-first-memory.json'.*appProperties has/);
      return Response.json({ files: stored && !delayListing ? [{ id: stored.id }] : [] });
    }
    if (pathname === "/upload/drive/v3/files") {
      assert.equal(options.method, "POST");
      assert.equal(searchParams.get("uploadType"), "multipart");
      const boundary = options.headers["Content-Type"].split("boundary=")[1];
      const parts = options.body.split("--" + boundary);
      const metadata = JSON.parse(parts[1].split("\r\n\r\n")[1]);
      const record = JSON.parse(parts[2].split("\r\n\r\n")[1]);
      assert.deepEqual(metadata.parents, [folderId]);
      assert.deepEqual(metadata.appProperties, { aidaMemory: "first-memory-v1" });
      assert.equal(metadata.mimeType, "application/json");
      assert.equal(metadata.name, "aida-first-memory.json");
      uploads.push({ id: metadata.id, record });
      if (stored) {
        assert.equal(metadata.id, stored.id);
        delayListing = false;
        return new Response(null, { status: 409 });
      }
      stored = { id: metadata.id, record };
      if (loseUploadResponse) throw new Error("Connection lost after upload");
      return Response.json({ id: metadata.id });
    }
    assert.equal(pathname, "/drive/v3/files/" + stored?.id);
    assert.equal(searchParams.get("alt"), "media");
    return Response.json(stored.record);
  };
  return {
    open: () => createMemoryStore(folderId, () => "test-token", fetchRequest),
    uploads, folder,
    corrupt: () => { stored.record = { text: fact }; }
  };
}

test("save reads back Drive evidence and a fresh store recalls it", async () => {
  const drive = fakeDrive();
  const firstSession = drive.open();
  assert.equal(await firstSession.recall(), null);
  const saved = await firstSession.remember(fact);
  assert.equal(saved.record.text, fact);
  assert.equal(saved.fileId, "file-1");
  assert.deepEqual(await drive.open().recall(), saved);
  assert.deepEqual(await drive.open().remember(fact), saved);
  await assert.rejects(drive.open().remember("another fact"), /already has a memory/);
  assert.equal(drive.uploads.length, 1);
  drive.corrupt();
  await assert.rejects(drive.open().recall(), /malformed/);
  await assert.rejects(drive.open().remember(fact), /malformed/);
  assert.equal(drive.uploads.length, 1);
});

test("retry after a lost response reuses the same ID even before list catches up", async () => {
  const drive = fakeDrive({ loseUploadResponse: true, delayListing: true });
  const session = drive.open();
  await assert.rejects(session.remember(fact), /Could not reach/);
  await assert.rejects(session.remember("another fact"), /original text/);
  const saved = await session.remember(fact);
  assert.deepEqual(drive.uploads, [drive.uploads[0], drive.uploads[0]]);
  assert.equal(saved.fileId, drive.uploads[0].id);
  assert.deepEqual(await drive.open().recall(), saved);
});

test("folder mismatch, HTTP errors and invalid JSON fail before a write", async () => {
  const drive = fakeDrive();
  drive.folder.name = "Different folder";
  await assert.rejects(drive.open().remember(fact), /does not match/);
  assert.equal(drive.uploads.length, 0);
  for (const [status, message] of [[401, /expired/], [403, /refused/], [404, /could not find/]]) {
    const session = createMemoryStore(folderId, () => "test-token", async () => new Response(null, { status }));
    await assert.rejects(session.recall(), message);
  }
  const session = createMemoryStore(folderId, () => "test-token", async () => new Response("bad JSON"));
  await assert.rejects(session.recall(), /malformed JSON/);
});

test("runtime entry points and references stay inside the new workspace", async () => {
  const page = await readFile(new URL("./index.html", import.meta.url), "utf8");
  assert.deepEqual([...page.matchAll(/(?:src|href)="([^"]+)"/g)].map(match => match[1]), ["./style.css", "./app.mjs"]);
  for (const file of ["index.html", "style.css", "app.mjs", "memory.mjs", "oauth.config.json"]) {
    const content = await readFile(new URL("./" + file, import.meta.url), "utf8");
    assert.doesNotMatch(content, /\.\.\/|file:\/\/|AIDA_NEXT|AIDA_ONE_SPINE|francisco-aida|G:\\\\|\/Aida_mobile\//);
  }
});
