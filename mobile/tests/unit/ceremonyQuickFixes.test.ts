// G09 — pure-model coverage for the six draw-ceremony quick fixes that live in
// ceremonyTimings.ts and skipPolicy.ts. Imports only those two modules (no screen, no native
// mocks) so the timing/decision maths is pinned independently of the ceremony wiring.
import { describe, it, expect } from 'vitest';

import {
  DRAW_COMMITTED_SYNC_DELAY_MS,
  REVEAL_ALLOWANCE_PER_CARD_MS,
  TO_TABLE_CAP_MS,
  drawCommittedSyncDelayMs,
  type CeremonyPhase,
} from '../../src/features/gacha/draw/ceremonyTimings';
import { shouldMarkCeremonyComplete } from '../../src/features/gacha/draw/skipPolicy';
import { SPOTLIGHT_AUTO_ADVANCE_MS } from '../../src/features/gacha/draw/spotlightQueue';
import { SPOTLIGHT_ENTRANCE_MS, spotlightFlipPlan } from '../../src/features/gacha/draw/spotlightPlan';
import { MAX_BATCH_OPEN } from '../../src/features/gacha/draw/drawBatch';

describe('ceremony quick fixes (G09)', () => {
  it('defers the draw_committed sync past the longest ceremony', () => {
    // MGACHA-03: the pull + draw-state sync must land after the longest possible ceremony, so
    // its network / JSON / AsyncStorage work never stutters the JS thread mid-ceremony.
    expect(DRAW_COMMITTED_SYNC_DELAY_MS).toBeGreaterThan(TO_TABLE_CAP_MS.multi);
  });

  // 2026-10-17 batch open: a five-card open spends ~9-12 s in the spotlight after reaching the
  // table, so the sync delay grows with the card count instead of stopping at the table.
  it('keeps a single-card open on the original delay', () => {
    expect(drawCommittedSyncDelayMs(1)).toBe(DRAW_COMMITTED_SYNC_DELAY_MS);
  });

  it('defers a multi-card open past the table and the whole spotlight reveal', () => {
    for (let count = 2; count <= 10; count += 1) {
      expect(drawCommittedSyncDelayMs(count)).toBe(TO_TABLE_CAP_MS.multi + count * REVEAL_ALLOWANCE_PER_CARD_MS + 1000);
      expect(drawCommittedSyncDelayMs(count)).toBeGreaterThan(drawCommittedSyncDelayMs(count - 1));
    }
    // Five cards: a ~9-12 s open, plus a margin, before the sync may start.
    expect(drawCommittedSyncDelayMs(MAX_BATCH_OPEN)).toBeGreaterThanOrEqual(12_000 + 1_000);
  });

  it('gives every card at least its spotlight entrance, flip and auto-advance hold', () => {
    for (const rarity of ['COM', 'RAR', 'LEG'] as const) {
      const plan = spotlightFlipPlan(rarity, false);
      // A Legendary has no auto-advance (it waits for a tap); its allowance covers the flip.
      const hold = SPOTLIGHT_AUTO_ADVANCE_MS[rarity] ?? 0;
      expect(SPOTLIGHT_ENTRANCE_MS + plan.landMs + hold, rarity).toBeLessThanOrEqual(REVEAL_ALLOWANCE_PER_CARD_MS);
    }
  });

  it('reads a junk count as one card', () => {
    expect(drawCommittedSyncDelayMs(0)).toBe(DRAW_COMMITTED_SYNC_DELAY_MS);
    expect(drawCommittedSyncDelayMs(Number.NaN)).toBe(DRAW_COMMITTED_SYNC_DELAY_MS);
  });

  it('marks the ceremony complete once it reaches settle or the table, exactly once', () => {
    // MGACHA-09: settle and the table both count as completed; earlier phases never do.
    const before: CeremonyPhase[] = ['swipe', 'approach', 'hold', 'tear-flip', 'flash-reveal'];
    for (const phase of before) {
      expect(shouldMarkCeremonyComplete(phase, false)).toBe(false);
    }
    expect(shouldMarkCeremonyComplete('settle', false)).toBe(true);
    expect(shouldMarkCeremonyComplete('cards-on-table', false)).toBe(true);

    // Exactly once: after the first mark, reaching the table (or settling again) does not re-mark.
    expect(shouldMarkCeremonyComplete('settle', true)).toBe(false);
    expect(shouldMarkCeremonyComplete('cards-on-table', true)).toBe(false);
  });
});
