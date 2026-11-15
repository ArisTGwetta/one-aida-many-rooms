import assert from "node:assert/strict";
import test from "node:test";
import { gzipSync } from "node:zlib";
import { createSkillRegistry } from "./skill-registry.mjs";
import { decodeSnailMini, snailMiniBinding } from "./snail-mini.mjs";

const digest = "a".repeat(64);
const artifact = rows => new Blob([gzipSync(JSON.stringify({ version: 1, sourceManifestDigest: digest, rows }))]);
test("Snail Mini fixture searches recorded paths and aliases through the read dispatcher", async () => {
  let authorized = false;
  let reads = 0;
  const address = "G:/My Drive/Research/Portrait.png";
  const registry = createSkillRegistry([snailMiniBinding({
    authorized: () => authorized,
    getCatalog: () => { reads++; return artifact([["snail-1", "Portrait", "png", ["google_drive_mount", address], ["Lighthouse"]]]); }
  })]);
  const find = query => registry.dispatch({ id: "search_snail_mini", version: 1, input: { query } }, {}, "read");
  await assert.rejects(find("lighthouse"), /unauthorized/);
  assert.equal(reads, 0);
  authorized = true;
  const result = await find("research lighthouse");
  assert.equal(result.sourceManifestDigest, digest);
  assert.deepEqual(result.matches[0].location, {
    provider: "google_drive_mount", address, accessible: "unverified",
    breadcrumbs: ["G:", "My Drive", "Research", "Portrait.png"]
  });
  assert.equal((await find("unmatched")).status, "empty");
  assert.equal(reads, 1);
  const row = ["snail-1", "Portrait", null, null, null];
  await assert.rejects(decodeSnailMini(artifact([row, row])), /Invalid Snail Mini record/);
});

test("private Drive transport checks folder, privacy, OAuth, bytes and hash before decoding", async () => {
  const { createSnailDriveReader } = await import("./snail-mini.mjs");
  const { createHash } = await import("node:crypto");
  const blob = artifact([["snail-1", "Portrait", null, null, ["Research"]]]);
  const bytes = Buffer.from(await blob.arrayBuffer());
  const spec = { id: "fixture", name: "snail-mini-v1.json.gz", bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex") };
  let session = "fixture-oauth";
  let failure;
  let mediaReads = 0;
  const get = createSnailDriveReader("private-folder", () => session, async (url, opts) => {
    assert.equal(new URL(url).origin, "https://www.googleapis.com");
    assert.equal(new URL(url).pathname, "/drive/v3/files/fixture");
    assert.equal(opts.headers.Authorization, "Bearer fixture-oauth");
    if (failure === "auth") return new Response(null, { status: 403 });
    if (url.endsWith("?alt=media")) {
      mediaReads++;
      return new Response(failure === "checksum" ? new Uint8Array(bytes.length) : bytes);
    }
    return Response.json({ id: "fixture", name: spec.name, parents: ["private-folder"],
      shared: failure === "public", trashed: false, size: String(bytes.length) });
  }, spec);
  assert.equal((await decodeSnailMini(await get())).rows.length, 1);
  failure = "checksum";
  await assert.rejects(get(), /checksum failed/);
  failure = "public";
  await assert.rejects(get(), /private catalog/);
  failure = "auth";
  await assert.rejects(get(), /Reauthorize/);
  session = null;
  await assert.rejects(get(), /Authorize Google Drive/);
  assert.equal(mediaReads, 2);
});
