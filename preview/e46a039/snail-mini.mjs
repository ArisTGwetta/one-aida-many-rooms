import { skillDescriptor } from "./skill-registry.mjs";

const maxCompressed = 2 * 1024 * 1024;
const maxDecoded = 26 * 1024 * 1024;
const normalize = value => value.normalize("NFKC").toLowerCase();

export async function decodeSnailMini(blob) {
  if (!blob?.size || blob.size > maxCompressed || typeof DecompressionStream !== "function") {
    throw new Error("Snail Mini cannot read this compressed catalog.");
  }
  const reader = blob.stream().pipeThrough(new DecompressionStream("gzip")).getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxDecoded) throw new Error("Snail Mini exceeds the decoded size limit.");
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const catalog = JSON.parse(chunks.join(""));
  if (catalog?.version !== 1 || !/^[a-f0-9]{64}$/.test(catalog.sourceManifestDigest) ||
      !Array.isArray(catalog.rows) || catalog.rows.length > 100000) throw new Error("Invalid Snail Mini schema.");
  const ids = new Set();
  for (const row of catalog.rows) {
    if (!Array.isArray(row) || row.length !== 5) throw new Error("Invalid Snail Mini row.");
    const [id, title, type, location, aliases] = row;
    if (!/^snail-\d+$/.test(id) || ids.has(id) || typeof title !== "string" || title.length > 1024 ||
        (type !== null && typeof type !== "string") ||
        (location !== null && (!Array.isArray(location) || location.length !== 2 ||
          typeof location[0] !== "string" || typeof location[1] !== "string" || location[1].length > 4096)) ||
        (aliases !== null && (!Array.isArray(aliases) || aliases.length > 128 ||
          aliases.some(alias => typeof alias !== "string" || alias.length > 1024)))) {
      throw new Error("Invalid Snail Mini record.");
    }
    ids.add(id);
  }
  return catalog;
}

export function searchSnailMini(catalog, query) {
  const terms = normalize(query).trim().split(/\s+/u);
  const matches = [];
  let count = 0;
  for (const [id, title, type, location, aliases] of catalog.rows) {
    const searchable = normalize([title, ...(aliases ?? []), location?.[1] ?? ""].join(" "));
    if (!terms.every(term => searchable.includes(term))) continue;
    count++;
    if (matches.length < 25) matches.push({ id, title, type,
      location: location ? { provider: location[0], address: location[1], accessible: "unverified",
        breadcrumbs: location[1].split(/[\\/]+/u).filter(Boolean) } : null });
  }
  return { status: count ? "found" : "empty", count, matches, sourceManifestDigest: catalog.sourceManifestDigest };
}

// The caller supplies an authorized private getter only after the live gates pass.
export function snailMiniBinding({ getCatalog, authorized, cacheKey }) {
  let pending;
  let sessionKey;
  return {
    descriptor: { ...skillDescriptor("search_snail_mini", 1, "read", "Search Snail Mini recorded document locations.",
      [{ name: "query", description: "Title, alias, or recorded path terms.", required: true }]), libraryOnly: true },
    validate: input => Object.keys(input ?? {}).length === 1 && typeof input.query === "string" &&
      Boolean(input.query.trim()) && input.query.length <= 180,
    authorize: authorized,
    async run({ query }) {
      const key = cacheKey?.();
      if (key !== sessionKey) { pending = undefined; sessionKey = key; }
      pending ??= Promise.resolve().then(getCatalog).then(decodeSnailMini).catch(error => {
        pending = undefined;
        throw error;
      });
      return searchSnailMini(await pending, query);
    },
    validateResult: result => ["found", "empty"].includes(result?.status) &&
      Array.isArray(result.matches) && result.matches.length <= 25 && /^[a-f0-9]{64}$/.test(result.sourceManifestDigest)
  };
}

const privateArtifact = Object.freeze({
  id: "1t0U1c1oXLjNxbXnmPN5txL2SVJ6PXrZC", name: "snail-mini-v1.json.gz", bytes: 1069921,
  sha256: "e4eea62ff6e1500fe14df0c723882fb3b465750718b22267566f3f86c1b1850c"
});

export function createSnailDriveReader(folderId, token, fetchRequest = fetch, artifact = privateArtifact) {
  return async () => {
    const access = token();
    if (!access) throw new Error("Authorize Google Drive and retry the Snail search.");
    const url = "https://www.googleapis.com/drive/v3/files/" + encodeURIComponent(artifact.id);
    async function get(query) {
      let response;
      try {
        response = await fetchRequest(url + query, { headers: { Authorization: "Bearer " + access },
          signal: AbortSignal.timeout(20000), cache: "no-store", redirect: "error" });
      } catch {
        throw new Error("Snail could not reach Google Drive. Retry Search.");
      }
      if (!response.ok) {
        throw Object.assign(new Error(response.status === 401 || response.status === 403
          ? "Drive authorization could not read Snail Mini. Reauthorize Drive and retry."
          : "Snail Mini is unavailable in Google Drive. Retry Search."), { status: response.status });
      }
      return response;
    }
    const metadata = await (await get("?fields=id,name,parents,shared,trashed,size")).json();
    if (metadata.id !== artifact.id || metadata.name !== artifact.name || !metadata.parents?.includes(folderId) ||
        metadata.shared !== false || metadata.trashed !== false || Number(metadata.size) !== artifact.bytes) {
      throw new Error("Snail Mini could not verify the approved private catalog.");
    }
    const response = await get("?alt=media");
    if (!response.body) throw new Error("Google Drive returned no Snail catalog bytes.");
    const reader = response.body.getReader();
    const bytes = new Uint8Array(artifact.bytes);
    let offset = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (offset + value.byteLength > bytes.length) throw new Error("Snail catalog exceeds its approved length.");
        bytes.set(value, offset);
        offset += value.byteLength;
      }
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    if (!globalThis.crypto?.subtle) throw new Error("This browser cannot verify the Snail catalog checksum.");
    const sha = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
      byte => byte.toString(16).padStart(2, "0")).join("");
    if (offset !== bytes.length || sha !== artifact.sha256) throw new Error("Snail catalog checksum failed. No results were loaded.");
    return new Blob([bytes], { type: "application/gzip" });
  };
}
