import { describe, expect, it } from 'vitest';

import { cardDetailStatus } from '../../src/features/gacha/library/cardDetailStatus';
import type { CardProgress } from '../../src/review/model';

// The chip must agree with Library and Home, which count a card as mastered
// only at stage >= MASTERY_STAGE_THRESHOLD (4). The old raw-stage rule called
// stage 3 "Mastered"; these tests pin the corrected boundary.
const DAY_MS = 86_400_000;

function learned(stableUid: string, stage: number): CardProgress {
  const now = Date.now();
  return { stableUid, stage, lastReviewedAt: now - DAY_MS, nextReviewAt: now };
}

describe('cardDetailStatus', () => {
  it('labels a stage 3 card Learning and a stage 4 card Mastered', () => {
    expect(cardDetailStatus(learned('a', 3))).toBe('Learning');
    expect(cardDetailStatus(learned('b', 4))).toBe('Mastered');
    // Above the threshold stays Mastered.
    expect(cardDetailStatus(learned('c', 6))).toBe('Mastered');
  });

  it('labels an unreviewed card New', () => {
    // Never reviewed: no lastReviewedAt, so not learned → New, whatever the stage.
    expect(cardDetailStatus({ stableUid: 'd', stage: 0, nextReviewAt: 0 })).toBe('New');
    expect(cardDetailStatus({ stableUid: 'e', stage: 5, nextReviewAt: 0 })).toBe('New');
    expect(cardDetailStatus(null)).toBe('New');
    expect(cardDetailStatus(undefined)).toBe('New');
  });
});
