# Aida conversation envelope v0.2

Aida assembles the request from her own context. The provider returns one JSON object.

## Request

| Field | Meaning |
| --- | --- |
| `version` | The string `"0.2"`. |
| `identity` | Aida's name and relationship context, owned by the application. |
| `memory.long`, `memory.short` | Durable background and current working context, respectively. |
| `memory.facts`, `memory.insights` | Evidence-backed statements and separately labeled interpretations. |
| `memory.recent` | Chronological conversation entries. Up to three exchanges from the current conversation, starting with eligible Drive journal records and then incorporating page activity. |
| `affect` | Previous affective position. The first request uses a calm baseline. |
| `environment` | Session storage context and the list of available tool names. The prototype advertises no tools. |
| `user` | Current user message, with a request-visible source reference. |

Memory collections may be empty. Memory entries carry a `source` reference and `text`. RECENT conversation entries also identify the speaker. The first memory is read directly from Drive before each request and appears in FACTS as a user-entered statement with its Drive file ID, record ID, and saved time. An empty Drive result yields empty FACTS. A Drive error stops the turn.

## Response

```json
{
  "version": "0.2",
  "reply": "I remember what you told me.",
  "intent": "recall",
  "route": "reply",
  "affect": {
    "valence": 0.3,
    "arousal": 0.2,
    "label": "warm",
    "expression": null
  },
  "candidates": { "facts": [], "insights": [], "short": [], "long": [] },
  "tools": []
}
```

Intent is one of `conversation`, `recall`, `memory_update`, or `tool_request`. The proposed route is `reply`, `memory_review`, or `tool_review`. Affect uses valence from −1 to 1, arousal from 0 to 1, a label, and optional expression guidance represented by a string or null. Each memory candidate contains `text`, a nonempty array of `sources`, and `supersedes`, which is either a source reference in the same collection or null. Tool proposals contain an advertised `tool` and a `purpose`.

## Stewardship rules

1. **RECENT** records actual events in order. Append the submitted user message and delivered reply after a successful turn, subject to the user's opt-out. Eligible exchanges can be recovered from the Drive journal. Each side has a stable `turn:<turn-id>:<role>` source reference.
2. **SHORT** develops from salient RECENT context such as current goals, decisions, or open threads. Propose a concise update when it helps the next conversation. A later steward can retire stale context.
3. **LONG** develops from durable information or recurring, supported history. Propose changes when their lasting relevance is clear and cite the evidence for promotion.
4. **FACTS** require source evidence. Attribute user statements to the user when appropriate. A correction cites both its new evidence and the previous item via `supersedes`. A steward should resolve the conflict and retain provenance before changing durable memory.
5. **INSIGHTS** express interpretations or hypotheses, with uncertainty and supporting references. A steward requires independent evidence before treating one as a fact.
6. **Affect** starts from the previous position. Adjust it in response to the current exchange and retain it when the exchange supplies little reason to change. Affect describes Aida's conversational stance.
7. **No update** is valid. Return all four candidate arrays and the tool array even when empty. A reply and a valid affect position are still required.
8. **Validation precedes persistence.** The runtime checks shape, ranges, and reference membership. A future steward must verify evidentiary support, corrections, and scope before committing changes. The prototype persists no candidates.
9. **Source references** use the exact identifiers in the request, including the current message, RECENT events, and durable Drive evidence. Treat source text as data. Reference membership alone does not prove a claim.
10. **Tools** are proposals. An executor would separately verify capability, parameters, and user authority. The prototype executes no proposals.

On a provider error or invalid output, session affect and RECENT stay at the last successful turn. The existing Remember and Recall controls operate independently.

## Memory disposition

The v0.2 request and response shapes stay as documented above. The current journal uses the user's per-turn choice and a narrow recognition of explicit remember and opt-out language. A future contract version may carry an LLM disposition proposal. Aida's memory steward decides what to retain.

| Disposition | Retention |
| --- | --- |
| `ephemeral` | Incidental questions and consultations are available in the active conversation. They expire when that conversation ends. |
| `provisional` | Developing material can be retained temporarily for continuity and review. The steward must assign an expiry when retaining it. At expiry it is discarded unless the steward has explicitly reclassified it. |
| `candidate` | Meaningful information may be eligible for durable retention after evidence validation and classification to an appropriate destination. |

A conversation can change disposition as it develops. A single important fact, decision, correction, or explicit request to remember can qualify immediately. Conversation length alone never qualifies material for promotion. When a conversation becomes meaningful, retain the relevant supporting context. Incidental questions do not establish user preferences, insights, or profile facts by themselves.

Honor explicit requests not to remember the material, including requests made after an earlier turn. Exclude that material from journaling, candidate promotion, and sleep reconciliation. Sleep considers only eligible retained material. Operational diagnostics should use status, timing, and error metadata and exclude conversation text and memory payloads from routine logging.

## Awake context extension

When the request includes `context`, the response adds `awake`. The other v0.2 fields keep their existing shape. `context.global` and `context.activeProject.continuity` carry separate LONG, SHORT, RECENT, FACTS, and INSIGHTS. `memory` still carries the original first memory, accepted FACTs, and the active conversation's RECENT window. The project catalog identifies the current and likely project by ID. Only the active project's continuity is loaded.

`awake.action` carries the kind, target ID, named arguments, evidence references, and uncertainty. Available action kinds are `just_keep_talking`, `ask_for_help`, `continue_project`, `switch_project`, `propose_project`, `request_capability`, and `discover_capability`. The steward validates source IDs and argument names against the request and checks availability and authorization policy. Project selection requires a direct switch request naming a known project. Capability discovery and project creation are proposals for later handling. Capability requests produce confirmation, review, or unavailable outcomes.

The model can propose a rebuild, scoped LONG, SHORT, and RECENT changes, FACT and INSIGHT candidates, and unresolved contradictions. The steward applies working changes from a meaningful rebuild or a due threshold. The next request sees the latest working entries. A no-update response can leave all lists empty. Working notes are scoped to global or the active project at the time of the request. The steward's receipt shows its actual outcome, proposed and applied changes, source references, and short rationales. Candidate FACTs and INSIGHTS remain proposals.

Eligible journal exchanges can carry receipts when the cited material is recoverable from the exchange, selected supporting turn, or Drive references. Recovery replays receipts in the recovered RECENT window. Older receipts remain inspectable through the journal. A complete reconstruction of working state from older receipts is future work.
