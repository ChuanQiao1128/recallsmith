# F03 — FSRS for every review (behind the flag), scheduler version stamp (#636)

Contract: R24-00 §4.3. Builds on F01 (`mobile/src/review/fsrs.ts`) and F02 (`scheduleWithFsrs`,
`features.fsrs.enabled`, memory-state fields), both already on `delivery/r24-f`.

## What changed (files)

Source (all JS-only, OTA-safe; no frozen file other than the §0 unfreeze of `progressSync.ts`):

- `mobile/src/features/gacha/session/sessionReviewHelpers.ts` — `buildRatedSessionState` saves through
  `scheduleWithFsrs(progress, rating, now, { learningCheck })` instead of `scheduleNextReview`. Focus runs
  still go through `scheduleFocusReview`. The exam cap (`capNextReviewToExam`) still wraps the result. New
  optional param `learningCheck?: boolean`. Only a passed check (any rating other than `again`; the screen
  folds it to `hard`) is scheduled as a learning check. A Forgot (`again`) keeps the 10 minute relearn step.
- `mobile/src/features/gacha/mistakes/focusSession.ts` — the `scheduleFocusReview` fallback (a due card,
  or any Again) calls `scheduleWithFsrs` instead of `scheduleNextReview`. Practice ratings on cards that are
  not due are unchanged: only `lastReviewedAt` moves.
- `mobile/src/features/gacha/mcq/mcqVerdict.ts` — `describeScheduledRating` now defaults to
  `scheduleWithFsrs`, so the MCQ preview line shows what the save will write. Comments updated.
- `mobile/src/screens/SessionCardScreen.tsx` — passes `learningCheck: isLearningCheck` to
  `buildRatedSessionState`. No other change.
- `mobile/src/sync/progressSync.ts` (§0 unfreeze, scheduler version only) — new exported
  `getSchedulerVersion()`: `'fsrs-5'` when `isFsrsEnabled()`, else `'ladder-v1'`. `recordReviewEvent`
  stamps `schedulerVersion: getSchedulerVersion()` at record time. Nothing else in the file changed. Events
  queued before the field existed still fall back to `'ladder-v1'` at push time, because the ladder
  produced them.

`scheduleWithFsrs` already returns `scheduleNextReview` exactly when the flag is off, so each call site has
one code path and the kill switch lives in a single place (`fsrsScheduler.ts`, unchanged).

## Exact surface shipped

- `buildRatedSessionState({ ..., learningCheck?: boolean })`
- `export function getSchedulerVersion(): string` in `mobile/src/sync/progressSync.ts`
- Wire: `card_reviewed.schedulerVersion` is `'fsrs-5'` while `features.fsrs.enabled` is on (the default) and
  `'ladder-v1'` when it is off. `progressAfter` also carries `fsrsStability` / `fsrsDifficulty` /
  `fsrsAnchorAt` (F02 fields). The server stores them without reading them.
- No new learner-facing text. With FSRS on, existing lines such as "back in N days" and "See it tomorrow"
  show FSRS numbers.

## How it is tested

New:
- `mobile/tests/unit/fsrsWiring.test.ts` checks each call site with the flag on and off:
  - `buildRatedSessionState`:
    - a first Good is 3 days and stores S 3.173 / D 5.2824;
    - a passed learning check is initState(hard) and due in 1 day;
    - a failed check is due in 10 minutes;
    - a plain hard is 2 days;
    - the exam cap wraps the FSRS result;
    - with the flag off it equals the ladder exactly.
  - The `scheduleFocusReview` fallback.
  - The `describeScheduledRating` default.
- `mobile/tests/integration/fsrs-review-flow.test.ts` runs the real `buildRatedSessionState` and the real
  `recordReviewEvent` against an in-memory AsyncStorage, then reads the offline queue:
  - Flag on: a new Q/A card passes its learning check (1 day, S 1.1839 / D 6.4883), gets Good on the due day
    (3 days, S 3.4452), then Good again on the next due day (9 days, S 9.4222). All three queued events say
    `'fsrs-5'`, with reviewStage `learning_check` / `repeat_review` / `repeat_review`.
  - Flag off: the same flow gives the ladder's 1 / 2 / 4 days, stamped `'ladder-v1'`.
  - `getSchedulerVersion()` follows the flag.

Updated (facts-fsrs §4 list):
- **Moved to FSRS numbers:**
  - `examCap.test.ts`
  - `sessionFocusUids.test.ts`
  - `sweepPlanner.test.ts` (sweep equals any mode under the session scheduler)
  - `progressSyncEnvelopeBytes.test.ts` (golden bytes now carry `'fsrs-5'`)
  - `mistake-loop.screen.test.tsx`: a Good one hour after a lapse is 2 days, rung 1.
  - `session-card-focus.screen.test.tsx`: a due one-day card rated Good is 4 days, rung 2.
  - `session-card-mcq.screen.test.tsx`: a Good preview is 4 days. The exam test now sets the exam 3 days
    out so the cap visibly shortens the line.
- **Split in `mcqVerdict.spec.ts`:** the two previews that pin ladder steps now run with
  `features.fsrs.enabled = false`. New tests cover the FSRS default preview: 10 min / 2 / 3 / 16 days,
  property-checked against `scheduleWithFsrs`, plus the FSRS preview under the exam cap.
- **Mocks:** six SessionCard screen tests mock `config/featureFlags`. Their mocks gained `isFsrsEnabled`,
  which reads the mocked flags the same way the real one does.
- **Unchanged because they test the ladder itself** (`scheduleNextReview` / `foldProgress` in the frozen
  model.ts, still the kill-switch fallback):
  - `scheduler.properties.test.ts`
  - `multiDeviceSync.sim.test.ts`
  - `revisionDemotionSync.test.ts`
  - `progressStorageSchema.test.ts`
- **Still pass unchanged:** the "10 minutes" / "See it tomorrow" copy tests (`ratingBar`, `mcqConstants`,
  `mcqReviewBody`, `session-summary-picks`) and `session-card-learning`. Under FSRS the learning check is
  still 1 day and Again is still 10 minutes.

Gates run: `cd mobile && npx tsc --noEmit && npx vitest run` → 275 files, 2033 tests pass.

## Owner steps

- None to ship. The kill switch is the remote config key `features.fsrs.enabled`. Set it to `false` to go
  back to the ladder on the next cold start. New events are then stamped `'ladder-v1'` again.

## Deferred

- The server ignores the FSRS memory-state fields in `progressAfter`, and pull does not return them. A second
  device rebuilds state from the interval (F02 anchor check), as the contract intends.
- The MCQ preview still prints "10 minutes" for any gap under an hour. FSRS never schedules a non-Again
  rating under 1 day, so the line stays correct.
- `npm run test:smoke` fails in this worktree on duplicate DOM / react-native global type declarations from
  the symlinked `node_modules`. It fails the same way on the base commit `dc48593`. It is not run by
  `F03.verify.sh`.
