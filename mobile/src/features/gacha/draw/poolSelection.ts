import type { CardProgress } from '../../../review/model';
import type { CardExport } from '../../../types/deckExport';
import { rarityOfCard } from './cardRarity';
import type { PityState } from './pity';

export type SelectionInput = {
  deckCards: CardExport[];
  ownedSet: Set<string>;
  progress: CardProgress[];
  drawCount: number;
  pityState: PityState;
  seed: number;
};

export type SelectionOutput = {
  cards: CardExport[];
  poolExhausted: boolean;
  pityNext: PityState;
  pityFiredFor: 'LEG' | 'RAR' | null;
};

export function selectDrawCards(input: SelectionInput): SelectionOutput {
  const { deckCards, ownedSet, progress, drawCount, pityState, seed } = input;

  const progressByUid = new Map(progress.map((item) => [item.stableUid, item]));
  const missing = deckCards.filter((card) => !ownedSet.has(card.StableUid));

  if (missing.length === 0) {
    return { cards: [], poolExhausted: true, pityNext: pityState, pityFiredFor: null };
  }

  type Weighted = { card: CardExport; weight: number };
  const now = seed;
  const weighted: Weighted[] = missing.map((card) => {
    const currentProgress = progressByUid.get(card.StableUid);
    let weight = 1.0;
    if (
      currentProgress &&
      typeof currentProgress.nextReviewAt === 'number' &&
      currentProgress.nextReviewAt > 0 &&
      currentProgress.nextReviewAt <= now
    ) {
      weight = 2.0;
    }
    if (
      currentProgress &&
      typeof currentProgress.lastReviewedAt === 'number' &&
      currentProgress.lastReviewedAt > 0
    ) {
      weight = 3.0;
    }
    return { card, weight };
  });

  let pityFiredFor: 'LEG' | 'RAR' | null = null;
  let pityNext: PityState = pityState;
  const forcedCards: CardExport[] = [];

  if (pityState.draws >= pityState.threshold) {
    const missingLegendary = missing.find((card) => rarityOfCard(card) === 'LEG');
    if (missingLegendary) {
      forcedCards.push(missingLegendary);
      pityFiredFor = 'LEG';
      pityNext = { ...pityState, draws: 0 };
    } else {
      const missingRare = missing.find((card) => rarityOfCard(card) === 'RAR');
      if (missingRare) {
        forcedCards.push(missingRare);
        pityFiredFor = 'RAR';
        pityNext = { ...pityState, draws: 0 };
      }
    }
  }

  const forcedUids = new Set(forcedCards.map((card) => card.StableUid));
  const remaining: Weighted[] = weighted.filter((item) => !forcedUids.has(item.card.StableUid));

  const cards: CardExport[] = [...forcedCards];
  const slots = drawCount - forcedCards.length;
  let rngState = seed;

  function nextRandom(): number {
    rngState = (rngState + 0x6d2b79f5) >>> 0;
    let value = rngState;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  }

  for (let index = 0; index < slots && remaining.length > 0; index += 1) {
    const totalWeight = remaining.reduce((sum, item) => sum + item.weight, 0);
    let roll = nextRandom() * totalWeight;
    let pickedIndex = 0;
    for (let weightIndex = 0; weightIndex < remaining.length; weightIndex += 1) {
      roll -= remaining[weightIndex].weight;
      if (roll <= 0) {
        pickedIndex = weightIndex;
        break;
      }
    }
    cards.push(remaining[pickedIndex].card);
    remaining.splice(pickedIndex, 1);
  }

  if (pityFiredFor === null) {
    const surfacedLegendary = cards.some((card) => rarityOfCard(card) === 'LEG');
    if (surfacedLegendary) {
      pityNext = { ...pityNext, draws: 0 };
    } else {
      pityNext = { ...pityNext, draws: pityNext.draws + 1 };
    }
  }

  return {
    cards,
    poolExhausted: cards.length < drawCount,
    pityNext,
    pityFiredFor,
  };
}
