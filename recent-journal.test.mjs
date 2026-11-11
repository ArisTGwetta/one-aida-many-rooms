import assert from "node:assert/strict";
import test from "node:test";
import { createConversationSession } from "./conversation.mjs";
import { availableSupport, createJournal, dispositionFor, makeJournalEvent } from "./recent-journal.mjs";

const start = Date.parse("2026-11-11T14:00:00.000Z");
const folder = "aida-dev";
const iso = ms => new Date(ms).toISOString();

function fakeDrive() {
  const files = new Map();
  let reserved = 0;
  let time = start;
  let failure;
  const uploads = [];
  const pages = [];
  async function fetchRequest(input, options) {
    const url = new URL(input);
    assert.equal(url.origin, "https://www.googleapis.com");
    assert.equal(options.cache, "no-store");
    if (url.pathname.endsWith("/generateIds")) return Response.json({ ids: [`file-${++reserved}`] });
    if (url.pathname === "/upload/drive/v3/files") {
      const boundary = options.headers["Content-Type"].split("boundary=")[1];
      const parts = options.body.split("--" + boundary);
      const [meta, body] = parts.slice(1, 3).map(part => JSON.parse(part.split("\r\n\r\n")[1]));
      uploads.push(meta.id);
      assert.deepEqual(meta.parents, [folder]);
      assert.equal(meta.appProperties.aidaMemory, "recent-v1");
      if (failure === "before") {
        failure = undefined;
        return new Response(null, { status: 503 });
      }
      if (files.has(meta.id)) return new Response(null, { status: 409 });
      files.set(meta.id, { ...meta, body, createdTime: iso(time), trashed: false });
      if (failure === "after") {
        failure = undefined;
        throw new Error("connection interrupted after upload");
      }
      return Response.json({ id: meta.id });
    }
    if (url.pathname === "/drive/v3/files") {
      const q = url.searchParams.get("q");
      assert.match(q, /^'aida-dev' in parents and trashed = false/);
      assert.match(q, /key='aidaMemory' and value='recent-v1'/);
      const conversation = q.match(/key='conversation' and value='([^']+)'/)?.[1];
      const cutoff = q.match(/createdTime (?:>|<=) '([^']+)'/)?.[1];
      const expiryScan = q.includes("createdTime <=");
      const size = Number(url.searchParams.get("pageSize"));
      pages.push(size);
      const offset = Number(url.searchParams.get("pageToken") || 0);
      const matches = [...files.values()].filter(file => !file.trashed &&
        (!conversation || conversation === file.appProperties.conversation) &&
        (expiryScan ? file.appProperties.disposition === "provisional" && file.createdTime <= cutoff
          : file.appProperties.disposition === "candidate" || file.createdTime > cutoff)
      ).reverse().sort((a, b) => b.createdTime.localeCompare(a.createdTime));
      return Response.json({
        files: matches.slice(offset, offset + size).map(({ id, appProperties }) => ({ id, appProperties })),
        nextPageToken: matches.length > offset + size ? String(offset + size) : undefined
      });
    }
    const file = files.get(url.pathname.split("/").at(-1));
    if (!file) return new Response(null, { status: 404 });
    if (options.method === "PATCH") {
      assert.equal(file.appProperties.disposition, "provisional");
      file.trashed = JSON.parse(options.body).trashed;
      return Response.json({ id: file.id, trashed: file.trashed });
    }
    assert.equal(url.searchParams.get("alt"), "media");
    return Response.json(file.body);
  }
  return {
    open: () => createJournal(folder, () => "fixture-token", fetchRequest, () => time),
    files, uploads, pages, setTime: value => { time = value; }, fail: phase => { failure = phase; }
  };
}

function session(recoveredTurns = []) {
  return createConversationSession({
    recoveredTurns,
    memoryStore: { recall: async () => null },
    provider: async envelope => JSON.stringify({
      version: "0.2", reply: "Understood.", intent: "conversation", route: "reply",
      affect: envelope.affect, candidates: { facts: [], insights: [], short: [], long: [] }, tools: []
    })
  });
}

async function exchange(conversation, id, message, choice = "auto") {
  const disposition = dispositionFor(message, choice);
  const result = await conversation.send(message, { keepInContext: disposition !== "excluded" });
  return { disposition, turn: { ...result.turn, conversationId: id }, envelope: result.envelope };
}

test("meaningful exchange and selected supporting context resume from the same Drive on a fresh client", async () => {
  const drive = fakeDrive();
  const journal = drive.open();
  const { id } = await journal.recover();
  const chat = session();
  const incidental = await exchange(chat, id, "How do you spell rhythm?");
  assert.equal(incidental.disposition, "ephemeral");
  assert.equal(drive.files.size, 0);
  const related = await exchange(chat, id, "This is for the title of the workshop.");
  const decision = await exchange(chat, id, "Remember this: we chose Rhythm Workshop as the title.");
  assert.equal(decision.disposition, "candidate");
  const support = availableSupport(related, decision.disposition, start);
  const stored = await journal.save({ event: makeJournalEvent(id, decision.turn, decision.disposition, support, start) });
  assert.equal(drive.files.size, 1);
  assert.deepEqual(stored.event.turns.map(turn => turn.turnId), [related.turn.turnId, decision.turn.turnId]);
  for (const recoveryId of [undefined, id]) {
    const otherClient = await drive.open().recover(recoveryId);
    assert.equal(otherClient.id, id);
    assert.equal(otherClient.turns.length, 2);
    const { envelope } = await exchange(session(otherClient.turns), id, "What did we decide?");
    assert.deepEqual(new Set(envelope.memory.recent.map(item => item.source)),
      new Set([related.turn.user.source, related.turn.aida.source, decision.turn.user.source, decision.turn.aida.source]));
    assert.equal(envelope.memory.recent.some(item => item.text.includes("spell")), false);
  }
  assert.ok(drive.pages.every(size => size === 3));
});

test("opt-out beats a selected retention policy and is unavailable as support", async () => {
  const drive = fakeDrive();
  const { id } = await drive.open().recover();
  const chat = session();
  const excluded = await exchange(chat, id, "Don't remember this: synthetic private content.", "candidate");
  assert.equal(excluded.disposition, "excluded");
  assert.equal(availableSupport(excluded, "candidate"), undefined);
  const next = await exchange(chat, id, "Hello again");
  assert.equal(next.envelope.memory.recent.length, 0);
  assert.throws(() => makeJournalEvent(id, excluded.turn, "candidate", undefined, start), /source evidence/);
  assert.equal(drive.files.size, 0);
  assert.equal(dispositionFor("Remember this: off the record.", "auto"), "excluded");
});

test("interrupted uploads before or after creation can retry with one immutable Drive file", async () => {
  for (const phase of ["before", "after"]) {
    const drive = fakeDrive();
    const journal = drive.open();
    const { id } = await journal.recover();
    const kept = await exchange(session(), id, "Remember this: the launch moved to Tuesday.");
    const pending = { event: makeJournalEvent(id, kept.turn, kept.disposition, undefined, start) };
    drive.fail(phase);
    await assert.rejects(journal.save(pending));
    const afterInterruption = await drive.open().recover(id);
    assert.equal(afterInterruption.turns.length, phase === "after" ? 1 : 0);
    const stored = await journal.save(pending);
    assert.deepEqual(drive.uploads, [stored.fileId, stored.fileId]);
    assert.equal(drive.files.size, 1);
    assert.equal((await drive.open().recover(id)).turns.length, 1);
  }
});

test("resume and inspection isolate conversations, and expired provisional files are excluded and trashed", async () => {
  const drive = fakeDrive();
  const journal = drive.open();
  const first = crypto.randomUUID();
  const second = crypto.randomUUID();
  const provisional = await exchange(session(), first, "We may plan a workshop.", "provisional");
  const temporary = await journal.save({ event: makeJournalEvent(first, provisional.turn, "provisional", undefined, start) });
  const preceding = { ...provisional, expiresAt: temporary.event.expiresAt };
  assert.equal(availableSupport(preceding, "candidate", start), provisional.turn);
  drive.setTime(start + 1);
  const decision = await exchange(session(), second, "Remember this: the meeting is at noon.");
  await journal.save({ event: makeJournalEvent(second, decision.turn, "candidate", undefined, start + 1) });
  assert.equal((await drive.open().recover()).id, second);
  assert.deepEqual((await journal.page(first)).entries.map(({ event }) => event.conversationId), [first]);
  assert.deepEqual((await journal.recover(first)).turns.map(turn => turn.turnId), [provisional.turn.turnId]);
  drive.setTime(start + 86400000);
  assert.equal(availableSupport(preceding, "candidate", start + 86400000), undefined);
  assert.equal((await journal.recover(first)).turns.length, 0);
  await journal.trashExpired();
  assert.equal(drive.files.get(temporary.fileId).trashed, true);
  assert.equal((await journal.recover(second)).turns.length, 1);
});

test("separate clients append without overwriting and startup loads only the newest three exchanges", async () => {
  const drive = fakeDrive();
  const id = crypto.randomUUID();
  const turns = [];
  for (let i = 0; i < 11; i++) {
    drive.setTime(start + i);
    const saved = await exchange(session(turns.slice(-3)), id, `Remember this: workshop decision ${i}.`);
    turns.push(saved.turn);
    await drive.open().save({ event: makeJournalEvent(id, saved.turn, saved.disposition, undefined, start + i) });
  }
  const device = drive.open();
  assert.deepEqual((await device.recover(id)).turns.map(turn => turn.turnId), turns.slice(-3).map(turn => turn.turnId));
  const firstPage = await device.page(id);
  assert.equal(firstPage.entries.length, 10);
  assert.equal((await device.page(id, firstPage.next)).entries[0].event.eventId, turns[0].turnId);
  assert.equal(drive.files.size, 11);
});
