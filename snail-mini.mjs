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
export function snailMiniBinding({ getCatalog, authorized }) {
  let pending;
  return {
    descriptor: skillDescriptor("search_snail_mini", 1, "read", "Search Snail Mini recorded document locations.",
      [{ name: "query", description: "Title, alias, or recorded path terms.", required: true }]),
    validate: input => Object.keys(input ?? {}).length === 1 && typeof input.query === "string" &&
      Boolean(input.query.trim()) && input.query.length <= 180,
    authorize: authorized,
    async run({ query }) {
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
