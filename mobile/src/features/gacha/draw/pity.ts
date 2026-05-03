export type MockDrawCard = {
  stableUid: string;
  question: string;
  difficulty: number;
  rarity: 'COM' | 'RAR' | 'LEG';
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

function pickRarity(roll: number, odds: PoolOdds): 'COM' | 'RAR' | 'LEG' {
  if (roll < odds.leg) return 'LEG';
  if (roll < odds.leg + odds.rar) return 'RAR';
  return 'COM';
}

export function buildPityProgressLabel(count: number): string {
  const safe = Math.max(0, Math.min(9, Math.floor(count)));
  return `${safe}/10 until guaranteed RAR+`;
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
