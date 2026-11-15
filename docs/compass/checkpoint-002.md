# Aida’s Compass — Checkpoint 002

**Aida with her mobile interface and restored emotional portraits**

- Comparison: [Compass Baseline 001, November 14, 2026](https://github.com/ArisTGwetta/one-aida-many-rooms/blob/b7955c00851c04e84c6a2a97cae2eb12b05d0a47/docs/compass/baseline-001-2026-11-14.md)
- Tested source: `f3c24d1301dde790d8e601a99ac040c1af7dbd99`
- [Live portrait preview](https://aristgwetta.github.io/one-aida-many-rooms/preview/f3c24d1/) · Pages publication commit `0e593a3e2ec0b2f427d36f89debd97d65ee73bbe`

## Acceptance and verification

**User-observed live evidence:** A successful mobile conversation on the preview displayed `happy1.png`. This verifies one real mobile conversation and one portrait display. The observation does not establish which affect coordinates produced that image or verify other expressions on a phone.

**Local automation:** All 44 tests passed. The portrait test checks all 19 historical coordinate points, asset availability and PNG signatures, neutral startup, and invalid input. The display fixture verifies a non-emotion image and the missing-image placeholder, including protection against a stale image error. The local route test verifies binary PNG serving. [Portrait tests](../../emotion-portrait.test.mjs) · [Local server test](../../dev-server.test.mjs)

**Code inspection:** Classic is the default and the mobile header offers a return to Classic. View switching moves and restores the existing DOM nodes, associates the moved controls with the existing form, and makes no provider or Drive calls. A presentation event passes validated affect coordinates to the portrait adapter. The conversation, memory, provider, steward, skill registry, and OAuth modules match Baseline 001. [Shared controls and view switching](../../mobile-view.mjs) · [Display renderer](../../visual-display.mjs)

## Compass comparison

| Items | Checkpoint status | Evidence delta |
|---|---|---|
| 1–3 · Identity and continuity | PARTIAL, PASS, PASS | An additional mobile conversation is live-verified. Cross-device continuity across rooms remains open. |
| 4–7 · Memory and understanding | PASS, PARTIAL, PARTIAL, PASS | No change established. Existing Remember/Recall, context update, source validation, and project-scope regressions passed. |
| 8–11 · Capabilities and rooms | PARTIAL, PASS, PASS, NOT IMPLEMENTED | Existing dispatch and confirmation tests passed. The Baseline 001 Lighthouse acceptance still stands. Snail integration remains outside this checkpoint. |
| 12–15 · Awake, asleep, and presence | PARTIAL, PARTIAL, PARTIAL, PARTIAL | Item 14 gains a live mobile reply and displayed portrait, plus automated verification of the separate visual surface and fallback. No status upgrade is warranted. |

No blocking regression was identified. The established suite does not verify repeated Classic/Mobile switching with a live draft and conversation, phone keyboard and Send placement, long-reply scroll anchoring, or all mobile controls in both themes. Live portrait variety, missing-image behavior, cross-device room continuity, generic project creation, and Ollama remain unverified. No provider conversations, Drive writes, or deployment were performed for this checkpoint.
