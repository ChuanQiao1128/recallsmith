import { describe, expect, it } from 'vitest';
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

describe('poolSelection', () => {
  it('excludes owned cards from output', () => {
    const cards = [buildCard('a', 1), buildCard('b', 2), buildCard('c', 3)];
    const result = selectDrawCards({
      deckCards: cards,
      ownedSet: new Set(['b']),
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
      drawCount: 1,
      pityState: { draws: 10, threshold: 10 },
      seed: 123,
    });

    expect(result.pityFiredFor).toBeNull();
    expect(result.cards[0].Difficulty).toBe(1);
    // Held at the threshold, not incremented to 11: an all-commons pool can
    // never fire pity, so an uncapped counter would climb forever while the
    // progress label kept promising a guarantee that never arrives.
    expect(result.pityNext.draws).toBe(10);
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
      drawCount: 3,
      pityState: { draws: 0, threshold: 10 },
      seed: 777,
    };

    const first = selectDrawCards(input);
    const second = selectDrawCards(input);

    expect(first.cards.map((card) => card.StableUid)).toEqual(second.cards.map((card) => card.StableUid));
  });

  it('samples uniformly from the missing pool', () => {
    // Real gacha pulls are uniform random from the unowned pool. The
    // "spaced repetition through pulls" weighting was removed because it
    // made the Library look like a contiguous block at the front (the
    // user always re-pulled cards they'd already studied). Reinforcement
    // now lives only in study sessions, not in pulls.
    //
    // This used to be titled "...regardless of review history" and fed a
    // progress fixture in to prove it. It cannot any more: SelectionInput
    // no longer has a progress field, so "review history does not move
    // the odds" is a fact about the signature rather than something a
    // sample can observe. What is left is the half a sample CAN observe
    // and nothing else pins -- that the pool itself is unweighted -- so
    // the test keeps that and drops the claim it can no longer make.
    const deckCards = [buildCard('seen', 1), buildCard('never', 1)];

    let seenHits = 0;
    let neverHits = 0;
    for (let seed = 1; seed <= 1000; seed += 1) {
      const result = selectDrawCards({
        deckCards,
        ownedSet: new Set(),
        drawCount: 1,
        pityState: { draws: 0, threshold: 10 },
        seed,
      });
      const uid = result.cards[0]?.StableUid;
      if (uid === 'seen') seenHits += 1;
      if (uid === 'never') neverHits += 1;
    }

    // Both cards must be reachable
    expect(seenHits).toBeGreaterThan(0);
    expect(neverHits).toBeGreaterThan(0);
    // And neither dominates — uniform sampling produces ~500/500 ± noise.
    // We assert ratio in [0.7, 1.3] which is a comfortable band for 1000
    // trials of a fair coin (true 50/50 has stdev ~16 hits at n=1000).
    const ratio = seenHits / neverHits;
    expect(ratio).toBeGreaterThanOrEqual(0.7);
    expect(ratio).toBeLessThanOrEqual(1.3);
  });

  it('produces scattered slot numbers across many draws (not a contiguous front block)', () => {
    // Visual sanity: after pulling 30 cards from a 100-card pool, the
    // owned slot numbers should span a wide range (not always 0..29).
    // This guards against the old weight-bias regression where pulls
    // surfaced low-index cards first.
    const deckCards = Array.from({ length: 100 }, (_, i) =>
      buildCard(`uid-${String(i).padStart(3, '0')}`, 1),
    );
    const result = selectDrawCards({
      deckCards,
      ownedSet: new Set(),
      drawCount: 30,
      pityState: { draws: 0, threshold: 999 },
      seed: 42,
    });
    const drawnIndices = result.cards
      .map((card) => Number(card.StableUid.replace('uid-', '')))
      .sort((a, b) => a - b);
    // The highest index should NOT be capped near 29 (which it would be
    // if the algorithm was picking from the top of the missing list).
    const highest = drawnIndices[drawnIndices.length - 1];
    expect(highest).toBeGreaterThan(40);
  });
});
