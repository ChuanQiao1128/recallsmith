# Draw v9 Agent Memory

This file is append-only memory for the draw animation autopilot loop.
Each run appends failures, proposed fixes, and stable decisions so next runs
can continue from current behavior without rediscovering context.

## 20260506-011910 cycle 1 :: A/HomeScreen :: FAIL
- time: 2026-05-06 01:40:22 NZST
- review: docs/design/v9-draw-final-spec-and-qa.md
- log_dir: docs/qa/autopilot-logs/20260506-011910-A-HomeScreen
- critic_status: fail
- critic_total_score: 81
- p0_count: 1
- top_findings:
  - [P0] docs/qa/autopilot-logs/20260506-011910-A-HomeScreen/2-gate-status.txt:4: Mandatory gate failure: `gate-screen-lines` is `FAIL`, so the HomeScreen phase gate is not passable in this run.
    fix: Resolve the over-limit screen line counts reported in `docs/qa/autopilot-logs/20260506-011910-A-HomeScreen/2-gate-lines.log` (or scope the phase gate so unrelated oversized screens do not block HomeScreen QA).
  - [P1] src/screens/HomeScreen.tsx:350: CTA meaning and behavior diverge when pulls exist: label is forced to `Open {deckTitle}` (`primaryCtaLabel`), but on press it can still route to `Challenge` via `homeState.vm.cta.nav` in `handlePrimaryCta`, which breaks v9 Home reward-gateway clarity.
    fix: Bind CTA label and navigation to the same source of truth: when showing `Open {deckTitle}`, route to `Draw`; otherwise keep challenge/library labels and routes aligned.
  - [P1] src/screens/HomeScreen.tsx:408: Home above-the-fold does not implement the v9 `pack-first visual` requirement; the primary card is text/metrics-only and lacks a reward-pack focal surface.
    fix: Add a pack-first hero visual block (with clear locked/available state) in the primary section while preserving one dominant CTA and secondary study link hierarchy.
- gate_status:
  - PASS typecheck
  - PASS unit
  - PASS integration
  - FAIL gate-screen-lines
  - PASS gate-inline-hex
  - PASS gate-loss-words
  - FAIL critic

## 20260506-011910 cycle 1 :: D/DrawScreen :: FAIL
- time: 2026-05-06 01:58:28 NZST
- review: docs/design/v9-draw-final-spec-and-qa.md
- log_dir: docs/qa/autopilot-logs/20260506-014022-D-DrawScreen
- critic_status: fail
- critic_total_score: 84
- p0_count: 0
- top_findings:
  - [P1] docs/qa/autopilot-logs/20260506-014022-D-DrawScreen/2-gate-lines.log: Gate failure is still present: `gate-screen-lines` fails because `src/screens/DrawCeremonyScreen.tsx` (1474) and `src/screens/DrawResultScreen.tsx` (859) exceed the <800-line static limit required by AGENTS.md §5 and v9 gate matrix.
    fix: Refactor `src/screens/DrawCeremonyScreen.tsx` and `src/screens/DrawResultScreen.tsx` into smaller screen+helper/component units until both are <800 lines, without changing DrawScreen behavior.
  - [P2] tests/integration/draw.screen.test.tsx: The DrawScreen timeout contract is implemented (`arm` auto-reset after 4500ms) but not directly asserted in integration tests, leaving a regression gap for v9 Draw interaction checklist item 2.1(4).
    fix: Add a fake-timer test that arms the pack, advances time past 4500ms, then verifies both `screen-draw-primary-cta` and `screen-draw-secondary-cta` are disabled again and unarmed hint copy is restored.
  - [P2] docs/qa/autopilot-logs/20260506-014022-D-DrawScreen/1-repair-output.txt: Responsive QA evidence is incomplete for DrawScreen: the log explicitly says 360/375/390/430 simulator screenshot validation was not run, so width-contract compliance is inferred rather than proven.
    fix: Run iOS simulator checks at 360/375/390/430 for DrawScreen and archive screenshots under `docs/screens/v7/<scenario>/<width>/` per AGENTS.md.
- gate_status:
  - PASS typecheck
  - PASS unit
  - PASS integration
  - FAIL gate-screen-lines
  - PASS gate-inline-hex
  - PASS gate-loss-words
  - FAIL critic

## 20260506-011910 cycle 1 :: D/DrawCeremonyScreen :: FAIL
- time: 2026-05-06 02:19:00 NZST
- review: docs/design/v9-draw-final-spec-and-qa.md
- log_dir: docs/qa/autopilot-logs/20260506-015828-D-DrawCeremonyScreen
- critic_status: fail
- critic_total_score: 87
- p0_count: 1
- top_findings:
  - [P0] /Users/qc/Desktop/DeveloperCards/recallsmith/mobile/src/screens/DrawResultScreen.tsx: Gate file `/Users/qc/Desktop/DeveloperCards/recallsmith/mobile/docs/qa/autopilot-logs/20260506-015828-D-DrawCeremonyScreen/2-gate-status.txt` reports `FAIL gate-screen-lines`; the offender is `DrawResultScreen.tsx` at 859 lines, violating the v7 hard limit for non-`ReviewScreen` screens.
    fix: Refactor `DrawResultScreen.tsx` into directly related shared components/helpers and reduce the screen file below 800 lines without changing existing route/testID behavior.
  - [P2] /Users/qc/Desktop/DeveloperCards/recallsmith/mobile/tests/integration/draw-ceremony.screen.test.tsx: The integration suite does not explicitly assert the full six-phase order and per-phase timing windows from `docs/design/v9-draw-final-spec-and-qa.md` (`swipe -> approach -> hold -> tear-flip -> flash-reveal -> settle`), leaving a regression gap for cadence/order changes.
    fix: Add deterministic timer-bound assertions for each phase transition and window compliance in `draw-ceremony.screen.test.tsx` (single and ten-draw paths).
- gate_status:
  - PASS typecheck
  - PASS unit
  - PASS integration
  - FAIL gate-screen-lines
  - PASS gate-inline-hex
  - PASS gate-loss-words
  - FAIL critic

## 20260506-011910 cycle 1 :: D/DrawResultScreen :: PASS
- time: 2026-05-06 02:34:28 NZST
- review: docs/design/v9-draw-final-spec-and-qa.md
- log_dir: docs/qa/autopilot-logs/20260506-021900-D-DrawResultScreen
- critic_status: pass
- critic_total_score: 88
- p0_count: 0
- top_findings:
  - [P1] /Users/qc/Desktop/DeveloperCards/recallsmith/mobile/src/screens/DrawResultScreen.tsx: Primary CTA routing depends on `remainingPulls` initialized to `0` until `loadRewardWalletState()` resolves (lines 131-157). A fast tap can navigate to `Library` even when pulls actually remain, which conflicts with the v9 branch contract (`Continue draw` -> `Draw` when pulls remain).
    fix: Gate the primary CTA until wallet state is resolved (disabled/loading state), or pass pull count synchronously via route params and use that as the initial source of truth.
  - [P2] /Users/qc/Desktop/DeveloperCards/recallsmith/mobile/src/screens/DrawResultScreen.tsx: The transient absolute registration pill (`registerVisible` + `registerPill`) appears above the header on first render (lines 252-268), temporarily competing with the intended top-level result hierarchy and increasing narrow-width clipping risk due long one-line bilingual copy.
    fix: Demote this pill to a lower visual priority location (below header/collection bar) and constrain width/overflow (`maxWidth` + truncation) for 360pt stability.
- gate_status:
  - PASS typecheck
  - PASS unit
  - PASS integration
  - PASS gate-screen-lines
  - PASS gate-inline-hex
  - PASS gate-loss-words
  - PASS critic

## 20260506-011910 cycle 1 :: C/LibraryScreen :: FAIL
- time: 2026-05-06 02:49:43 NZST
- review: docs/design/v9-draw-final-spec-and-qa.md
- log_dir: docs/qa/autopilot-logs/20260506-023428-C-LibraryScreen
- critic_status: fail
- critic_total_score: 89
- p0_count: 0
- top_findings:
  - [P1] /Users/qc/Desktop/DeveloperCards/recallsmith/mobile/src/features/gacha/library/libraryMapper.ts:17: v9 Library handoff contract calls out `Missing` terminology, but the current user-facing status vocabulary is only `New/Learning/Mastered`; `Missing` is never surfaced.
    fix: Introduce `Missing` as the user-facing label for stage-0/uncollected state (while keeping filter keys stable if needed), and keep dimmed styling tied to that state.
  - [P1] /Users/qc/Desktop/DeveloperCards/recallsmith/mobile/src/screens/LibraryScreen.tsx:130: Collection bar uses filtered card count (`vm.cards.length`) as denominator, so progress shifts by active filter and can become misleading.
    fix: Compute `totalCount` from unfiltered VM counts (`new + learning + mastered`) so collection progress stays invariant across filter changes.
  - [P2] /Users/qc/Desktop/DeveloperCards/recallsmith/mobile/tests/integration/library-final.screen.test.tsx:153: Checklist coverage gap: v9 requires `Missing` label verification, but this test currently checks only filter chips and focus behavior.
    fix: Extend this test to verify `Missing` terminology appears in the grid for a stage-0 card.
- gate_status:
  - PASS typecheck
  - PASS unit
  - PASS integration
  - PASS gate-screen-lines
  - PASS gate-inline-hex
  - PASS gate-loss-words
  - FAIL critic

## 20260506-011910 cycle 2 :: A/HomeScreen :: PASS
- time: 2026-05-06 03:03:38 NZST
- review: docs/design/v9-draw-final-spec-and-qa.md
- log_dir: docs/qa/autopilot-logs/20260506-025003-A-HomeScreen
- critic_status: pass
- critic_total_score: 93
- p0_count: 0
- top_findings:
  - [P2] /Users/qc/Desktop/DeveloperCards/recallsmith/mobile/src/features/gacha/home/HomeDeckRow.tsx: `HomeDeckRow` defines local RGBA color literals in `HOME_DECK_ROW_TOKENS` instead of sourcing all visual tokens from `src/theme/*`, which is outside the AGENTS.md theme-token boundary expectation.
    fix: Move these row surface/border color tokens into the theme layer (`src/theme/*`) and consume them from `HomeDeckRow` via theme exports.
- gate_status:
  - PASS typecheck
  - PASS unit
  - PASS integration
  - PASS gate-screen-lines
  - PASS gate-inline-hex
  - PASS gate-loss-words
  - PASS critic

## 20260506-011910 cycle 2 :: D/DrawScreen :: PASS
- time: 2026-05-06 03:17:42 NZST
- review: docs/design/v9-draw-final-spec-and-qa.md
- log_dir: docs/qa/autopilot-logs/20260506-030338-D-DrawScreen
- critic_status: pass
- critic_total_score: 93
- p0_count: 0
- top_findings:
  - [P2] tests/integration/draw.screen.test.tsx:320: The suite checks that swipe arming is required, but it does not assert the armed-state timeout reset after 4.5s, which is part of the DrawScreen interaction contract.
    fix: Add a fake-timer integration case that arms once, advances 4500ms, and verifies both open CTAs return to disabled until a new swipe occurs.
  - [P2] tests/integration/draw.screen.test.tsx: There is no width-matrix automation for DrawScreen layout at 360/375/390/430, so CTA hierarchy and non-overlap rules rely on manual verification only.
    fix: Add parameterized width render assertions for 360/375/390/430 to validate single-line primary CTA and stable two-action footer hierarchy.
- gate_status:
  - PASS typecheck
  - PASS unit
  - PASS integration
  - PASS gate-screen-lines
  - PASS gate-inline-hex
  - PASS gate-loss-words
  - PASS critic

## 20260506-011910 cycle 2 :: D/DrawCeremonyScreen :: PASS
- time: 2026-05-06 03:23:54 NZST
- review: docs/design/v9-draw-final-spec-and-qa.md
- log_dir: docs/qa/autopilot-logs/20260506-031742-D-DrawCeremonyScreen
- critic_status: pass
- critic_total_score: 91
- p0_count: 0
- top_findings:
  - [P2] /Users/qc/Desktop/DeveloperCards/recallsmith/mobile/tests/integration/draw-ceremony.screen.test.tsx: The ceremony integration suite validates cadence/skip/flash, but it does not explicitly cover the required width matrix (`360/375/390/430`) for DrawCeremonyScreen (`W-BASE`/`W-MODAL` contract in the screen-quality matrix), leaving narrow-width overlap/regression risk unguarded.
    fix: Add width-parameterized ceremony integration cases by mocking `useWindowDimensions` and asserting root/stage/primary CTA visibility and one-line CTA behavior at `360/375/390/430`.
- gate_status:
  - PASS typecheck
  - PASS unit
  - PASS integration
  - PASS gate-screen-lines
  - PASS gate-inline-hex
  - PASS gate-loss-words
  - PASS critic

## 20260506-011910 cycle 2 :: D/DrawResultScreen :: PASS
- time: 2026-05-06 03:28:02 NZST
- review: docs/design/v9-draw-final-spec-and-qa.md
- log_dir: docs/qa/autopilot-logs/20260506-032355-D-DrawResultScreen
- critic_status: pass
- critic_total_score: 88
- p0_count: 0
- top_findings:
  - [P1] /Users/qc/Desktop/DeveloperCards/recallsmith/mobile/src/screens/DrawResultScreen.tsx: Primary CTA routing depends on `remainingPulls` initialized to `0` until `loadRewardWalletState()` resolves (see lines 75, 131-157, 429-442). A fast tap can route to `Library` even when pulls remain, which violates the v9 CTA branch contract.
    fix: Use a synchronous initial source of truth for pulls (for example route param from ceremony/draw result) or keep the primary CTA disabled/loading until wallet state is resolved.
  - [P2] /Users/qc/Desktop/DeveloperCards/recallsmith/mobile/src/features/gacha/components/drawResultStyles.ts: The transient registration pill has no width cap (`registerPill`/`registerText`, lines 37-53 and 66-70). On narrow widths, longer localized copy can clip and visually compete with the top collection-progress hierarchy.
    fix: Add a width constraint (`maxWidth`) and truncation-safe behavior for the pill text; optionally place the pill below the header/collection area to preserve top-level hierarchy clarity.
- gate_status:
  - PASS typecheck
  - PASS unit
  - PASS integration
  - PASS gate-screen-lines
  - PASS gate-inline-hex
  - PASS gate-loss-words
  - PASS critic

## 20260506-011910 cycle 2 :: C/LibraryScreen :: FAIL
- time: 2026-05-06 03:45:16 NZST
- review: docs/design/v9-draw-final-spec-and-qa.md
- log_dir: docs/qa/autopilot-logs/20260506-032802-C-LibraryScreen
- critic_status: fail
- critic_total_score: 82
- p0_count: 0
- top_findings:
  - [P1] /Users/qc/Desktop/DeveloperCards/recallsmith/mobile/src/features/gacha/library/libraryMapper.ts:90: Library ownership/status is derived only from review `stage` (`new/learning/mastered`). Cards can remain rendered as `Missing` (dimmed) even after draw ownership updates, so Library handoff can diverge from the result-page owned/total semantics and weakens the v9 `scrollToNew`/ownership readability contract.
    fix: Feed ownership data into `buildLibraryVM` (for example owned UID set), distinguish `owned-but-unlearned` from truly missing, and compute collection/readability state from that ownership source rather than `stage` alone.
  - [P1] /Users/qc/Desktop/DeveloperCards/recallsmith/mobile/vitest.config.ts:5: `npm run test:integration` includes only `**/*.test.ts(x)`, so `tests/integration/library-360-columns.spec.tsx` (Library W-GRID 360/375/390/430 checks) is not executed by the gate. Responsive-column regressions can slip through while gate status remains green.
    fix: Either rename `tests/integration/library-360-columns.spec.tsx` to `*.test.tsx`, or extend `vitest.config.ts` include patterns to also match `**/*.spec.tsx`.
- gate_status:
  - PASS typecheck
  - PASS unit
  - PASS integration
  - PASS gate-screen-lines
  - PASS gate-inline-hex
  - PASS gate-loss-words
  - FAIL critic

## 20260506-011910 cycle 3 :: A/HomeScreen :: PASS
- time: 2026-05-06 03:59:53 NZST
- review: docs/design/v9-draw-final-spec-and-qa.md
- log_dir: docs/qa/autopilot-logs/20260506-034536-A-HomeScreen
- critic_status: pass
- critic_total_score: 93
- p0_count: 0
- top_findings:
  - [P2] /Users/qc/Desktop/DeveloperCards/recallsmith/mobile/src/screens/HomeScreen.tsx: Settings entry is rendered in the top header row (`headerRow`) before the primary Home reward block, which conflicts with the v7 Home hierarchy intent that keeps Settings as a lower-priority entry after the core Home flow.
    fix: Move the Settings icon/button below the core Home reward gateway section (after primary CTA + draw status + secondary links) while preserving current accessibility semantics.
  - [P2] /Users/qc/Desktop/DeveloperCards/recallsmith/mobile/src/features/gacha/home/HomeDeckRow.tsx: Deck row visual tokens use local hardcoded RGBA values (`HOME_DECK_ROW_TOKENS`) instead of centralized theme tokens, reducing theme consistency and violating the AGENTS preference to route styling through `src/theme/*`.
    fix: Replace local RGBA token literals with equivalent semantic tokens from `src/theme/colors` (or add canonical tokens there first) and consume only theme exports in this component.
- gate_status:
  - PASS typecheck
  - PASS unit
  - PASS integration
  - PASS gate-screen-lines
  - PASS gate-inline-hex
  - PASS gate-loss-words
  - PASS critic

## 20260506-011910 cycle 3 :: D/DrawScreen :: PASS
- time: 2026-05-06 04:03:24 NZST
- review: docs/design/v9-draw-final-spec-and-qa.md
- log_dir: docs/qa/autopilot-logs/20260506-035953-D-DrawScreen
- critic_status: pass
- critic_total_score: 92
- p0_count: 0
- top_findings:
  - [P2] tests/integration/draw.screen.test.tsx: DrawScreen does not have automated width-matrix assertions for 360/375/390/430, so the v9 Draw visual contract (CTA hierarchy/no overlap across required widths) is not directly guarded by tests.
    fix: Add parameterized integration coverage for 360/375/390/430 that renders DrawScreen and asserts stable two-action footer structure, primary-vs-secondary CTA presence, and no layout regressions in the above-the-fold region.
  - [P2] tests/integration/draw.screen.test.tsx: The 4.5s armed-state auto-reset contract is implemented in DrawScreen but not explicitly asserted, leaving v9 interaction checklist item 2.1(4) vulnerable to regressions.
    fix: Add a fake-timer integration test that arms via swipe, advances time past 4500ms, and verifies both open CTAs return to disabled with unarmed hint copy.
- gate_status:
  - PASS typecheck
  - PASS unit
  - PASS integration
  - PASS gate-screen-lines
  - PASS gate-inline-hex
  - PASS gate-loss-words
  - PASS critic

## 20260506-011910 cycle 3 :: D/DrawCeremonyScreen :: FAIL
- time: 2026-05-06 04:24:37 NZST
- review: docs/design/v9-draw-final-spec-and-qa.md
- log_dir: docs/qa/autopilot-logs/20260506-040324-D-DrawCeremonyScreen
- critic_status: fail
- critic_total_score: 82
- p0_count: 1
- top_findings:
  - [P0] /Users/qc/Desktop/DeveloperCards/recallsmith/mobile/src/screens/DrawCeremonyScreen.tsx: The v9 ten-draw choreography contract is only explicitly implemented in the fallback branch (`phase === 'tear-flip' && isMulti && !ceremonyLottieAvailable`), while the primary runtime branch renders one generic `CeremonyLottie` clip for both single and multi draws. With bundled `lottie-react-native` + `assets/lottie/pack-opening.json`, production can bypass the explicit ten-card rotating-system/center-focus implementation required by `docs/design/v9-draw-final-spec-and-qa.md` §2.2 and fails commercial animation gate consistency.
    fix: Make the primary ceremony path mode-aware: use dedicated single/multi animation assets or keep the multi orbit/focus choreography active even when Lottie is available. Ensure multi draw visibly maintains continuous rotating-system semantics through `tear-flip` and preserves focal transition to center.
  - [P1] /Users/qc/Desktop/DeveloperCards/recallsmith/mobile/tests/integration/draw-ceremony.screen.test.tsx: Current integration coverage validates fallback orbit continuity and reduced-motion Lottie semantics, but does not verify normal-motion Lottie choreography parity (single vs multi behavior and timing handoff). This leaves the main shipped animation path under-specified relative to the v9 ceremony checklist.
    fix: Add explicit normal-motion Lottie-path assertions for multi and single draws, including focal transition behavior and bounded handoff timing after settle.
- gate_status:
  - PASS typecheck
  - PASS unit
  - PASS integration
  - PASS gate-screen-lines
  - PASS gate-inline-hex
  - PASS gate-loss-words
  - FAIL critic

## 20260506-011910 cycle 3 :: D/DrawResultScreen :: PASS
- time: 2026-05-06 04:28:13 NZST
- review: docs/design/v9-draw-final-spec-and-qa.md
- log_dir: docs/qa/autopilot-logs/20260506-042437-D-DrawResultScreen
- critic_status: pass
- critic_total_score: 92
- p0_count: 0
- top_findings:
  - [P2] /Users/qc/Desktop/DeveloperCards/recallsmith/mobile/src/screens/DrawResultScreen.tsx: Rarity summary strip renders in LEG/RAR/COM order, while the v9 result checklist specifies COM/RAR/LEG scan order.
    fix: Render rarity chips in COM, RAR, LEG order using the existing summary counts.
  - [P2] /Users/qc/Desktop/DeveloperCards/recallsmith/mobile/src/screens/DrawResultScreen.tsx: Primary CTA is derived from `remainingPulls` with initial value 0, so first paint can briefly show and execute the empty-wallet branch before wallet state resolves.
    fix: Gate CTA interaction until wallet load completes or seed initial pulls from deterministic navigation/session state.
- gate_status:
  - PASS typecheck
  - PASS unit
  - PASS integration
  - PASS gate-screen-lines
  - PASS gate-inline-hex
  - PASS gate-loss-words
  - PASS critic

## 20260506-011910 cycle 3 :: C/LibraryScreen :: PASS
- time: 2026-05-06 04:33:08 NZST
- review: docs/design/v9-draw-final-spec-and-qa.md
- log_dir: docs/qa/autopilot-logs/20260506-042813-C-LibraryScreen
- critic_status: pass
- critic_total_score: 96
- p0_count: 0
- top_findings:
  - [P2] /Users/qc/Desktop/DeveloperCards/recallsmith/mobile/src/screens/LibraryScreen.tsx: `scrollToNew` searches `visibleCards` after the active filter is applied; if the user re-enters Library with a non-`all` filter that excludes new cards, the handoff highlight/jump can silently no-op.
    fix: When `route.params.scrollToNew` is true, resolve the target from unfiltered rows (or force `filter='all'` before targeting) so result-to-library handoff always lands on the first new card.
  - [P2] /Users/qc/Desktop/DeveloperCards/recallsmith/mobile/src/screens/LibraryScreen.tsx: The no-deck error branch shows only `Retry`; for the `No deck available yet. Install one first.` case, retry does not provide a recovery path and can loop indefinitely.
    fix: Add a secondary recovery action in the error state to navigate to `Deck` install/update gate while keeping `Retry` for transient failures.
- gate_status:
  - PASS typecheck
  - PASS unit
  - PASS integration
  - PASS gate-screen-lines
  - PASS gate-inline-hex
  - PASS gate-loss-words
  - PASS critic

## 20260506-011910 cycle 4 :: A/HomeScreen :: PASS
- time: 2026-05-06 04:49:31 NZST
- review: docs/design/v9-draw-final-spec-and-qa.md
- log_dir: docs/qa/autopilot-logs/20260506-043329-A-HomeScreen
- critic_status: pass
- critic_total_score: 94
- p0_count: 0
- gate_status:
  - PASS typecheck
  - PASS unit
  - PASS integration
  - PASS gate-screen-lines
  - PASS gate-inline-hex
  - PASS gate-loss-words
  - PASS critic

## 20260506-011910 cycle 4 :: D/DrawScreen :: PASS
- time: 2026-05-06 04:54:04 NZST
- review: docs/design/v9-draw-final-spec-and-qa.md
- log_dir: docs/qa/autopilot-logs/20260506-044931-D-DrawScreen
- critic_status: pass
- critic_total_score: 90
- p0_count: 0
- top_findings:
  - [P2] /Users/qc/Desktop/DeveloperCards/recallsmith/mobile/tests/integration/draw.screen.test.tsx: DrawScreen integration coverage validates behavior and CTA gating, but it does not include explicit W-BASE/W-CTA width-contract checks at 360/375/390/430 for this screen.
    fix: Add width-parameterized DrawScreen contract tests (mock viewport width) to assert stable stage/CTA layout and single-line primary CTA across 360/375/390/430.
  - [P2] /Users/qc/Desktop/DeveloperCards/recallsmith/mobile/src/screens/DrawScreen.tsx: Screen-level coupling is still high: deck resolution/install, wallet mutation, and open-flow orchestration are implemented inline, which weakens selector/planner boundary clarity for ongoing Phase D maintenance.
    fix: Extract draw entry loader/open orchestration into a dedicated draw feature helper (selector/planner-style module) and keep DrawScreen focused on rendering + event wiring.
- gate_status:
  - PASS typecheck
  - PASS unit
  - PASS integration
  - PASS gate-screen-lines
  - PASS gate-inline-hex
  - PASS gate-loss-words
  - PASS critic

## 20260506-011910 cycle 4 :: D/DrawCeremonyScreen :: PASS
- time: 2026-05-06 05:08:17 NZST
- review: docs/design/v9-draw-final-spec-and-qa.md
- log_dir: docs/qa/autopilot-logs/20260506-045404-D-DrawCeremonyScreen
- critic_status: pass
- critic_total_score: 92
- p0_count: 0
- gate_status:
  - PASS typecheck
  - PASS unit
  - PASS integration
  - PASS gate-screen-lines
  - PASS gate-inline-hex
  - PASS gate-loss-words
  - PASS critic

## 20260506-011910 cycle 4 :: D/DrawResultScreen :: PASS
- time: 2026-05-06 05:19:45 NZST
- review: docs/design/v9-draw-final-spec-and-qa.md
- log_dir: docs/qa/autopilot-logs/20260506-050817-D-DrawResultScreen
- critic_status: pass
- critic_total_score: 96
- p0_count: 0
- gate_status:
  - PASS typecheck
  - PASS unit
  - PASS integration
  - PASS gate-screen-lines
  - PASS gate-inline-hex
  - PASS gate-loss-words
  - PASS critic

## 20260506-011910 cycle 4 :: C/LibraryScreen :: PASS
- time: 2026-05-06 05:24:09 NZST
- review: docs/design/v9-draw-final-spec-and-qa.md
- log_dir: docs/qa/autopilot-logs/20260506-051945-C-LibraryScreen
- critic_status: pass
- critic_total_score: 95
- p0_count: 0
- top_findings:
  - [P2] /Users/qc/Desktop/DeveloperCards/recallsmith/mobile/src/screens/LibraryScreen.tsx: Empty-state recovery CTA can be a no-op when a deck has zero cards and filter is already `all` (`library-empty-cta` only calls `setFilter('all')`). This weakens the empty-state recovery path under E-dimension criteria.
    fix: Branch empty-state action by cause: for true zero-card decks, provide a non-noop recovery (e.g., navigate to deck install/update gate or deck switch action); keep `Reset filters` only for filtered-empty cases.
- gate_status:
  - PASS typecheck
  - PASS unit
  - PASS integration
  - PASS gate-screen-lines
  - PASS gate-inline-hex
  - PASS gate-loss-words
  - PASS critic

## 20260506-011910 cycle 5 :: A/HomeScreen :: PASS
- time: 2026-05-06 05:28:20 NZST
- review: docs/design/v9-draw-final-spec-and-qa.md
- log_dir: docs/qa/autopilot-logs/20260506-052429-A-HomeScreen
- critic_status: pass
- critic_total_score: 96
- p0_count: 0
- top_findings:
  - [P2] /Users/qc/Desktop/DeveloperCards/recallsmith/mobile/src/screens/HomeScreen.tsx:382: Home starts with a 3-line branding header before the reward stage, which slightly weakens the v9 `pack-first visual` emphasis for the first fold.
    fix: Compress the header to a minimal single-line shell (or move subtitle below fold) so `home-pack-visual` becomes the first dominant element in the primary card area.
- gate_status:
  - PASS typecheck
  - PASS unit
  - PASS integration
  - PASS gate-screen-lines
  - PASS gate-inline-hex
  - PASS gate-loss-words
  - PASS critic

## 20260506-011910 cycle 5 :: D/DrawScreen :: PASS
- time: 2026-05-06 05:33:16 NZST
- review: docs/design/v9-draw-final-spec-and-qa.md
- log_dir: docs/qa/autopilot-logs/20260506-052820-D-DrawScreen
- critic_status: pass
- critic_total_score: 95
- p0_count: 0
- top_findings:
  - [P2] /Users/qc/Desktop/DeveloperCards/recallsmith/mobile/tests/integration/draw.screen.test.tsx: DrawScreen integration coverage validates CTA count and swipe-arming, but it does not explicitly exercise the required 360/375/390/430 width matrix for Draw entry layout stability.
    fix: Add width-parameterized DrawScreen cases (for 360/375/390/430) with mocked window dimensions, then assert hero+neighbor hints remain visible and both CTA labels stay single-line.
  - [P2] /Users/qc/Desktop/DeveloperCards/recallsmith/mobile/tests/integration/draw.screen.test.tsx: The armed-state timeout reset contract is implemented in DrawScreen but not directly tested, leaving regression risk for the swipe-to-arm interaction rule.
    fix: Add a fake-timer test that arms the pack, advances the timer to timeout, and verifies both open buttons are disabled again and hint text returns to the pre-armed state.
- gate_status:
  - PASS typecheck
  - PASS unit
  - PASS integration
  - PASS gate-screen-lines
  - PASS gate-inline-hex
  - PASS gate-loss-words
  - PASS critic

## 20260506-011910 cycle 5 :: D/DrawCeremonyScreen :: PASS
- time: 2026-05-06 05:50:23 NZST
- review: docs/design/v9-draw-final-spec-and-qa.md
- log_dir: docs/qa/autopilot-logs/20260506-053316-D-DrawCeremonyScreen
- critic_status: pass
- critic_total_score: 95
- p0_count: 0
- gate_status:
  - PASS typecheck
  - PASS unit
  - PASS integration
  - PASS gate-screen-lines
  - PASS gate-inline-hex
  - PASS gate-loss-words
  - PASS critic

## 20260506-011910 cycle 5 :: D/DrawResultScreen :: PASS
- time: 2026-05-06 05:54:29 NZST
- review: docs/design/v9-draw-final-spec-and-qa.md
- log_dir: docs/qa/autopilot-logs/20260506-055023-D-DrawResultScreen
- critic_status: pass
- critic_total_score: 94
- p0_count: 0
- top_findings:
  - [P2] /Users/qc/Desktop/DeveloperCards/recallsmith/mobile/src/features/gacha/components/drawResultStyles.ts: `registerPill` uses fixed top placement without a width cap; on narrow widths with larger font scaling it can clip or crowd the header, weakening W-BASE confidence.
    fix: Add a responsive width constraint (for example `maxWidth: '88%'`) and ensure the pill text safely truncates with ellipsis under large font scales.
  - [P2] /Users/qc/Desktop/DeveloperCards/recallsmith/mobile/src/screens/DrawResultScreen.tsx: The modal close control (`screen-draw-result-detail-close`) has no explicit accessibility role/label, reducing screen-reader clarity for dismissing card detail.
    fix: Add `accessibilityRole="button"` and a specific `accessibilityLabel` (for example `Close card detail`) to the close Pressable.
- gate_status:
  - PASS typecheck
  - PASS unit
  - PASS integration
  - PASS gate-screen-lines
  - PASS gate-inline-hex
  - PASS gate-loss-words
  - PASS critic

## 20260506-011910 cycle 5 :: C/LibraryScreen :: PASS
- time: 2026-05-06 05:59:21 NZST
- review: docs/design/v9-draw-final-spec-and-qa.md
- log_dir: docs/qa/autopilot-logs/20260506-055429-C-LibraryScreen
- critic_status: pass
- critic_total_score: 90
- p0_count: 0
- top_findings:
  - [P2] /Users/qc/Desktop/DeveloperCards/recallsmith/mobile/src/screens/LibraryScreen.tsx: `scrollToNew` handoff uses `FlatList.scrollToIndex` without `onScrollToIndexFailed`/retry handling. On longer lists, RN can fail initial index jumps before measurements complete, so the DrawResult->Library jump may no-op.
    fix: Add `onScrollToIndexFailed` with a deferred retry (or provide `getItemLayout` for deterministic offsets) so `scrollToNew` always lands on the target region.
  - [P2] /Users/qc/Desktop/DeveloperCards/recallsmith/mobile/src/features/gacha/library/libraryScreenStyles.ts: Filter sheet options enforce `minHeight: 44` but do not enforce `minWidth >= 44`. Short labels like `All`/`New` can drop below the 44x44 touch target contract.
    fix: Set `sheetOption.minWidth` to `a11y.minTouch` (44) to guarantee tap area width on all widths.
- gate_status:
  - PASS typecheck
  - PASS unit
  - PASS integration
  - PASS gate-screen-lines
  - PASS gate-inline-hex
  - PASS gate-loss-words
  - PASS critic
