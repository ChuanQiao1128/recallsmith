import { describe, expect, it } from 'vitest';

import {
  BURST_CAMERA_PUNCH,
  CHARGE_DIM,
  CHARGE_PULSE_FRACTION_OF_HOLD,
  CHARGE_PULSE_SCALE,
  CHARGE_SHAKE_DEG,
  CHARGE_SHAKE_MS,
  CHARGE_SHAKE_PX,
  DEVICE,
  FAST_FORWARD_FROM_HOLD_FRACTION,
  FAST_FORWARD_TEAR_FACTOR,
  FLASH_FADE_MS,
  FLASH_HOLD_MS,
  FLASH_RISE_MS,
  REDUCED_MOTION_FLASH_MS,
  REDUCED_MOTION_SETTLE_MS,
  SPILL_STAGGER_MS,
  SPILL_START_FRACTION,
  SPILL_TRAVEL_FRACTION,
  SWIPE_TRIGGER_DISTANCE,
  TELL_FRACTION_OF_HOLD,
  TEST_BASE,
  TO_TABLE_CAP_MS,
  chargePulseOffsets,
  compressTimings,
  getCeremonyTimingOverride,
  phaseDurations,
  resolveCeremonyTimings,
  setCeremonyTimingOverride,
  type PeakRarity,
} from '../../src/features/gacha/draw/ceremonyTimings';
import { SPOTLIGHT_ENTRANCE_MS, spotlightFlipPlan } from '../../src/features/gacha/draw/spotlightPlan';

const RARITIES: PeakRarity[] = ['COM', 'RAR', 'LEG'];

describe('ceremonyTimings', () => {
  it('TEST_BASE is byte-for-byte the pre-1.6 table', () => {
    expect(resolveCeremonyTimings({ isMulti: false, peakRarity: 'RAR', motionAvailable: false })).toMatchObject({
      table: 'TEST_BASE',
      approach: 300,
      hold: 180,
      tearFlip: 360,
      flashReveal: 220,
      settleMs: 200,
      tableTailMs: 500,
    });
    expect(resolveCeremonyTimings({ isMulti: true, peakRarity: 'LEG', motionAvailable: false })).toMatchObject({
      approach: 620,
      hold: 300,
      tearFlip: 940,
      flashReveal: 280,
      settleMs: 300,
      tableTailMs: 500,
    });
    expect(resolveCeremonyTimings({ isMulti: false, peakRarity: 'COM', motionAvailable: false }).hold).toBe(140);
    expect(resolveCeremonyTimings({ isMulti: false, peakRarity: 'LEG', motionAvailable: false }).hold).toBe(220);
    expect(resolveCeremonyTimings({ isMulti: true, peakRarity: 'COM', motionAvailable: false }).hold).toBe(220);
    expect(resolveCeremonyTimings({ isMulti: true, peakRarity: 'RAR', motionAvailable: false }).hold).toBe(260);

    expect(
      phaseDurations(resolveCeremonyTimings({ isMulti: false, peakRarity: 'RAR', motionAvailable: false })),
    ).toEqual({
      swipe: 0,
      approach: 300,
      hold: 180,
      'tear-flip': 360,
      'flash-reveal': 220,
      settle: 200,
      'cards-on-table': 0,
    });
    expect(TEST_BASE.tapQueueMs).toBe(90);
  });

  it('DEVICE charge is the same for every rarity and pulses at approach start, hold start and mid-hold', () => {
    // v2 (I06): hold is the same for every rarity (the pack pulses three times on the three
    // charge plucks; only the colour on the third pulse tells the rarity).
    for (const row of [DEVICE.single, DEVICE.multi]) {
      expect(row.hold.COM).toBe(row.hold.RAR);
      expect(row.hold.RAR).toBe(row.hold.LEG);
    }
    // The three pulse offsets from approach start are [0, approach, approach + hold/2], matching
    // the plucks in charge.wav at 0 / 350 / 700 ms.
    const single = resolveCeremonyTimings({ isMulti: false, peakRarity: 'LEG', motionAvailable: true });
    expect(chargePulseOffsets(single)).toEqual([0, 350, 700]);
    for (const r of RARITIES) {
      const t = resolveCeremonyTimings({ isMulti: true, peakRarity: r, motionAvailable: true });
      expect(chargePulseOffsets(t)).toEqual([0, t.approach, t.approach + Math.round(t.hold * CHARGE_PULSE_FRACTION_OF_HOLD)]);
    }
  });

  it('DEVICE reaches the table under the ceilings', () => {
    for (const isMulti of [false, true]) {
      for (const peakRarity of RARITIES) {
        const resolved = resolveCeremonyTimings({ isMulti, peakRarity, motionAvailable: true });
        expect(resolved.toTableMs).toBeLessThanOrEqual(isMulti ? TO_TABLE_CAP_MS.multi : TO_TABLE_CAP_MS.single);
      }
    }
    expect(resolveCeremonyTimings({ isMulti: false, peakRarity: 'LEG', motionAvailable: true }).toTableMs).toBe(3050);
    expect(resolveCeremonyTimings({ isMulti: true, peakRarity: 'LEG', motionAvailable: true }).toTableMs).toBe(3050);
  });

  it('the single Legendary hero lands before TO_TABLE_CAP_MS.single', () => {
    const t = resolveCeremonyTimings({ isMulti: false, peakRarity: 'LEG', motionAvailable: true });
    const heroLandsMs = t.approach + t.hold + t.tearFlip + SPOTLIGHT_ENTRANCE_MS + spotlightFlipPlan('LEG', false).landMs;
    expect(heroLandsMs).toBeLessThanOrEqual(TO_TABLE_CAP_MS.single);
    expect(heroLandsMs).toBe(2720);
  });

  it('the silence beat fits after the colour tell', () => {
    for (const row of [DEVICE.single, DEVICE.multi]) {
      for (const r of RARITIES) {
        expect(DEVICE.beatMs[r]).toBeLessThanOrEqual(row.hold[r] * (1 - TELL_FRACTION_OF_HOLD));
      }
    }
    for (const r of RARITIES) {
      expect(TEST_BASE.beatMs[r]).toBe(0);
    }
  });

  it('compress keeps only the beat of hold and speeds the tear by 1.6x', () => {
    const t = resolveCeremonyTimings({ isMulti: true, peakRarity: 'LEG', motionAvailable: true });
    expect(t.hold).toBe(700);
    expect(t.beatMs).toBe(280);
    expect(t.tearFlip).toBe(900);

    // beatStart = hold - beatMs = 420; 500 ms in → 80 ms into the beat → hold' = 280 - 80 = 200.
    const compressed = compressTimings(t, 500);
    expect(compressed.hold).toBe(200);
    expect(compressed.tearFlip).toBe(Math.round(t.tearFlip / FAST_FORWARD_TEAR_FACTOR));
    expect(compressed.flashReveal).toBe(t.flashReveal);
    expect(compressed.settleMs).toBe(t.settleMs);
    expect(compressed.tableTailMs).toBe(t.tableTailMs);
    expect(compressed.toTableMs).toBe(
      compressed.approach +
        compressed.hold +
        compressed.tearFlip +
        compressed.flashReveal +
        compressed.settleMs +
        compressed.tableTailMs,
    );

    expect(compressTimings(t, 560).hold).toBe(140); // 140 ms into the beat → 280 - 140
    expect(compressTimings(t, 2000).hold).toBe(0);

    expect(t.hold).toBe(700);
    expect(t.tearFlip).toBe(900);
  });

  it('the __DEV__ override reaches DEVICE only and clears with null', () => {
    setCeremonyTimingOverride({ single: { approach: 1000 } as never });
    expect(resolveCeremonyTimings({ isMulti: false, peakRarity: 'RAR', motionAvailable: true }).approach).toBe(1000);
    expect(resolveCeremonyTimings({ isMulti: false, peakRarity: 'RAR', motionAvailable: true }).hold).toBe(700);
    expect(resolveCeremonyTimings({ isMulti: true, peakRarity: 'RAR', motionAvailable: true }).approach).toBe(350);
    expect(resolveCeremonyTimings({ isMulti: false, peakRarity: 'RAR', motionAvailable: false }).approach).toBe(300);
    expect(getCeremonyTimingOverride()).toEqual({ single: { approach: 1000 } });

    setCeremonyTimingOverride(null);
    expect(resolveCeremonyTimings({ isMulti: false, peakRarity: 'RAR', motionAvailable: true }).approach).toBe(350);
    expect(getCeremonyTimingOverride()).toBeNull();

    try {
      (globalThis as { __DEV__?: boolean }).__DEV__ = false;
      setCeremonyTimingOverride({ single: { approach: 1234 } as never });
      expect(getCeremonyTimingOverride()).toBeNull();
    } finally {
      (globalThis as { __DEV__?: boolean }).__DEV__ = true;
    }
  });

  it('exports the shared constants', () => {
    expect(REDUCED_MOTION_FLASH_MS).toBe(180);
    expect(REDUCED_MOTION_SETTLE_MS).toBe(240);
    expect(SWIPE_TRIGGER_DISTANCE).toBe(72);
    expect(TELL_FRACTION_OF_HOLD).toBe(0.6);
    expect(FAST_FORWARD_FROM_HOLD_FRACTION).toBe(0.6);
    expect(FAST_FORWARD_TEAR_FACTOR).toBe(1.6);
    expect(SPILL_STAGGER_MS).toBe(60);
    expect(SPILL_START_FRACTION).toBe(0.5);
    expect(SPILL_TRAVEL_FRACTION).toBeCloseTo(1 / 6);
    expect(CHARGE_DIM).toBe(0.55);
    expect(CHARGE_PULSE_FRACTION_OF_HOLD).toBe(0.5);
    expect(CHARGE_PULSE_SCALE).toBe(1.06);
    expect(CHARGE_SHAKE_PX).toBe(6);
    expect(CHARGE_SHAKE_DEG).toBe(3);
    expect(CHARGE_SHAKE_MS).toBe(120);
    expect(BURST_CAMERA_PUNCH).toBe(1.08);
    expect(FLASH_RISE_MS).toBe(50);
    expect(FLASH_HOLD_MS).toBe(40);
    expect(FLASH_FADE_MS).toBe(300);
    expect(Object.isFrozen(TEST_BASE)).toBe(true);
    expect(Object.isFrozen(DEVICE)).toBe(true);
  });
});
