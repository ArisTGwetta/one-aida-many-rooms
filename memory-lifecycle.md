# Aida's intended memory lifecycle

Aida owns her identity, memory, affect, and conversation envelope. OpenAI is the default reasoning provider. Ollama is an optional provider when its environment is reachable. A provider change preserves the same identity, relevant project context, memory, and current conversation.

A request carries base identity and relationship context, LONG, SHORT, FACTS, INSIGHTS, RECENT, relevant project context, and the current message. The current six-message window lives only in page memory. It resets on reload. The first user-entered fact still comes from its existing Drive record.

The future durable path starts by journaling actual conversation and activity events as they occur, with stable IDs, timestamps, speaker or tool identity, and source references. The Librarian classifies those events into base Aida, project, tool, and specialized vault contexts. A lightweight project index points to briefcases, and the briefcase loader reconstructs the relevant context when a project is active.

A manually triggered sleep cycle reconciles the journal into diary entries, FACTS, INSIGHTS, SHORT, and LONG. It preserves provenance, distinguishes interpretation from evidence-backed facts, and records corrections against the superseded items. No update is a normal outcome. Candidates from the conversation model are proposals that require review before promotion. Tool proposals require separate execution authority.

The journal, Librarian, sleep cycle, project index, and briefcase loader remain future work.
