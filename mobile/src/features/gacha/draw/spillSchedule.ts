// Pure multi-pull deal model: replaces the padded orbit at DrawCeremonyScreen.tsx:828-836
// (which cloned a 2-card pull up to 6). Invariants: exactly cards.length entries, in
// card-index order (entries[i].index === i); every card lands inside the tear phase; the
// featured card is dealt last to the centre slot; slots are a permutation of 0..count-1.
// The stagger/start/travel numbers come from ceremonyTimings.ts, not from local literals
// (design §3.1 M3).

import {
  SPILL_STAGGER_MS,
  SPILL_START_FRACTION,
  SPILL_TRAVEL_FRACTION,
  type PeakRarity,
} from './ceremonyTimings';

export type SpillEntry = { index: number; leaveAt: number; landAt: number; slot: number };
export type SpillSchedule = {
  entries: SpillEntry[];
  startMs: number;
  travelMs: number;
  staggerMs: number;
  featuredIndex: number;
};

// Index of the first 'LEG', else the first 'RAR', else 0; -1 for an empty pull.
// Same precedence as pickFeaturedCard (DrawCeremonyScreen.tsx:133-140), by index.
export function featuredCardIndex(cards: ReadonlyArray<{ rarity: PeakRarity }>): number {
  if (cards.length === 0) return -1;
  const leg = cards.findIndex((c) => c.rarity === 'LEG');
  if (leg >= 0) return leg;
  const rar = cards.findIndex((c) => c.rarity === 'RAR');
  if (rar >= 0) return rar;
  return 0;
}

// Middle of the top row of the table layout (DrawCeremonyScreen.tsx:1199-1224):
// one row up to five cards, otherwise two rows of ceil(n/2).
export function centreSlot(count: number): number {
  if (count < 1) return 0;
  const rowLength = count <= 5 ? count : Math.ceil(count / 2);
  return Math.floor((rowLength - 1) / 2);
}

export function buildSpillSchedule(
  cards: ReadonlyArray<{ rarity: PeakRarity }>,
  tearMs: number,
): SpillSchedule {
  const count = cards.length;
  // A negative or non-finite tear collapses the whole deal to t = 0 rather than
  // producing negative stagger.
  const tear = Number.isFinite(tearMs) && tearMs > 0 ? tearMs : 0;
  const startMs = Math.round(tear * SPILL_START_FRACTION);
  const travelMs = Math.round(tear * SPILL_TRAVEL_FRACTION);
  const featuredIndex = featuredCardIndex(cards);

  if (count === 0) {
    return { entries: [], startMs, travelMs, staggerMs: 0, featuredIndex: -1 };
  }

  const staggerMs =
    count <= 1
      ? 0
      : Math.max(0, Math.min(SPILL_STAGGER_MS, Math.floor((tear - startMs - travelMs) / (count - 1))));

  // Slots: the featured card takes the centre; the remaining slots go to the
  // non-featured cards in index order.
  const featuredSlot = centreSlot(count);
  const remainingSlots: number[] = [];
  for (let s = 0; s < count; s++) {
    if (s !== featuredSlot) remainingSlots.push(s);
  }

  const slotOf = new Array<number>(count);
  const nonFeatured: number[] = [];
  for (let i = 0; i < count; i++) {
    if (i !== featuredIndex) nonFeatured.push(i);
  }
  nonFeatured.forEach((cardIdx, i) => {
    slotOf[cardIdx] = remainingSlots[i];
  });
  slotOf[featuredIndex] = featuredSlot;

  // Deal order: every non-featured card in index order, then the featured card last.
  const dealOrder = [...nonFeatured, featuredIndex];
  const entries = new Array<SpillEntry>(count);
  dealOrder.forEach((cardIdx, o) => {
    const leaveAt = startMs + o * staggerMs;
    entries[cardIdx] = { index: cardIdx, leaveAt, landAt: leaveAt + travelMs, slot: slotOf[cardIdx] };
  });

  return { entries, startMs, travelMs, staggerMs, featuredIndex };
}
