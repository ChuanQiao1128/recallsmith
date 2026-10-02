# F02 — FSRS scheduling adapter, memory-state fields, kill switch (#635)

Contract: R24-00 §4.2. Builds on F01 (`mobile/src/review/fsrs.ts`). No call site is switched yet (F03).

## What changed (files)

- `mobile/src/review/fsrsScheduler.ts` (new): `scheduleWithFsrs(progress, rating, nowMs, opts?)`.
- `mobile/src/review/model.ts`: `CardProgress` gains optional `fsrsStability`, `fsrsDifficulty`,
  `fsrsAnchorAt`. Types and doc comment only; no behaviour change.
- `mobile/src/review/storage.ts`: `normalizeProgressEntry` keeps the three fields when they are finite
  numbers and drops them otherwise.
- `mobile/src/config/featureFlags.ts`: `features.fsrs.enabled` (default `true`, remote override, frozen,
  part of the change-detection compare) and `isFsrsEnabled()` = `getFeatureFlags().fsrs?.enabled !== false`.
- `mobile/src/config/remoteConfig.ts`: `RemoteFeatures.fsrs?: { enabled?: boolean }` (type only).
- Tests: `mobile/tests/unit/fsrsScheduler.test.ts` (new); `featureFlags.test.ts`,
  `featureFlagsSentry.test.ts` (full-snapshot assertions now include `fsrs`, plus new fsrs flag cases);
  `progressStorageSchema.test.ts` (round trip keeps / drops the FSRS fields).

## Surface shipped

`scheduleWithFsrs(progress: CardProgress, rating: ReviewRating, nowMs: number, opts?: { learningCheck?: boolean }): CardProgress`

- Flag off (`features.fsrs.enabled === false`): returns `scheduleNextReview(progress, rating, new Date(nowMs))`
  unchanged, including for a learning check.
- Never reviewed (`lastReviewedAt` absent): state = `initState(grade)`.
- Reviewed: stored state is used only when `fsrsStability > 0`, `fsrsDifficulty` is finite and
  `fsrsAnchorAt === lastReviewedAt`. Otherwise it is derived: `S = max(0.5, (nextReviewAt − lastReviewedAt)/day)`
  when `nextReviewAt > 0`, else the ladder interval of `stage`; `D = clamp(5 + 0.5·lapses + 0.3·hardStreak, 1, 10)`.
  New state = `nextState(state, grade, elapsedDays)` with `elapsedDays = max(0, (now − lastReviewedAt)/day)`.
- `nextReviewAt`: again → now + 10 minutes; otherwise now + FSRS days; learning check → now + 1 day; always
  capped at now + `MAX_NEXT_REVIEW_HORIZON_MS`.
- `stage`: again → `max(0, stage − 2)`; otherwise the largest ladder rung ≤ the interval
  (via `inferStageFromIntervalMs`, so 15+ days → stage 4 = mastered).
- `lapses` +1 on again; `hardStreak` +1 on hard, reset to 0 on the third hard and on any other rating
  (same as `scheduleNextReview`); `revisionDemotedAt` cleared; `lastReviewedAt = now`.
- Memory state written back with `fsrsAnchorAt = now`.
- Learning check (`opts.learningCheck`): state = `initState(hard)` regardless of prior state, due in 1 day.

## How it is tested

`cd mobile && npx tsc --noEmit && npx vitest run tests/unit/fsrsScheduler.test.ts tests/unit/fsrs.test.ts tests/unit/progressStorageSchema.test.ts tests/unit/featureFlags.test.ts`
covers: new card per rating (S/D/days match the F01 reference vectors), review on time vs late vs early,
stale-anchor and missing-field derivation (incl. 0.5 floor, stage fallback, D clamp), again = 10 minutes,
hardStreak/lapses, revisionDemotedAt cleared, stage mapping, learning check, horizon cap, flag default /
off / non-boolean, storage round trip keeps and drops the fields. Full `npm test` in `mobile/` was run too.

## Owner steps

None. To turn FSRS off remotely after F03 wires it in, publish `"features": { "fsrs": { "enabled": false } }`
in the remote config; it applies on the next cold start.

## Deferred

- F03: switch the call sites to `scheduleWithFsrs` and set `schedulerVersion` in progressSync.
- The interval used for non-again ratings is FSRS `state.days` (F01), which equals `intervalDays(S)` except
  where the ts-fsrs sibling ordering lifts it (a first `hard` is 2 days, as in the contract's reference
  vector). Kept that way so the app matches the §4.1 vectors.
