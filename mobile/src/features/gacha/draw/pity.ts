import { loadDrawState, saveDrawState } from './drawStateStore';

export type MockDrawCard = {
  stableUid: string;
  question: string;
  difficulty: number;
  rarity: 'COM' | 'RAR' | 'LEG';
  tag?: string;
};

export type PoolOdds = {
  com: number;
  rar: number;
  leg: number;
};

export type MockDrawResult = {
  poolId: string;
  cards: MockDrawCard[];
  pityBefore: number;
  pityAfter: number;
  pityTriggered: boolean;
  highlightedRarity: 'RAR' | 'LEG' | null;
  seedLabel: string;
};

export type PityState = {
  draws: number;
  threshold: number;
};

export const DEFAULT_PITY_STATE: PityState = { draws: 0, threshold: 10 };

export function pickRarity(roll: number, odds: PoolOdds): 'COM' | 'RAR' | 'LEG' {
  if (roll < odds.leg) return 'LEG';
  if (roll < odds.leg + odds.rar) return 'RAR';
  return 'COM';
}

// "8/10 until guaranteed RAR+" read as 8 of 10 cards, which is not what the
// counter measures: poolSelection advances it once per draw action, so a
// ten-card pull moves it by 1. Saying "draws" keeps the unit honest without
// touching the mechanic (see the simulation numbers in poolSelection.ts).
export function buildPityProgressLabel(count: number): string {
  const safe = Math.max(0, Math.min(9, Math.floor(count)));
  return `${safe}/10 draws until guaranteed RAR+`;
}

export function buildMockDrawResult(params: {
  poolId: string;
  odds: PoolOdds;
  sourceCards: MockDrawCard[];
  pityBefore?: number;
  drawCount?: number;
}): MockDrawResult {
  const { poolId, odds, sourceCards, pityBefore = 0, drawCount = 10 } = params;
  const cards: MockDrawCard[] = [];
  let pityCounter = Math.max(0, Math.floor(pityBefore));
  let pityTriggered = false;

  for (let i = 0; i < drawCount; i += 1) {
    const base = sourceCards[i % sourceCards.length];
    let rarity: 'COM' | 'RAR' | 'LEG';

    if (pityCounter >= 9) {
      rarity = base.rarity === 'LEG' ? 'LEG' : 'RAR';
      pityTriggered = true;
      pityCounter = 0;
    } else {
      const roll = ((i * 37 + pityBefore * 13 + poolId.length * 17) % 100) / 100;
      rarity = pickRarity(roll, odds);
      pityCounter = rarity === 'COM' ? pityCounter + 1 : 0;
    }

    cards.push({ ...base, rarity });
  }

  const highlightedRarity = cards.some((card) => card.rarity === 'LEG') ? 'LEG' : cards.some((card) => card.rarity === 'RAR') ? 'RAR' : null;

  return {
    poolId,
    cards,
    pityBefore: Math.max(0, Math.floor(pityBefore)),
    pityAfter: pityCounter,
    pityTriggered,
    highlightedRarity,
    seedLabel: `seed #${(poolId.length * 173 + pityBefore * 91 + drawCount * 47).toString(16)}`,
  };
}

export function buildPityProgressLabelV9(state: PityState, missingLegCount: number): string {
  if (missingLegCount === 0) return '';
  const remaining = Math.max(0, state.threshold - state.draws);
  if (remaining === 0) return 'Next draw guarantees a missing rare or better';
  return `${remaining} draws until guaranteed reveal`;
}

/**
 * Normalises a persisted pity record. Kept separate from storage so the
 * merged-key loader can stay ignorant of gameplay defaults: the store
 * reports what was written, this decides what a missing threshold means.
 */
export function normalizePityState(stored: PityState | null): PityState {
  if (!stored) return { ...DEFAULT_PITY_STATE };
  return {
    draws: Math.max(0, Math.floor(stored.draws)),
    threshold: stored.threshold > 0 ? stored.threshold : DEFAULT_PITY_STATE.threshold,
  };
}

export async function loadPityState(slug: string): Promise<PityState> {
  try {
    const state = await loadDrawState(slug);
    return normalizePityState(state.pity);
  } catch {
    return { ...DEFAULT_PITY_STATE };
  }
}

export async function savePityState(slug: string, state: PityState): Promise<void> {
  // Read-modify-write of the merged record: pity shares its key with the
  // owned set now, so writing pity alone would erase the collection.
  const current = await loadDrawState(slug);
  await saveDrawState(slug, { owned: current.owned, pity: state });
}
