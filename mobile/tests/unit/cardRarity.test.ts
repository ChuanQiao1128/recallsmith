import { describe, expect, it } from 'vitest';
import { rarityFromDifficulty } from '../../src/features/gacha/draw/cardRarity';

describe('cardRarity', () => {
  it('maps known difficulties to rarity', () => {
    expect(rarityFromDifficulty(1)).toBe('COM');
    expect(rarityFromDifficulty(2)).toBe('RAR');
    expect(rarityFromDifficulty(3)).toBe('LEG');
  });

  it('treats invalid low values as common', () => {
    expect(rarityFromDifficulty(0)).toBe('COM');
    expect(rarityFromDifficulty(-1)).toBe('COM');
    expect(rarityFromDifficulty(Number.NaN)).toBe('COM');
  });

  it('treats 4+ as legendary', () => {
    expect(rarityFromDifficulty(4)).toBe('LEG');
    expect(rarityFromDifficulty(99)).toBe('LEG');
  });
});
