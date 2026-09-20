import { describe, expect, it } from 'vitest';

import {
  DEVICE,
  FAST_FORWARD_FROM_HOLD_FRACTION,
  FAST_FORWARD_TEAR_FACTOR,
  REDUCED_MOTION_FLASH_MS,
  REDUCED_MOTION_SETTLE_MS,
  SPILL_STAGGER_MS,
  SPILL_START_FRACTION,
  SPILL_TRAVEL_FRACTION,
  SWIPE_TRIGGER_DISTANCE,
  TELL_FRACTION_OF_HOLD,
  TEST_BASE,
  TO_TABLE_CAP_MS,
  compressTimings,
  getCeremonyTimingOverride,
  phaseDurations,
  resolveCeremonyTimings,
  setCeremonyTimingOverride,
  type PeakRarity,
} from '../../src/features/gacha/draw/ceremonyTimings';

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

  it('DEVICE hold tiers rise COM < RAR < LEG with gaps of at least 240 ms', () => {
    for (const row of [DEVICE.single, DEVICE.multi]) {
      expect(row.hold.COM).toBeLessThan(row.hold.RAR);
      expect(row.hold.RAR).toBeLessThan(row.hold.LEG);
      expect(row.hold.RAR - row.hold.COM).toBeGreaterThanOrEqual(240);
      expect(row.hold.LEG - row.hold.RAR).toBeGreaterThanOrEqual(240);
    }
  });

  it('DEVICE anticipation sits inside the grammar band', () => {
    const singleCom = DEVICE.single.approach + DEVICE.single.hold.COM;
    expect(singleCom).toBeGreaterThanOrEqual(600);
    expect(singleCom).toBeLessThanOrEqual(1200);

    const upperBand: number[] = [
      DEVICE.single.approach + DEVICE.single.hold.RAR,
      DEVICE.single.approach + DEVICE.single.hold.LEG,
      ...RARITIES.map((r) => DEVICE.multi.approach + DEVICE.multi.hold[r]),
    ];
    for (const value of upperBand) {
      expect(value).toBeGreaterThanOrEqual(1200);
      expect(value).toBeLessThanOrEqual(2000);
    }
    expect(DEVICE.multi.approach + DEVICE.multi.hold.LEG).toBe(2000);
  });

  it('DEVICE reaches the table under the ceilings', () => {
    for (const isMulti of [false, true]) {
      for (const peakRarity of RARITIES) {
        const resolved = resolveCeremonyTimings({ isMulti, peakRarity, motionAvailable: true });
        expect(resolved.toTableMs).toBeLessThanOrEqual(isMulti ? TO_TABLE_CAP_MS.multi : TO_TABLE_CAP_MS.single);
      }
    }
    expect(resolveCeremonyTimings({ isMulti: false, peakRarity: 'LEG', motionAvailable: true }).toTableMs).toBe(3120);
    expect(resolveCeremonyTimings({ isMulti: true, peakRarity: 'LEG', motionAvailable: true }).toTableMs).toBe(5000);
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
    expect(t.hold).toBe(1100);
    expect(t.beatMs).toBe(300);
    expect(t.tearFlip).toBe(1800);

    const compressed = compressTimings(t, 660);
    expect(compressed.hold).toBe(300);
    expect(compressed.tearFlip).toBe(1125);
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

    expect(compressTimings(t, 900).hold).toBe(200);
    expect(compressTimings(t, 2000).hold).toBe(0);

    expect(t.hold).toBe(1100);
    expect(t.tearFlip).toBe(1800);
  });

  it('the __DEV__ override reaches DEVICE only and clears with null', () => {
    setCeremonyTimingOverride({ single: { approach: 1000 } as never });
    expect(resolveCeremonyTimings({ isMulti: false, peakRarity: 'RAR', motionAvailable: true }).approach).toBe(1000);
    expect(resolveCeremonyTimings({ isMulti: false, peakRarity: 'RAR', motionAvailable: true }).hold).toBe(620);
    expect(resolveCeremonyTimings({ isMulti: true, peakRarity: 'RAR', motionAvailable: true }).approach).toBe(900);
    expect(resolveCeremonyTimings({ isMulti: false, peakRarity: 'RAR', motionAvailable: false }).approach).toBe(300);
    expect(getCeremonyTimingOverride()).toEqual({ single: { approach: 1000 } });

    setCeremonyTimingOverride(null);
    expect(resolveCeremonyTimings({ isMulti: false, peakRarity: 'RAR', motionAvailable: true }).approach).toBe(600);
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
    expect(Object.isFrozen(TEST_BASE)).toBe(true);
    expect(Object.isFrozen(DEVICE)).toBe(true);
  });
});
