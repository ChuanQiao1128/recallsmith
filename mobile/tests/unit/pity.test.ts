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

describe('pity helpers', () => {
  beforeEach(() => {
    store.clear();
  });

  it('formats pity progress labels', () => {
    expect(buildPityProgressLabel(8)).toBe('8/10 draws until guaranteed RAR+');
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
    expect(buildPityProgressLabelV9({ draws: 10, threshold: 10 }, 1)).toBe('Next draw guarantees a missing rare or better');
  });

  it('returns countdown label when pity has not reached threshold', () => {
    expect(buildPityProgressLabelV9({ draws: 7, threshold: 10 }, 1)).toBe('3 draws until guaranteed reveal');
  });
});
