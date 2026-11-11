# Aida conversation envelope v0.2

Aida assembles the request from her own context. The provider returns one JSON object. The current implementation is exercised with a simulated provider.

## Request

| Field | Meaning |
| --- | --- |
| `version` | The string `"0.2"`. |
| `identity` | Aida's name and relationship context, owned by the application. |
| `memory.long`, `memory.short` | Durable background and current working context, respectively. |
| `memory.facts`, `memory.insights` | Evidence-backed statements and separately labeled interpretations. |
| `memory.recent` | Chronological conversation or activity entries. The prototype supplies up to six messages from the current browser session. |
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

1. **RECENT** records actual events in order. Append the submitted user message and delivered reply after a successful turn. In the prototype this window resets when the session ends. Future durable activity entries must identify what actually happened and where the evidence lives.
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
