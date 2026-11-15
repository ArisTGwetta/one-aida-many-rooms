import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createLibraryState, rememberSearchBinding } from "./mind-palace.mjs";
import { createSkillRegistry } from "./skill-registry.mjs";

test("Remember search dispatches a scoped read, returns recorded provenance, and fails closed", async () => {
  let allowed = true;
  let reads = 0;
  const store = {
    async recall() {
      reads++;
      return { fileId: "fixture-drive", record: { id: "fixture", text: "Meet at the café." } };
    }
  };
  const registry = createSkillRegistry([rememberSearchBinding(store, () => allowed)]);
  const request = query => ({ id: "search_remember", version: 1, input: { query } });
  assert.deepEqual(await registry.dispatch(request("MEET café"), {}, "read"), { matches: [{
    id: "fixture", reference: "drive:fixture-drive", title: "Saved Aida memory", excerpt: "Meet at the café."
  }] });
  assert.deepEqual(await registry.dispatch(request("unknown"), {}, "read"), { matches: [] });
  await assert.rejects(registry.dispatch(request("   "), {}, "read"), /Invalid/);
  allowed = false;
  await assert.rejects(registry.dispatch(request("café"), {}, "read"), /unauthorized/);
  await assert.rejects(registry.dispatch({ id: "snail", version: 1, input: {} }, {}, "read"), /unavailable/);
  assert.equal(reads, 2);
});

test("the desk has one composer and only the supported source is selectable", async () => {
  const page = await readFile(new URL("./index.html", import.meta.url), "utf8");
  assert.equal([...page.matchAll(/id="chat-form"/g)].length, 1);
  assert.equal([...page.matchAll(/id="message"/g)].length, 1);
  const options = page.match(/<select id="palace-source">([\s\S]+?)<\/select>/u)[1];
  assert.deepEqual([...options.matchAll(/<option([^>]*)>/g)].map(match => match[1].includes("disabled")),
    [true, false, true, true, true]);
});

test("sleep review separates pending and reviewed cards and Done only closes the panel", async () => {
  const { setupSleepPanel } = await import("./sleep-panel.mjs");
  function node() {
    return {
      children: [], handlers: {},
      append(...children) { this.children.push(...children); for (const child of children) child.parentNode = this; },
      replaceChildren() { this.children = []; },
      addEventListener(name, action) { this.handlers[name] = action; },
      querySelector() { return { focus() {} }; }
    };
  }
  const nodes = new Map();
  const get = id => { if (!nodes.has(id)) nodes.set(id, node()); return nodes.get(id); };
  const original = globalThis.document;
  globalThis.document = { getElementById: get, createElement: node };
  try {
    let writes = 0;
    const proposals = ["pending", "reviewed"].map(id => ({
      id, category: "FACT", text: id + " text", reason: "Fixture reason", sources: ["turn:fixture"]
    }));
    setupSleepPanel({
      journal: {}, provider() {}, run: (_label, action) => action(),
      store: {
        async queue() { return { runs: [{ createdAt: "fixture", proposals }] }; },
        async reviewPage(id) { return { decisions: id === "reviewed" ? [{ status: "accepted" }] : [] }; },
        async effectiveVersion(proposal) { return { text: proposal.text }; },
        async review() { writes++; }
      }
    });
    await get("sleep-queue").handlers.click();
    assert.equal(get("sleep-pending").children[0].children[1].textContent, "pending text");
    assert.equal(get("sleep-reviewed").children[0].children[1].textContent, "reviewed text");
    assert.match(get("sleep-pending").children[0].children[2].textContent, /Fixture reason/);
    get("sleep-panel").open = true;
    get("sleep-done").handlers.click();
    assert.equal(get("sleep-panel").open, false);
    assert.equal(get("sleep-pending").children.length, 1);
    assert.equal(writes, 0);
  } finally {
    if (original === undefined) delete globalThis.document;
    else globalThis.document = original;
  }
});

test("welcome controls and the Library workspace reuse the shared application entry points", async () => {
  const page = await readFile(new URL("./index.html", import.meta.url), "utf8");
  const view = await readFile(new URL("./mobile-view.mjs", import.meta.url), "utf8");
  const app = await readFile(new URL("./app.mjs", import.meta.url), "utf8");
  const css = await readFile(new URL("./mobile-view.css", import.meta.url), "utf8");
  assert.equal([...page.matchAll(/id="transcript"/g)].length, 1);
  assert.equal([...page.matchAll(/id="message"/g)].length, 1);
  assert.match(page, /id="welcome-code" type="password"/);
  assert.match(view, /byId\("welcome-drive"\).*byId\("connect"\)\.click\(\)/);
  assert.equal([...app.matchAll(/await loadOpenAIKey\(/g)].length, 1);
  assert.equal([...app.matchAll(/await unlockProvider\(code\)/g)].length, 2);
  assert.match(view, /if \(!ready\)[\s\S]+entrance\.classList\.add\("arriving"\)/);
  assert.match(css, /\.workspace-room #mind-palace \{ grid-row: 4;/);
  assert.match(css, /prefers-reduced-motion: reduce[\s\S]+animation: none/);
});

test("Library proposal leaves edits and results alone until explicitly applied", () => {
  const desk = createLibraryState();
  desk.state.query = "first memory";
  assert.deepEqual(desk.begin(), { query: "first memory", source: "remember" });
  desk.complete([{ id: "first", title: "Memory", reference: "drive:first", excerpt: "private fixture" }]);
  desk.select("drive:unknown");
  assert.equal(desk.state.selected, null);
  desk.select("drive:first");
  desk.propose("Aida's suggestion");
  desk.state.query = "typed while waiting";
  assert.equal(desk.state.query, "typed while waiting");
  desk.dismiss();
  assert.equal(desk.state.query, "typed while waiting");
  desk.propose(" another suggestion ");
  desk.state.proposal.query = "  edited suggestion  ";
  assert.equal(desk.accept(), true);
  assert.equal(desk.state.query, "edited suggestion");
  assert.equal(desk.snapshot().searched.query, "first memory");
  assert.equal(desk.snapshot().selected, "drive:first");
  assert.equal(desk.snapshot().results[0].excerpt, undefined);
  desk.begin();
  desk.fail("fixture error");
  assert.equal(desk.state.selected, null);
  assert.deepEqual(desk.state.matches, []);
  assert.equal(desk.state.status, "failed");
});

test("Aida suggests through one provider call with neither skill execution nor memory access", async () => {
  const { createConversationSession } = await import("./conversation.mjs");
  const { createProviders, openAIModel } = await import("./providers.mjs");
  let calls = 0;
  const invoke = createProviders({ apiKey: "fixture", async fetchRequest(_url, options) {
    calls++;
    const body = JSON.parse(options.body);
    const input = JSON.parse(body.input);
    assert.equal(input.identity.name, "Aida");
    assert.equal(input.workspace.query, "draft");
    assert.equal(body.max_output_tokens, 160);
    assert.deepEqual(body.text.format.schema.required, ["query"]);
    const reply = calls === 1 ? { query: " first memory " } : { skillRequest: { id: "search_remember" } };
    return Response.json({ status: "completed", output: [{ type: "message", content: [
      { type: "output_text", text: JSON.stringify(reply) }
    ] }] });
  } });
  const never = () => assert.fail("A suggestion must not access memory or the dispatcher.");
  const session = createConversationSession({
    memoryStore: { recall: never }, loadCanonicalFacts: never, steward: { assemble: never, apply: never, resolveSkill: never },
    async provider(input) { return (await invoke({ ...input, provider: "openai", model: openAIModel })).raw; }
  });
  assert.equal(await session.suggestLibrarySearch({ query: "draft", source: "remember" }), "first memory");
  assert.equal(calls, 1);
  assert.equal(session.recentTurnCount, 0);
  await assert.rejects(session.suggestLibrarySearch({ query: "draft" }), /invalid Library suggestion/);
  assert.equal(session.recentTurnCount, 0);
});
