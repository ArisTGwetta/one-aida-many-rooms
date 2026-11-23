# Bounded prompts and session-local RECENT+ v1

Local implementation on aida-v1, November 22, 2026. No publication authorization
is exercised here; CURRENT, CANDIDATE and the Pages ref remain unchanged.

## Boundaries and behavior

- LONG: living charter/overall status. SHORT: current-stage progress and next steps.
  RECENT+: earlier conversational unfolding. RECENT: latest actual exchanges.
  Everyday continuity uses the same distinctions without compulsory project structure.
- Ordinary Chat opts into the new path. Earlier module callers remain compatible;
  this is not another app, deployment lane, provider or memory store.
- Normal RECENT retains three exchanges. When another exchange would displace one,
  the existing conversational model call receives the previous RECENT+ and only the
  retiring exchange as consolidation input. No extra model call or background loop.
- New RECENT+ is an independently validated, scope-bound response field. The strict
  awake evaluation contract remains intact. Every supplied evaluation evidence ID
  must still be echoed exactly once. Already-reviewed twenty-exchange replay is
  disabled on this path: the review packet uses current actual exchanges, pending
  evidence and incoming message (normally at most seven sources). Twenty-turn,
  pre-compaction and Sleep reflection triggers remain mandatory.
- At checkpoints the model sees current semantic understanding, prior conversational
  consolidation, source-linked observations and current review evidence. RECENT+
  sources are derived references, never newly supplied original evidence for facts
  or semantic updates. Targeted retrieval of older original text is a remaining
  limitation; no new retrieval skill is added.
- Consolidation has a request ID, scope and expected base revision. Only retiring
  sources and previous-summary aliases may be cited. Maximum eight entries and 800
  o200k_base reference tokens including metadata. Unknown sources, stale bindings,
  malformed or oversized replacements fail closed before stewardship applies the
  turn. A failed turn does not replace RECENT+, advance meaning or release evidence.
- Session-local lineage resolves current summary aliases to original turn IDs. It is
  inspectable but absent from prompts and persistence; each entry is capped at 512
  original references. Previous summary aliases do not leave dangling provenance.
- Retired raw exchanges remain session-local for existing explicit save choices,
  subject to the existing 2 MiB cap. They are not replayed in ordinary prompts.
  Retained results omit repeated frozen context/envelope copies. Disposal clears
  summary and lineage. Understanding-only saving never serializes RECENT+; original
  exchange preservation still requires the existing explicit choice. No durable
  schema or project-memory subsystem is introduced.

## Prompt assembly and accounting

Only the transport copy is projected. It carries one selected semantic package,
plus authorized global understanding for a project and the compact project directory.
Continuity duplicates become explicit stateRef pointers. Trusted skill handlers,
validation and persistence keep complete host-side state. No relevant memory is
silently dropped to fit a budget. An oversized request fails with counts and retains
retry state. First memory/canonical FACTs remain inputs to the normal assembly.

A locally owned js-tiktoken 1.0.21 core/o200k_base reference tokenizer counts context,
instructions and schema separately, including skill descriptions and output schemas.
No tokenizer service or runtime external path is needed. The ranks cost 2,325,563
uncompressed bytes (local gzip measurement 1,136,500); phone loading/memory impact is
unverified. Vendor provenance, archive checksum, MIT license and the tiny atob adapter
are in vendor/tokenizer. No package install or startup script was executed.

Application trial budget profiles (not claims about model context limits):
- OpenAI: 20,000 total accounted tokens, 20% input safety margin.
- Ollama: 16,384 total, 35% input safety margin for tokenizer uncertainty.
- Input reference count includes instructions + schema + context, with a 64-token
  framing allowance. Reserve the existing response ceiling (normally 2,000, checkpoint
  3,000). Existing image limits remain; image requests additionally reserve 4,096
  tokens, a conservative allowance rather than measured vision-token accounting.
- o200k_base counts are actual reference-BPE counts, not verified hosted billing or
  Ollama-native counts. Margins are estimates and need live calibration. Existing
  48 KiB envelope controls also remain. Sleep/Library-specific provider contracts
  and Theater's independent transport are unchanged.
- Development Evidence includes per-call promptBudget; the Living Mind inspector
  shows RECENT+ and its original-source mapping. Diagnostics contain no private text.

## Verification and measurements

196/196 full offline tests; 58 memory-bridge tests and three local-server tests.
The thirty-turn test runs the real ordinary Chat handler, actual provider adapter,
parser and steward with scripted model interpretation and synthetic Drive doubles.
It runs once for Everyday and once for project:atlas. Each completes 27 successful
consolidations; an injected turn-eleven invalid citation preserves the last good
summary, structured state, raw window and same-source retry. Turn twenty retains its
mandatory review trigger. A later correction replaces an earlier reference and
survives repeated consolidation. Prompt size stabilizes; no private project details
enter another scope. Temporary disposal/reload and understanding-only preservation
for both Everyday and projects exclude summary and lineage from durable records.

Representative measured turns 24–30: approximately 7.2k input reference tokens for
Everyday and 7.4k for the project, including roughly 2.4k instruction tokens, 2.6k
schema tokens and 2.2–2.5k context tokens. Envelope sizes are about 8.8/9.8 kB.
The trial summary uses roughly 170–190 reference tokens, below its 800-token cap.
UUID tokenization causes small variations; tests bound the warm-window spread to
150 reference tokens. These are synthetic measurements, not live success claims.

Other regressions verify source/shape/stale/budget rejection, exact no-change review,
provider-aware total-budget failure before transport with safe retry, original-source
lineage, one semantic projection per scope, directory-only unrelated projects,
no implicit LONG/SHORT promotion, no original-memory changes, and full module serving
through the existing restricted loopback route. Earlier Theater, skills, Glasses,
Snail, provider/credential, retention and Drive tests remain green.

## Attention acceptance criteria and remaining limits

The architecture also requires strategic attention: new priorities load the relevant
charter and stage context; displaced unfinished initiatives leave active semantic
context while authorized directory pointers permit later recovery. Inactivity must
not imply completion/cancellation. Future acceptance should cover design -> shopping
-> construction -> growing, with bounded stage replacement and historical retrieval.
This increment DOES NOT implement priority ranking, semantic retirement/many-to-one
replacement, automatic project preservation, new archive retrieval or a Librarian.

Live gates remain real model consolidation quality, actual provider schema acceptance
and token usage, natural corrections/uncertainty, phone performance, and separately
authorized durable recovery. Scripted tests prove boundaries and accounting, not
that an LLM preserves meaning. Budget overflow fails safely rather than guaranteeing
an arbitrarily large context will fit. No paid calls, live Drive writes, browser-tab
interactions, OAuth changes, pushes or deployment were performed for this increment.
