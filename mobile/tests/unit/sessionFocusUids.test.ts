import { describe, expect, it } from 'vitest';

import {
  buildFocusIndex,
  MAX_FOCUS_UIDS,
  pickFocusCard,
  sanitizeFocusUids,
  scheduleFocusReview,
} from '../../src/features/gacha/mistakes/focusSession';
import { buildRatedSessionState } from '../../src/features/gacha/session/sessionReviewHelpers';
import { type CardProgress } from '../../src/review/model';
import { scheduleWithFsrs } from '../../src/review/fsrsScheduler';
import type { CardExport, DeckExport } from '../../src/types/deckExport';

const T = Date.UTC(2026, 8, 27, 9, 0, 0);

function card(uid: string, order: number): CardExport {
  return { StableUid: uid, OrderInDeck: order, Difficulty: 1, Question: `Q ${uid}` };
}

const DECK: DeckExport = {
  Slug: 'aws',
  Title: 'AWS',
  Locale: 'en-US',
  Version: '1',
  DeckType: 1,
  IsFreeStarter: true,
  TotalCards: 5,
  FreeCardCount: 5,
  Cards: [card('a', 1), card('b', 2), card('c', 3), card('d', 4), card('e', 5)],
};

describe('focus session helpers', () => {
  it('keeps only non-empty string uids, deduped, in the given order', () => {
    expect(sanitizeFocusUids(['b', ' a ', '', '   ', 7, null, 'b', { uid: 'x' }, 'a', 'c'])).toEqual(['b', 'a', 'c']);
    expect(sanitizeFocusUids(undefined)).toEqual([]);
    expect(sanitizeFocusUids('a,b')).toEqual([]);
    expect(sanitizeFocusUids({ 0: 'a', length: 1 })).toEqual([]);
  });

  it('caps focus uids at 15', () => {
    expect(MAX_FOCUS_UIDS).toBe(15);
    const raw = Array.from({ length: 20 }, (_, i) => `u${i}`);
    const out = sanitizeFocusUids(raw);
    expect(out).toHaveLength(15);
    expect(out).toEqual(raw.slice(0, 15));
    // Duplicates do not use up the cap.
    expect(sanitizeFocusUids(['u0', 'u0', ...raw.slice(1)])).toEqual(raw.slice(0, 15));
  });

  it('builds the focus index in the given order and drops cards the deck or the gate does not have', () => {
    const index = buildFocusIndex(DECK, ['d', 'missing', 'a', 'c', 'e'], new Set(['a', 'c', 'd']));
    expect(index?.cards.map((c) => c.StableUid)).toEqual(['d', 'a', 'c']);
    expect([...(index?.cardMap.keys() ?? [])].sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(buildFocusIndex(DECK, ['e', 'b'], null)?.cards.map((c) => c.StableUid)).toEqual(['e', 'b']);
  });

  it('returns no focus index when no focus card is usable', () => {
    expect(buildFocusIndex(DECK, [], null)).toBeNull();
    expect(buildFocusIndex(DECK, ['missing'], null)).toBeNull();
    expect(buildFocusIndex(DECK, ['a', 'b'], new Set(['c']))).toBeNull();
  });

  it('picks focus cards in order regardless of due state and stops after the last one', () => {
    const index = buildFocusIndex(DECK, ['c', 'a', 'e'], null)!;
    const progress: CardProgress[] = [
      { stableUid: 'a', stage: 5, lastReviewedAt: T - 1000, nextReviewAt: T + 30 * 86_400_000 },
      { stableUid: 'b', stage: 0, nextReviewAt: 0 },
      { stableUid: 'c', stage: 4, lastReviewedAt: T - 1000, nextReviewAt: T + 7 * 86_400_000 },
      { stableUid: 'e', stage: 0, nextReviewAt: 0 },
    ];
    const rated = new Set<string>();
    const served: string[] = [];
    for (;;) {
      const next = pickFocusCard({ index, progress, ratedUids: rated });
      if (!next) break;
      expect(next.progress.stableUid).toBe(next.card.StableUid);
      served.push(next.card.StableUid);
      rated.add(next.card.StableUid);
    }
    expect(served).toEqual(['c', 'a', 'e']);
    // A focus card without a progress row is skipped rather than served.
    const noRowForA = progress.filter((p) => p.stableUid !== 'a');
    expect(pickFocusCard({ index, progress: noRowForA, ratedUids: new Set(['c']) })?.card.StableUid).toBe('e');
  });

  // Y08 mobile-12: a focus run gives scheduler credit only where a normal review would.
  describe('scheduleFocusReview', () => {
    const DAY_MS = 86_400_000;
    const now = new Date(T);
    const notDue: CardProgress = { stableUid: 'a', stage: 1, lastReviewedAt: T - DAY_MS, nextReviewAt: T + DAY_MS, lapses: 0, hardStreak: 1 };
    const due: CardProgress = { stableUid: 'b', stage: 1, lastReviewedAt: T - 2 * DAY_MS, nextReviewAt: T - 1000 };

    it('leaves the schedule of a card that is not due untouched for Hard, Good and Easy', () => {
      for (const rating of ['hard', 'good', 'easy'] as const) {
        const next = scheduleFocusReview(notDue, rating, now);
        expect(next).toEqual({ ...notDue, lastReviewedAt: T });
      }
      // Repeating it changes nothing further: no stage creep on back-to-back runs.
      const twice = scheduleFocusReview(scheduleFocusReview(notDue, 'good', now), 'good', new Date(T + 60_000));
      expect(twice.stage).toBe(1);
      expect(twice.nextReviewAt).toBe(notDue.nextReviewAt);
    });

    // A normal review is scheduleWithFsrs (the ladder when features.fsrs is off, R24 §4.3).
    it('schedules a due card, and an Again on any card, exactly like a normal review', () => {
      for (const rating of ['again', 'hard', 'good', 'easy'] as const) {
        expect(scheduleFocusReview(due, rating, now)).toEqual(scheduleWithFsrs(due, rating, T));
      }
      expect(scheduleFocusReview(notDue, 'again', now)).toEqual(scheduleWithFsrs(notDue, 'again', T));
    });

    it('is what buildRatedSessionState applies in a focus run, and only there', () => {
      const base = {
        current: { card: card('a', 1), progress: notDue },
        progress: [notDue, due],
        rating: 'good' as const,
        mode: 'mixed' as const,
        sessionDone: 0,
        sessionLimit: 2,
        now,
        cardIndex: null,
      };
      expect(buildRatedSessionState({ ...base, focusRun: true }).updatedOne).toMatchObject({
        stage: 1,
        nextReviewAt: T + DAY_MS,
        lastReviewedAt: T,
      });
      expect(buildRatedSessionState(base).updatedOne).toMatchObject(scheduleWithFsrs(notDue, 'good', T));
    });
  });
});
