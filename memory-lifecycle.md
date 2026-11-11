# Aida's intended memory lifecycle

Aida owns her identity, memory, affect, and conversation envelope. OpenAI is the default reasoning provider. Ollama is an optional provider when its environment is reachable. A provider change preserves the same identity, relevant project context, memory, and current conversation.

A request carries base identity and relationship context, LONG, SHORT, FACTS, INSIGHTS, RECENT, relevant project context, and the current message. The six-message active window starts with up to three eligible exchanges from the current Drive conversation. Subsequent activity can add exchanges in page memory. The first user-entered fact still comes from its existing Drive record.

The steward uses the [conversation contract's memory dispositions](conversation-v0.2.md#memory-disposition). Ephemeral consultations stay in the active conversation. Provisional material expires at a boundary set by the steward unless explicitly reclassified. Candidate material requires evidence validation and destination classification. A meaningful fact, decision, correction, or explicit request to remember can qualify in one turn. As a conversation develops, the steward can reclassify selected material and keep the context needed to support it. Respect explicit requests not to remember at each step.

The RECENT journal records eligible conversation exchanges as they occur so interruptions do not erase saved context. Entries carry stable IDs, timestamps, speaker identity, and source references. Future activity journaling can extend the same principles to tools. The Librarian will classify eligible material into base Aida, project, tool, and specialized vault contexts. A lightweight project index points to briefcases. The briefcase loader reconstructs relevant context on demand for the active project.

Sleep reads eligible retained journal material and stores proposals for DIARY, FACT, INSIGHT, SHORT, and LONG. It preserves provenance, distinguishes interpretation from user-reported facts, and records review corrections alongside the original proposal. Human acceptance can commit the effective version of a non-synthetic `aida/fact`. The acceptance record is also the durable canonical FACT and carries explicit authority and source links. The remaining destinations await canonical reconciliation. No update is a normal outcome. Tool proposals require separate execution authority.

Use operational diagnostics for timing, status, and errors. Keep conversation text and memory payloads out of routine logs and give diagnostic records their own expiry so they cannot become a parallel conversation archive.

The Librarian, canonical reconciliation, project index, and briefcase loader remain future work.

## Non-blocking memory review

The first sleep-cycle and stewardship milestones must keep conversation, eligible journaling, and proposal generation available while earlier proposals await review. Sleep can produce diary entries and propose FACTS, INSIGHTS, SHORT, and LONG updates without immediate human approval. An invitation to inspect proposals is optional. The user can open the queue when convenient.

Store the review queue durably and recover it independently of the current conversation after a restart. Each proposal has a stable ID, version, destination, source references, reviewer findings, and a history of disposition changes. Support the statuses `pending`, `accepted`, `corrected`, `rejected`, `deferred`, and `superseded`. Record the authority, decision, and resulting memory revision when a change is committed. Link corrections and superseding proposals to earlier versions and preserve the original evidence and findings.

Deterministic validators, local LLMs, hosted models, Cody during development, and the human can contribute findings or recommendations. Commit authority is assigned separately by stewardship policy. Routine updates can proceed under that policy. Ask the human for clarification when ambiguity or risk materially affects the decision, and keep unrelated conversations and memory work moving while the question is open.
