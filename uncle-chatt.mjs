import { skillDescriptor } from "./skill-registry.mjs";

const take = (value, limit) => typeof value === "string" ? value.trim().slice(0, limit) : "";
export function uncleChattBinding(authorized) {
  return {
    descriptor: {
      ...skillDescriptor("ask_uncle_chatt", 1, "manual", "Prepare a private draft for Francisco to review and copy to ChatGPT.",
        [{ name: "question", description: "The help Francisco is seeking.", required: true }]),
      authorization: "review-only"
    },
    validate: input => Object.keys(input ?? {}).length === 1 && Boolean(take(input.question, 1200)) && input.question.length <= 1200,
    authorize: authorized,
    run({ question }, { recent = [] }) {
      const context = recent.slice(-4).map(item => (item.role === "user" ? "Francisco" : "Aida") +
        ": " + take(item.text, 400)).join("\n");
      const reply = [...recent].reverse().find(item => item.role === "aida");
      return { status: "draft", brief: [
        "Question\n" + take(question, 1200),
        "Relevant context\n" + (context || "[Add the context you want to share.]"),
        "What Aida tried\n" + (reply ? "Latest reply: " + take(reply.text, 400) : "[Add any steps already tried.]"),
        "Uncertainties\n[Add what is still unclear or unverified.]",
        "Help requested\nPlease answer the question and flag assumptions or missing information."
      ].join("\n\n") };
    },
    validateResult: result => result?.status === "draft" && typeof result.brief === "string" && result.brief.length <= 5000
  };
}

export function setupUncleChatt({ registry, contextSource, run, recent }) {
  const id = name => document.getElementById(name);
  const dialog = id("chatt-dialog");
  const button = id("chatt-open");
  const question = id("chatt-question");
  const draft = id("chatt-brief");
  const status = id("chatt-status");
  let offerQuestion;
  const capability = registry.descriptors().find(skill => skill.id === "ask_uncle_chatt");
  function clear() {
    question.value = draft.value = "";
    id("chatt-include-recent").checked = false;
    status.textContent = "";
    draft.disabled = id("chatt-copy").disabled = true;
  }
  button.addEventListener("click", () => {
    clear();
    question.value = take(offerQuestion || id("message").value, 1200);
    dialog.showModal();
    question.focus();
  });
  id("chatt-form").addEventListener("submit", event => {
    event.preventDefault();
    const input = { question: question.value.trim() };
    const context = { recent: id("chatt-include-recent").checked ? recent() : [] };
    draft.value = "";
    draft.disabled = id("chatt-copy").disabled = true;
    run("Preparing a local draft…", async () => {
      const base = await contextSource.load();
      if (!registry.catalog(base.capabilities).some(skill =>
        skill.id === capability.id && skill.version === capability.version && skill.availability === "available")) {
        throw new Error("Ask Uncle Chatt is unavailable.");
      }
      const result = await registry.dispatch({ id: capability.id, version: capability.version, input }, context, "manual");
      if (!dialog.open) return "";
      draft.value = result.brief;
      draft.disabled = id("chatt-copy").disabled = false;
      return "Review and edit the draft before copying it.";
    }, status);
  });
  id("chatt-copy").addEventListener("click", async () => {
    if (!draft.value.trim()) return;
    try {
      await navigator.clipboard.writeText(draft.value);
      status.textContent = "Copied. Paste it into ChatGPT when you’re ready.";
    } catch {
      draft.focus();
      draft.select();
      status.textContent = "Clipboard unavailable. Copy the selected text manually.";
    }
  });
  id("chatt-discard").addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", clear);
  return {
    offer(text) { offerQuestion = text; button.textContent = "Review Aida’s Uncle Chatt offer"; },
    reset() { offerQuestion = undefined; button.textContent = "Ask Uncle Chatt"; if (dialog.open) dialog.close(); },
    refresh(busy, authorized) {
      button.disabled = busy || !authorized;
      id("chatt-prepare").disabled = busy || !authorized;
    }
  };
}
