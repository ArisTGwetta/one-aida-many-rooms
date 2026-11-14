import { createSleepCycle } from "./sleep.mjs";

const byId = id => document.getElementById(id);

export function setupSleepPanel({ store, journal, run, provider }) {
  const cycle = createSleepCycle({ journal, store, provider });
  const status = byId("sleep-status");
  const report = byId("sleep-report");
  const proposals = byId("sleep-proposals");
  const olderEvidence = byId("sleep-older");
  const olderQueue = byId("sleep-queue-older");
  let evidenceCursor;
  let queueCursor;
  const shown = new Set();

  function reportText({ proposals: saved, ...summary }) {
    return JSON.stringify({ ...summary, newProposalIds: saved.map(item => item.id) }, null, 2);
  }

  async function showProposal(proposal) {
    if (shown.has(proposal.id)) return false;
    const latest = (await store.reviewPage(proposal.id, undefined, 1)).decisions[0];
    if (shown.has(proposal.id)) return false;
    shown.add(proposal.id);
    const card = document.createElement("details");
    const title = document.createElement("summary");
    const body = document.createElement("pre");
    const history = document.createElement("pre");
    history.hidden = true;
    const correction = document.createElement("textarea");
    const label = document.createElement("label");
    correction.maxLength = 4000;
    correction.rows = 2;
    label.textContent = "Correction text";
    label.append(correction);
    const actions = document.createElement("div");
    actions.className = "actions";
    const button = (text, action) => {
      const control = document.createElement("button");
      control.type = "button";
      control.textContent = text;
      control.addEventListener("click", action);
      actions.append(control);
      return control;
    };
    let decision = latest;
    async function show() {
      const effective = await store.effectiveVersion(proposal, decision);
      const committed = Boolean(decision?.canonicalFact);
      const needsCommit = proposal.destination === "aida/fact" && !proposal.synthetic && decision?.status === "accepted" && !committed;
      const commitLabel = committed ? " · committed to Drive" : needsCommit ? " · awaiting FACT commit" : "";
      title.textContent = `${proposal.category} · ${decision?.status ?? "pending"}${commitLabel}${proposal.synthetic ? " · synthetic" : ""}`;
      body.textContent = JSON.stringify({
        ...proposal, status: decision?.status ?? "pending", effectiveText: effective.text,
        canonicalCommitVerified: committed, latestReview: decision ?? null
      }, null, 2);
    }
    await show();
    for (const [text, choice] of [["Accept", "accepted"], ["Correct", "corrected"], ["Reject", "rejected"], ["Defer", "deferred"]]) {
      button(text, () => run("Saving review…", async () => {
        try {
          decision = await store.review({
            proposalId: proposal.id, status: choice,
            correction: choice === "corrected" ? correction.value : "",
            previous: decision?.id ?? null
          });
        } catch (error) {
          decision = (await store.reviewPage(proposal.id, undefined, 1)).decisions[0];
          await show();
          throw error;
        }
        correction.value = "";
        history.hidden = true;
        moreHistory.hidden = true;
        await show();
        return decision.canonicalFact ? "FACT committed and verified in Drive." : "Review recorded in Drive.";
      }, status));
    }
    let historyCursor;
    async function loadHistory(cursor) {
      const page = await store.reviewPage(proposal.id, cursor);
      const content = JSON.stringify(page.decisions, null, 2);
      history.textContent = cursor ? `${history.textContent}\n\n${content}` : content;
      history.hidden = false;
      historyCursor = page.next;
      moreHistory.hidden = !historyCursor;
      return "Review history loaded from Drive.";
    }
    button("Review history", () => run("Reading review history…", () => loadHistory(), status));
    const moreHistory = button("Older decisions", () => run("Reading older decisions…", () => loadHistory(historyCursor), status));
    moreHistory.hidden = true;
    card.append(title, body, label, actions, history);
    proposals.append(card);
    return !decision;
  }

  async function loadQueue(cursor) {
    if (!cursor) {
      proposals.replaceChildren();
      shown.clear();
    }
    const page = await store.queue(cursor);
    let pendingCount = 0;
    for (const saved of page.runs) {
      const details = document.createElement("details");
      const title = document.createElement("summary");
      const body = document.createElement("pre");
      title.textContent = `Sleep run · ${saved.createdAt}`;
      body.textContent = reportText(saved);
      details.append(title, body);
      proposals.append(details);
      for (const item of saved.proposals) {
        if (await showProposal(item)) pendingCount++;
      }
    }
    queueCursor = page.next;
    olderQueue.hidden = !queueCursor;
    return `${pendingCount} pending proposal(s) in this queue page.`;
  }

  async function runCycle(cursor) {
    const result = await cycle(cursor);
    evidenceCursor = result.next;
    olderEvidence.hidden = !evidenceCursor;
    const { proposals: saved } = result.run;
    report.textContent = reportText(result.run);
    report.hidden = false;
    const count = saved.length + result.run.existingProposalIds.length;
    for (const item of saved) await showProposal(item);
    for (const id of result.run.existingProposalIds) {
      const item = await store.findProposal(id);
      if (item) await showProposal(item);
    }
    return `${result.reused ? "Recovered saved run" : "Saved sleep run"}. ${count} proposal(s).`;
  }

  byId("sleep-run").addEventListener("click", () => run("Examining eligible Drive evidence…", () => runCycle(), status));
  olderEvidence.addEventListener("click", () => run("Examining older Drive evidence…", () => runCycle(evidenceCursor), status));
  byId("sleep-queue").addEventListener("click", () => run("Loading review queue…", () => loadQueue(), status));
  olderQueue.addEventListener("click", () => run("Loading older proposals…", () => loadQueue(queueCursor), status));
  return () => {
    evidenceCursor = queueCursor = undefined;
    olderEvidence.hidden = olderQueue.hidden = report.hidden = true;
    status.textContent = report.textContent = "";
    proposals.replaceChildren();
    shown.clear();
  };
}
