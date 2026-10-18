import { describe, it, expect } from 'vitest';
import type { CardProgress } from '../../src/review/model';
import {
  buildKindHint,
  noteServedCard,
  EMPTY_MCQ_RUN_STATE,
} from '../../src/features/gacha/mcq/mcqRotation';
import { DEFAULT_FEATURE_FLAGS, type FeatureFlags } from '../../src/config/featureFlags';

const flagsWith = (mcq: Partial<FeatureFlags['mcq']>) => ({ mcq: { ...DEFAULT_FEATURE_FLAGS.mcq, ...mcq } });
const newRow = { stableUid: 'n', stage: 0, nextReviewAt: 0 } as CardProgress;
const learnedRow = { stableUid: 'l', stage: 2, lastReviewedAt: 1, nextReviewAt: 2 } as CardProgress;

describe('mcqRotation', () => {
  it('answers null under the kill switch', () => {
    expect(buildKindHint(EMPTY_MCQ_RUN_STATE, flagsWith({ enabled: false }))).toBeNull();
    expect(buildKindHint({ served: 0, lastNewKind: 'qa' }, flagsWith({ enabled: false, maxPerRun: 9 }))).toBeNull();
    expect(EMPTY_MCQ_RUN_STATE).toEqual({ served: 0, lastNewKind: null });
    expect(Object.isFrozen(EMPTY_MCQ_RUN_STATE)).toBe(true);
  });

  it('caps at maxPerRun and alternates on the last new kind', () => {
    expect(buildKindHint(EMPTY_MCQ_RUN_STATE, flagsWith({ maxPerRun: 0 }))).toStrictEqual({
      mcqAllowed: false,
      preferMcq: false,
    });
    expect(buildKindHint({ served: 2, lastNewKind: 'qa' }, flagsWith({ maxPerRun: 2 }))).toStrictEqual({
      mcqAllowed: false,
      preferMcq: false,
      mcqFallback: true,
    });
    expect(buildKindHint({ served: 1, lastNewKind: 'mcq' }, flagsWith({ maxPerRun: 2 }))).toEqual({
      mcqAllowed: true,
      preferMcq: false,
    });
    expect(buildKindHint({ served: 1, lastNewKind: 'qa' }, flagsWith({ maxPerRun: 2 }))).toEqual({
      mcqAllowed: true,
      preferMcq: true,
    });
    expect(buildKindHint({ served: 0, lastNewKind: null }, flagsWith({ maxPerRun: 2 }))).toEqual({
      mcqAllowed: true,
      preferMcq: true,
    });
    expect(buildKindHint(EMPTY_MCQ_RUN_STATE, flagsWith({ maxPerRun: Number.NaN }))).toStrictEqual({
      mcqAllowed: false,
      preferMcq: false,
    });
  });

  // maxPerRun 0 documents "never serve MCQ from the new-card bucket"; only a positive cap that has been
  // reached lets the planner fall back to an MCQ new card when no Q/A new card is left.
  it('sets mcqFallback only once a positive maxPerRun is reached', () => {
    for (const lastNewKind of [null, 'qa', 'mcq'] as const) {
      for (const served of [0, 1, 3]) {
        const zero = buildKindHint({ served, lastNewKind }, flagsWith({ maxPerRun: 0 }));
        expect(zero).toStrictEqual({ mcqAllowed: false, preferMcq: false });
      }
      expect(buildKindHint({ served: 1, lastNewKind }, flagsWith({ maxPerRun: 1 }))).toStrictEqual({
        mcqAllowed: false,
        preferMcq: false,
        mcqFallback: true,
      });
      expect(buildKindHint({ served: 5, lastNewKind }, flagsWith({ maxPerRun: 2 }))?.mcqFallback).toBe(true);
      // Under the cap nothing changes: no mcqFallback key at all.
      expect(buildKindHint({ served: 1, lastNewKind }, flagsWith({ maxPerRun: 2 }))).not.toHaveProperty('mcqFallback');
    }
    expect(buildKindHint({ served: 4, lastNewKind: 'qa' }, flagsWith({ maxPerRun: Number.NaN }))).not.toHaveProperty('mcqFallback');
  });

  it('counts served MCQ cards from any bucket', () => {
    expect(noteServedCard(EMPTY_MCQ_RUN_STATE, newRow, true)).toEqual({ served: 1, lastNewKind: 'mcq' });
    expect(noteServedCard(EMPTY_MCQ_RUN_STATE, learnedRow, true)).toEqual({ served: 1, lastNewKind: null });
    expect(noteServedCard({ served: 1, lastNewKind: 'mcq' }, newRow, false)).toEqual({ served: 1, lastNewKind: 'qa' });
    expect(noteServedCard({ served: 1, lastNewKind: 'qa' }, learnedRow, false)).toEqual({ served: 1, lastNewKind: 'qa' });

    const before = { served: 0, lastNewKind: null } as const;
    const result = noteServedCard(before, newRow, true);
    expect(before).toEqual({ served: 0, lastNewKind: null });
    expect(result).not.toBe(before);
  });
});
