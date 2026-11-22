# CURRENT and CANDIDATE

November 22, 2026. User-authorized replacement for per-feature numbered previews.

- CURRENT: https://aristgwetta.github.io/one-aida-many-rooms/current/
- CANDIDATE: https://aristgwetta.github.io/one-aida-many-rooms/candidate/

These are two deployment slots for the same Aida and authorized Drive store,
not separate identities or memory stores. The existing Pages source remains
`pages-preview-7827a28` at `/`; Google OAuth uses the unchanged existing origin.

CURRENT remains byte-for-byte at its designated source until Francisco explicitly
accepts CANDIDATE. Automated tests, deployment success and plausible replies are
not acceptance. CANDIDATE is repaired in place and reused for the next increment.
Promotion copies the accepted runtime into CURRENT and records the exact source
commit; it is not permission to alter Drive memory.

Runtime provenance is recorded in each slot's `deployment.json`. Source commits
and publication commits are distinct. Historical publication commits preserve
the exact prior trees for rollback, without requiring live per-commit deployments.

Original Mission 008 candidate source `252f4b18ec5f379c570f14d7ffe631daa34e26b9`
was rejected. The recovery replaces CANDIDATE in place; read
`/candidate/deployment.json` for its exact runtime source commit.
CURRENT source: `c1c6fb59191d9c40f2e77eb15233cba6da54593a`, explicitly
confirmed by Francisco as the retained everyday baseline with known limitations.
Do not substitute an older Theater checkpoint based on its test record.
Its real model-generated changes, Drive persistence, fresh-session recovery,
corrections and Everyday/project isolation remain live acceptance gates.

## Historical entry points

The redundant `/preview/252f4b1/` package is retired into CANDIDATE; its entry
redirects to the stable slot, preserving query parameters and fragment. It is no
longer a second independently maintained candidate. Its original runtime remains
recoverable in publication commit `ed84be4e24725033cf979b5be8c5aa81e7f5c2a9`.

Older accepted previews and the root are preserved during this transition. They
are historical compatibility entry points, not additional active development
slots. No further feature previews may be added. Broader retirement must first
classify acceptance/dependencies; this change does not guess that an older
accepted deployment or pending test harness is safe to delete.

No live provider calls, sign-in, Drive writes or OAuth configuration changes are
part of deployment cleanup. Path changes retain the same origin and credentials
remain in browser memory; opening a new path does not transfer an old tab's token.
