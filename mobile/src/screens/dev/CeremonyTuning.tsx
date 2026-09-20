// __DEV__-only tuning screen for the DEVICE ceremony timing table (B13).
//
// Stepper rows (− / +) write the whole merged table back through
// setCeremonyTimingOverride, so a later resolveCeremonyTimings on device sees
// exactly what the screen shows. A cap readout previews each toTableMs against
// TO_TABLE_CAP_MS, and the frame-gap probe reads requestAnimationFrame deltas on
// the JS thread — this measures JS-thread rAF gaps (the "first LEG flip stall"
// half of rubric F), not the UI-thread Reanimated/Skia cadence, which needs
// Instruments/gfxinfo. The screen self-gates on __DEV__ so a release build with
// this module bundled still renders only the unavailable text.

import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../navigation/types';
import {
  DEVICE,
  TO_TABLE_CAP_MS,
  resolveCeremonyTimings,
  getCeremonyTimingOverride,
  setCeremonyTimingOverride,
  type CeremonyTimingTable,
  type PeakRarity,
} from '../../features/gacha/draw/ceremonyTimings';
import { motionAvailable, skiaAvailable } from '../../components/ceremony/reanimatedGuard';

export type TuningKey =
  | `${'single' | 'multi'}.${'approach' | 'tearFlip' | 'flashReveal' | 'settleMs'}`
  | `${'single' | 'multi'}.hold.${PeakRarity}`
  | 'tableTailMs'
  | `${'beatMs' | 'flipMs' | 'rimSettleMs'}.${PeakRarity}`;

/** 24 keys, in this exact order (row order on screen). */
export const TUNING_KEYS: ReadonlyArray<TuningKey> = [
  'single.approach', 'single.hold.COM', 'single.hold.RAR', 'single.hold.LEG', 'single.tearFlip', 'single.flashReveal', 'single.settleMs',
  'multi.approach', 'multi.hold.COM', 'multi.hold.RAR', 'multi.hold.LEG', 'multi.tearFlip', 'multi.flashReveal', 'multi.settleMs',
  'tableTailMs',
  'beatMs.COM', 'beatMs.RAR', 'beatMs.LEG', 'flipMs.COM', 'flipMs.RAR', 'flipMs.LEG', 'rimSettleMs.COM', 'rimSettleMs.RAR', 'rimSettleMs.LEG',
];

export const TUNING_STEP_MS = 20;
export const TUNING_MIN_MS = 0;
export const TUNING_MAX_MS = 4000;
/** Rubric F (release-1.6.0-plan:133): p95 frame gap < 22 ms, no frame > 50 ms. */
export const FRAME_GAP_P95_CAP_MS = 22;
export const FRAME_GAP_MAX_CAP_MS = 50;
/** Rolling window of gaps kept (≈ 10 s at 60 Hz) and how often the readout re-renders (every 30 frames ≈ 0.5 s). */
export const PROBE_WINDOW = 600;
export const PROBE_REPORT_EVERY = 30;

type FrameGapSummary = { p95: number; max: number; count: number };
type TimingRowKey = 'single' | 'multi';

function deepCopyTable(t: CeremonyTimingTable): CeremonyTimingTable {
  return {
    single: { approach: t.single.approach, hold: { ...t.single.hold }, tearFlip: t.single.tearFlip, flashReveal: t.single.flashReveal, settleMs: t.single.settleMs },
    multi: { approach: t.multi.approach, hold: { ...t.multi.hold }, tearFlip: t.multi.tearFlip, flashReveal: t.multi.flashReveal, settleMs: t.multi.settleMs },
    tableTailMs: t.tableTailMs,
    beatMs: { ...t.beatMs },
    flipMs: { ...t.flipMs },
    rimSettleMs: { ...t.rimSettleMs },
    liftMs: t.liftMs,
    landMs: t.landMs,
    tapQueueMs: t.tapQueueMs,
  };
}

function mergeRow(base: CeremonyTimingTable['single'], over: Partial<CeremonyTimingTable['single']> | undefined): CeremonyTimingTable['single'] {
  return {
    approach: over?.approach ?? base.approach,
    hold: { ...base.hold, ...(over?.hold ?? {}) },
    tearFlip: over?.tearFlip ?? base.tearFlip,
    flashReveal: over?.flashReveal ?? base.flashReveal,
    settleMs: over?.settleMs ?? base.settleMs,
  };
}

/** Pure. Deep-copies `base` and lays `override` on top (top-level keys only — the override is Partial<CeremonyTimingTable>). null → copy of base. */
export function mergeTimingOverride(base: CeremonyTimingTable, override: Partial<CeremonyTimingTable> | null): CeremonyTimingTable {
  const b = deepCopyTable(base);
  if (!override) return b;
  return {
    single: mergeRow(b.single, override.single),
    multi: mergeRow(b.multi, override.multi),
    tableTailMs: override.tableTailMs ?? b.tableTailMs,
    beatMs: { ...b.beatMs, ...(override.beatMs ?? {}) },
    flipMs: { ...b.flipMs, ...(override.flipMs ?? {}) },
    rimSettleMs: { ...b.rimSettleMs, ...(override.rimSettleMs ?? {}) },
    liftMs: override.liftMs ?? b.liftMs,
    landMs: override.landMs ?? b.landMs,
    tapQueueMs: override.tapQueueMs ?? b.tapQueueMs,
  };
}

/** Pure. e.g. 'single.hold.LEG' → table.single.hold.LEG; 'tableTailMs' → table.tableTailMs. */
export function readTimingPath(table: CeremonyTimingTable, key: TuningKey): number {
  const parts = key.split('.');
  if (parts.length === 1) return (table as unknown as Record<string, number>)[parts[0]];
  if (parts[0] === 'single' || parts[0] === 'multi') {
    const row = table[parts[0] as TimingRowKey];
    if (parts[1] === 'hold') return row.hold[parts[2] as PeakRarity];
    return (row as unknown as Record<string, number>)[parts[1]];
  }
  const group = (table as unknown as Record<string, Record<string, number>>)[parts[0]];
  return group[parts[1]];
}

/** Pure. Returns a NEW table (never mutates), value clamped to [TUNING_MIN_MS, TUNING_MAX_MS] and rounded to an integer. */
export function writeTimingPath(table: CeremonyTimingTable, key: TuningKey, valueMs: number): CeremonyTimingTable {
  const clamped = Math.round(Math.min(TUNING_MAX_MS, Math.max(TUNING_MIN_MS, valueMs)));
  const next = deepCopyTable(table);
  const parts = key.split('.');
  if (parts.length === 1) {
    (next as unknown as Record<string, number>)[parts[0]] = clamped;
  } else if (parts[0] === 'single' || parts[0] === 'multi') {
    const row = next[parts[0] as TimingRowKey];
    if (parts[1] === 'hold') row.hold[parts[2] as PeakRarity] = clamped;
    else (row as unknown as Record<string, number>)[parts[1]] = clamped;
  } else {
    (next as unknown as Record<string, Record<string, number>>)[parts[0]][parts[1]] = clamped;
  }
  return next;
}

/** Pure. Nearest-rank p95: sorted ascending, index = max(0, ceil(0.95 × n) − 1). Empty → { p95: 0, max: 0, count: 0 }. */
export function summarizeFrameGaps(gapsMs: number[]): FrameGapSummary {
  const n = gapsMs.length;
  if (n === 0) return { p95: 0, max: 0, count: 0 };
  const sorted = [...gapsMs].sort((a, b) => a - b);
  const idx = Math.max(0, Math.ceil(0.95 * n) - 1);
  return { p95: sorted[idx], max: sorted[n - 1], count: n };
}

const IDLE_SUMMARY: FrameGapSummary = { p95: 0, max: 0, count: 0 };

/** rAF-delta probe on the JS thread. Inactive or no requestAnimationFrame → { 0, 0, 0 }. */
export function useFrameGapProbe(active: boolean): FrameGapSummary {
  const [summary, setSummary] = React.useState<FrameGapSummary>(IDLE_SUMMARY);
  React.useEffect(() => {
    if (!active) {
      setSummary(IDLE_SUMMARY);
      return;
    }
    const raf = (globalThis as { requestAnimationFrame?: (cb: (ts: number) => void) => number }).requestAnimationFrame;
    const caf = (globalThis as { cancelAnimationFrame?: (handle: number) => void }).cancelAnimationFrame;
    if (typeof raf !== 'function') return;
    let stopped = false;
    let lastTs: number | null = null;
    let handle: number | undefined;
    let sinceReport = 0;
    const gaps: number[] = [];
    const tick = (ts: number): void => {
      if (stopped) return;
      if (lastTs !== null) {
        gaps.push(ts - lastTs);
        if (gaps.length > PROBE_WINDOW) gaps.shift();
        sinceReport += 1;
        if (sinceReport >= PROBE_REPORT_EVERY) {
          sinceReport = 0;
          setSummary(summarizeFrameGaps(gaps));
        }
      }
      lastTs = ts;
      handle = raf(tick);
    };
    handle = raf(tick);
    return () => {
      stopped = true;
      if (typeof caf === 'function' && handle !== undefined) caf(handle);
    };
  }, [active]);
  return active ? summary : IDLE_SUMMARY;
}

const RARITIES: ReadonlyArray<PeakRarity> = ['COM', 'RAR', 'LEG'];

export function CeremonyTuningScreen(props: NativeStackScreenProps<RootStackParamList, 'CeremonyTuning'>) {
  const [table, setTable] = React.useState<CeremonyTimingTable>(() => mergeTimingOverride(DEVICE, getCeremonyTimingOverride()));
  const [probing, setProbing] = React.useState(false);
  const probe = useFrameGapProbe(probing);

  const isDev = (globalThis as { __DEV__?: boolean }).__DEV__ === true;
  if (!isDev) {
    return <Text testID="ceremony-tuning-unavailable">Not available in release builds</Text>;
  }

  const bump = (key: TuningKey, delta: number): void => {
    const next = writeTimingPath(table, key, readTimingPath(table, key) + delta);
    setCeremonyTimingOverride(next);
    setTable(next);
  };

  const resetOverrides = (): void => {
    setCeremonyTimingOverride(null);
    setTable(mergeTimingOverride(DEVICE, null));
  };

  const motionText = `motion: ${motionAvailable ? 'available' : 'unavailable'} · skia: ${skiaAvailable ? 'available' : 'unavailable'} · table: ${motionAvailable ? 'DEVICE' : 'TEST_BASE'}`;
  const verdict = probe.count === 0 ? 'IDLE' : probe.p95 < FRAME_GAP_P95_CAP_MS && probe.max <= FRAME_GAP_MAX_CAP_MS ? 'PASS' : 'FAIL';

  return (
    <SafeAreaView testID="ceremony-tuning-root" style={styles.root}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Ceremony tuning</Text>
        <Text testID="ceremony-tuning-motion" style={styles.meta}>{motionText}</Text>

        <View style={styles.capGrid}>
          {([false, true] as const).map((isMulti) =>
            RARITIES.map((rarity) => {
              const toTableMs = resolveCeremonyTimings({ isMulti, peakRarity: rarity, motionAvailable: true }).toTableMs;
              const cap = TO_TABLE_CAP_MS[isMulti ? 'multi' : 'single'];
              const over = toTableMs > cap ? ' OVER' : '';
              return (
                <Text
                  key={`${isMulti ? 'multi' : 'single'}-${rarity}`}
                  testID={`ceremony-tuning-cap-${isMulti ? 'multi' : 'single'}-${rarity}`}
                  style={over ? styles.capOver : styles.cap}
                >
                  {`${isMulti ? 'multi' : 'single'} ${rarity}: ${toTableMs} / ${cap}${over}`}
                </Text>
              );
            }),
          )}
        </View>

        {TUNING_KEYS.map((key) => (
          <View key={key} testID={`ceremony-tuning-slider-${key}`} style={styles.row}>
            <Text style={styles.rowLabel}>{key}</Text>
            <Text testID={`ceremony-tuning-slider-${key}-value`} style={styles.rowValue}>{readTimingPath(table, key)}</Text>
            <Pressable
              testID={`ceremony-tuning-slider-${key}-minus`}
              accessibilityRole="button"
              accessibilityLabel={`Decrease ${key}`}
              style={styles.step}
              onPress={() => bump(key, -TUNING_STEP_MS)}
            >
              <Text style={styles.stepText}>−</Text>
            </Pressable>
            <Pressable
              testID={`ceremony-tuning-slider-${key}-plus`}
              accessibilityRole="button"
              accessibilityLabel={`Increase ${key}`}
              style={styles.step}
              onPress={() => bump(key, TUNING_STEP_MS)}
            >
              <Text style={styles.stepText}>+</Text>
            </Pressable>
          </View>
        ))}

        <Pressable testID="ceremony-tuning-reset" accessibilityRole="button" style={styles.action} onPress={resetOverrides}>
          <Text style={styles.actionText}>Reset overrides</Text>
        </Pressable>

        <Pressable testID="ceremony-tuning-probe-toggle" accessibilityRole="button" style={styles.action} onPress={() => setProbing((p) => !p)}>
          <Text style={styles.actionText}>{probing ? 'Stop probe' : 'Start probe'}</Text>
        </Pressable>
        <Text testID="ceremony-tuning-probe" style={styles.meta}>
          {`p95 ${probe.p95.toFixed(1)} ms · max ${probe.max.toFixed(1)} ms · n ${probe.count} · ${verdict}`}
        </Text>

        <Pressable testID="ceremony-tuning-open-draw" accessibilityRole="button" style={styles.action} onPress={() => props.navigation.navigate('Draw')}>
          <Text style={styles.actionText}>Open Draw</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

export default CeremonyTuningScreen;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0B1020' },
  content: { padding: 16, paddingBottom: 48 },
  title: { fontSize: 20, fontWeight: '900', color: '#F5ECC4' },
  meta: { marginTop: 8, fontSize: 12, color: 'rgba(245,236,196,0.75)', fontWeight: '600' },
  capGrid: { marginTop: 12, gap: 4 },
  cap: { fontSize: 12, color: 'rgba(245,236,196,0.85)', fontWeight: '600' },
  capOver: { fontSize: 12, color: '#D75A5A', fontWeight: '900' },
  row: { flexDirection: 'row', alignItems: 'center', marginTop: 8, gap: 8 },
  rowLabel: { flex: 1, fontSize: 12, color: 'rgba(245,236,196,0.85)', fontWeight: '600' },
  rowValue: { minWidth: 48, fontSize: 13, color: '#F5ECC4', fontWeight: '900', textAlign: 'right' },
  step: { minWidth: 44, minHeight: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(245,236,196,0.12)' },
  stepText: { fontSize: 18, color: '#F5ECC4', fontWeight: '900' },
  action: { marginTop: 14, minHeight: 48, borderRadius: 999, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, backgroundColor: 'rgba(245,236,196,0.16)' },
  actionText: { fontSize: 14, color: '#F5ECC4', fontWeight: '900', letterSpacing: 0.4 },
});
