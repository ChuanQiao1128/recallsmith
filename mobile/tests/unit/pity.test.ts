import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => store.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
  },
}));

import {
  DEFAULT_PITY_STATE,
  buildMockDrawResult,
  buildPityProgressLabel,
  buildPityProgressLabelV9,
  loadPityState,
  savePityState,
} from '../../src/features/gacha/draw/pity';
import { selectDrawCards } from '../../src/features/gacha/draw/poolSelection';
import { rarityOfCard } from '../../src/features/gacha/draw/cardRarity';

describe('pity helpers', () => {
  beforeEach(() => {
    store.clear();
  });

  it('formats pity progress labels', () => {
    expect(buildPityProgressLabel(8)).toBe('8/10 cards until a rare or better is guaranteed');
  });

  it('injects a RAR+ card when pity is about to trigger', () => {
    const result = buildMockDrawResult({
      poolId: 'csharp',
      odds: { com: 0.7, rar: 0.27, leg: 0.03 },
      pityBefore: 9,
      sourceCards: [
        { stableUid: 'a', question: 'A', difficulty: 1, rarity: 'COM' },
        { stableUid: 'b', question: 'B', difficulty: 2, rarity: 'RAR' },
      ],
    });

    expect(result.pityTriggered).toBe(true);
    expect(result.cards.some((card) => card.rarity === 'RAR' || card.rarity === 'LEG')).toBe(true);
  });

  it('returns default pity state when nothing is stored', async () => {
    const state = await loadPityState('csharp');
    expect(state).toEqual(DEFAULT_PITY_STATE);
  });

  it('persists pity state round-trip', async () => {
    await savePityState('csharp', { draws: 6, threshold: 12 });
    const state = await loadPityState('csharp');
    expect(state).toEqual({ draws: 6, threshold: 12 });
  });

  it('returns empty v9 pity label when no missing legendary cards remain', () => {
    expect(buildPityProgressLabelV9({ draws: 4, threshold: 10 }, 0)).toBe('');
  });

  it('returns guarantee label when pity remaining is zero', () => {
    expect(buildPityProgressLabelV9({ draws: 10, threshold: 10 }, 1)).toBe('Next card guarantees a missing rare or better');
  });

  // 2026-10-17 batch open: the countdown was one card short. The guarantee pays on the slot after
  // the counter reaches the threshold, so from 7 of 10 three more Commons can come first and the
  // fourth card is the guaranteed one.
  it('returns countdown label when pity has not reached threshold', () => {
    expect(buildPityProgressLabelV9({ draws: 7, threshold: 10 }, 1)).toBe('A rare card is guaranteed within 4 cards');
  });

  it('counts the guaranteed card itself one Common before the threshold', () => {
    expect(buildPityProgressLabelV9({ draws: 9, threshold: 10 }, 1)).toBe('A rare card is guaranteed within 2 cards');
  });

  it('reads within 11 cards from a fresh pack, as the Help FAQ says', () => {
    expect(buildPityProgressLabelV9({ draws: 0, threshold: 10 }, 1)).toBe('A rare card is guaranteed within 11 cards');
  });

  it('promises the next card at or past the threshold', () => {
    expect(buildPityProgressLabelV9({ draws: 12, threshold: 10 }, 1)).toBe('Next card guarantees a missing rare or better');
  });
});

// 2026-10-17 batch open: the countdown is checked against the real selector, not only as a string.
// Worst case for the guarantee: thirty Commons and a single missing Rare, in random order.
describe('pity countdown matches the draw selector', () => {
  const deckCards = [
    ...Array.from({ length: 30 }, (_, i) => ({ StableUid: `com-${i}`, Question: `C${i}`, Difficulty: 1, OrderInDeck: i + 1 })),
    { StableUid: 'rar-1', Question: 'R1', Difficulty: 2, OrderInDeck: 31 },
  ];
  const withinOf = (draws: number) => {
    const label = buildPityProgressLabelV9({ draws, threshold: 10 }, 1);
    const match = /within (\d+) cards/.exec(label);
    return match ? Number(match[1]) : 1; // "Next card guarantees" = within 1
  };
  const hasRarePlus = (draws: number, drawCount: number, seed: number) =>
    selectDrawCards({ deckCards, ownedSet: new Set(), drawCount, pityState: { draws, threshold: 10 }, seed }).cards.some(
      (card) => rarityOfCard(card) !== 'COM',
    );

  it('always delivers the rare card within the promised count', () => {
    for (let draws = 0; draws <= 10; draws += 1) {
      const within = withinOf(draws);
      for (let seed = 0; seed < 200; seed += 1) {
        expect(hasRarePlus(draws, within, seed), `draws ${draws}, seed ${seed}`).toBe(true);
      }
    }
  });

  it('is not one card short: one card fewer than promised can still be all Commons', () => {
    for (let draws = 0; draws < 10; draws += 1) {
      const within = withinOf(draws);
      let allCommons = false;
      for (let seed = 0; seed < 200 && !allCommons; seed += 1) {
        allCommons = !hasRarePlus(draws, within - 1, seed);
      }
      expect(allCommons, `draws ${draws}`).toBe(true);
    }
  });
});
