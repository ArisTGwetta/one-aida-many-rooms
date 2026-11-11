# Aida's intended memory lifecycle

Aida owns her identity, memory, affect, and conversation envelope. OpenAI is the default reasoning provider. Ollama is an optional provider when its environment is reachable. A provider change preserves the same identity, relevant project context, memory, and current conversation.

A request carries base identity and relationship context, LONG, SHORT, FACTS, INSIGHTS, RECENT, relevant project context, and the current message. The six-message active window starts with up to three eligible exchanges from the current Drive conversation. Subsequent activity can add exchanges in page memory. The first user-entered fact still comes from its existing Drive record.

The steward uses the [conversation contract's memory dispositions](conversation-v0.2.md#memory-disposition). Ephemeral consultations stay in the active conversation. Provisional material expires at a boundary set by the steward unless explicitly reclassified. Candidate material requires evidence validation and destination classification. A meaningful fact, decision, correction, or explicit request to remember can qualify in one turn. As a conversation develops, the steward can reclassify selected material and keep the context needed to support it. Respect explicit requests not to remember at each step.

The RECENT journal records eligible conversation exchanges as they occur so interruptions do not erase saved context. Entries carry stable IDs, timestamps, speaker identity, and source references. Future activity journaling can extend the same principles to tools. The Librarian will classify eligible material into base Aida, project, tool, and specialized vault contexts. A lightweight project index points to briefcases. The briefcase loader reconstructs relevant context on demand for the active project.

A manually triggered sleep cycle reconciles only eligible retained journal material into diary entries, FACTS, INSIGHTS, SHORT, and LONG. It preserves provenance, distinguishes interpretation from evidence-backed facts, and records corrections against the superseded items. No update is a normal outcome. Model proposals require steward review before promotion. Tool proposals require separate execution authority.

Use operational diagnostics for timing, status, and errors. Keep conversation text and memory payloads out of routine logs and give diagnostic records their own expiry so they cannot become a parallel conversation archive.

The Librarian, sleep cycle, project index, and briefcase loader remain future work.
