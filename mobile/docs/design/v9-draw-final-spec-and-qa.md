# v9 Draw Final Spec + Quantitative QA Gates (Full Contract)

Last updated: 2026-05-06  
Scope: `mobile` only  
Target screens: `HomeScreen`, `DrawScreen`, `DrawCeremonyScreen`, `DrawResultScreen`, `LibraryScreen`

## 1) Product Intent

This is a pack-opening product loop, not a utility flow.  
The user must feel this sequence clearly:

1. pick pack
2. arm gesture
3. open ceremony
4. reveal and collect
5. decide next action

If any screen weakens that emotional line, it is a design defect even if tests pass.

## 2) Final UX Shape (Detailed)

## 2.1 Draw entry page (`DrawScreen`)

Layout contract:
1. Hero pack centered on stage, with left/right neighbor hints visible.
2. Top row keeps only pull wallet chip (`xN`), no extra meta rows.
3. Bottom area keeps exactly two actions: `Open 10` (primary), `Open 1` (secondary).
4. No pity paragraph, no briefings, no extra cards, no redundant helper panels.

Interaction contract:
1. User must swipe right to arm opening.
2. Arm threshold is explicit and stable.
3. If not armed, both open buttons are disabled.
4. Armed state auto-resets after timeout if user does not trigger open.

Visual contract:
1. Pack has depth cues: halo, shadow, subtle bob, highlight sweep.
2. Neighbor hints communicate "selectable deck family", not random cards.
3. CTA hierarchy is always clear at 360/375/390/430 widths.

## 2.2 Ceremony page (`DrawCeremonyScreen`)

Canonical phase machine (must stay fixed):
1. `swipe`
2. `approach`
3. `hold`
4. `tear-flip`
5. `flash-reveal`
6. `settle`

Single-draw behavior:
1. Gesture starts sequence.
2. Pack enters with push-in motion.
3. Short hold to build anticipation.
4. Tear/flip to reveal card.
5. Rarity flash.
6. Card settles, skip appears, then result.

Ten-draw behavior:
1. Same 6 phases, same semantic order.
2. During `tear-flip`, ten cards must read as one continuous rotating system.
3. Center pack/card must clearly become focal object.
4. Side cards remain supportive, not flat duplicates.
5. Sequence must feel like one performance, not independent clips.

Rarity pacing:
1. `COM`: quickest and lightest.
2. `RAR`: medium emphasis.
3. `LEG`: longest hold, strongest flash and impact.

Skip rules:
1. `Show result` cannot appear before `settle`.
2. Reduced-motion path is allowed, but still preserves reveal semantics.

## 2.3 Result page (`DrawResultScreen`)

Information hierarchy:
1. Top: collection progress (`owned/total`).
2. Middle: featured card (highest rarity from this draw).
3. Lower strip: rarity counts (`COM/RAR/LEG`).
4. Bottom: one primary CTA + `Done` link.

CTA routing:
1. Pulls remain: primary = `Continue draw` -> `Draw`.
2. Pulls empty: primary = `Go to Library` -> `Library` with `{ focusSlug, scrollToNew }`.
3. `Done` always routes `Home`.

Ten-draw review:
1. User can open full grid/sheet for all cards.
2. Card detail modal remains available.

## 2.4 Library handoff (`LibraryScreen`)

Handoff contract:
1. Entering from result must focus current slug.
2. If `scrollToNew` set, jump to first newly relevant region.
3. Missing terminology is `Missing` (not `Unowned`).

Collection readability:
1. Owned cards use full-color/high-contrast treatment.
2. Missing cards are visibly dimmed.
3. New cards are perceptible without overwhelming layout.

## 2.5 Home reward gateway (`HomeScreen`)

Home must support draw loop without clutter:
1. Pack-first visual.
2. Main CTA is `Open {deckTitle}` when pulls exist.
3. Study link remains secondary (`Study {n} due cards`).
4. Zero-pull state keeps reward context visible but locked.

## 3) Motion Design Contract

## 3.1 Phase duration windows (hard numeric gates)

Standard mode:
1. `approach`: 420ms to 700ms
2. `hold`: 280ms to 550ms (rarity dependent)
3. `tear-flip`: 450ms to 1500ms (single/multi dependent)
4. `flash-reveal`: 280ms to 500ms
5. `settle`: 320ms to 520ms

Reduced motion:
1. Full ceremony total: 450ms to 800ms
2. Still includes reveal signal and result handoff

## 3.2 Choreography quality gates

1. No phase skipping or reordering in normal mode.
2. Multi-draw must show continuous motion for at least 900ms.
3. Focal target transition (side -> center) must be visible.
4. Flash color must map to rarity (`COM`, `RAR`, `LEG`).
5. Skip CTA unlock moment must be post-settle only.

## 3.3 Visual depth gates

1. Stage must include depth cues: perspective + shadow + glow.
2. Flat card stack with no perceived Z-space fails.
3. Hero/neighbor visual separation must be clear.
4. Reflection/shine layer should exist during dramatic phases.

## 4) Performance Contract

## 4.1 Runtime targets

On iPhone-class simulator devices:
1. No blocking freeze > 120ms during `tear-flip` and `flash-reveal`.
2. No repeated jank spikes across two consecutive runs.
3. JS thread should not show sustained long tasks through ceremony core.

## 4.2 Automated proxy metrics (for CI/autopilot)

1. Phase timers fire in expected order and windows.
2. No dropped transition to result after sequence completion.
3. No repeated state-reset loops in ceremony.
4. Integration tests complete without timeout inflation.

Note: this contract uses testable proxies, not subjective recording review.

## 5) Test and Gate Matrix

## 5.1 Mandatory green gates

1. `npm run test:typecheck`
2. `npm run test:unit`
3. `npm run test:integration`

## 5.2 Screen-contract tests

1. `tests/integration/draw.screen.test.tsx`
   - two CTA contract
   - swipe-arm threshold contract
2. `tests/integration/draw-ceremony.screen.test.tsx`
   - full phase cadence
   - skip timing
   - rarity flash mapping
3. `tests/integration/draw-result.screen.test.tsx`
   - collection bar
   - single CTA branch behavior
   - done-link route
4. `tests/integration/home.screen.test.tsx`
   - `Open {deckTitle}` and study-link behavior
5. `tests/integration/library-final.screen.test.tsx`
   - `Missing` label
   - focus route behavior

## 5.3 Critic JSON gate

1. `status = pass`
2. `total_score >= 90`
3. `p0_failures = []`
4. unresolved `P1` findings = `0`

## 6) Definition of Done (this milestone)

All conditions below must be true:
1. Gesture-to-open loop is clear and deliberate.
2. Ten-draw ceremony reads as one continuous dramatic sequence.
3. Rarity tier differences are obvious in both pacing and flash energy.
4. Result screen pushes immediate next action with no ambiguity.
5. Library handoff correctly anchors user to the deck and new cards.
6. All hard gates pass for 2 consecutive full cycles.

## 7) Out of Scope

1. Backend API redesign
2. Frontend web app (`frontend/`) changes
3. Native rebuild orchestration in this pass
4. Unrelated screen redesign outside the five targets

## 8) Autopilot Handoff

Use this document as the review source:

`/Users/qc/Desktop/DeveloperCards/recallsmith/mobile/scripts/run-v9-draw-5h-agent-loop.sh`

Recommended command:

```bash
cd /Users/qc/Desktop/DeveloperCards/recallsmith/mobile
HOURS=5 CODEX_MODEL=gpt-5.3-codex MAX_ROUNDS_PER_SCREEN=2 PASS_STREAK_REQUIRED=2 \
bash scripts/run-v9-draw-5h-agent-loop.sh docs/design/v9-draw-final-spec-and-qa.md
```
