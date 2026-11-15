import assert from "node:assert/strict";
import test from "node:test";
import { createSkillRegistry } from "./skill-registry.mjs";
import { uncleChattBinding } from "./uncle-chatt.mjs";
import { createAwakeSteward } from "./awake-context.mjs";

test("Uncle Chatt is a manual draft capability with opt-in context and no model or write", async () => {
  let allowed = false;
  const registry = createSkillRegistry([uncleChattBinding(() => allowed)]);
  const request = { id: "ask_uncle_chatt", version: 1, input: { question: "How can we verify this?" } };
  const recent = [{ role: "user", text: "A private fixture." }, { role: "aida", text: "We tried a dry run." }];
  await assert.rejects(registry.dispatch(request, {}, "manual"), /unauthorized/);
  allowed = true;
  await assert.rejects(registry.dispatch(request, { recent }, "read"), /unavailable/);
  const without = await registry.dispatch(request, {}, "manual");
  assert.ok(!without.brief.includes("private fixture"));
  const withContext = await registry.dispatch(request, { recent }, "manual");
  assert.equal(withContext.status, "draft");
  assert.match(withContext.brief, /Francisco: A private fixture/);
  assert.match(withContext.brief, /What Aida tried\nLatest reply: We tried a dry run/);
  assert.match(withContext.brief, /Uncertainties[\s\S]+Help requested/);

  const empty = { long: [], short: [], recent: [], facts: [], insights: [] };
  const steward = createAwakeSteward({ async load() {
    return { global: empty, projects: [], capabilities: [], references: [] };
  } }, { skills: registry });
  const user = { text: "Could Uncle Chatt help?", source: "turn:fixture:user" };
  const context = await steward.assemble([], user);
  const receipt = await steward.apply({ context, user, memory: { recent: [] } }, {
    action: { kind: "request_capability", target: request.id, arguments: [{ name: "question", value: request.input.question }],
      sources: [user.source], uncertainty: null },
    changes: [], candidates: [], contradictions: [], rebuild: null
  });
  assert.deepEqual(receipt.outcome, { status: "proposed", route: "ask_uncle_chatt" });
  assert.deepEqual(receipt.applied, []);
});
