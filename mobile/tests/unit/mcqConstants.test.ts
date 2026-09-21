import { describe, expect, it } from 'vitest';
import {
  MCQ_COACH_SEEN_KEY,
  MCQ_COACH_READ_TIMEOUT_MS,
  MCQ_FAST_MS,
  MCQ_LETTERS,
  MCQ_COPY,
  MCQ_TEST_IDS,
  mcqLetter,
  mcqKindChip,
  mcqSelectedCount,
  mcqBannerPartial,
  mcqQualifierBody,
  mcqOptionA11yLabel,
  mcqPicksLine,
  mcqWhyNotA11yLabel,
  mcqOverLimitAnnouncement,
  MCQ_OVER_LIMIT_HINT_MS,
} from '../../src/features/gacha/mcq/mcqConstants';

describe('mcqConstants', () => {
  it('formats letters, chips, counts and the picks line', () => {
    expect([0, 1, 2, 3, 4, 5].map(mcqLetter)).toEqual(['A', 'B', 'C', 'D', 'E', 'F']);
    expect(mcqLetter(6)).toBe('?');
    expect(mcqLetter(-1)).toBe('?');
    expect(mcqLetter(NaN)).toBe('?');

    expect(mcqKindChip(1)).toBe('Multiple choice');
    expect(mcqKindChip(2)).toBe('Choose 2');
    expect(mcqKindChip(3)).toBe('Choose 3');
    expect(mcqKindChip(0)).toBe('Multiple choice');
    expect(mcqKindChip(4)).toBe('Choose 3');

    expect(mcqSelectedCount(1, 2)).toBe('1 of 2 selected');
    expect(mcqBannerPartial(1, 2)).toBe('You knew 1 of 2');
    expect(mcqQualifierBody('MOST performant')).toBe(
      'The stem asked for the MOST performant option. Several options would work; the one that best satisfies that phrase wins.',
    );
    expect(mcqOptionA11yLabel(1, 4, 'x')).toBe('Option B of 4: x');
    expect([0, 1, 4].map(mcqWhyNotA11yLabel)).toEqual(['Why not option A', 'Why not option B', 'Why not option E']);
    expect(mcqOverLimitAnnouncement(2)).toBe('Pick 2 answers — deselect one first');
    expect(mcqOverLimitAnnouncement(3)).toBe('Pick 3 answers — deselect one first');
    expect(MCQ_OVER_LIMIT_HINT_MS).toBe(1_500);
    expect(mcqPicksLine({ landed: 3, answered: 5 })).toBe('3 of 5 picks landed');
    expect(mcqPicksLine({ landed: 0, answered: 5 })).toBe(
      "0 of 5 picks landed — they're all back in 10 minutes",
    );
  });

  it('pins the storage key, the fast budgets, the copy and the testID shapes', () => {
    expect(MCQ_COACH_SEEN_KEY).toBe('recallsmith:mcq:coach-seen:v1');
    expect(MCQ_COACH_READ_TIMEOUT_MS).toBe(250);
    expect(MCQ_FAST_MS).toEqual({ upToFourOptions: 20_000, fiveOrSix: 30_000 });
    expect(MCQ_LETTERS).toEqual(['A', 'B', 'C', 'D', 'E', 'F']);

    expect(Object.isFrozen(MCQ_COPY)).toBe(true);
    expect(Object.isFrozen(MCQ_TEST_IDS)).toBe(true);
    expect(Object.isFrozen(MCQ_FAST_MS)).toBe(true);

    expect(MCQ_COPY.kindChip).toEqual({ single: 'Multiple choice', two: 'Choose 2', three: 'Choose 3' });
    expect(MCQ_COPY.redeal).toBe("Back again — let's see if it stuck");
    expect(MCQ_COPY.dontKnow).toBe("I don't know");
    expect(MCQ_COPY.faceMark).toBe('MC');
    expect(MCQ_COPY.faceMarkPick(2)).toBe('MC · pick 2');
    expect(MCQ_COPY.detailChipPick(3)).toBe('Multiple choice · pick 3');
    expect(MCQ_COPY.coach.startsWith('New card type.')).toBe(true);

    expect(MCQ_TEST_IDS.dock).toBe('review-rating-bar');
    expect(MCQ_TEST_IDS.option('c')).toBe('mcq-option-c');
    expect(MCQ_TEST_IDS.optionLetter('c')).toBe('mcq-option-letter-c');
    expect(MCQ_TEST_IDS.why('b')).toBe('mcq-why-b');
    expect(MCQ_TEST_IDS.whyToggle('b')).toBe('mcq-why-toggle-b');
    expect(MCQ_TEST_IDS.libraryKind('u1')).toBe('library-card-kind-u1');
    expect(MCQ_TEST_IDS.summaryPicks).toBe('session-summary-picks');
    expect(MCQ_TEST_IDS.drawFeaturedKind).toBe('draw-result-featured-kind');
    expect(MCQ_TEST_IDS.cardDetailKind).toBe('card-detail-kind-chip');
  });
});
