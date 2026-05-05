import { describe, expect, it } from 'vitest';
import type { CardProgress } from '../../src/review/model';
import type { CardExport } from '../../src/types/deckExport';
import { selectDrawCards } from '../../src/features/gacha/draw/poolSelection';

function buildCard(stableUid: string, difficulty: number): CardExport {
  return {
    StableUid: stableUid,
    Question: `Q-${stableUid}`,
    Difficulty: difficulty,
    OrderInDeck: 1,
  };
}

function buildProgress(partial: Partial<CardProgress> & { stableUid: string }): CardProgress {
  return {
    stableUid: partial.stableUid,
    stage: partial.stage ?? 0,
    lastReviewedAt: partial.lastReviewedAt,
    nextReviewAt: partial.nextReviewAt ?? 0,
  };
}

describe('poolSelection', () => {
  it('excludes owned cards from output', () => {
    const cards = [buildCard('a', 1), buildCard('b', 2), buildCard('c', 3)];
    const result = selectDrawCards({
      deckCards: cards,
      ownedSet: new Set(['b']),
      progress: [],
      drawCount: 3,
      pityState: { draws: 0, threshold: 10 },
      seed: 123,
    });

    expect(result.cards.map((card) => card.StableUid)).not.toContain('b');
  });

  it('returns at most drawCount cards', () => {
    const cards = [buildCard('a', 1), buildCard('b', 2), buildCard('c', 3)];
    const result = selectDrawCards({
      deckCards: cards,
      ownedSet: new Set(),
      progress: [],
      drawCount: 2,
      pityState: { draws: 0, threshold: 10 },
      seed: 123,
    });

    expect(result.cards.length).toBeLessThanOrEqual(2);
  });

  it('returns fewer cards and marks poolExhausted when missing pool is smaller than drawCount', () => {
    const cards = [buildCard('a', 1), buildCard('b', 2)];
    const result = selectDrawCards({
      deckCards: cards,
      ownedSet: new Set(),
      progress: [],
      drawCount: 5,
      pityState: { draws: 0, threshold: 10 },
      seed: 123,
    });

    expect(result.cards).toHaveLength(2);
    expect(result.poolExhausted).toBe(true);
  });

  it('returns empty cards with poolExhausted when no missing cards remain', () => {
    const cards = [buildCard('a', 1), buildCard('b', 2)];
    const result = selectDrawCards({
      deckCards: cards,
      ownedSet: new Set(['a', 'b']),
      progress: [],
      drawCount: 1,
      pityState: { draws: 3, threshold: 10 },
      seed: 123,
    });

    expect(result.cards).toEqual([]);
    expect(result.poolExhausted).toBe(true);
    expect(result.pityFiredFor).toBeNull();
  });

  it('forces a missing LEG at pity threshold', () => {
    const cards = [buildCard('a', 1), buildCard('b', 2), buildCard('c', 3)];
    const result = selectDrawCards({
      deckCards: cards,
      ownedSet: new Set(),
      progress: [],
      drawCount: 1,
      pityState: { draws: 10, threshold: 10 },
      seed: 123,
    });

    expect(result.pityFiredFor).toBe('LEG');
    expect(result.cards[0].StableUid).toBe('c');
    expect(result.pityNext.draws).toBe(0);
  });

  it('falls back to forcing a missing RAR when no missing LEG exists', () => {
    const cards = [buildCard('a', 1), buildCard('b', 2)];
    const result = selectDrawCards({
      deckCards: cards,
      ownedSet: new Set(),
      progress: [],
      drawCount: 1,
      pityState: { draws: 10, threshold: 10 },
      seed: 123,
    });

    expect(result.pityFiredFor).toBe('RAR');
    expect(result.cards[0].StableUid).toBe('b');
    expect(result.pityNext.draws).toBe(0);
  });

  it('does not force pity when only commons are missing', () => {
    const cards = [buildCard('a', 1), buildCard('b', 1)];
    const result = selectDrawCards({
      deckCards: cards,
      ownedSet: new Set(),
      progress: [],
      drawCount: 1,
      pityState: { draws: 10, threshold: 10 },
      seed: 123,
    });

    expect(result.pityFiredFor).toBeNull();
    expect(result.cards[0].Difficulty).toBe(1);
    expect(result.pityNext.draws).toBe(11);
  });

  it('is deterministic for the same seed', () => {
    const cards = [
      buildCard('a', 1),
      buildCard('b', 1),
      buildCard('c', 2),
      buildCard('d', 3),
      buildCard('e', 1),
    ];
    const input = {
      deckCards: cards,
      ownedSet: new Set<string>(),
      progress: [],
      drawCount: 3,
      pityState: { draws: 0, threshold: 10 },
      seed: 777,
    };

    const first = selectDrawCards(input);
    const second = selectDrawCards(input);

    expect(first.cards.map((card) => card.StableUid)).toEqual(second.cards.map((card) => card.StableUid));
  });

  it('surfaces seen-unowned cards at least 1.5x as often as never-seen cards over many seeds', () => {
    const deckCards = [buildCard('seen', 1), buildCard('never', 1)];
    const progress = [buildProgress({ stableUid: 'seen', stage: 2, lastReviewedAt: 2000, nextReviewAt: 9000 })];

    let seenHits = 0;
    let neverHits = 0;
    for (let seed = 1; seed <= 1000; seed += 1) {
      const result = selectDrawCards({
        deckCards,
        ownedSet: new Set(),
        progress,
        drawCount: 1,
        pityState: { draws: 0, threshold: 10 },
        seed,
      });
      const uid = result.cards[0]?.StableUid;
      if (uid === 'seen') seenHits += 1;
      if (uid === 'never') neverHits += 1;
    }

    expect(neverHits).toBeGreaterThan(0);
    expect(seenHits / neverHits).toBeGreaterThanOrEqual(1.5);
  });
});
