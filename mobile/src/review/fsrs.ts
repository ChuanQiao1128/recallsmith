// mobile/src/review/fsrs.ts
//
// FSRS-5 memory model, vendored as pure functions (no dependency). Settings are
// fixed by contract R24-00 §4.1: default FSRS-5 weights, desired retention 0.9,
// maximum interval 90 days, no fuzz, long-term scheduling only (no same-day
// short-term steps). Numbers match ts-fsrs 4.7.1 with the same settings; see
// tests/unit/fsrs.test.ts for the reference vectors.

/** 1 = again, 2 = hard, 3 = good, 4 = easy. */
export type FsrsGrade = 1 | 2 | 3 | 4;

export interface FsrsMemoryState {
  /** Days until retrievability falls to the desired retention. Always > 0. */
  stability: number;
  /** In [1, 10]; higher means stability grows more slowly. */
  difficulty: number;
}

export interface FsrsState extends FsrsMemoryState {
  /**
   * Whole days until the next review for the grade just given, in
   * [1, MAX_INTERVAL_DAYS]. Equals intervalDays(stability) except where the
   * ts-fsrs sibling ordering (again <= hard < good < easy) lifts it, e.g. a
   * first `hard` gets 2 days rather than 1.
   */
  days: number;
}

export const FSRS5_WEIGHTS: readonly number[] = Object.freeze([
  0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046, 1.54575, 0.1192, 1.01925, 1.9395, 0.11,
  0.29605, 2.2698, 0.2315, 2.9898, 0.51655, 0.6621,
]);
export const DESIRED_RETENTION = 0.9;
export const MAX_INTERVAL_DAYS = 90;

const W = FSRS5_WEIGHTS;
const DECAY = -0.5;
const FACTOR = 19 / 81; // 0.9 ** (1 / DECAY) - 1
const S_MIN = 0.01;
const GRADES: readonly FsrsGrade[] = [1, 2, 3, 4];

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Probability of recall after `elapsedDays` for a card with this stability. */
export function retrievability(elapsedDays: number, stability: number): number {
  return Math.pow(1 + (FACTOR * Math.max(0, elapsedDays)) / stability, DECAY);
}

/** Whole-day interval at which retrievability reaches DESIRED_RETENTION, in [1, 90]. */
export function intervalDays(stability: number): number {
  const raw = (stability / FACTOR) * (Math.pow(DESIRED_RETENTION, 1 / DECAY) - 1);
  return clamp(Math.round(raw), 1, MAX_INTERVAL_DAYS);
}

function initDifficulty(grade: FsrsGrade): number {
  return W[4] - Math.exp(W[5] * (grade - 1)) + 1;
}

function initStability(grade: FsrsGrade): number {
  return Math.max(W[grade - 1], S_MIN);
}

function nextDifficulty(difficulty: number, grade: FsrsGrade): number {
  const delta = -W[6] * (grade - 3);
  // Linear damping: the step shrinks as difficulty approaches 10.
  const damped = difficulty + (delta * (10 - difficulty)) / 9;
  // Mean reversion towards the initial difficulty of an `easy` first review.
  const reverted = W[7] * initDifficulty(4) + (1 - W[7]) * damped;
  return clamp(reverted, 1, 10);
}

function nextRecallStability(d: number, s: number, r: number, grade: FsrsGrade): number {
  const hardPenalty = grade === 2 ? W[15] : 1;
  const easyBonus = grade === 4 ? W[16] : 1;
  return (
    s *
    (1 + Math.exp(W[8]) * (11 - d) * Math.pow(s, -W[9]) * (Math.exp((1 - r) * W[10]) - 1) * hardPenalty * easyBonus)
  );
}

function nextForgetStability(d: number, s: number, r: number): number {
  const forgotten = W[11] * Math.pow(d, -W[12]) * (Math.pow(s + 1, W[13]) - 1) * Math.exp((1 - r) * W[14]);
  // Long-term only: a lapse never raises stability (ts-fsrs with short-term off).
  return clamp(s, S_MIN, forgotten);
}

function stepState(state: FsrsMemoryState, grade: FsrsGrade, elapsedDays: number): FsrsMemoryState {
  const { stability: s, difficulty: d } = state;
  const r = retrievability(elapsedDays, s);
  const stability = grade === 1 ? nextForgetStability(d, s, r) : nextRecallStability(d, s, r, grade);
  return { stability: Math.max(stability, S_MIN), difficulty: nextDifficulty(d, grade) };
}

/**
 * ts-fsrs long-term sibling ordering. A first review also keeps again below
 * hard (again <= hard, hard >= again + 1); a later review keeps hard <= good.
 * Then good > hard and easy > good. Re-clamped so no interval exceeds the cap.
 */
function orderedDays(stabilities: readonly number[], firstReview: boolean): number[] {
  let [again, hard, good, easy] = stabilities.map(intervalDays);
  if (firstReview) {
    again = Math.min(again, hard);
    hard = Math.max(hard, again + 1);
  } else {
    hard = Math.min(hard, good);
  }
  good = Math.max(good, hard + 1);
  easy = Math.max(easy, good + 1);
  return [again, hard, good, easy].map((days) => clamp(days, 1, MAX_INTERVAL_DAYS));
}

/** Memory state and interval after the first ever review of a card. */
export function initState(grade: FsrsGrade): FsrsState {
  const days = orderedDays(GRADES.map(initStability), true);
  return {
    stability: initStability(grade),
    difficulty: clamp(initDifficulty(grade), 1, 10),
    days: days[grade - 1],
  };
}

/** Memory state and interval after reviewing `elapsedDays` after the previous review. */
export function nextState(state: FsrsMemoryState, grade: FsrsGrade, elapsedDays: number): FsrsState {
  const siblings = GRADES.map((g) => stepState(state, g, elapsedDays));
  const days = orderedDays(
    siblings.map((next) => next.stability),
    false,
  );
  return { ...siblings[grade - 1], days: days[grade - 1] };
}
