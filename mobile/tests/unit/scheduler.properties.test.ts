// Property tests for the review scheduler.
// These assert "for all inputs, this holds" instead of "input A gives B".
// The scheduler is a pure function of (progress, rating, now), which is what
// makes exhaustive random probing possible at all: no clock, no storage.
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  scheduleNextReview,
  clampStage,
  inferStageFromIntervalMs,
  foldProgress,
  type CardProgress,
  type ReviewRating,
  type ReviewEvent,
} from '../../src/review/model';

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_STAGE = 6;

const ratingArb = fc.constantFrom<ReviewRating>('again', 'hard', 'good', 'easy');

// Stage generator deliberately includes values the type system says are
// impossible (NaN, Infinity, negatives, fractions). Persisted JSON from an
// older build or a corrupted sync payload can carry any of them, so the
// generator encodes the real input contract, not the declared one.
const dirtyStageArb = fc.oneof(
  fc.integer({ min: 0, max: MAX_STAGE }),
  fc.constantFrom(NaN, Infinity, -Infinity, -5, -1, 99, 6.7, 2.3),
);

const nowMsArb = fc.integer({ min: 1_000_000_000_000, max: 2_000_000_000_000 });

function progressAt(stage: number, nowMs: number): CardProgress {
  return {
    stableUid: 'uid-1',
    stage,
    lastReviewedAt: nowMs - DAY_MS,
    nextReviewAt: nowMs,
  };
}

describe('scheduler properties', () => {
  it('futureness: nextReviewAt is always strictly after now', () => {
    fc.assert(
      fc.property(dirtyStageArb, ratingArb, nowMsArb, (stage, rating, nowMs) => {
        const next = scheduleNextReview(progressAt(stage, nowMs), rating, new Date(nowMs));
        expect(next.nextReviewAt).toBeGreaterThan(nowMs);
        expect(next.lastReviewedAt).toBe(nowMs);
      }),
    );
  });

  it('domain closure: stage stays an integer in [0, 6] for any input stage', () => {
    fc.assert(
      fc.property(dirtyStageArb, ratingArb, nowMsArb, (stage, rating, nowMs) => {
        const next = scheduleNextReview(progressAt(stage, nowMs), rating, new Date(nowMs));
        expect(Number.isInteger(next.stage)).toBe(true);
        expect(next.stage).toBeGreaterThanOrEqual(0);
        expect(next.stage).toBeLessThanOrEqual(MAX_STAGE);
        // and the interval must stay finite: a NaN stage must not leak into the date
        expect(Number.isFinite(next.nextReviewAt)).toBe(true);
      }),
    );
  });

  // Monotonicity is deliberately scoped to good/easy. It used to read as a
  // property of the scheduler as a whole because nothing could ever lower a
  // stage; now that again/hard demote, "the stage never goes down" is false by
  // design and only the success ratings still climb.
  it('monotonicity (good/easy only): good never lowers the stage, and easy is never below good', () => {
    fc.assert(
      fc.property(dirtyStageArb, nowMsArb, (stage, nowMs) => {
        const p = progressAt(stage, nowMs);
        const start = clampStage(stage);
        const good = scheduleNextReview(p, 'good', new Date(nowMs));
        const easy = scheduleNextReview(p, 'easy', new Date(nowMs));

        expect(good.stage).toBeGreaterThanOrEqual(start);
        expect(easy.stage).toBeGreaterThanOrEqual(good.stage);
        // stage ordering must carry through to the actual interval
        expect(easy.nextReviewAt).toBeGreaterThanOrEqual(good.nextReviewAt);
      }),
    );
  });

  // REWRITTEN, on purpose. The previous property asserted the ratchet: "again
  // schedules +10min and leaves the stage untouched". That was the defect
  // transcribed as a specification, and it passed for as long as it existed. A
  // test proves the code matches itself, not that it matches the need -- and
  // the need is that a card the user just failed comes back sooner, not on the
  // 42-day interval it had earned before failing.
  it('again semantics: +10min, the stage drops two rungs (floored at 0), and a lapse is counted', () => {
    fc.assert(
      fc.property(dirtyStageArb, nowMsArb, (stage, nowMs) => {
        const before = progressAt(stage, nowMs);
        const next = scheduleNextReview(before, 'again', new Date(nowMs));

        expect(next.nextReviewAt).toBe(nowMs + 10 * 60 * 1000);
        expect(next.stage).toBe(Math.max(0, clampStage(stage) - 2));
        expect(next.lapses).toBe((before.lapses ?? 0) + 1);
        expect(next.hardStreak).toBe(0);
      }),
    );
  });

  it('again never raises the stage, and saturates at 0 rather than going negative', () => {
    fc.assert(
      fc.property(dirtyStageArb, nowMsArb, (stage, nowMs) => {
        const next = scheduleNextReview(progressAt(stage, nowMs), 'again', new Date(nowMs));
        expect(next.stage).toBeLessThanOrEqual(clampStage(stage));
        expect(next.stage).toBeGreaterThanOrEqual(0);
      }),
    );
  });

  // The hard streak is the reason #0 (the AsyncStorage whitelist) had to land
  // first: a counter that does not survive a reload can never reach 3, so this
  // property would hold in memory and be dead in the app.
  it('hard streak: two hards hold the stage, the third demotes one rung and resets the streak', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: MAX_STAGE }), nowMsArb, (stage, nowMs) => {
        const p0 = progressAt(stage, nowMs);

        const h1 = scheduleNextReview(p0, 'hard', new Date(nowMs));
        expect(h1.stage).toBe(stage);
        expect(h1.hardStreak).toBe(1);

        const h2 = scheduleNextReview(h1, 'hard', new Date(nowMs + 1));
        expect(h2.stage).toBe(stage);
        expect(h2.hardStreak).toBe(2);

        const h3 = scheduleNextReview(h2, 'hard', new Date(nowMs + 2));
        expect(h3.stage).toBe(Math.max(0, stage - 1));
        expect(h3.hardStreak).toBe(0);

        // A fourth hard starts a fresh run: the drop is one rung per three
        // answers, not a cliff.
        const h4 = scheduleNextReview(h3, 'hard', new Date(nowMs + 3));
        expect(h4.stage).toBe(h3.stage);
        expect(h4.hardStreak).toBe(1);
      }),
    );
  });

  it('any non-hard answer clears the hard streak', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: MAX_STAGE }),
        fc.constantFrom<ReviewRating>('again', 'good', 'easy'),
        nowMsArb,
        (stage, rating, nowMs) => {
          const primed = { ...progressAt(stage, nowMs), hardStreak: 2 };
          const next = scheduleNextReview(primed, rating, new Date(nowMs));
          expect(next.hardStreak).toBe(0);
        },
      ),
    );
  });

  it('lapses only ever grow, and only on again', () => {
    fc.assert(
      fc.property(dirtyStageArb, ratingArb, nowMsArb, (stage, rating, nowMs) => {
        const before = { ...progressAt(stage, nowMs), lapses: 4 };
        const next = scheduleNextReview(before, rating, new Date(nowMs));
        expect(next.lapses).toBe(rating === 'again' ? 5 : 4);
      }),
    );
  });

  // The strict round-trip inferStage(next - last) === stage is FALSE, and that
  // is the finding, not a test bug: stage -> interval is many-to-one, so the
  // decode cannot be exact. What we can guarantee is the direction of the loss.
  it('round-trip: the rebuilt stage never overestimates the real stage', () => {
    fc.assert(
      fc.property(dirtyStageArb, ratingArb, nowMsArb, (stage, rating, nowMs) => {
        const next = scheduleNextReview(progressAt(stage, nowMs), rating, new Date(nowMs));
        const intervalMs = next.nextReviewAt - next.lastReviewedAt!;
        const inferred = inferStageFromIntervalMs(intervalMs);
        expect(inferred).not.toBeNull();
        expect(inferred!).toBeLessThanOrEqual(next.stage);
      }),
    );
  });

  it('round-trip is exact for good/easy, and only ever loses on hard/again', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: MAX_STAGE }), fc.constantFrom<ReviewRating>('good', 'easy'), nowMsArb, (stage, rating, nowMs) => {
        const next = scheduleNextReview(progressAt(stage, nowMs), rating, new Date(nowMs));
        const intervalMs = next.nextReviewAt - next.lastReviewedAt!;
        expect(inferStageFromIntervalMs(intervalMs)).toBe(next.stage);
      }),
    );
  });

  // Pinned counterexamples: these are the two shapes fast-check shrank to.
  // Kept as examples so the known loss is documented rather than rediscovered.
  it('known lossy cases: hard and again cannot be round-tripped', () => {
    const nowMs = 1_700_000_000_000;

    // hard at stage 4 (first of the streak, so no demotion yet) schedules
    // round(15 * 0.7) = 11 days, which is not a bucket
    const hard = scheduleNextReview(progressAt(4, nowMs), 'hard', new Date(nowMs));
    expect(hard.stage).toBe(4);
    expect(hard.nextReviewAt - nowMs).toBe(11 * DAY_MS);
    expect(inferStageFromIntervalMs(hard.nextReviewAt - nowMs)).toBe(3);

    // again drops two rungs and schedules 10 minutes, which reads as stage 0:
    // the interval no longer says anything about the rung it landed on
    const again = scheduleNextReview(progressAt(5, nowMs), 'again', new Date(nowMs));
    expect(again.stage).toBe(3);
    expect(inferStageFromIntervalMs(again.nextReviewAt - nowMs)).toBe(0);
  });
});

describe('foldProgress', () => {
  const eventArb = (stableUid: string): fc.Arbitrary<ReviewEvent> =>
    fc.record({
      stableUid: fc.constant(stableUid),
      rating: ratingArb,
      at: nowMsArb,
    });

  it('projection equals fold(log) for any event sequence', () => {
    fc.assert(
      fc.property(fc.array(eventArb('uid-1'), { maxLength: 40 }), (events) => {
        const initial: CardProgress = { stableUid: 'uid-1', stage: 0, nextReviewAt: 0 };

        // the projection the app would hold: apply events in chronological order
        const ordered = [...events].sort((a, b) => a.at - b.at);
        const projection = ordered.reduce(
          (p, e) => scheduleNextReview(p, e.rating, new Date(e.at)),
          initial,
        );

        // the fold applied to the log as it arrived (any order)
        expect(foldProgress(initial, events)).toEqual(projection);
      }),
    );
  });

  it('ignores events belonging to other cards', () => {
    fc.assert(
      fc.property(
        fc.array(eventArb('uid-1'), { maxLength: 10 }),
        fc.array(eventArb('uid-2'), { maxLength: 10 }),
        (mine, theirs) => {
          const initial: CardProgress = { stableUid: 'uid-1', stage: 0, nextReviewAt: 0 };
          expect(foldProgress(initial, [...mine, ...theirs])).toEqual(
            foldProgress(initial, mine),
          );
        },
      ),
    );
  });
});
