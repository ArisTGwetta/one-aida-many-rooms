import assert from "node:assert/strict";
import test from "node:test";
import { createSkillRegistry, skillDescriptor } from "./skill-registry.mjs";

const request = (id, version, input) => ({ id, version, input });
function binding(id, version, run) {
  return {
    descriptor: skillDescriptor(id, version, "read", id, []),
    validate: input => typeof input.value === "number",
    authorize: (_input, context) => context.allowed.includes(id),
    run,
    validateResult: result => Number.isFinite(result?.value)
  };
}

test("versions coexist and a bounded workflow composes skills through the same checks", async () => {
  const compose = binding("workflow", 1, async (input, _context, { call }) => {
    const first = await call(request("double", 1, input));
    return call(request("increment", 1, first));
  });
  const doubleV2 = binding("double", 2, ({ value }) => ({ value: value * 3 }));
  const increment = binding("increment", 1, ({ value }) => ({ value: value + 1 }));
  const registry = factor => createSkillRegistry([
    compose, binding("double", 1, ({ value }) => ({ value: value * factor })), doubleV2, increment
  ]);
  const context = { allowed: ["workflow", "double", "increment"] };
  const input = { value: 3 };
  const first = registry(2);
  assert.deepEqual(first.descriptors().filter(item => item.id === "double").map(item => item.version), [1, 2]);
  assert.deepEqual(await first.dispatch(request("workflow", 1, input), context, "read"), { value: 7 });
  assert.deepEqual(await registry(4).dispatch(request("workflow", 1, input), context, "read"), { value: 13 });
  assert.deepEqual(await first.dispatch(request("double", 2, input), context, "read"), { value: 9 });
  assert.deepEqual(await first.dispatch(request("increment", 1, input), context, "read"), { value: 4 });
  await assert.rejects(first.dispatch(request("double", 3, input), context, "read"), /unavailable/);
  await assert.rejects(first.dispatch(request("workflow", 1, input), { allowed: ["workflow", "double"] }, "read"), /unauthorized/);
  await assert.rejects(first.dispatch(request("workflow", 1, input), context, "read", { remaining: 2 }), /unavailable/);
  await assert.rejects(first.dispatch(request("double", 1, {}), context, "read"), /Invalid/);
  const invalid = createSkillRegistry([binding("broken", 1, () => ({ text: "wrong shape" }))]);
  await assert.rejects(invalid.dispatch(request("broken", 1, input), { allowed: ["broken"] }, "read"), /Invalid skill result/);
});
