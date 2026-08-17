import type { CardExport } from '../../../types/deckExport';

export type Rarity = 'COM' | 'RAR' | 'LEG';

export function rarityFromDifficulty(difficulty: number): Rarity {
  if (difficulty >= 3) return 'LEG';
  if (difficulty === 2) return 'RAR';
  return 'COM';
}

export function rarityOfCard(card: CardExport): Rarity {
  return rarityFromDifficulty(card.Difficulty);
}

export const RARITY_RANK: Record<Rarity, number> = { COM: 0, RAR: 1, LEG: 2 };
