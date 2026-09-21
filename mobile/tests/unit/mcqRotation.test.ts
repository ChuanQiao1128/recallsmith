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
    expect(buildKindHint(EMPTY_MCQ_RUN_STATE, flagsWith({ maxPerRun: 0 }))).toEqual({
      mcqAllowed: false,
      preferMcq: false,
    });
    expect(buildKindHint({ served: 2, lastNewKind: 'qa' }, flagsWith({ maxPerRun: 2 }))).toEqual({
      mcqAllowed: false,
      preferMcq: false,
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
    expect(buildKindHint(EMPTY_MCQ_RUN_STATE, flagsWith({ maxPerRun: Number.NaN }))).toEqual({
      mcqAllowed: false,
      preferMcq: false,
    });
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
