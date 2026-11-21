# Aida's intended memory lifecycle

Aida owns her identity, memory, affect, and conversation envelope. OpenAI is the default reasoning provider. Ollama is an optional provider when its environment is reachable. A provider change preserves the same identity, relevant project context, memory, and current conversation.

A request carries base identity and relationship context, LONG, SHORT, FACTS, INSIGHTS, RECENT, relevant project context, and the current message. The six-message active window starts with up to three eligible exchanges from the current Drive conversation. Subsequent activity can add exchanges in page memory. The first user-entered fact still comes from its existing Drive record.

The steward uses the [conversation contract's memory dispositions](conversation-v0.2.md#memory-disposition). Ephemeral consultations stay in the active conversation. Provisional material expires at a boundary set by the steward unless explicitly reclassified. Candidate material requires evidence validation and destination classification. A meaningful fact, decision, correction, or explicit request to remember can qualify in one turn. As a conversation develops, the steward can reclassify selected material and keep the context needed to support it. Respect explicit requests not to remember at each step.

The RECENT journal records eligible conversation exchanges as they occur so interruptions do not erase saved context. Entries carry stable IDs, timestamps, speaker identity, and source references. Future activity journaling can extend the same principles to tools. The Librarian will classify eligible material into base Aida, project, tool, and specialized vault contexts. A lightweight project index points to briefcases. The briefcase loader reconstructs relevant context on demand for the active project.

Sleep reads eligible retained journal material and stores proposals for DIARY, FACT, INSIGHT, SHORT, and LONG. It preserves provenance, distinguishes interpretation from user-reported facts, and records review corrections alongside the original proposal. Human acceptance can commit the effective version of a non-synthetic `aida/fact`. The acceptance record is also the durable canonical FACT and carries explicit authority and source links. The remaining destinations await canonical reconciliation. No update is a normal outcome. Tool proposals require separate execution authority.

Use operational diagnostics for timing, status, and errors. Keep conversation text and memory payloads out of routine logs and give diagnostic records their own expiry so they cannot become a parallel conversation archive.

The Librarian, canonical reconciliation, project index, and briefcase loader remain future work.

## Memory Bridge implementation checkpoint

Ordinary awake interpretation, the context steward, project skills, and selective RECENT journaling already existed. The bridge connects validated awake changes to their existing Drive records. It adds no new database, mandatory model call, or background Librarian. The Theater and its storage/routing remain unchanged.

Each scope now checkpoints one current LONG, SHORT and RECENT interpretation, preserving compatible meaning and explicit uncertainty. Working FACT/INSIGHT candidates and questions remain plural and noncanonical. An eligible conversation writes its existing journal entry first, including before/after snapshots, operation ID, exact cited evidence, and the previous journal pointer. Only verified journal evidence authorizes the context update. The existing context file keeps `schema_version: 1`, adds optional per-entry `meaning`, and optional `memoryBridge` metadata: version, revision, operationId, journalReference, previousJournalReference, and review collections. No migration or rewriting on read occurs.

The application verifies context writes by readback and labels failed persistence unconfirmed. Retry reuses the reply, journal ID, operation ID and checkpoint; it does not call the model. Identical committed retries succeed without another context write. Stale base hashes/revisions and conditional-write conflicts fail closed, preserving the journal evidence for review. Two-scope updates are sequential and can be partly verified; they are not an atomic transaction. Each verified scope is recognized on retry.

Cold clients load current interpretations directly from owned context records, even when their original receipt is older than the three-exchange RECENT window. Startup checks the latest recovered checkpoint and can resume an unconfirmed one without regenerating conversation. Historical project evidence follows scoped journal links rather than loading every project's history. Missing evidence is reported, never reconstructed. Retrieval is bounded; a pending checkpoint outside the recovered window or a stale concurrent checkpoint may require explicit inspection/review. No automatic conflict merge is implemented.

Permanent checkpoints use nonexpiring candidate journals. Provisional material stays in the expiring journal and is not applied to permanent interpretations. Quick consultations and opted-out turns cannot contaminate a later snapshot through the working overlay. Opt-out prevents the current exchange from future retention; it does not delete already committed historical records. Meaningful candidates can qualify automatically under the steward policy, while canonical FACT/INSIGHT promotion stays on the existing separate path.

### Live persistence gate

Tests use synthetic private Drive responses only. The new optional conditional adapter reads the Drive v2 JSON ETag, brackets the v3 content read with matching tags, and submits a v2 media update with `If-Match`. Missing/weak tags, changed versions, failed readback, and HTTP 412 stop the checkpoint; there is no unconditional-write fallback. Existing ordinary v3 memory APIs, OAuth client/scopes, and first-memory paths are unchanged.

The actual Google server's conditional update behavior and browser CORS compatibility remain **unverified**. Before publication/live memory acceptance, a separately approved disposable Drive test must demonstrate the authorized browser path, successful readback, and rejection of a deliberately stale precondition. Mocks do not establish those properties. No live Drive writes or paid provider calls were made for this checkpoint.

Reference contracts: [Drive v2 file ETag](https://developers.google.com/workspace/drive/api/reference/rest/v2/files), [v2 media update](https://developers.google.com/workspace/drive/api/reference/rest/v2/files/update). The transport must fail closed if the live precondition contract cannot be verified; do not relax it to make a demo pass.

## Non-blocking memory review

The first sleep-cycle and stewardship milestones must keep conversation, eligible journaling, and proposal generation available while earlier proposals await review. Sleep can produce diary entries and propose FACTS, INSIGHTS, SHORT, and LONG updates without immediate human approval. An invitation to inspect proposals is optional. The user can open the queue when convenient.

Store the review queue durably and recover it independently of the current conversation after a restart. Each proposal has a stable ID, version, destination, source references, reviewer findings, and a history of disposition changes. Support the statuses `pending`, `accepted`, `corrected`, `rejected`, `deferred`, and `superseded`. Record the authority, decision, and resulting memory revision when a change is committed. Link corrections and superseding proposals to earlier versions and preserve the original evidence and findings.

Deterministic validators, local LLMs, hosted models, Cody during development, and the human can contribute findings or recommendations. Commit authority is assigned separately by stewardship policy. Routine updates can proceed under that policy. Ask the human for clarification when ambiguity or risk materially affects the decision, and keep unrelated conversations and memory work moving while the question is open.
