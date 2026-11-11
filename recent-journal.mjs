import { createDriveClient } from "./memory.mjs";

export const recentTurns = 3;
const day = 24 * 60 * 60 * 1000;
const marker = "recent-v1";
const uuid = value => typeof value === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const timestamp = value => typeof value === "string" && /^\d{4}-\d\d-\d\dT/.test(value) && Number.isFinite(Date.parse(value));
const property = (key, value) => `appProperties has { key='${key}' and value='${value}' }`;
const durable = value => value === "candidate" || value === "provisional";

export function dispositionFor(message, choice) {
  const normalized = message.replace(/[’‘]/g, "'");
  if (choice === "exclude" ||
      /\b(?:do\s*not|don't|never|please\s+avoid)\s+(?:ever\s+)?(?:remember|keep|retain|save|store|record|log|journal)\b|\b(?:off the record|forget (?:this|that))\b/i.test(normalized)) {
    return "excluded";
  }
  if (durable(choice)) return choice;
  if (choice === "auto" && /^\s*(?:please\s+)?remember\s+this(?:\s*[:,.—-]|\s*$)/i.test(normalized)) return "candidate";
  return "ephemeral";
}

function validMessage(message, role, source) {
  return message?.role === role && message.source === source &&
    typeof message.text === "string" && Boolean(message.text.trim()) && message.text.length <= 4000;
}

function validateEvent(event) {
  const turns = event?.turns;
  if (event?.schema_version !== 1 || event.source !== "aida-chat" || !uuid(event.conversationId) ||
      !uuid(event.eventId) || !durable(event.disposition) || !timestamp(event.savedAt) ||
      (event.disposition === "provisional"
        ? event.expiresAt !== new Date(Date.parse(event.savedAt) + day).toISOString()
        : event.expiresAt !== null) ||
      !Array.isArray(turns) || turns.length < 1 || turns.length > 2 || turns.at(-1)?.turnId !== event.eventId) {
    throw new Error("A Drive journal entry has invalid metadata.");
  }
  const ids = new Set();
  for (const turn of turns) {
    if (!uuid(turn?.turnId) || ids.has(turn.turnId) || !Number.isSafeInteger(turn.order) || !timestamp(turn.startedAt) ||
        !timestamp(turn.completedAt) || turn.conversationId !== event.conversationId ||
        !validMessage(turn.user, "user", `turn:${turn.turnId}:user`) ||
        !validMessage(turn.aida, "aida", `turn:${turn.turnId}:aida`) ||
        dispositionFor(turn.user.text, "auto") === "excluded") {
      throw new Error("A Drive journal turn has invalid source evidence.");
    }
    ids.add(turn.turnId);
  }
  return event;
}

export function makeJournalEvent(conversationId, turn, disposition, supportingTurn, now = Date.now()) {
  return validateEvent({
    schema_version: 1, source: "aida-chat", conversationId, eventId: turn.turnId,
    disposition, savedAt: new Date(now).toISOString(),
    expiresAt: disposition === "provisional" ? new Date(now + day).toISOString() : null,
    turns: supportingTurn ? [supportingTurn, turn] : [turn]
  });
}

export function availableSupport(preceding, disposition, now = Date.now()) {
  if (!preceding || !durable(disposition)) return undefined;
  if (preceding.disposition === "ephemeral" ||
      (disposition === "candidate" && preceding.disposition === "provisional" && Date.parse(preceding.expiresAt) > now)) {
    return preceding.turn;
  }
}

export function collectRecent(entries) {
  const unique = new Map();
  for (const { event } of entries) {
    for (const turn of event.turns) {
      const existing = unique.get(turn.turnId);
      if (existing && JSON.stringify(existing) !== JSON.stringify(turn)) throw new Error("Conflicting evidence for a journal turn.");
      unique.set(turn.turnId, turn);
    }
  }
  return [...unique.values()].sort((a, b) =>
    a.order - b.order || a.turnId.localeCompare(b.turnId)
  ).slice(-recentTurns);
}

export function createJournal(folderId, token, fetchRequest = fetch, now = Date.now) {
  const drive = createDriveClient(folderId, token, fetchRequest);
  const base = `'${folderId}' in parents and trashed = false and mimeType = 'application/json' and ${property("aidaMemory", marker)}`;

  async function list(filter, pageSize, cursor) {
    const query = new URLSearchParams({
      q: `${base} and ${filter}`, pageSize: String(pageSize),
      orderBy: "createdTime desc,name desc",
      fields: "files(id,appProperties),incompleteSearch,nextPageToken"
    });
    if (cursor) query.set("pageToken", cursor);
    const page = await drive.list(query);
    if (page?.incompleteSearch || !Array.isArray(page?.files)) throw new Error("Drive returned an incomplete journal search.");
    return page;
  }

  async function read(file) {
    const event = validateEvent(await drive.readJson(file.id));
    const props = file.appProperties;
    if (props?.aidaMemory !== marker || props.event !== event.eventId || props.conversation !== event.conversationId ||
        props.disposition !== event.disposition) throw new Error("Drive journal metadata does not match its contents.");
    return { fileId: file.id, event };
  }

  function eligibleFilter() {
    const cutoff = new Date(now() - day).toISOString();
    return `(${property("disposition", "candidate")} or (${property("disposition", "provisional")} and createdTime > '${cutoff}'))`;
  }

  async function page(conversationId, cursor, pageSize = 10) {
    if (!uuid(conversationId)) throw new Error("Enter a valid conversation ID.");
    const result = await list(`${eligibleFilter()} and ${property("conversation", conversationId)}`, pageSize, cursor);
    const entries = await Promise.all(result.files.map(read));
    if (entries.some(({ event }) => event.conversationId !== conversationId)) throw new Error("Drive returned another conversation.");
    return { entries: entries.filter(({ event }) => !event.expiresAt || Date.parse(event.expiresAt) > now()), next: result.nextPageToken };
  }

  return {
    page,
    async recover(conversationId) {
      let id = conversationId;
      if (!id) {
        const latest = await list(eligibleFilter(), recentTurns);
        for (const file of latest.files) {
          const { event } = await read(file);
          if (!event.expiresAt || Date.parse(event.expiresAt) > now()) {
            id = event.conversationId;
            break;
          }
        }
      }
      if (!id) return { id: crypto.randomUUID(), turns: [], entries: [] };
      const { entries } = await page(id, undefined, recentTurns);
      return { id, turns: collectRecent(entries), entries };
    },
    async save(pending) {
      const event = validateEvent(pending.event);
      if (event.expiresAt && Date.parse(event.expiresAt) <= now()) throw new Error("The provisional journal entry expired.");
      // Preserve the reserved ID across retries, including a lost upload response.
      pending.fileId ??= await drive.generateId();
      const props = { aidaMemory: marker, conversation: event.conversationId, event: event.eventId, disposition: event.disposition };
      await drive.uploadJson(pending.fileId, `aida-recent-${event.eventId}.json`, props, event);
      const stored = await read({ id: pending.fileId, appProperties: props });
      if (JSON.stringify(stored.event) !== JSON.stringify(event)) throw new Error("Drive journal readback did not match the saved exchange.");
      return stored;
    },
    async trashExpired() {
      const cutoff = new Date(now() - day).toISOString();
      const result = await list(`${property("disposition", "provisional")} and createdTime <= '${cutoff}'`, 10);
      for (const file of result.files) {
        const { event } = await read(file);
        if (Date.parse(event.expiresAt) <= now()) await drive.trash(file.id);
      }
    }
  };
}
