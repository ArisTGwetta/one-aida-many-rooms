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
