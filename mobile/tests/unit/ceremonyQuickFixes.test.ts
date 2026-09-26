// G09 — pure-model coverage for the six draw-ceremony quick fixes that live in
// ceremonyTimings.ts and skipPolicy.ts. Imports only those two modules (no screen, no native
// mocks) so the timing/decision maths is pinned independently of the ceremony wiring.
import { describe, it, expect } from 'vitest';

import {
  BED_TABLE_FADE_DELAY_MS,
  BED_TABLE_FADE_OUT_MS,
  DEVICE,
  DRAW_COMMITTED_SYNC_DELAY_MS,
  TO_TABLE_CAP_MS,
  tapFlipCueOffsets,
  type CeremonyPhase,
} from '../../src/features/gacha/draw/ceremonyTimings';
import { shouldMarkCeremonyComplete } from '../../src/features/gacha/draw/skipPolicy';

describe('ceremony quick fixes (G09)', () => {
  it('defers the draw_committed sync past the longest ceremony', () => {
    // MGACHA-03: the pull + draw-state sync must land after the longest possible ceremony, so
    // its network / JSON / AsyncStorage work never stutters the JS thread mid-ceremony.
    expect(DRAW_COMMITTED_SYNC_DELAY_MS).toBeGreaterThan(TO_TABLE_CAP_MS.multi);
  });

  it('fades the table bed out before the 8 s ambience loop can wrap', () => {
    // MGACHA-02: ambience.wav is an 8 s non-gapless loop; the fade must complete before the
    // loop boundary would be reached on a normal pull.
    expect(BED_TABLE_FADE_DELAY_MS + BED_TABLE_FADE_OUT_MS).toBeLessThan(8000);
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

  it('schedules the flip sound at lift end and the rarity sting at the flip midpoint', () => {
    // MGACHA-07: on the DEVICE table (liftMs 80, LEG flipMs 640) a head-of-queue LEG flip plays
    // the flip sound at lift end and the sting at the flip midpoint (when the face appears).
    expect(tapFlipCueOffsets('LEG', 0, DEVICE)).toEqual({ flipAtMs: 80, stingAtMs: 400 });
    // COM has no rarity sting.
    expect(tapFlipCueOffsets('COM', 0, DEVICE).stingAtMs).toBeNull();
    // A 90 ms queue delay (one TAP_QUEUE_GAP) shifts both cues by 90 ms.
    expect(tapFlipCueOffsets('LEG', 90, DEVICE)).toEqual({ flipAtMs: 170, stingAtMs: 490 });
  });
});
