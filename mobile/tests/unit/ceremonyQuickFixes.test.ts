// G09 — pure-model coverage for the six draw-ceremony quick fixes that live in
// ceremonyTimings.ts and skipPolicy.ts. Imports only those two modules (no screen, no native
// mocks) so the timing/decision maths is pinned independently of the ceremony wiring.
import { describe, it, expect } from 'vitest';

import {
  DRAW_COMMITTED_SYNC_DELAY_MS,
  TO_TABLE_CAP_MS,
  type CeremonyPhase,
} from '../../src/features/gacha/draw/ceremonyTimings';
import { shouldMarkCeremonyComplete } from '../../src/features/gacha/draw/skipPolicy';

describe('ceremony quick fixes (G09)', () => {
  it('defers the draw_committed sync past the longest ceremony', () => {
    // MGACHA-03: the pull + draw-state sync must land after the longest possible ceremony, so
    // its network / JSON / AsyncStorage work never stutters the JS thread mid-ceremony.
    expect(DRAW_COMMITTED_SYNC_DELAY_MS).toBeGreaterThan(TO_TABLE_CAP_MS.multi);
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
