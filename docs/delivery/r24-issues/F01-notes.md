# F01 — FSRS-5 core (vendored, pure)

Issue #634, round r24 wave f. Contract R24-00 §4.1.

## What changed

- `mobile/src/review/fsrs.ts` (new): FSRS-5 as pure functions, no dependency.
- `mobile/tests/unit/fsrs.test.ts` (new): reference vectors and properties.

## Surface shipped

```ts
type FsrsGrade = 1 | 2 | 3 | 4;                       // again / hard / good / easy
interface FsrsMemoryState { stability: number; difficulty: number }
interface FsrsState extends FsrsMemoryState { days: number }

const FSRS5_WEIGHTS: readonly number[];               // default FSRS-5 weights (19)
const DESIRED_RETENTION = 0.9;
const MAX_INTERVAL_DAYS = 90;

initState(grade): FsrsState                           // first ever review
nextState(state, grade, elapsedDays): FsrsState       // any later review
retrievability(elapsedDays, stability): number        // (1 + 19/81 · t/S)^-0.5
intervalDays(stability): number                       // clamp(round(S · factor), 1, 90); factor = 1 at 0.9
```

Settings: decay -0.5, factor 19/81, no fuzz, long-term only (w17/w18 short-term terms unused; a lapse
never raises stability, as in ts-fsrs with short-term off). Difficulty uses linear damping and mean
reversion to the `easy` initial difficulty, clamped to [1, 10]; stability floor 0.01.

`days` on the returned state is the interval for the grade given. It equals `intervalDays(stability)`
except where ts-fsrs's sibling ordering lifts it: on a first review again ≤ hard and hard ≥ again + 1
(so a first `hard` is 2 days, matching the reference vector, while `intervalDays(1.1839)` is 1); on a later
review hard ≤ good; always good > hard and easy > good. The result is re-clamped to [1, 90].

## How it is tested

`cd mobile && npx tsc --noEmit && npx vitest run tests/unit/fsrs.test.ts`:
- constants (weights, retention, cap);
- first review S/D/days for grades 1–4 to 4 decimal places;
- the 7-step sequence (good, good, good, again, good, easy, hard), reviewed on each due day, to 4 dp;
- retrievability at 0 and at t = S; intervalDays rounding, clamping and monotonicity in stability;
- 200 seeded random histories × 30 steps: difficulty in [1, 10], stability > 0 and finite, days an
  integer in [1, 90]; sibling ordering; purity (input not mutated).

## Owner steps

None. Nothing calls this module yet.

## Deferred

- F02 (`fsrsScheduler.ts`) wires this into `CardProgress`; F03 switches the call sites. F02 should use
  `state.days` (not `intervalDays(S)`) if it wants the first-`hard` = 2 days behaviour of the reference.
