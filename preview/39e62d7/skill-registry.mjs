export function createSkillRegistry(bindings) {
  const entries = new Map();
  for (const binding of bindings) {
    const key = binding.descriptor.id + "@" + binding.descriptor.version;
    if (entries.has(key)) throw new Error("Duplicate skill binding.");
    entries.set(key, binding);
  }
  return {
    catalog(existing) {
      const registered = this.descriptors();
      return [...existing.filter(entry => !registered.some(skill => skill.id === entry.id) || entry.availability === "unavailable"),
        ...registered.filter(skill => !existing.some(entry => entry.id === skill.id && entry.availability === "unavailable"))];
    },
    available(existing, context) {
      return this.catalog(existing).filter(descriptor =>
        entries.get(descriptor.id + "@" + descriptor.version)?.available?.(context) !== false);
    },
    plan(context, phase) {
      const plans = [...entries.values()].filter(binding => binding.descriptor.phase === phase)
        .map(binding => {
          const { id, version } = binding.descriptor;
          const advertised = context.context.capabilities.some(skill =>
            skill.id === id && skill.version === version && skill.phase === phase);
          const input = advertised ? binding.plan?.(context) : null;
          return input ? { id, version, input } : null;
        }).filter(Boolean);
      if (plans.length > 1) throw new Error("Please clarify which capability to use.");
      return plans[0];
    },
    action(context) {
      for (const binding of entries.values()) {
        const outcome = binding.action?.(context);
        if (outcome) return outcome;
      }
    },
    integrate(request, result, context, steward) {
      const binding = entries.get(request.id + "@" + request.version);
      return binding.integrate ? binding.integrate(result, context, steward) : { ...context, skillResult: result };
    },
    descriptors: () => [...entries.values()].map(binding => structuredClone(binding.descriptor)),
    async dispatch(request, context, phase, budget = { remaining: 3 }) {
      const binding = entries.get(request.id + "@" + request.version);
      if (!binding || binding.descriptor.phase !== phase || !budget.remaining) throw new Error("Skill unavailable for this request.");
      if (!binding.validate(request.input) || !await binding.authorize(request.input, context)) throw new Error("Invalid or unauthorized skill request.");
      budget.remaining--;
      const result = await binding.run(request.input, context, {
        call: next => this.dispatch(next, context, phase, budget)
      });
      if (!binding.validateResult(result)) throw new Error("Invalid skill result.");
      return result;
    }
  };
}

export function skillDescriptor(id, version, phase, purpose, arguments_) {
  return { id, version, phase, purpose, arguments: arguments_, availability: "available", route: id,
    authorization: phase === "read" ? "read-only" : "confirmation" };
}
