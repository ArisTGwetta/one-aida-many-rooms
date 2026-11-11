import { createDriveClient } from "./memory.mjs";
import { categories, maxSleepBytes, parseSleepResponse, sleepLimit, sourceEvidence } from "./sleep-contract.mjs";

const marker = "sleep-v1";
const idPattern = /^[a-f0-9]{64}$/;
const reviewStatuses = ["accepted", "corrected", "rejected", "deferred", "superseded"];
const property = (key, value) => `appProperties has { key='${key}' and value='${value}' }`;

function evidenceBatches(evidence) {
  const batches = [];
  let batch = [];
  const encoder = new TextEncoder();
  // Each pair comes from one journal turn. Keep both speakers in the same request.
  for (let index = 0; index < evidence.length; index += 2) {
    const pair = evidence.slice(index, index + 2);
    const candidate = [...batch, ...pair];
    if (encoder.encode(JSON.stringify({ version: "sleep-v0.1", evidence: candidate })).byteLength > maxSleepBytes) {
      batches.push(batch);
      batch = pair;
    } else {
      batch = candidate;
    }
  }
  if (batch.length) batches.push(batch);
  return batches;
}

async function digest(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("");
}

export function createSleepStore(folderId, token, fetchRequest = fetch) {
  const drive = createDriveClient(folderId, token, fetchRequest);
  const pending = new Map();
  const base = `'${folderId}' in parents and trashed = false and mimeType = 'application/json' and ${property("aidaMemory", marker)}`;

  async function list(kind, filter, cursor, pageSize = 5) {
    const q = [base, property("kind", kind), filter].filter(Boolean).join(" and ");
    const query = new URLSearchParams({ q, pageSize: String(pageSize), orderBy: "createdTime desc,name desc",
      fields: "files(id,appProperties),nextPageToken,incompleteSearch" });
    if (cursor) query.set("pageToken", cursor);
    const result = await drive.list(query);
    if (result?.incompleteSearch || !Array.isArray(result?.files)) throw new Error("Drive returned an incomplete sleep queue search.");
    return result;
  }

  async function read(file, kind) {
    const record = await drive.readJson(file.id);
    if (record?.schema_version !== 1 || record.kind !== kind || !idPattern.test(record.id) ||
        file.appProperties?.record !== record.id || file.appProperties?.kind !== kind ||
        file.appProperties?.aidaMemory !== marker ||
        (kind === "run" && (!Array.isArray(record.proposals) || record.proposals.length > sleepLimit ||
          record.proposals.some((proposal, index) => !proposal || !idPattern.test(proposal.id) ||
            file.appProperties[`p${index}`] !== proposal.id) ||
          !Array.isArray(record.examined) || !Array.isArray(record.noUpdates) || !Array.isArray(record.existingProposalIds))) ||
        (kind === "review" && (!reviewStatuses.includes(record.status) || file.appProperties.proposal !== record.proposalId))) {
      throw new Error("A sleep queue record has invalid metadata.");
    }
    return { ...record, fileId: file.id };
  }

  async function find(kind, id) {
    const result = await list(kind, property("record", id), undefined, 1);
    return result.files.length ? read(result.files[0], kind) : null;
  }

  async function save(record, extra) {
    const existing = await find(record.kind, record.id);
    if (existing) {
      pending.delete(record.id);
      return existing;
    }
    let reserved = pending.get(record.id);
    if (!reserved) {
      reserved = { fileId: await drive.generateId(), record, extra };
      pending.set(record.id, reserved);
    }
    const props = { aidaMemory: marker, kind: record.kind, record: record.id, ...reserved.extra };
    await drive.uploadJson(reserved.fileId, `aida-sleep-${record.kind}-${record.id}.json`, props, reserved.record);
    const saved = await read({ id: reserved.fileId, appProperties: props }, record.kind);
    const { fileId, ...content } = saved;
    if (JSON.stringify(content) !== JSON.stringify(reserved.record)) throw new Error("Sleep queue readback did not match the write.");
    pending.delete(record.id);
    return saved;
  }

  const proposalKeys = Array.from({ length: sleepLimit }, (_, index) => `p${index}`);
  async function findProposal(id) {
    if (typeof id !== "string" || !idPattern.test(id)) throw new Error("Invalid proposal ID.");
    const filter = proposalKeys.map(key => property(key, id)).join(" or ");
    const result = await list("run", `(${filter})`, undefined, 1);
    if (!result.files.length) return null;
    const run = await read(result.files[0], "run");
    const proposal = run.proposals.find(item => item.id === id);
    if (!proposal) throw new Error("Proposal index does not match the run.");
    return proposal;
  }

  async function reviewPage(proposalId, cursor, pageSize = 10) {
    if (typeof proposalId !== "string" || !idPattern.test(proposalId)) throw new Error("Invalid proposal ID.");
    const page = await list("review", property("proposal", proposalId), cursor, pageSize);
    const decisions = await Promise.all(page.files.map(file => read(file, "review")));
    if (decisions.some(item => item.proposalId !== proposalId)) throw new Error("Drive returned another proposal's review.");
    return { decisions, next: page.nextPageToken };
  }

  return {
    async findRun(id) { return find("run", id); },
    async saveRun(run) {
      const props = Object.fromEntries(run.proposals.map((item, index) => [proposalKeys[index], item.id]));
      return save(run, props);
    },
    findProposal,
    async queue(cursor) {
      const result = await list("run", undefined, cursor, 3);
      const runs = await Promise.all(result.files.map(file => read(file, "run")));
      return { runs, next: result.nextPageToken };
    },
    reviewPage,
    async review({ proposalId, status, correction = "", previous = null }) {
      correction = correction.trim();
      if (!reviewStatuses.includes(status) ||
          (status === "corrected" ? !correction || correction.length > 4000 : Boolean(correction))) {
        throw new Error("Choose a valid review decision and enter text for corrections.");
      }
      if (!await findProposal(proposalId)) throw new Error("Proposal was not found in Drive.");
      const id = await digest({ proposalId, status, correction, previous });
      const existing = await find("review", id);
      if (existing) return existing;
      const latest = (await reviewPage(proposalId, undefined, 1)).decisions[0];
      if ((latest?.id ?? null) !== previous) throw new Error("The proposal changed. Reload its review before deciding.");
      return save({
        schema_version: 1, kind: "review", id, proposalId, status, correction: correction || null,
        previous, reviewer: "human", authority: "proposal-review-only", createdAt: new Date().toISOString()
      }, { proposal: proposalId });
    }
  };
}

export function createSleepCycle({ journal, store, provider }) {
  let pending;
  return async function run(cursor) {
    if (pending) {
      const run = await store.saveRun(pending.run);
      const next = pending.next;
      pending = undefined;
      return { run, next, reused: true };
    }
    const page = await journal.sleepEvidence(cursor);
    const evidence = sourceEvidence(page.entries);
    const examined = evidence.map(({ source, fileId, turnId, conversationId, disposition, at, incidental, synthetic }) =>
      ({ source, fileId, turnId, conversationId, disposition, at, incidental, synthetic }));
    const id = await digest({ version: "sleep-v0.1", evidence: [...evidence].sort((a, b) => a.source.localeCompare(b.source)) });
    const existing = await store.findRun(id);
    if (existing) return { run: existing, next: page.next, reused: true };

    const proposed = [];
    const providerCalls = [];
    for (const batch of evidenceBatches(evidence.filter(item => !item.incidental))) {
      const receipt = await provider({ version: "sleep-v0.1", evidence: batch });
      proposed.push(...parseSleepResponse(receipt.raw, batch));
      providerCalls.push({ provider: receipt.provider ?? null, model: receipt.model ?? null, usage: receipt.usage ?? null });
    }
    const createdAt = new Date().toISOString();
    const proposals = new Map();
    const existingIds = new Set();
    let omitted = 0;
    for (const item of proposed) {
      const proposalId = await digest({ category: item.category, destination: item.destination, text: item.text, sources: item.sources });
      if (proposals.has(proposalId) || existingIds.has(proposalId)) continue;
      if (await store.findProposal(proposalId)) existingIds.add(proposalId);
      else if (proposals.size < sleepLimit) {
        proposals.set(proposalId, { ...item, id: proposalId, version: 1, status: "pending", createdAt });
      } else {
        omitted++;
      }
    }
    pending = { next: page.next, run: {
      schema_version: 1, kind: "run", id, createdAt, examined,
      proposals: [...proposals.values()], existingProposalIds: [...existingIds],
      noUpdates: categories.filter(category => !proposed.some(item => item.category === category)),
      omitted, providerCalls
    } };
    const run = await store.saveRun(pending.run);
    pending = undefined;
    return { run, next: page.next, reused: false };
  };
}
