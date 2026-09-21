import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { formatRank, rankCardsByOrder } from '../../src/features/gacha/library/cardRank';
import { buildLibraryCardRows, buildLibraryVM } from '../../src/features/gacha/library/libraryMapper';

const NOW = new Date('2026-04-23T12:00:00.000Z');

// Sparse OrderInDeck, out of array order: the shape of the shipped AWS deck,
// whose tiles read #005, #780, #1140, #3700 on a 371-card deck (owner's
// device, 2026-09-21) because every surface printed the authoring key.
const sparseDeck = {
  Slug: 'aws',
  Title: 'AWS',
  Locale: 'en-US',
  Version: '1',
  DeckType: 1,
  TotalCards: 4,
  Cards: [
    { StableUid: 'c', OrderInDeck: 1140, Difficulty: 1, Question: 'Q3', Topic: 'B' },
    { StableUid: 'a', OrderInDeck: 5, Difficulty: 1, Question: 'Q1', Topic: 'A' },
    { StableUid: 'd', OrderInDeck: 3700, Difficulty: 2, Question: 'Q4', Topic: 'A' },
    { StableUid: 'b', OrderInDeck: 780, Difficulty: 3, Question: 'Q2', Topic: 'B' },
  ],
} as any;

describe('cardRank', () => {
  it('ranks cards 1-based in OrderInDeck order, ignoring array order and gaps', () => {
    const ranks = rankCardsByOrder(sparseDeck.Cards);
    expect(ranks.get('a')).toBe(1);
    expect(ranks.get('b')).toBe(2);
    expect(ranks.get('c')).toBe(3);
    expect(ranks.get('d')).toBe(4);
    expect(ranks.get('nope')).toBeUndefined();
    expect(rankCardsByOrder([]).size).toBe(0);
  });

  it('keeps the first rank for a duplicated uid and array order for equal OrderInDeck', () => {
    const ranks = rankCardsByOrder([
      { StableUid: 'x', OrderInDeck: 2 },
      { StableUid: 'y', OrderInDeck: 2 },
      { StableUid: 'x', OrderInDeck: 1 },
    ]);
    expect(ranks.get('x')).toBe(1);
    expect(ranks.get('y')).toBe(3);
  });

  it('is a bijection onto 1..n for distinct uids (property)', () => {
    fc.assert(
      fc.property(fc.uniqueArray(fc.tuple(fc.uuid(), fc.integer({ min: -1000, max: 100000 })), { selector: (t) => t[0] }), (pairs) => {
        const cards = pairs.map(([StableUid, OrderInDeck]) => ({ StableUid, OrderInDeck }));
        const ranks = rankCardsByOrder(cards);
        expect(ranks.size).toBe(cards.length);
        expect([...ranks.values()].sort((a, b) => a - b)).toEqual(cards.map((_, i) => i + 1));
        // Monotone: a smaller OrderInDeck never gets a larger rank.
        for (const p of cards) {
          for (const q of cards) {
            if (p.OrderInDeck < q.OrderInDeck) expect(ranks.get(p.StableUid)!).toBeLessThan(ranks.get(q.StableUid)!);
          }
        }
      }),
    );
  });

  it('formats "011" style with three digits minimum and no cap', () => {
    expect(formatRank(1)).toBe('001');
    expect(formatRank(11)).toBe('011');
    expect(formatRank(441)).toBe('441');
    expect(formatRank(1234)).toBe('1234');
    expect(formatRank(0)).toBe('000');
    expect(formatRank(-3)).toBe('000');
    expect(formatRank(Number.NaN)).toBe('000');
  });
});

describe('libraryMapper rank', () => {
  it('puts the deck rank on every row, computed over the whole deck', () => {
    const rows = buildLibraryCardRows({ deck: sparseDeck, progress: [], now: NOW });
    expect(rows.map((row) => [row.stableUid, row.orderInDeck, row.rank])).toEqual([
      ['a', 5, 1],
      ['b', 780, 2],
      ['c', 1140, 3],
      ['d', 3700, 4],
    ]);
  });

  it('keeps the whole-deck rank inside a trial slice and under a topic filter', () => {
    // Trial slice takes the first two array entries (c, a); their ranks are 3 and 1, not 1 and 2.
    const trial = buildLibraryCardRows({ deck: sparseDeck, progress: [], now: NOW, isTrial: true, previewTotal: 2 });
    expect(trial.map((row) => [row.stableUid, row.rank])).toEqual([
      ['a', 1],
      ['c', 3],
    ]);

    const filtered = buildLibraryVM({ deck: sparseDeck, progress: [], now: NOW, topicFilter: 'b' });
    expect(filtered.cards.map((row) => [row.stableUid, row.rank])).toEqual([
      ['b', 2],
      ['c', 3],
    ]);
  });
});
