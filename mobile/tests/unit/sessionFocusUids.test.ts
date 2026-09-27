import { describe, expect, it } from 'vitest';

import {
  buildFocusIndex,
  MAX_FOCUS_UIDS,
  pickFocusCard,
  sanitizeFocusUids,
} from '../../src/features/gacha/mistakes/focusSession';
import type { CardProgress } from '../../src/review/model';
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
});
