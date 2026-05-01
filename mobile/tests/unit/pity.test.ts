import { describe, expect, it } from 'vitest';
import { buildMockDrawResult, buildPityProgressLabel } from '../../src/features/gacha/draw/pity';

describe('pity helpers', () => {
  it('formats pity progress labels', () => {
    expect(buildPityProgressLabel(8)).toBe('8/10 until guaranteed RAR+');
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
});
