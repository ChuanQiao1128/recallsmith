import { describe, expect, it } from 'vitest';
import type { CardProgress } from '../../src/review/model';
import { pickNextCard } from '../../src/features/gacha/planner/sessionPlanner';
import { buildRatedSessionState } from '../../src/features/gacha/session/sessionReviewHelpers';

// R22 §6: a card studied this session waits for its recall check at the end of the run, so the
// planner must not deal it again (it is still new until the check rates it).

const NOW = new Date('2026-09-27T09:00:00.000Z');
const NOW_MS = NOW.getTime();
const qa = (order: number): any => ({ StableUid: `q${order}`, OrderInDeck: order, Difficulty: 1, Question: `Q${order}`, Revision: 1 });
const deckOf = (cards: any[]): any => ({ Slug: 'aws', Title: 'AWS', Locale: 'en-US', Version: '1', DeckType: 1, TotalCards: cards.length, Cards: cards });
const fresh = (uid: string): CardProgress => ({ stableUid: uid, stage: 0, nextReviewAt: 0 });
const due = (uid: string): CardProgress => ({ stableUid: uid, stage: 2, lastReviewedAt: NOW_MS - 3 * 86_400_000, nextReviewAt: NOW_MS - 86_400_000, lastSeenRevision: 1 });

const cards = [qa(1), qa(2), qa(3)];
const deck = deckOf(cards);

describe('learning step: the planner skips studied cards', () => {
  it('pickNextCard deals the next new card, not one in excludeUids', () => {
    const progress = cards.map((c) => fresh(c.StableUid));
    expect(pickNextCard({ deck, progress, now: NOW, mode: 'learn-new' })?.card.StableUid).toBe('q1');
    expect(
      pickNextCard({ deck, progress, now: NOW, mode: 'learn-new', avoidUid: 'q1', excludeUids: new Set(['q1']) })?.card.StableUid,
    ).toBe('q2');
    // avoidUid alone falls back to the avoided card when nothing else is left; excludeUids never does.
    const onlyOne = [fresh('q1')];
    const single = deckOf([qa(1)]);
    expect(pickNextCard({ deck: single, progress: onlyOne, now: NOW, mode: 'learn-new', avoidUid: 'q1' })?.card.StableUid).toBe('q1');
    expect(
      pickNextCard({ deck: single, progress: onlyOne, now: NOW, mode: 'learn-new', avoidUid: 'q1', excludeUids: new Set(['q1']) }),
    ).toBeNull();
  });

  it('an empty or absent excludeUids changes nothing', () => {
    const progress = [due('q1'), fresh('q2'), fresh('q3')];
    for (const mode of ['review-due', 'learn-new', 'mixed', 'sweep'] as const) {
      const plain = pickNextCard({ deck, progress, now: NOW, mode });
      expect(pickNextCard({ deck, progress, now: NOW, mode, excludeUids: new Set() })).toEqual(plain);
      expect(pickNextCard({ deck, progress, now: NOW, mode, excludeUids: null })).toEqual(plain);
    }
  });

  it('buildRatedSessionState forwards excludeUids to its next pick', () => {
    const progress = [due('q1'), fresh('q2'), fresh('q3')];
    const index = { cards, cardMap: new Map(cards.map((c) => [c.StableUid, c])) };
    const state = buildRatedSessionState({
      current: { card: cards[0], progress: progress[0] },
      progress,
      rating: 'good',
      mode: 'mixed',
      sessionDone: 1,
      sessionLimit: 3,
      now: NOW,
      cardIndex: index,
      excludeUids: new Set(['q2']),
    });
    expect(state.nextCurrent?.card.StableUid).toBe('q3');

    const last = buildRatedSessionState({
      current: { card: cards[0], progress: progress[0] },
      progress,
      rating: 'good',
      mode: 'mixed',
      sessionDone: 1,
      sessionLimit: 3,
      now: NOW,
      cardIndex: index,
      excludeUids: new Set(['q2', 'q3']),
    });
    expect(last.nextCurrent).toBeNull();
  });
});
