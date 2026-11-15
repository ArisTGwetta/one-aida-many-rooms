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

export function createLibraryState() {
  const state = { query: "", source: "remember", matches: [], selected: null, status: "idle",
    error: null, searched: null, proposal: null };
  return {
    state,
    setSource(source) {
      if (source === state.source) return;
      Object.assign(state, { source, searched: null, matches: [], selected: null, status: "idle", error: null });
    },
    evidence() {
      const { searched, source, selected, matches, status } = state;
      const current = searched?.source === source;
      return {
        kind: "library_search_result",
        source,
        query: current ? searched.query : null,
        status: current ? status : "idle",
        selectedReference: current ? selected : null,
        ...(current && status === "failed" ? { error: "The Library search did not complete." } : {}),
        results: current && status === "found" ? matches.slice(0, 1).map(({ title, reference, excerpt }) => ({
          title, reference, excerpt: excerpt.slice(0, 4000), truncated: excerpt.length > 4000
        })) : []
      };
    },
    begin() {
      state.searched = { query: state.query.trim(), source: state.source };
      Object.assign(state, { matches: [], selected: null, status: "searching", error: null });
      return state.searched;
    },
    complete(matches) { Object.assign(state, { matches, status: matches.length ? "found" : "empty" }); },
    fail(error) { Object.assign(state, { status: "failed", error }); },
    select(reference) {
      if (state.matches.some(item => item.reference === reference)) state.selected = reference;
    },
    propose(query) { state.proposal = query === null ? null : { query, source: "remember" }; },
    dismiss() { state.proposal = null; },
    accept() {
      const query = state.proposal?.query.trim();
      if (!query || query.length > 180) return false;
      Object.assign(state, { query, source: state.proposal.source, proposal: null });
      return true;
    },
    snapshot() {
      const { query, source, searched, selected, status, matches } = state;
      return { query, source, searched, selected, status,
        results: matches.map(({ id, title, reference }) => ({ id, title, reference })) };
    }
  };
}

export function setupMindPalace({ token, run, contextSource, registry, suggest }) {
  const id = name => document.getElementById(name);
  const status = id("palace-status");
  const evidence = id("palace-evidence");
  const results = id("palace-results");
  const registered = registry.descriptors().find(skill => skill.id === "search_remember");
  const workbench = createLibraryState();
  const query = id("palace-query");
  const sourceSelect = id("palace-source");
  const proposal = id("palace-proposal");
  const proposedQuery = id("palace-proposed-query");
  const suggestButton = id("palace-suggest");
  const sync = () => {
    workbench.state.query = query.value;
    if (workbench.state.source !== sourceSelect.value) {
      workbench.setSource(sourceSelect.value);
      results.replaceChildren();
      evidence.textContent = "";
      status.textContent = "Choose Search to query this source.";
    }
  };
  query.addEventListener("input", sync);
  sourceSelect.addEventListener("change", sync);

  function renderProposal() {
    proposal.hidden = !workbench.state.proposal;
    proposedQuery.value = workbench.state.proposal?.query ?? "";
  }
  proposedQuery.addEventListener("input", () => {
    if (workbench.state.proposal) workbench.state.proposal.query = proposedQuery.value;
  });
  id("palace-dismiss").addEventListener("click", () => {
    workbench.dismiss();
    renderProposal();
    suggestButton.focus();
  });
  id("palace-use").addEventListener("click", () => {
    if (!workbench.accept()) { status.textContent = "Enter search terms before applying the suggestion."; return; }
    query.value = workbench.state.query;
    sourceSelect.value = workbench.state.source;
    renderProposal();
    status.textContent = "Suggestion applied. Review the terms, then select Search.";
    query.focus();
  });
  suggestButton.addEventListener("click", () => {
    if (suggestButton.disabled || !token()) return;
    sync();
    const snapshot = workbench.snapshot();
    run("Asking Aida for search terms…", async () => {
      const suggestion = await suggest(snapshot);
      if (suggestion === null) return "Aida needs more context. Add search terms or discuss what you want in chat.";
      workbench.propose(suggestion);
      renderProposal();
      return "Review Aida’s suggestion before applying it.";
    }, status);
  });

  id("palace-search").addEventListener("submit", event => {
    event.preventDefault();
    if (!token() || id("palace-find").disabled || id("palace-source").value !== "remember") return;
    sync();
    const searched = workbench.begin();
    const request = { id: registered.id, version: registered.version, input: { query: searched.query } };
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
        if (workbench.state.searched !== searched) return "The search source changed. Search again for current results.";
        workbench.complete(matches);
        for (const item of workbench.state.matches) {
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
            workbench.select(item.reference);
            card.dataset.selected = "true";
            message.value = draft;
            message.focus();
          });
          const bring = document.createElement("button");
          bring.type = "button";
          bring.textContent = "Bring this one";
          const address = document.createElement("p");
          address.hidden = true;
          bring.addEventListener("click", () => {
            workbench.select(item.reference);
            card.dataset.selected = "true";
            address.textContent = item.reference;
            address.hidden = false;
          });
          card.append(title, excerpt, source, ask, bring, address);
          results.append(card);
        }
        evidence.textContent = JSON.stringify({ id: request.id, version: request.version,
          outcome: "completed", references: matches.map(item => item.reference) }, null, 2);
        return matches.length ? "Found in the saved Drive memory." : "No match in the saved Drive memory.";
      } catch (error) {
        if (workbench.state.searched === searched) workbench.fail(error.message);
        evidence.textContent = JSON.stringify({ id: request.id, version: request.version, outcome: "failed" }, null, 2);
        throw error;
      }
    }, status);
  });
  return {
    conversationEvidence() {
      return !id("mobile-room").hidden && !id("mind-palace").hidden ? workbench.evidence() : undefined;
    },
    refresh(running, hasSession) {
      id("palace-find").disabled = running || !token();
      suggestButton.disabled = running || !token() || !hasSession;
    },
    clear() {
      Object.assign(workbench.state, createLibraryState().state);
      query.value = "";
      sourceSelect.value = workbench.state.source;
      renderProposal();
      results.replaceChildren();
      evidence.textContent = "";
      status.textContent = "Search the saved Drive memory.";
    }
  };
}
