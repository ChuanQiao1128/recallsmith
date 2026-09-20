// Pure timing model for the 1.6 draw ceremony. It owns CeremonyPhase/PeakRarity
// and the two timing tables that every phase transition reads from.
//
// TEST_BASE is byte-for-byte the pre-1.6 table asserted by
// draw-ceremony.screen.test.tsx:73-92 and must never change — B09 imports it so
// that test keeps passing. DEVICE is the real-device (Seam-of-Light) table,
// tuned through CeremonyTuning (B13) and documented by B14.

import type { Rarity } from './cardRarity';

export type CeremonyPhase =
  | 'swipe' | 'approach' | 'hold' | 'tear-flip' | 'flash-reveal' | 'settle' | 'cards-on-table';
export type PeakRarity = Rarity;
export type { Rarity };

export type CeremonyTimingTable = {
  single: { approach: number; hold: Record<PeakRarity, number>; tearFlip: number; flashReveal: number; settleMs: number };
  multi:  { approach: number; hold: Record<PeakRarity, number>; tearFlip: number; flashReveal: number; settleMs: number };
  tableTailMs: number;
  beatMs: Record<PeakRarity, number>;
  flipMs: Record<PeakRarity, number>;
  rimSettleMs: Record<PeakRarity, number>;
  liftMs: number; landMs: number; tapQueueMs: number;
};

export const TEST_BASE: CeremonyTimingTable = Object.freeze({
  single: { approach: 300, hold: { COM: 140, RAR: 180, LEG: 220 }, tearFlip: 360, flashReveal: 220, settleMs: 200 },
  multi:  { approach: 620, hold: { COM: 220, RAR: 260, LEG: 300 }, tearFlip: 940, flashReveal: 280, settleMs: 300 },
  tableTailMs: 500,
  beatMs: { COM: 0, RAR: 0, LEG: 0 },
  flipMs: { COM: 0, RAR: 0, LEG: 0 },
  rimSettleMs: { COM: 0, RAR: 0, LEG: 0 },
  liftMs: 0, landMs: 0, tapQueueMs: 90,
});

export const DEVICE: CeremonyTimingTable = Object.freeze({
  single: { approach: 600, hold: { COM: 360, RAR: 620, LEG: 880 }, tearFlip: 600, flashReveal: 320, settleMs: 520 },
  multi:  { approach: 900, hold: { COM: 600, RAR: 860, LEG: 1100 }, tearFlip: 1800, flashReveal: 400, settleMs: 600 },
  tableTailMs: 200,
  beatMs: { COM: 120, RAR: 180, LEG: 300 },
  flipMs: { COM: 380, RAR: 480, LEG: 640 },
  rimSettleMs: { COM: 800, RAR: 1000, LEG: 1200 },
  liftMs: 80, landMs: 200, tapQueueMs: 90,
});

export const TO_TABLE_CAP_MS = Object.freeze({ single: 3300, multi: 5500 });
export const REDUCED_MOTION_FLASH_MS = 180;
export const REDUCED_MOTION_SETTLE_MS = 240;
export const SWIPE_TRIGGER_DISTANCE = 72;
export const TELL_FRACTION_OF_HOLD = 0.6;
export const FAST_FORWARD_FROM_HOLD_FRACTION = 0.6;
export const FAST_FORWARD_TEAR_FACTOR = 1.6;
export const SPILL_STAGGER_MS = 60;
export const SPILL_START_FRACTION = 0.5;
export const SPILL_TRAVEL_FRACTION = 1 / 6;

export type ResolvedCeremonyTimings = {
  table: 'TEST_BASE' | 'DEVICE';
  isMulti: boolean; peakRarity: PeakRarity;
  approach: number; hold: number; tearFlip: number; flashReveal: number; settleMs: number; tableTailMs: number;
  beatMs: number;
  flipMs: Record<PeakRarity, number>; rimSettleMs: Record<PeakRarity, number>;
  liftMs: number; landMs: number; tapQueueMs: number;
  toTableMs: number;
};

type TimingRow = CeremonyTimingTable['single'];

function mergeRow(base: TimingRow, over: Partial<TimingRow> | undefined): TimingRow {
  if (!over) return base;
  return {
    approach: over.approach ?? base.approach,
    hold: { ...base.hold, ...(over.hold ?? {}) },
    tearFlip: over.tearFlip ?? base.tearFlip,
    flashReveal: over.flashReveal ?? base.flashReveal,
    settleMs: over.settleMs ?? base.settleMs,
  };
}

function mergeTable(base: CeremonyTimingTable, over: Partial<CeremonyTimingTable> | null): CeremonyTimingTable {
  if (!over) return base;
  return {
    single: mergeRow(base.single, over.single),
    multi: mergeRow(base.multi, over.multi),
    tableTailMs: over.tableTailMs ?? base.tableTailMs,
    beatMs: { ...base.beatMs, ...(over.beatMs ?? {}) },
    flipMs: { ...base.flipMs, ...(over.flipMs ?? {}) },
    rimSettleMs: { ...base.rimSettleMs, ...(over.rimSettleMs ?? {}) },
    liftMs: over.liftMs ?? base.liftMs,
    landMs: over.landMs ?? base.landMs,
    tapQueueMs: over.tapQueueMs ?? base.tapQueueMs,
  };
}

export function resolveCeremonyTimings(input: {
  isMulti: boolean;
  peakRarity: PeakRarity;
  motionAvailable: boolean;
}): ResolvedCeremonyTimings {
  const { isMulti, peakRarity, motionAvailable } = input;
  const table = motionAvailable ? mergeTable(DEVICE, getCeremonyTimingOverride()) : TEST_BASE;
  const tableName: 'TEST_BASE' | 'DEVICE' = motionAvailable ? 'DEVICE' : 'TEST_BASE';
  const row = isMulti ? table.multi : table.single;
  const approach = row.approach;
  const hold = row.hold[peakRarity];
  const tearFlip = row.tearFlip;
  const flashReveal = row.flashReveal;
  const settleMs = row.settleMs;
  const tableTailMs = table.tableTailMs;
  const toTableMs = approach + hold + tearFlip + flashReveal + settleMs + tableTailMs;
  return Object.freeze({
    table: tableName,
    isMulti,
    peakRarity,
    approach,
    hold,
    tearFlip,
    flashReveal,
    settleMs,
    tableTailMs,
    beatMs: table.beatMs[peakRarity],
    flipMs: table.flipMs,
    rimSettleMs: table.rimSettleMs,
    liftMs: table.liftMs,
    landMs: table.landMs,
    tapQueueMs: table.tapQueueMs,
    toTableMs,
  });
}

export function phaseDurations(t: ResolvedCeremonyTimings): Record<CeremonyPhase, number> {
  return {
    swipe: 0,
    approach: t.approach,
    hold: t.hold,
    'tear-flip': t.tearFlip,
    'flash-reveal': t.flashReveal,
    settle: t.settleMs,
    'cards-on-table': 0,
  };
}

export function compressTimings(t: ResolvedCeremonyTimings, elapsedInHoldMs: number): ResolvedCeremonyTimings {
  const beatStart = t.hold - t.beatMs;
  const elapsedInBeat = Math.max(0, elapsedInHoldMs - beatStart);
  const hold = Math.max(0, t.beatMs - elapsedInBeat);
  const tearFlip = Math.round(t.tearFlip / FAST_FORWARD_TEAR_FACTOR);
  const toTableMs = t.approach + hold + tearFlip + t.flashReveal + t.settleMs + t.tableTailMs;
  return Object.freeze({ ...t, hold, tearFlip, toTableMs });
}

let override: Partial<CeremonyTimingTable> | null = null;

export function setCeremonyTimingOverride(next: Partial<CeremonyTimingTable> | null): void {
  if (!(globalThis as { __DEV__?: boolean }).__DEV__) return;
  override = next;
}

export function getCeremonyTimingOverride(): Partial<CeremonyTimingTable> | null {
  if (!(globalThis as { __DEV__?: boolean }).__DEV__) return null;
  return override;
}
