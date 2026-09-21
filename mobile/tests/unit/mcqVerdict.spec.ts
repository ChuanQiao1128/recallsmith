import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  resolveMcqVerdict,
  isFastResponse,
  mapMcqVerdictToRating,
  describeScheduledRating,
  RATING_LABEL,
  type McqVerdict,
  type McqConfidence,
  type McqReviewStage,
} from '../../src/features/gacha/mcq/mcqVerdict';
import { MCQ_FAST_MS } from '../../src/features/gacha/mcq/mcqConstants';
import { scheduleNextReview, type CardProgress, type ReviewRating } from '../../src/review/model';
import type { McqExport } from '../../src/types/deckExport';

function mcqOf(correct: readonly string[], keys: readonly string[] = ['a', 'b', 'c', 'd']): McqExport {
  return {
    v: 1,
    qualifier: null,
    shuffle: true,
    options: keys.map((key) => ({
      key,
      text: `option ${key}`,
      why: correct.includes(key) ? null : `why not ${key}`,
      correct: correct.includes(key),
    })),
  };
}

const card1 = mcqOf(['b']);
const card2 = mcqOf(['a', 'c'], ['a', 'b', 'c', 'd', 'e']);
const card3 = mcqOf(['a', 'b', 'c'], ['a', 'b', 'c', 'd', 'e', 'f']);

const verdictArb = fc.constantFrom<McqVerdict>('correct', 'partial', 'wrong');
const confidenceArb = fc.constantFrom<McqConfidence>('sure', 'unsure');
const stageNameArb = fc.constantFrom<McqReviewStage>('first_review', 'repeat_review');
const responseArb = fc.oneof(
  fc.integer({ min: 0, max: 120_000 }),
  fc.constantFrom(NaN, Infinity, -Infinity, -1, 0, 20_000, 20_001, 30_000, 30_001),
);
const optionCountArb = fc.oneof(fc.integer({ min: 3, max: 6 }), fc.constantFrom(NaN, 0, 7));
const dirtyStageArb = fc.oneof(
  fc.integer({ min: 0, max: 6 }),
  fc.constantFrom(NaN, Infinity, -Infinity, -5, -1, 99, 2.3),
);
const hardStreakArb = fc.oneof(fc.integer({ min: 0, max: 3 }), fc.constantFrom(NaN, -1, 2.5));
const inputArb = fc.record({
  verdict: verdictArb,
  confidence: confidenceArb,
  changedPick: fc.boolean(),
  responseMs: responseArb,
  optionCount: optionCountArb,
  reviewStage: stageNameArb,
  stage: dirtyStageArb,
  hardStreak: hardStreakArb,
  redeal: fc.oneof(fc.boolean(), fc.constant(undefined)),
});

const FOUR: ReviewRating[] = ['again', 'hard', 'good', 'easy'];

describe('mcqVerdict', () => {
  it('wrong always maps to again', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        expect(mapMcqVerdictToRating({ ...input, verdict: 'wrong' })).toBe('again');
      }),
    );
  });

  it('partial always maps to hard', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        expect(mapMcqVerdictToRating({ ...input, verdict: 'partial' })).toBe('hard');
      }),
    );
  });

  it('unsure never reaches good or easy', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        expect(['again', 'hard']).toContain(mapMcqVerdictToRating({ ...input, confidence: 'unsure' }));
      }),
    );
  });

  it('first_review never reaches easy', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        expect(mapMcqVerdictToRating({ ...input, reviewStage: 'first_review' })).not.toBe('easy');
      }),
    );
  });

  it('a changed pick never reaches easy', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        expect(mapMcqVerdictToRating({ ...input, changedPick: true })).not.toBe('easy');
      }),
    );
  });

  it('a slow answer never reaches easy', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        if (isFastResponse(input.responseMs, input.optionCount)) return;
        expect(mapMcqVerdictToRating(input)).not.toBe('easy');
      }),
    );
  });

  it('a same-run redeal never reaches easy', () => {
    // Review 2026-09-22 (row 6): `again` drops a stage-3 card to stage 1, so its ten-minute redeal
    // would otherwise satisfy row 6 and climb straight back — the redeal flag caps the row at 'good'.
    fc.assert(
      fc.property(inputArb, (input) => {
        expect(mapMcqVerdictToRating({ ...input, redeal: true })).not.toBe('easy');
      }),
    );
    // The cap is the ONLY effect of the flag: everything that is not row 6 answers the same either way.
    fc.assert(
      fc.property(inputArb, (input) => {
        const plain = mapMcqVerdictToRating({ ...input, redeal: false });
        const capped = mapMcqVerdictToRating({ ...input, redeal: true });
        expect(capped).toBe(plain === 'easy' ? 'good' : plain);
      }),
    );
    const lapsedFromThree = {
      verdict: 'correct' as McqVerdict,
      confidence: 'sure' as McqConfidence,
      changedPick: false,
      responseMs: 3_000,
      optionCount: 4,
      reviewStage: 'repeat_review' as McqReviewStage,
      stage: 1,
      hardStreak: 0,
    };
    expect(mapMcqVerdictToRating(lapsedFromThree)).toBe('easy');
    expect(mapMcqVerdictToRating({ ...lapsedFromThree, redeal: false })).toBe('easy');
    expect(mapMcqVerdictToRating({ ...lapsedFromThree, redeal: true })).toBe('good');
    expect(mapMcqVerdictToRating({ ...lapsedFromThree, redeal: true, stage: 0 })).toBe('good');
    expect(mapMcqVerdictToRating({ ...lapsedFromThree, redeal: true, confidence: 'unsure' })).toBe('hard');
    expect(mapMcqVerdictToRating({ ...lapsedFromThree, redeal: true, verdict: 'wrong' })).toBe('again');
  });

  it('is total and only ever answers one of the four ratings', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        let out: ReviewRating;
        expect(() => {
          out = mapMcqVerdictToRating(input);
        }).not.toThrow();
        expect(FOUR).toContain(out!);
      }),
    );

    const dirtyArb = fc.record({
      verdict: fc.string(),
      confidence: fc.string(),
      changedPick: fc.anything(),
      responseMs: responseArb,
      optionCount: optionCountArb,
      reviewStage: fc.string(),
      stage: dirtyStageArb,
      hardStreak: hardStreakArb,
      redeal: fc.anything(),
    });
    fc.assert(
      fc.property(dirtyArb, (raw) => {
        const input = {
          ...raw,
          verdict: raw.verdict as unknown as McqVerdict,
          confidence: raw.confidence as unknown as McqConfidence,
          changedPick: raw.changedPick as unknown as boolean,
          reviewStage: raw.reviewStage as unknown as McqReviewStage,
          redeal: raw.redeal as unknown as boolean,
        };
        let out: ReviewRating;
        expect(() => {
          out = mapMcqVerdictToRating(input);
        }).not.toThrow();
        expect(FOUR).toContain(out!);
      }),
    );

    const base = {
      verdict: 'correct' as McqVerdict,
      confidence: 'sure' as McqConfidence,
      changedPick: false,
      responseMs: 5_000,
      optionCount: 4,
      reviewStage: 'repeat_review' as McqReviewStage,
      stage: 3,
      hardStreak: 0,
    };
    expect(mapMcqVerdictToRating({ ...base, verdict: 'nope' as unknown as McqVerdict })).toBe('again');
    expect(
      mapMcqVerdictToRating({ ...base, verdict: 'correct', confidence: 'nope' as unknown as McqConfidence }),
    ).toBe('hard');
    expect(
      mapMcqVerdictToRating({
        ...base,
        verdict: 'correct',
        confidence: 'sure',
        reviewStage: 'nope' as unknown as McqReviewStage,
      }),
    ).toBe('good');
  });

  it('reproduces the seven rows of plan §5.3', () => {
    const base = {
      verdict: 'correct' as McqVerdict,
      confidence: 'sure' as McqConfidence,
      changedPick: false,
      responseMs: 5_000,
      optionCount: 4,
      reviewStage: 'repeat_review' as McqReviewStage,
      stage: 3,
      hardStreak: 0,
    };
    // row 1
    expect(mapMcqVerdictToRating({ ...base, verdict: 'wrong' })).toBe('again');
    // row 2
    expect(mapMcqVerdictToRating({ ...base, verdict: 'partial' })).toBe('hard');
    // row 3
    expect(mapMcqVerdictToRating({ ...base, confidence: 'unsure' })).toBe('hard');
    // row 4
    expect(mapMcqVerdictToRating({ ...base, reviewStage: 'first_review', stage: 0 })).toBe('good');
    // row 5
    expect(mapMcqVerdictToRating({ ...base, changedPick: true })).toBe('good');
    expect(mapMcqVerdictToRating({ ...base, responseMs: 25_000 })).toBe('good');
    expect(mapMcqVerdictToRating({ ...base, responseMs: 25_000, optionCount: 5 })).toBe('easy');
    // row 6
    expect(mapMcqVerdictToRating({ ...base, stage: 1 })).toBe('easy');
    // row 7
    expect(mapMcqVerdictToRating({ ...base, stage: 0 })).toBe('good');
    expect(mapMcqVerdictToRating({ ...base, stage: 2, hardStreak: 1 })).toBe('good');
  });

  it('resolves the verdict from the picked keys and ignores unknown keys', () => {
    expect(resolveMcqVerdict([], card1)).toBe('wrong');
    expect(resolveMcqVerdict(['b'], card1)).toBe('correct');
    expect(resolveMcqVerdict(['a'], card1)).toBe('wrong');
    expect(resolveMcqVerdict(['b', 'z'], card1)).toBe('correct');
    expect(resolveMcqVerdict(['z'], card1)).toBe('wrong');

    expect(resolveMcqVerdict(['a', 'c'], card2)).toBe('correct');
    expect(resolveMcqVerdict(['c', 'a'], card2)).toBe('correct');
    expect(resolveMcqVerdict(['a', 'b'], card2)).toBe('partial');
    expect(resolveMcqVerdict(['b', 'd'], card2)).toBe('wrong');
    expect(resolveMcqVerdict(['a'], card2)).toBe('partial');
    expect(resolveMcqVerdict(['a', 'a'], card2)).toBe('partial');

    expect(resolveMcqVerdict(['a', 'b', 'c'], card3)).toBe('correct');
    expect(resolveMcqVerdict(['a', 'b', 'd'], card3)).toBe('partial');
    expect(resolveMcqVerdict(['a', 'd', 'e'], card3)).toBe('wrong');
    expect(resolveMcqVerdict([], card3)).toBe('wrong');

    expect(resolveMcqVerdict(['a'], mcqOf([]))).toBe('wrong');

    fc.assert(
      fc.property(
        fc.array(fc.constantFrom('a', 'b', 'c', 'd', 'e', 'f', 'z'), { maxLength: 6 }),
        fc.constantFrom(card1, card2, card3),
        (picks, mcq) => {
          const snapshot = structuredClone(mcq);
          expect(resolveMcqVerdict([...picks, 'z'], mcq)).toBe(resolveMcqVerdict(picks, mcq));
          expect(['correct', 'partial', 'wrong']).toContain(resolveMcqVerdict(picks, mcq));
          expect(mcq).toEqual(snapshot);
        },
      ),
    );
  });

  it('calls an answer fast only inside the option-count budget', () => {
    expect(isFastResponse(20_000, 4)).toBe(true);
    expect(isFastResponse(20_001, 4)).toBe(false);
    expect(isFastResponse(30_000, 5)).toBe(true);
    expect(isFastResponse(30_001, 5)).toBe(false);
    expect(isFastResponse(25_000, 6)).toBe(true);
    expect(isFastResponse(25_000, 3)).toBe(false);
    expect(isFastResponse(0, 4)).toBe(true);
    expect(isFastResponse(-1, 4)).toBe(false);
    expect(isFastResponse(NaN, 4)).toBe(false);
    expect(isFastResponse(Infinity, 6)).toBe(false);
    expect(isFastResponse(25_000, NaN)).toBe(true);
    expect(MCQ_FAST_MS).toEqual({ upToFourOptions: 20_000, fiveOrSix: 30_000 });
  });

  it('previews the ladder without touching the progress', () => {
    const NOW = new Date(1_700_000_000_000);
    const p = (stage: number, extra?: Partial<CardProgress>): CardProgress => ({
      stableUid: 'u',
      stage,
      nextReviewAt: 0,
      lastReviewedAt: 1,
      ...extra,
    });

    expect(describeScheduledRating(p(3), 'again', NOW).line).toBe('Scheduled as Again · back in 10 minutes');

    const hard0 = describeScheduledRating(p(2, { hardStreak: 0 }), 'hard', NOW);
    expect(hard0.line).toBe('Scheduled as Hard · the card stays where it is · back in 3 days');
    expect(hard0.after.stage).toBe(2);

    expect(describeScheduledRating(p(0), 'hard', NOW).line).toBe(
      'Scheduled as Hard · the card stays where it is · back in 1 day',
    );

    const hardDemote = describeScheduledRating(p(2, { hardStreak: 2 }), 'hard', NOW);
    expect(hardDemote.line).toBe('Scheduled as Hard · back in 1 day');
    expect(hardDemote.after.stage).toBe(1);

    const good0 = describeScheduledRating(p(0), 'good', NOW);
    expect(good0.line).toBe('Scheduled as Good · back in 2 days');
    expect(good0.after.stage).toBe(1);

    const easy1 = describeScheduledRating(p(1), 'easy', NOW);
    expect(easy1.line).toBe('Scheduled as Easy · back in 8 days');
    expect(easy1.after.stage).toBe(3);

    expect(describeScheduledRating(p(6), 'easy', NOW).line).toBe('Scheduled as Easy · back in 60 days');

    expect(RATING_LABEL).toEqual({ again: 'Again', hard: 'Hard', good: 'Good', easy: 'Easy' });
    expect(Object.isFrozen(RATING_LABEL)).toBe(true);

    fc.assert(
      fc.property(
        fc.constantFrom<ReviewRating>(...FOUR),
        dirtyStageArb,
        hardStreakArb,
        (rating, stage, hardStreak) => {
          const before = p(stage, { hardStreak });
          const snapshot = structuredClone(before);
          const { after, line } = describeScheduledRating(before, rating, NOW);
          expect(after).toEqual(scheduleNextReview(before, rating, NOW));
          expect(before).toEqual(snapshot);
          expect(line.startsWith(`Scheduled as ${RATING_LABEL[rating]}`)).toBe(true);
          expect(line).toContain(' · back in ');
        },
      ),
    );
  });
});
