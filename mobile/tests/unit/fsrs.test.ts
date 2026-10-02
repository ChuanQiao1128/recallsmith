import { describe, expect, it } from 'vitest';
import {
  DESIRED_RETENTION,
  FSRS5_WEIGHTS,
  MAX_INTERVAL_DAYS,
  type FsrsGrade,
  initState,
  intervalDays,
  nextState,
  retrievability,
} from '../../src/review/fsrs';

// Reference vectors: ts-fsrs 4.7.1, default FSRS-5 weights, retention 0.9,
// maximum interval 90, no fuzz, long-term scheduling (contract R24-00 §4.1).
const GRADES: FsrsGrade[] = [1, 2, 3, 4];

describe('fsrs constants', () => {
  it('uses the default FSRS-5 weights, retention 0.9 and a 90 day cap', () => {
    expect(FSRS5_WEIGHTS).toEqual([
      0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046, 1.54575, 0.1192, 1.01925, 1.9395,
      0.11, 0.29605, 2.2698, 0.2315, 2.9898, 0.51655, 0.6621,
    ]);
    expect(DESIRED_RETENTION).toBe(0.9);
    expect(MAX_INTERVAL_DAYS).toBe(90);
  });
});

describe('initState (first review)', () => {
  const cases: Array<[FsrsGrade, number, number, number]> = [
    [1, 0.4026, 7.1949, 1],
    [2, 1.1839, 6.4883, 2],
    [3, 3.173, 5.2824, 3],
    [4, 15.6911, 3.2245, 16],
  ];
  it.each(cases)('grade %i -> S %f D %f, %i days', (grade, s, d, days) => {
    const state = initState(grade);
    expect(state.stability).toBeCloseTo(s, 4);
    expect(state.difficulty).toBeCloseTo(d, 4);
    expect(state.days).toBe(days);
  });
});

describe('nextState (reference sequence)', () => {
  it('matches ts-fsrs when reviewed exactly on each due day', () => {
    const grades: FsrsGrade[] = [3, 3, 3, 1, 3, 4, 2];
    const expected: Array<[number, number, number]> = [
      [3.173, 5.2824, 3],
      [10.7389, 5.273, 11],
      [34.5776, 5.2635, 35],
      [3.8182, 6.7842, 4],
      [11.0196, 6.7679, 11],
      [63.6648, 6.2295, 64],
      [85.3394, 6.8247, 85],
    ];
    let state = initState(grades[0]);
    const seen: Array<[number, number, number]> = [[state.stability, state.difficulty, state.days]];
    for (const grade of grades.slice(1)) {
      state = nextState(state, grade, state.days);
      seen.push([state.stability, state.difficulty, state.days]);
    }
    seen.forEach(([s, d, days], i) => {
      const [es, ed, edays] = expected[i];
      expect(s).toBeCloseTo(es, 4);
      expect(d).toBeCloseTo(ed, 4);
      expect(days).toBe(edays);
    });
  });
});

describe('retrievability and intervalDays', () => {
  it('is 1 at elapsed 0 and 0.9 at elapsed = stability', () => {
    expect(retrievability(0, 5)).toBe(1);
    expect(retrievability(5, 5)).toBeCloseTo(0.9, 10);
    expect(retrievability(10, 5)).toBeLessThan(0.9);
  });

  it('rounds stability to whole days within [1, 90]', () => {
    expect(intervalDays(0.01)).toBe(1);
    expect(intervalDays(3.173)).toBe(3);
    expect(intervalDays(15.69105)).toBe(16);
    expect(intervalDays(500)).toBe(90);
  });

  it('is non-decreasing in stability', () => {
    let prev = 0;
    for (let s = 0.01; s < 200; s += 0.37) {
      const days = intervalDays(s);
      expect(days).toBeGreaterThanOrEqual(prev);
      expect(days).toBeGreaterThanOrEqual(1);
      expect(days).toBeLessThanOrEqual(MAX_INTERVAL_DAYS);
      prev = days;
    }
  });
});

describe('properties over random review histories', () => {
  // Deterministic LCG so a failure reproduces.
  function rng(seed: number): () => number {
    let x = seed >>> 0;
    return () => {
      x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
      return x / 2 ** 32;
    };
  }

  it('keeps difficulty in [1, 10], stability > 0 and days in [1, 90]', () => {
    const rand = rng(42);
    for (let run = 0; run < 200; run++) {
      let state = initState(GRADES[Math.floor(rand() * 4)]);
      for (let step = 0; step < 30; step++) {
        expect(state.difficulty).toBeGreaterThanOrEqual(1);
        expect(state.difficulty).toBeLessThanOrEqual(10);
        expect(state.stability).toBeGreaterThan(0);
        expect(Number.isFinite(state.stability)).toBe(true);
        expect(state.days).toBeGreaterThanOrEqual(1);
        expect(state.days).toBeLessThanOrEqual(MAX_INTERVAL_DAYS);
        expect(Number.isInteger(state.days)).toBe(true);
        const grade = GRADES[Math.floor(rand() * 4)];
        const elapsed = rand() < 0.2 ? 0 : rand() * 2 * state.days;
        state = nextState(state, grade, elapsed);
      }
    }
  });

  it('orders the sibling intervals again <= hard < good < easy below the cap', () => {
    const base = nextState(initState(3), 3, 3);
    const days = GRADES.map((g) => nextState(base, g, 11).days);
    expect(days[0]).toBeLessThanOrEqual(days[1]);
    expect(days[1]).toBeLessThan(days[2]);
    expect(days[2]).toBeLessThan(days[3]);
  });

  it('is pure: the input state is not mutated', () => {
    const state = initState(3);
    const copy = { ...state };
    nextState(state, 1, 3);
    expect(state).toEqual(copy);
  });
});
