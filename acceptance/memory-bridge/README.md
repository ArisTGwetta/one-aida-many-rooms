# Mission 008C — disposable browser rehearsal

Local implementation only. No publication or live writes have been performed.
This harness imports the exact Memory Bridge production modules; the ordinary
application, OAuth configuration and Theater are unchanged. It does not import
providers, browser API-key loaders, Sleep or Theater. All proposals are visibly
synthetic fixtures. No model service is called.

## Side-effect trace and isolation

The normal context initializer reserves folder appProperties, creates the global,
project-catalog and capability-catalog JSON records, and marks initialization.
`createProject` additionally reserves a project pointer, creates its continuity,
sets readiness, and updates the catalog. The bridge creates RECENT journal/receipt
files and conditionally updates the continuity file. There is no separate project
index, memory database or production manifest in these paths.

All those effects are redirected through existing folder-ID and fetch-injection
interfaces into a new run-owned folder. No production seam or check was weakened.
The real development folder is read only, including its appProperties fingerprint.
The harness never loads its catalogs, first-memory content or personal projects.
It never changes the real folder's pointers. No new sharing permissions are set.

Two nested folders are required because `verifyFolder` intentionally requires the
fixed development-area name. The outer folder carries a unique visible test label;
the inner folder preserves that fixed name, carries the same run marker, and is
the normal adapter's isolated store.

## Exact planned Drive manifest

After normal browser sign-in, **Prepare** verifies the configured development
folder and reserves 14 IDs using the real Drive `generateIds` API. It checks each
reserved ID is absent. This makes no file/content writes. The browser displays
all IDs, exact names, parents and types before execution can be confirmed.

| Count | Artifact | Allowed writes |
| --- | --- | --- |
| 1 | `AIDA-MEMORY-BRIDGE-TEST-<run UUID>` under the real development folder | Create with run marker; verified cleanup |
| 1 | Inner `AIDA — ONE AIDA MANY ROOMS — DEV` under that container | Create; synthetic context initialization/project pointers; cleanup |
| 1 | `aida-context-global.json` | Create empty; **all subsequent content updates forbidden**; cleanup |
| 1 | `aida-context-projects.json` | Create empty; register only the synthetic project; cleanup |
| 1 | `aida-context-capabilities.json` | Create empty; cleanup |
| 1 | `aida-context-project-mb-test-<run UUID>.json` | Initial LONG/SHORT; expansion, uncertainty, correction; expected rejected stale writes; cleanup |
| 8 | `aida-recent-<preselected turn UUID>.json` | Three meaningful checkpoints, four later retained exchanges, one rejected stale-checkpoint evidence record; cleanup |

Project ID: `mb-test-<run UUID>`. All journal conversation/turn IDs are synthetic.
Existing production initialization and journal interfaces accept reserved IDs;
the harness uses those interfaces, never fabricates successful Drive responses.
Its network guard permits only the listed creations and mutations of verified
run-owned IDs. Production list/read calls are scoped to the inner store. Real
Drive responses and conditional headers pass through unchanged.

## Browser procedure (after separate publication approval)

Proposed entry:
`https://aristgwetta.github.io/one-aida-many-rooms/preview/a0aa76d/acceptance/memory-bridge/`

1. Open the isolated harness. It checks `location.origin` against the existing
   config. Localhost is not assumed authorized and no local OAuth override exists.
2. Choose **Authorize Google Drive and prepare plan**. Use the intended account.
   The existing `authorize` helper obtains the token into browser memory only.
3. Inspect the exact target, run UUID and 14 planned artifacts. Check the explicit
   confirmation and choose **Run disposable test**. It cannot execute twice.
4. Inspect PASS/FAIL/BLOCKED and the actual ID/version/write/status ledger. A failure
   stops later tests; they remain BLOCKED. A stale conditional update must receive
   HTTP 412 and leave the newer record unchanged; otherwise it fails acceptance.
5. Download the credential-free report. Separately confirm **Cleanup**. Reauthorize
   with the same button if the token expires; do not copy or paste a token.
6. Download the final report and close the page only after inspecting cleanup.

The test reconstructs new readers/stewards without supplying recovered turns,
after pushing the checkpoint out of the three-exchange journal window. This is
cold-context recovery inside one browser, not a claim of physical second-device
acceptance. It does not require reloading the harness page. A reload loses the
token and run controller; use a saved report to identify retained artifacts. No
automatic recovery/deletion by name is implemented.

## Cleanup authority

Cleanup uses the existing recoverable `trash(fileId)` method, never permanent
delete. Each target must have been created and readback-verified by this exact
run, retain its expected name/parent/type, and match the last observed write
version. Unknown/lost write outcomes stop cleanup. There is no traversal-based
deletion: only manifest IDs can be trashed. A one-item emptiness check before
trashing each known folder protects unexpected children; it never deletes those
children. On uncertainty, retain and report exact IDs. Cleanup can resume after
reauthorization; it never automatically adopts a changed version.

Versions are checked before recoverable trash; this is not an atomic lock against
an adversarial concurrent editor. The test namespace is intended for one operator.
The guard and exact-ID ownership checks prevent touching unrelated records.

## Publication proposal and local verification

`publication.json` is the exact **12-file** runtime allowlist. Seven production
modules and the unchanged OAuth config are copied byte-for-byte from committed
Git blobs (not Windows CRLF working copies); four harness
runtime files are added. Tests, documentation, synthetic HTTP doubles, and normal
Aida/Theater UI are excluded. The only external script is existing Google Identity
Services. Drive is the only API destination. Tokens, headers, response bodies and
private memory are absent from reports/downloads/logs.

The package test follows all local module imports, scripts, styles and config
references. It constructs the proposed additive Git tree in memory from the
existing publishing artifact, compares every original blob, and checks the prefix
is unused. It creates no publishing ref, worktree or deployment. Publication must
recheck the live source head and stop on differences.

Run locally with synthetic data: `node --test acceptance/memory-bridge/*.test.mjs`.
Full regressions: `node --test`. These prove local behavior, not browser CORS,
Google's live ETag contract, or actual browser sign-in. Those remain live gates.
