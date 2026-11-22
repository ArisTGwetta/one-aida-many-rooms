# One Aida, Many Rooms — repository instructions

## Start here

- Repository: `ArisTGwetta/one-aida-many-rooms`.
- Normal home: `C:/Users/arist/Documents/Codex/One-Aida-Many-Rooms-Canonical`.
- Normal branch: `aida-v1`. Check path, branch, HEAD and status before work.
- Do not develop from a Pages artifact or an older `One-Aida-Many-Rooms-*` folder.
- Read `docs/architecture/memory-contract-v1.md` and `docs/missions/ledger.md` before memory/architecture work. The contract is normative; component limits do not redefine it.

## One home, disposable experiments

Git commits and tags are restore points. Do not create a new Aida folder for each mission, date or version. Use this home for normal work. A temporary branch/worktree needs an explicit purpose and exit condition; it must never silently become canonical. Integrate successful work, verify it here, secure useful history, then remove the redundant worktree. Failed experiments need not retain working directories indefinitely.

Before cleanup verify the resolved target, tracked/untracked/ignored state, history backup, and absence of runtime dependencies. Use Git worktree removal for linked worktrees. Never delete a shared Git database, unrelated project, credential, personal file or Drive resource. Retain ambiguous unique data. Do not publicly import old donor/private author history to preserve a disposable checkout.

## Change safety and authority

- No finished Aida is assumed. Preserve agreed architecture, accepted work, assets and recoverable history; failed implementations are not architectural requirements.
- LLMs interpret meaning. Deterministic code validates sources, scope, authority, persistence and retrieval. Avoid expanding phrase-rule substitutes for understanding.
- Keep skill execution out of the Director. Keep Theater META/GAME, character knowledge, diagnostics and everyday memory isolated.
- No second memory system or legacy runtime paths. Adopted donor resources must be copied into owned modules/assets.
- Keep credentials out of source, logs and reports. Reuse existing OAuth; no Cloud changes without need and authorization.
- Paid provider calls, live Drive mutations, deployment and unrelated infrastructure changes require current task authorization. A source push is not deployment approval.
- Identify shared-module/schema changes before implementation. Ask only for genuinely new scope, architectural conflict or risk of unique data loss; do not repeatedly request granted approval.

## Two-version deployment policy

- The only active user-facing slots are `/current/` (last designated working
  version, held unchanged until explicit user acceptance) and `/candidate/`
  (the single version under development/live acceptance).
- Publish repairs and later increments into CANDIDATE in place. Do not create new
  commit-named preview deployments, daily deployment folders or parallel apps.
- Passing automated tests does not accept CANDIDATE. Promotion to CURRENT requires
  explicit user acceptance. Preserve CURRENT runtime bytes until then.
- Git commits/tags provide history and rollback. Before retiring a historical
  preview, classify it, verify Git recovery and dependencies, and preserve existing
  accepted deployments and working entry points. Do not rewrite Git history.
- Use the existing Pages source and Google OAuth configuration. Slot publication
  never authorizes provider calls, Drive writes or changes to memory policy.
- Record exact source and publication commits separately; documentation-only
  development commits do not change the source served by a slot.

## Verification and closeout

Run `node --test` here and relevant focused checks. The static ES-module app has no build/install step. `node dev-server.mjs` serves loopback; preserve route/origin restrictions. Do not assume localhost Google OAuth is authorized. Static verification needs no provider call.

Component tests are not proof of live memory. Primary gates: automatic SHORT persistence, real cold-start recovery and correction; then SHORT→LONG, belief evolution, scope/retention and reconciliation. Distinguish simulated tests, live observations and open gates.

Update the ledger, commit useful work and push when authorized. Report canonical path, branch, source commit, source publication, deployment URL/commit, worktree status and live gaps. Preserve the designated ordinary preview until its replacement passes separately authorized live acceptance.
