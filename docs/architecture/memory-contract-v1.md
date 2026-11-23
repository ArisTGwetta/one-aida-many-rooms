# Aida memory contract v1

**Version 1.4.0 — authoritative architectural requirements.**
Original reconciliation: November 21, 2026. Living Mind refinement: November 22.
This is not a declaration that the implementation satisfies every requirement.
Envelope `0.2`, context `schema_version: 1` and Theater schemas are separate
implementation versions. This documentation changes none of them.

## Recovery clarification: one engine, two permission modes

### Compulsory reflection, not compulsory remembering

Meaningful changes are eligible immediately, on the conversational turn. Twenty
turns is a maximum checkpoint interval, not a waiting period. A checkpoint is
also mandatory at Sleep/handoff and before conversation evidence is compacted or
discarded. Failed or deferred review preserves its evidence and retry state.

Every checkpoint produces an inspectable, source-grounded review artifact, even
when no durable personal fact or LONG/SHORT change is warranted. Distinguish
updated understanding, provisional observation/hypothesis, justified reviewed-
and-discarded material, and deferred/failed review. An empty changes array alone
is not an accountable review. Observations, hypotheses and established
understanding are different epistemic states. Recurring trivial exchanges may
support an observed pattern without establishing its cause or a personal trait.
Later evidence can reinforce, explain, revise or retire an observation while its
earlier uncertainty/provenance remains distinguishable. Sensitive personal topics
require especially conservative inference and retention.

Review artifacts are not automatic durable memory. Temporary reviews remain
entirely session-local; meaningful durable interpretations still require the
existing authorized validation/persistence path. The normal semantic proposal
path is `awake`, with an explicit versioned evaluation; compatibility candidate
collections must not compete with it. Session, scope, reset reason, turn sequence,
review outcome and verified persistence are separate, visible signals.

Everyday Aida and every project use the same Living Mind state schema and
meaning-update lifecycle. Global identity/personality and skills are shared;
private room understanding, affect, orientation and reflections remain scoped.

JUST CHATTING loads authorized memory and evolves a session-only working package.
Neither raw temporary exchanges nor their interpretations are automatically written
to durable context or archival services. Explicit opt-out still prevents retention.
REMEMBER WITH ME evaluates each turn for meaningful changes or no change; valid
eligible updates use verified persistence without routine human review. A proposal,
accepted working update, journal receipt and readback-verified commit are distinct.

Before temporary conversation becomes durable, the user explicitly chooses current
understanding, original exchanges, both, or neither. Saving understanding alone
must not archive the raw conversation, including through a later turn's context.
Durable-to-temporary stops future persistence; it does not erase committed memory.

Sleep/session end compares temporary understanding with committed understanding.
Meaningful differences invite saving understanding only or letting it go; no
meaningful difference requires no approval interruption. Durable handoff verifies
pending writes or clearly reports failure. Inspect/Resume is read-only; takeover
is explicit and cannot recover another browser's unsaved work. No silent overwrite.

These permissions do not authorize a new memory service, a full archival pipeline,
automatic cross-room transfer, or automatic promotion to canonical beliefs. The
independent reflective rhythms and all original requirements below remain binding.

## Conversational consolidation and attention (v1.4 clarification)

RECENT is the latest actual exchanges. Session-local RECENT+ is a bounded,
evolving account of how earlier conversation unfolded, including references,
corrections, uncertainty and unresolved conversational threads. It is derived
conversational context, not SHORT, LONG, a FACT or durable project memory.
Consolidation takes the previous RECENT+ and newly retiring exchanges; it does not
summarize the whole conversation repeatedly. Validate replacements before releasing
prompt material. Failed consolidation preserves the last good version and evidence.
Temporary RECENT+ disappears on disposal/reload. It is not implicitly authorized by
an understanding-only save. Any future durable conversational consolidation needs
explicit scope/retention authorization; none is introduced by this increment.

LONG is a living charter and overall status: what we are doing, why, what matters,
what has been established, and the overall state. SHORT is current-stage/sprint
progress: what is happening now, changes, blocks, unresolved matters and next steps.
They are distinct interpretations, not successive transcript summaries. Apply the
same distinction to everyday continuity without forcing ordinary life into projects.
Both must stay bounded and change representation as work progresses. Completed or
superseded details should not accumulate indefinitely in active understanding.

Attention follows current strategic priorities. Importance, urgency, current
attention and preservation are separate. A displaced unfinished initiative can be
released from active semantic context without being declared finished, abandoned or
cancelled. Preserve only authorized lightweight directory pointers; retrieve its
last known scoped state when it returns. The directory discovers initiatives; it
must not inject all their histories into each prompt. Automatic semantic retirement,
priority management and directory ranking are NOT implemented in the RECENT+
increment. Their eventual acceptance must cover interruption/resumption without
loss or unauthorized retention. Existing meaning-unit limits and revision semantics
remain unchanged until a separately approved lifecycle change.

## Authority and provenance

Francisco's approved requirements govern. Sources include the original envelope
(`91a3e1b`), Mission 006 provider-independent chat and lifecycle
(`cbb60139e782a64b061b33a21b6aa8c48707874e`), selective retention (`8eed921`,
`78d9a09`), non-blocking review (`5a368f8`), awake context (`ae33da1`), scoped
capabilities, Theater isolation and Memory Bridge (`a0aa76d`). Current Mission 007
explicitly clarifies the RECENT→SHORT→LONG dependency: the earliest documents
expressed its direction, not the exact formula verbatim.

This document governs intended memory behavior. `conversation-v0.2.md` describes
wire contracts; `memory-lifecycle.md` records implementation history and limits.
Dated acceptance/Compass reports are historical evidence, not blanket current
certification. Amend the contract explicitly with version and rationale. Do not
rewrite requirements to match incomplete code or turn prototype limits into policy.

## Fourteen requirements

1. **One continuous Aida.** Aida owns identity, memory, relationships and continuity
   across rooms, devices, providers and sessions. Interfaces and models do not
   create separate Aidas. Authorized Drive records are durable authority; browser
   windows are not independent authoritative memory stores.
2. **RECENT is evidence.** Eligible actual turns and attributed, source-linked
   receipts feed recoverable history. Preserve IDs, ordering, timestamps, scope
   and provenance. Raw history, a bounded prompt window and current RECENT handoff
   are distinct. A failed action is not a completed-action receipt.
3. **RECENT + current SHORT → next SHORT.** Interpret meaningful evidence against
   the current situation, open matters, decisions and intentions. Preserve
   compatible meaning and update changes. SHORT is one living interpretation per
   scope, not an append-only list or the last few messages.
4. **New SHORT + current LONG → next LONG.** Consider the newly understood situation
   against enduring purpose, relationships, history and principles. Expand/revise
   when warranted; no change is valid. Preserve unrelated meaning. This dependency
   does not require a second LLM call on every turn.
5. **FACTS and INSIGHTS evolve.** Maintain plural, attributed, evidence-grounded
   beliefs with confidence/uncertainty and correction history. Distinguish user
   reports, independently supported facts, interpretations and fiction. Accepted
   does not mean immutable or independently verified. Later evidence may qualify
   or supersede beliefs without erasing provenance.
6. **Every turn can matter, or change nothing.** Ordinary conversation can contribute
   corrections, changed understanding, affect, decisions and unfinished business.
   Explicit keep/no-change is normal. This opportunity does not require permanent
   retention of every turn. Affect evolves from its prior position and remains
   separate from character affect.
7. **Routine evolution is automatic.** Authorized stewardship updates meaningful
   memory without routine human filing/approval. Deterministic validation and
   reviewer recommendations are not universal human commit gates. Ask when
   ambiguity, disclosure risk or consequences warrant it. Pending review does not
   suspend ordinary conversation.
8. **Sleep consolidates and repairs.** Awake understanding and eligible persistence
   precede Sleep. Sleep reconciles eligible evidence with current memory, preserving
   corrections, uncertainty and history. It is not the first opportunity to
   remember. A durable queue supports later inspection; reviewer findings, review
   status and actual commit authority are separate.
9. **Cold starts recover understanding.** Restore current LONG/SHORT/RECENT, relevant
   beliefs, unfinished business and authorized history pointers after closure,
   restart or device change. Do not depend on the original browser or a receipt
   remaining in a tiny prompt window. Distinguish empty, missing, malformed and
   inaccessible records.
10. **Corrections change current truth, not the past.** Use evidence and explicit
    supersession to revise understanding while retaining previous beliefs and why
    they changed. Preserve compatible information. Competing claims may remain
    UNCLEAR; new information is not automatically a contradiction. KEEP, EXPAND,
    REVISE and UNCLEAR describe semantic outcomes.
11. **Discretion governs disclosure and action.** Confidence, privacy, audience,
    uncertainty and consequences govern what Aida says/does. Knowing something
    does not authorize disclosure. Memory acceptance is not tool execution
    authority. Cloud disclosure and spending permissions remain explicit.
12. **Models interpret; deterministic mechanisms enforce.** LLMs interpret meaning
    and propose understanding. Deterministic code validates structure, source
    membership, scope and authority, then persists, verifies and retrieves. Schema
    validity and confidence do not prove truth. General understanding must not
    become an ever-growing collection of special phrase rules.
13. **Rooms have scoped memory.** Project-private evidence stays scoped. Theater
    META, active GAME, individual character knowledge, abandoned attempts and
    operational diagnostics retain their boundaries. Only explicitly permitted,
    small attributed outcomes cross into everyday context. A visit receipt does
    not automatically become a personal relationship fact.
14. **Retention is selective.** Quick consultations may remain ephemeral. Provisional
    continuity has a retention boundary; candidates require source/scope validation.
    Explicit no-save/forget instructions are authoritative. Preserve relevant
    available support when context becomes meaningful; do not reconstruct missing
    turns. Diagnostics must not become a permanent conversation archive.

## Required lifecycle

### Living Mind and independent reflective rhythms

Mission 008 refines the implementation into two asynchronous rhythms without
discarding the fourteen requirements. During ordinary conversation, the same
Living Mind engine checks out a complete, versioned current package for Everyday
or a stable project ID. It includes the same global Aida identity and principles,
LONG, SHORT, RECENT/handoff, relevant attributed beliefs, affect, orientation,
historical references and available pending reflections. Projects are not separate
identities. Project state remains isolated and can be restored after inactivity.

Reflective Crawler, Diary, Librarian and Steward are independent modular services,
not a mandatory linear pipeline. The Crawler preserves eligible source evidence;
Diary records events, significance and unfinished questions; Librarian organizes
beliefs, relationships, patterns and historical retrieval; Steward validates
authority, sources, versions and commits and can offer pending reflections.
Diary/Librarian do not exist merely to manufacture LONG/SHORT. Aida may consider
reflections on return without being forced to raise them immediately. Implementing
the full reflective system is not required for the first Living Mind milestone.

Historical evidence, earlier interpretations and current understanding must remain
distinct. Every scope uses the same schema/update/persistence/recovery mechanism.
Global learning from projects requires explicit authorized scope transfer. The
following semantic dependency is retained within the Living Mind rhythm.

```text
eligible conversation / authorized receipt
                  ↓
        source-linked RECENT evidence
                  ↓
RECENT + current SHORT → proposed next SHORT
                  ↓
next SHORT + current LONG → proposed next LONG
                  ↓
steward: validate evidence, scope, retention, authority and revision
                  ↓
verified durable current understanding + historical evidence
                  ↓
cold-start assembly / bounded retrieval → next conversation
```

FACT/INSIGHT evolution, affect and no-change outcomes accompany this process.
Sleep later consolidates and repairs it. The diagram specifies semantic
dependencies, not a mandatory sequence of paid model calls.

Distinguish **model proposal → steward decision → persistence attempt → verified
durable commit → recovered context**. Review acceptance, journal save and current
memory commit are not synonyms. Failed readback is unconfirmed. Retry persistence
without repeating completed paid conversation. Stale writers must not overwrite
newer verified understanding.

## Implementation assessment at consolidation

| Requirement | Status and existing evidence |
| --- | --- |
| 1 | Partial: provider-switch fixtures and live first-memory cross-device acceptance; complete evolving continuity not proven. |
| 2 | Selective conversation journals implemented: `recent-journal.mjs` and recovery/retry/isolation tests; general activity journaling partial. |
| 3 | Partial: awake and bridge current-view/expansion tests; automatic ordinary-chat live gate open. |
| 4 | Missing explicit SHORT→LONG dependency; simultaneous proposals do not establish it. |
| 5 | Partial: corrected FACT acceptance works; general automatic belief/INSIGHT reconciliation unfinished; FACT templates narrow. |
| 6 | Partial: updates/no-change supported; affect session-local, durable continuity unestablished. |
| 7 | Partial: automatic working changes and synthetic bridge checkpoints; canonical beliefs remain human-gated. |
| 8 | Partial: real proposal/review pipeline; Sleep lacks current/accepted SHORT/LONG reconciliation. |
| 9 | Beyond-window synthetic bridge recovery passes; real Drive/browser/cold-device gate open. |
| 10 | Synthetic revision/provenance passes; ordinary deployed Chaos correction exposed the unconnected path. |
| 11 | Partial: grounding and scoped authority; general discretion/consequence policy unfinished. |
| 12 | Partial: steward/registry boundaries exist; reference validation is not semantic verification. |
| 13 | Extensive Theater/bridge scope tests pass; full live cross-room memory acceptance open. |
| 14 | Opt-out, expiry and quick-consultation fixtures pass; retrospective forgetting unfinished. |

Gaps never authorize narrower requirements. Bounded meaning units and optional
version-1 metadata are implementation choices, not the definition of Aida's mind.
Sleep SHORT/LONG acceptances remain review-only until connected to current records.

## Primary end-to-end gates

1. **Automatic SHORT + cold start:** ordinary meaningful chat updates SHORT without
   manual Remember/review; closure and a fresh browser/device recover it after its
   receipt leaves the prompt window.
2. **Correction:** update a synthetic claim, recover it as current, preserve
   compatible details and retrieve superseded evidence.
3. **SHORT→LONG:** demonstrate the dependency, compatible expansion, uncertainty,
   warranted revision and no-change in actual requests and steward receipts.
4. **Beliefs:** attributed FACT/INSIGHT qualification/correction without universal
   human approval or fabricated certainty.
5. **Scope/retention:** reject project/character leaks and unwanted consultation
   retention; verify approved outcomes and privacy instructions.
6. **Sleep/recovery:** reconcile current understanding and eligible evidence;
   verify interrupted-write retry and real stale-writer rejection.

Use integrated ordinary Aida for primary acceptance. Existing harness tests can
establish transport properties, not replace these gates. Live provider calls and
Drive mutations require separate authorization. Component tests alone never
certify working memory.
