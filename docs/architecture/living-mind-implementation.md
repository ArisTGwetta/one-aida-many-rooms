# Living Mind v1 implementation checkpoint

Mission 008, November 22, 2026. Canonical home and branch remain unchanged.
This records implementation, not a claim of real browser/Drive acceptance.

## One engine, existing records

`living-mind.mjs` is a pure projection/validation helper, not another store.
`createContextSource`, `createAwakeSteward`, the ordinary conversation session and
Memory Bridge checkpoints serve both `everyday` and `project:<stable-id>` scopes.
Existing version-1 global/project files retain their five continuity sections.
Optional `livingMind` metadata adds version, scopeId, meaningRevision,
lastInteractionAt, lastMeaningfulAt, affect, a bounded eligible conversation window, orientation,
retrieval references, pendingReflections and checkout. Existing data is read
without migration; legacy current sections are preserved unless explicitly changed.
No new OAuth client, archive database, project-memory subsystem or model route.

Model-facing `context.currentState` is a complete `aida-current-state@1` projection
with committed revision, identity/principles, current continuity, relevant beliefs,
review material and metadata. In a project, `globalState` carries authorized global
understanding alongside it. Global raw conversation is excluded from project
requests. Old compatibility fields keep their existing shapes without duplicating
metadata. The actual final request context is inspectable in development evidence.

The same conversational model evaluates SHORT then LONG, with explicit source-
grounded operations or no change. No additional Librarian call is required. Valid
meaningful rebuilds or explicitly retained exchanges checkpoint automatically.
An eligible no-change turn may update interaction/affect/conversational state
without incrementing meaningRevision. The snapshot commit revision is separate.
FACT/INSIGHT candidates stay attributed working proposals in the current package;
this mission does not complete general canonical belief reconciliation.

## Persistence, checkout and handoff

Normal UI sessions acquire a conditional, readback-verified checkout on their
selected existing context file. Another owner causes a warning **before** a model
call. A twenty-minute expiry is visible metadata; an interrupted different owner
still requires explicit takeover rather than silently discarding unsaved work.
The same session renews when needed. Project changes release the prior scope.

Each retained meaningful exchange saves journal evidence first and then uses the
existing ETag/base-hash checkpoint path. The new reader accepts earlier checkpoints;
older strict Memory Bridge readers may reject new optional `mind` metadata. Readback
verifies the complete package. Retries reuse the reply/operation/file ID. An old
checkout cannot overwrite a newer package. Ownership changes do not falsely make
a previously verified semantic checkpoint unconfirmed. If newer authoritative
state exists, cold recovery does not replay an older draft as current.

**Commit pending state and release** verifies any pending write, then releases the
checkout. Successful meaningful turns are already checkpointed, so recovery does
not depend on a graceful browser close. **Discard uncommitted local update**
clears only pending browser work and retains Drive evidence/current state. It is
not a retrospective erasure feature. Browser-local raw history and drafts remain
transient; no browser-local store is authoritative.

## Scope and history boundaries

New journal turns carry scopeId; supporting turns cannot cross scopes. In-page
conversation and affect are selected by scope. Unscoped legacy turns without
scope-bearing receipts remain inspectable but are not presumed safe global model
context. No historical file is rewritten to guess its scope.

Project journal files use `aidaMemory: recent-project-v1` in the **same folder and
journal implementation**. The new reader understands both markers. This prevents
old previews from automatically treating new private project dialogue as global
RECENT. The legacy global Sleep path reads only global journal entries until it
becomes scope-aware. Project history remains accessible to the existing scoped
evidence reader; automatic reads are still bounded to twelve linked checkpoints.
All retained original journal files remain in Drive for deeper/manual inspection.

The current package stores at most three whole eligible exchanges / 6,000 text
characters; larger raw evidence remains in the journal. Current meanings retain
existing capacity limits. Ordinary ephemeral consultations and explicit opt-out
do not gain permanent interpretations. Checkout metadata is operational, not
personal memory. Pending reflections have a validated, scope-owned read interface;
no Diary/Librarian/reflection generator was implemented. Theater is unchanged.

## Ordinary-interface acceptance procedure

After separately authorized preview publication, authorize the intended account
normally. No token/key is copied to Cody. Checkout writes only optional metadata
to the existing selected context file; meaningful turns append scoped journals
and update that context. Original first memory and unrelated Drive files remain
unchanged. A new project requires the existing separately confirmed creation flow.

1. In Everyday, discuss a meaningful synthetic plan. Inspect the actual request,
   proposed changes, validation, committed revision and recovered readback under
   **Living Mind → State evolution**. No Remember, Sleep or review acceptance.
2. Release, close the page and open a genuinely fresh browser. Check **On New
   conversation, exclude recovered conversation text**, then New conversation.
   Ask about the plan. Verify the outbound request has current SHORT/LONG and no
   original conversation text. A plausible reply alone does not pass.
3. Correct a detail while preserving the goal; repeat cold recovery and inspect
   supersession/provenance. Exercise a legitimate no-change turn.
4. Select one registered development project. Repeat meaningful SHORT update,
   verified commit, release and fresh-session recovery. Select Everyday and a
   different project and verify the private project's details are absent.
5. An active/interrupted checkout must warn; explicit takeover must invalidate
   the prior writer without losing newer current understanding.

No live provider call, Drive mutation or deployment was performed for local tests.
Local verification: 156/156 automated tests passed; the loopback HTTP module/style
graph loaded all 36 referenced files successfully. These checks use synthetic
memory/provider data and static assets, not authenticated Google Drive.
The existing authorization flow also performs provisional-journal expiry cleanup;
that pre-existing effect must be disclosed when authorizing a live rehearsal.
Real ETag/If-Match behavior, browser CORS, actual semantic model responses and
cross-device acceptance remain unverified until this procedure is authorized and
run. Do not claim the mission's real-conversation goal from synthetic tests.
