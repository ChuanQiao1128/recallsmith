import { describe, expect, it } from 'vitest';
import type { CardProgress } from '../../src/review/model';
import { countDueToday, pickNextCard } from '../../src/features/gacha/planner/sessionPlanner';
import { buildRatedSessionState } from '../../src/features/gacha/session/sessionReviewHelpers';

// 2026-10-14 learning flow: Got it on the study view commits the card as hard on the learning-check
// schedule, due in exactly one day. The planner needs no exclusion list to keep a studied card out of
// the rest of the run (the R22 §6 excludeUids is gone): the card is learned and not due today, so no
// pick deals it again. (Review all / sweep deals learned cards, but it never deals a new card, so a
// sweep has no study view.)

const NOW = new Date('2026-09-27T09:00:00.000Z');
const NOW_MS = NOW.getTime();
const DAY_MS = 86_400_000;
const qa = (order: number): any => ({ StableUid: `q${order}`, OrderInDeck: order, Difficulty: 1, Question: `Q${order}`, Revision: 1 });
const deckOf = (cards: any[]): any => ({ Slug: 'aws', Title: 'AWS', Locale: 'en-US', Version: '1', DeckType: 1, TotalCards: cards.length, Cards: cards });
const indexOf = (cards: any[]) => ({ cards, cardMap: new Map(cards.map((c) => [c.StableUid, c])) });
const fresh = (uid: string): CardProgress => ({ stableUid: uid, stage: 0, nextReviewAt: 0 });
const STUDY_MODES = ['review-due', 'learn-new', 'mixed'] as const;

/** Got it on `uid`, through the session's save path. */
function gotIt(cards: any[], progress: CardProgress[], uid: string, mode: (typeof STUDY_MODES)[number], examDate: string | null = null) {
  const current = progress.find((p) => p.stableUid === uid)!;
  return buildRatedSessionState({
    current: { card: cards.find((c) => c.StableUid === uid), progress: current },
    progress,
    rating: 'hard',
    mode,
    sessionDone: 0,
    sessionLimit: 5,
    now: NOW,
    cardIndex: indexOf(cards),
    examDate,
    learningCheck: true,
  });
}

/** The local calendar date `days` after NOW, as the study goal stores it. */
function localDateKey(days: number): string {
  const d = new Date(NOW_MS);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

describe('learning step: a studied card is not dealt again in the same run', () => {
  it('Got it leaves the card due tomorrow, so the next pick is the next new card', () => {
    const cards = [qa(1), qa(2), qa(3)];
    const state = gotIt(cards, cards.map((c) => fresh(c.StableUid)), 'q1', 'learn-new');

    expect(state.updatedOne).toEqual(expect.objectContaining({ stage: 0, lastReviewedAt: NOW_MS, nextReviewAt: NOW_MS + DAY_MS }));
    expect(state.nextCurrent?.card.StableUid).toBe('q2');
    expect(countDueToday(state.updatedProgress, NOW)).toBe(0);
  });

  it('a run whose only card was studied ends instead of dealing it again, in every mode but Review all', () => {
    const cards = [qa(1)];
    for (const mode of STUDY_MODES) {
      const state = gotIt(cards, [fresh('q1')], 'q1', mode);
      // avoidUid falls back to the avoided card when nothing else is left; the studied card is
      // neither due nor new, so even that fallback finds nothing.
      expect(state.nextCurrent).toBeNull();
      expect(pickNextCard({ deck: deckOf(cards), progress: state.updatedProgress, now: NOW, mode })).toBeNull();
    }
  });

  it('a mixed run moves on to the next new card, never back to the studied one', () => {
    const cards = [qa(1), qa(2)];
    const first = gotIt(cards, cards.map((c) => fresh(c.StableUid)), 'q1', 'mixed');
    expect(first.nextCurrent?.card.StableUid).toBe('q2');
    const second = gotIt(cards, first.updatedProgress, 'q2', 'mixed');
    expect(second.nextCurrent).toBeNull();
    expect(countDueToday(second.updatedProgress, NOW)).toBe(0);
  });

  it('the exam cap never pulls a studied card back into today', () => {
    // Exam the day after tomorrow: no review after the start of tomorrow, which is still not today.
    const cards = [qa(1)];
    const state = gotIt(cards, [fresh('q1')], 'q1', 'mixed', localDateKey(2));
    expect(state.updatedOne.nextReviewAt).toBeGreaterThan(NOW_MS);
    expect(state.updatedOne.nextReviewAt).toBeLessThanOrEqual(NOW_MS + DAY_MS);
    expect(countDueToday(state.updatedProgress, NOW)).toBe(0);
    expect(state.nextCurrent).toBeNull();
  });
});
