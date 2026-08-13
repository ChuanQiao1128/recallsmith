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

  it('monotonicity: good never lowers the stage, and easy is never below good', () => {
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

  it('again semantics: exactly +10min and the stage is left untouched', () => {
    fc.assert(
      fc.property(dirtyStageArb, nowMsArb, (stage, nowMs) => {
        const next = scheduleNextReview(progressAt(stage, nowMs), 'again', new Date(nowMs));
        expect(next.nextReviewAt).toBe(nowMs + 10 * 60 * 1000);
        expect(next.stage).toBe(clampStage(stage));
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

    // hard at stage 4 schedules round(15 * 0.7) = 11 days, which is not a bucket
    const hard = scheduleNextReview(progressAt(4, nowMs), 'hard', new Date(nowMs));
    expect(hard.stage).toBe(4);
    expect(hard.nextReviewAt - nowMs).toBe(11 * DAY_MS);
    expect(inferStageFromIntervalMs(hard.nextReviewAt - nowMs)).toBe(3);

    // again keeps the stage but schedules 10 minutes, which reads as stage 0
    const again = scheduleNextReview(progressAt(5, nowMs), 'again', new Date(nowMs));
    expect(again.stage).toBe(5);
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
