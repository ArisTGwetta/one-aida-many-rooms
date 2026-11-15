# Glasses V1.1 checkpoint and V1 capability inventory

- Source: `84875ab123a36ee429c5189c1711631e57c16930` on `glasses-v1-1`, tagged `checkpoint/glasses-v1-1`.
- [Accepted preview](https://aristgwetta.github.io/one-aida-many-rooms/preview/84875ab/) · Pages publication `784d8c5476beee239be185bbbcd770997f637082`.
- Descends from protected `checkpoint/welcome-library-v1` at `26c643d`, via Shared Library Evidence `9aff7e2` and Glasses V1 `bcff022`. Compass 001 and Checkpoint 002 remain separate records.

## Human acceptance

Francisco reported that Aida accurately described her proposed digital portrait, discussed painterly and anime-style telescope images, and handled an oversized image. In his published illustrated book *There Is a Ghost in the House*, Aida discussed all 12 pages sequentially, interpreted illustrations in the developing narrative, and kept the conversation usable throughout. She sometimes confused characters or speakers and accepted corrections, including Grandma’s ghost versus Grandpa. She sometimes described earlier pages as unseen. Glasses sends only the active page on each request. Live New, replacement, Clear, failure handling, and phone-specific behavior remain unverified in this record.

## Capability inventory

| Capability | Status | Evidence |
|---|---|---|
| Welcome, authentication, Google OAuth | PASS — automated only | Shared entry-point and OAuth fixture tests; Francisco accepted Welcome and authentication at `26c643d`. No fresh/cancelled auth test was recorded for this candidate. |
| Shared Chat and conversation continuity | PASS — live verified | The 12-page conversation stayed usable. Cross-device and older-room recovery are separate gaps. |
| Aida portrait and shared composer | PASS — automated only | Renderer and shared composer fixtures. Mobile `happy1.png` display was accepted at Checkpoint 002. The inspected portrait in this acceptance is an input, separate from Aida’s own expression surface. |
| Library / Remember | PASS — automated only | Dispatcher and reference tests; live first-memory retrieval was accepted at `26c643d`. |
| Aida-proposed search terms | PASS — automated only | One-call and no-write fixtures. Steps 1–4 passed on the earlier Shared Library Workbench preview. |
| Library evidence in conversation | PASS — automated only | Mocked outbound provider request verifies bounded result content, source, and selection. No live rerun reported here. |
| Glasses attachment and direct vision | PASS — live verified | Francisco’s portrait and style discussion. Mocked transport independently checks exact image bytes in a separate provider part. |
| Image adaptation and source metadata | PASS — live verified | Oversized file succeeded. Original bytes, dimensions and hashes are covered by automated checks. |
| PDF rendering, order, navigation and follow-ups | PASS — live verified | All 12 illustrated pages discussed in order; existing renderer smoke and mocked wire tests corroborate. Character fidelity remains imperfect. |
| Project association and manual correction | PASS — automated only | Fixtures verify scoped context and explicit change. The actual project ID in the live book conversation was not inspected. |
| Clear / New / Save | PARTIAL | Automated invalidation and replacement coverage. Live use unverified. Save discloses unavailable durable artifact storage. |
| Retention options | PASS — automated only | Existing disposition and recovery tests plus compatible receipt validation. |
| Sleep, proposals, review and approval | PARTIAL | User observed diary proposals after the book. Historical review acceptance and current tests support review, corrections and FACT approval. Project SHORT/LONG handoff is absent. |
| Provider authorization and cloud notices | PASS — automated only | Scoped route and credential fixtures, fixed hosted OpenAI path for pixels, visible notice in markup. No fresh authorization or notice behavior measured live. |
| Shared Google Drive memory | PASS — automated only | Adapter and fresh-client journal fixtures. Earlier first-memory desktop/iPhone acceptance and Welcome Remember retrieval remain historical evidence. |
| Budget and meter | PASS — automated only | Usage and estimated-cost tests; no current live billing reconciliation. |
| Snail document discovery | NOT IMPLEMENTED | Snail Mini remains gated on a private Drive binary-fetch check and actual phone performance. |

## Verification credibility

- `node --version`: Node.js `v24.21.0`. `node --test`: 57 passed, 0 failed, 0 skipped, 289 ms runner time.
- `node --test --test-name-pattern='PDF pages invalidate' glasses.test.mjs` in a disposable archive: removing the synchronous clearing of old pixels gave one expected assertion failure. Restoring the original bytes gave one pass in 94 ms. SHA-256 verified restoration. The source worktree was never modified.
- Existing fixtures mock HTTP provider and Drive calls and parts of image and canvas preparation. They verify data flow and policy, without establishing live model accuracy.
- Prior publication smoke used a disposable Node harness launching headless Chrome with a loopback synthetic 2-page PDF. The real vendored worker rendered red then blue and the harness sampled the rendered pixels. Installed desktop Chrome at this checkpoint: `157.0.8103.52`. This fixture was not rerun during registration. No phone rendering, paid API, live Drive read/write, or browser acceptance was initiated for registration. The human observations above are separate.

## Continuity finding

Successful visual turns can carry a validated historical visual receipt with initiating room/project, current project, change flag, time, filename, original/prepared hashes, adaptation flag, page and count, and user/Aida source references. The observation is the existing Aida reply referenced by the receipt; the receipt contains no duplicate reply and no pixels. The existing retention decision determines whether the turn is saved in RECENT. Sleep includes the optional receipt next to the Aida message for an eligible saved turn. Therefore the project ID can reach Sleep when retained, but the live book record was not inspected to prove which receipts reached that run. Sleep routes proposals to global `aida/<category>` destinations and only supports canonical commit for eligible accepted FACTs. It has no project SHORT/LONG commit or briefcase handoff. RECENT can recover retained user and Aida text in its bounded window without reopening an image. Conversation assembly currently flattens recovered turns to text and does not forward the historical visual receipt, so richer provenance-based recall beyond those turns is unverified.

## Remaining work and order

1. Complete a bounded human acceptance pass for replacement, Clear, invalid files, project change, and actual phone behavior. Watch for page/character confusion and distinguish active-page pixels from remembered discussion.
2. With approval, inspect a specific retained book turn and Sleep input read-only. Decide project routing and review authority before a small project SHORT/LONG handoff. Checkpoint 001 also leaves cross-device room continuity, live generic project creation, full sleep reconciliation, and live Ollama/cost behavior open.
3. Keep Snail Mini in the V1 punchlist per the earlier design. Its private binary fetch and real iPhone parse/search gates remain open. No index replacement is planned.
4. Durable artifact Save, fuller historical-image recall, room-visit summaries, shared workbench expansion, and whole-book ingestion require separate scope decisions. Additional post-V1 extensions such as RPG and Uncle Chatt are outside this checkpoint.

No runtime changes, changes to protected checkpoints or releases, merges, or deployments were made.
