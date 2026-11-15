import { skillDescriptor } from "./skill-registry.mjs";

const queryArg = { name: "query", description: "Search terms for the explicitly saved Drive memory.", required: true };
export function rememberSearchBinding(store, authorized) {
  return {
    descriptor: skillDescriptor("search_remember", 1, "read", "Search the explicitly saved Drive memory.", [queryArg]),
    validate: input => typeof input?.query === "string" && Boolean(input.query.trim()) &&
      input.query.length <= 180 && Object.keys(input).length === 1,
    authorize: authorized,
    async run({ query }) {
      const saved = await store.recall();
      const normalized = value => value.normalize("NFKC").toLowerCase();
      const terms = normalized(query).trim().split(/\s+/u);
      const text = saved ? normalized(saved.record.text) : "";
      if (!saved || !terms.every(term => text.includes(term))) return { matches: [] };
      return { matches: [{
        id: saved.record.id,
        reference: "drive:" + saved.fileId,
        title: "Saved Aida memory",
        excerpt: saved.record.text
      }] };
    },
    validateResult: result => Array.isArray(result?.matches) && result.matches.length <= 1 &&
      result.matches.every(match => /^drive:[\w-]+$/.test(match.reference) &&
        typeof match.id === "string" && typeof match.excerpt === "string")
  };
}

export function setupMindPalace({ token, run, contextSource, registry }) {
  const id = name => document.getElementById(name);
  const status = id("palace-status");
  const evidence = id("palace-evidence");
  const results = id("palace-results");
  const registered = registry.descriptors().find(skill => skill.id === "search_remember");
  id("palace-search").addEventListener("submit", event => {
    event.preventDefault();
    if (!token() || id("palace-find").disabled || id("palace-source").value !== "remember") return;
    const request = { id: registered.id, version: registered.version, input: { query: id("palace-query").value.trim() } };
    results.replaceChildren();
    evidence.textContent = "";
    run("Reading saved memory…", async () => {
      try {
        const context = await contextSource.load();
        if (!registry.catalog(context.capabilities).some(skill =>
          skill.id === request.id && skill.version === request.version && skill.availability === "available")) {
          throw new Error("This capability is unavailable.");
        }
        const { matches } = await registry.dispatch(request, {}, "read");
        for (const item of matches) {
          const card = document.createElement("article");
          card.className = "sleep-card";
          const title = document.createElement("h3");
          title.textContent = item.title;
          const excerpt = document.createElement("p");
          excerpt.textContent = item.excerpt;
          const source = document.createElement("p");
          source.textContent = item.reference;
          const ask = document.createElement("button");
          ask.type = "button";
          ask.textContent = "Ask Aida about this";
          ask.addEventListener("click", () => {
            const message = id("message");
            const prompt = "Can we discuss the saved memory referenced by " + item.reference + "?";
            const draft = message.value ? message.value + "\n\n" + prompt : prompt;
            if (draft.length > message.maxLength) {
              status.textContent = "There is no room in the draft for this reference.";
              return;
            }
            message.value = draft;
            message.focus();
          });
          const bring = document.createElement("button");
          bring.type = "button";
          bring.textContent = "Bring this one";
          const address = document.createElement("p");
          address.hidden = true;
          bring.addEventListener("click", () => { address.textContent = item.reference; address.hidden = false; });
          card.append(title, excerpt, source, ask, bring, address);
          results.append(card);
        }
        evidence.textContent = JSON.stringify({ id: request.id, version: request.version,
          outcome: "completed", references: matches.map(item => item.reference) }, null, 2);
        return matches.length ? "Found in the saved Drive memory." : "No match in the saved Drive memory.";
      } catch (error) {
        evidence.textContent = JSON.stringify({ id: request.id, version: request.version, outcome: "failed" }, null, 2);
        throw error;
      }
    }, status);
  });
  return {
    refresh(running) { id("palace-find").disabled = running || !token(); },
    clear() { results.replaceChildren(); evidence.textContent = ""; status.textContent = "Search the saved Drive memory."; }
  };
}
