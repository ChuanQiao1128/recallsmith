import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => new Map<string, string>());

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => store.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => { store.set(key, value); }),
    removeItem: vi.fn(async (key: string) => { store.delete(key); }),
  },
}));

import {
  CEREMONY_PERF_HISTORY_KEY,
  CEREMONY_PERF_HISTORY_LIMIT,
  CEREMONY_PERF_VERSION,
  MAX_TIMER_SAMPLES,
  clearActiveCeremonyPerf,
  createCeremonyPerfSession,
  formatCeremonyPerfReport,
  loadCeremonyPerfHistory,
  parseCeremonyPerfReport,
  type CeremonyPerfDeviceInfo,
  type CeremonyPerfMeta,
  type CeremonyPerfReport,
} from '../../src/features/gacha/draw/ceremonyPerf';
import {
  isDrawStateSyncInFlight,
  setDrawStateSyncInFlight,
} from '../../src/sync/syncActivity';

const META: CeremonyPerfMeta = {
  renderer: 'skia', reduceMotion: false, cardCount: 5, peakRarity: 'LEG', isMulti: true, tapFlow: true, slug: 'csharp',
};
const DEVICE: CeremonyPerfDeviceInfo = {
  platform: 'ios', osVersion: '18.6', model: 'iPhone', jsEngine: 'hermes',
  appVersion: '1.6.0 (16)', updateId: 'abcdef0123456789', runtimeVersion: '1.6.0', channel: 'production',
};

async function flush() {
  for (let i = 0; i < 25; i += 1) await Promise.resolve();
}

beforeEach(() => {
  store.clear();
  setDrawStateSyncInFlight(false);
});

afterEach(() => {
  clearActiveCeremonyPerf();
  vi.restoreAllMocks();
});

describe('ceremonyPerf v2 recorder', () => {
  it('records planned vs fired timer slip and caps the list at MAX_TIMER_SAMPLES', () => {
    let t = 0;
    const session = createCeremonyPerfSession(META, { now: () => t, raf: null, caf: null, persist: async () => {}, device: () => DEVICE });
    session.recordTimerSlip('approach', 16.4, 20.37); // planned rounds to int, fired/slip to 0.1 ms
    session.recordTimerSlip('hold', NaN, 5); // non-finite planned → no-op
    session.recordTimerSlip('hold', 5, Infinity); // non-finite fired → no-op
    for (let i = 0; i < MAX_TIMER_SAMPLES + 10; i += 1) session.recordTimerSlip('spam', 10, 12);
    const report = session.stop();
    expect(report.version).toBe(CEREMONY_PERF_VERSION);
    expect(report.timers![0]).toEqual({ name: 'approach', plannedMs: 16, firedMs: 20.4, slipMs: 4 });
    expect(report.timers!.length).toBe(MAX_TIMER_SAMPLES);
    // A late call after stop() is ignored.
    session.recordTimerSlip('after', 1, 2);
    expect(report.timers!.length).toBe(MAX_TIMER_SAMPLES);
  });

  it('records an effect-commit timestamp per phase in the report', () => {
    let t = 0;
    const session = createCeremonyPerfSession(META, { now: () => t, raf: null, caf: null, persist: async () => {}, device: () => DEVICE });
    t = 500.6;
    session.markPhaseCommit('approach');
    t = 1200.4;
    session.markPhaseCommit('hold');
    const report = session.stop();
    expect(report.commits).toEqual([
      { phase: 'approach', atMs: 501 },
      { phase: 'hold', atMs: 1200 },
    ]);
  });

  it('keeps the newest five reports in the history key, newest first', async () => {
    for (let i = 0; i < CEREMONY_PERF_HISTORY_LIMIT + 1; i += 1) {
      const session = createCeremonyPerfSession(
        { ...META, slug: `s${i}` },
        { now: () => 0, raf: null, caf: null, device: () => DEVICE, wallClock: () => new Date('2026-09-21T10:00:00.000Z') },
      );
      session.markPhase('approach');
      session.stop();
      await flush();
    }
    const rawHistory = store.get(CEREMONY_PERF_HISTORY_KEY);
    expect(rawHistory).toBeTruthy();
    const parsed = JSON.parse(rawHistory!) as CeremonyPerfReport[];
    expect(parsed).toHaveLength(CEREMONY_PERF_HISTORY_LIMIT);
    expect(parsed.map((r) => r.meta.slug)).toEqual(['s5', 's4', 's3', 's2', 's1']);
    const loaded = await loadCeremonyPerfHistory();
    expect(loaded.map((r) => r.meta.slug)).toEqual(['s5', 's4', 's3', 's2', 's1']);
  });

  it('still parses and formats a version 1 report without timers or commits', () => {
    const v1: CeremonyPerfReport = {
      version: 1,
      startedAt: '2026-09-21T10:00:00.000Z',
      durationMs: 6100,
      framesFromMs: 900,
      meta: META,
      js: null,
      ui: null,
      phases: [{ phase: 'approach', atMs: 900, durationMs: 600 }],
      audio: [],
      device: DEVICE,
    };
    const parsed = parseCeremonyPerfReport(JSON.stringify(v1));
    expect(parsed).toEqual(v1);
    const lines = formatCeremonyPerfReport(parsed!);
    expect(lines.some((l) => l.startsWith('Timer slip:'))).toBe(false);
    expect(lines.some((l) => l.startsWith('Commit lag:'))).toBe(false);
    expect(lines.some((l) => l.startsWith('At tear:'))).toBe(false);
    expect(lines[lines.length - 1]).toContain('Device:');
  });

  it('formats timer slip, commit lag and tear flags only when present', () => {
    const base: CeremonyPerfReport = {
      version: 2,
      startedAt: '2026-09-21T10:00:00.000Z',
      durationMs: 6100,
      framesFromMs: 900,
      meta: { ...META },
      js: null,
      ui: null,
      phases: [
        { phase: 'approach', atMs: 500, durationMs: 100 },
        { phase: 'hold', atMs: 600, durationMs: 100 },
      ],
      audio: [],
      device: DEVICE,
      timers: [
        { name: 'approach', plannedMs: 100, firedMs: 105, slipMs: 5 },
        { name: 'hold', plannedMs: 200, firedMs: 230, slipMs: 30 },
      ],
      commits: [
        { phase: 'approach', atMs: 530 },
        { phase: 'hold', atMs: 620 },
      ],
    };
    const withFlags: CeremonyPerfReport = {
      ...base,
      meta: { ...META, audioWarmAtTear: true, syncInFlightAtTear: false },
    };
    const lines = formatCeremonyPerfReport(withFlags);
    expect(lines).toContain('Timer slip: 2 timers · p50 5 ms · max 30 ms (hold)');
    expect(lines).toContain('Commit lag: max 30 ms (approach) · 2 phases');
    expect(lines).toContain('At tear: audio warm · sync idle');
    // The new lines land after "Audio hits" and before "Device".
    const audioIdx = lines.findIndex((l) => l.startsWith('Audio hits:'));
    const deviceIdx = lines.findIndex((l) => l.startsWith('Device:'));
    const tearIdx = lines.findIndex((l) => l.startsWith('At tear:'));
    expect(audioIdx).toBeLessThan(tearIdx);
    expect(tearIdx).toBeLessThan(deviceIdx);

    // A half-known tear renders '?' for the missing side.
    const halfKnown = formatCeremonyPerfReport({ ...base, meta: { ...META, audioWarmAtTear: false } });
    expect(halfKnown).toContain('At tear: audio cold · sync ?');

    // Nothing present → none of the three lines.
    const bare = formatCeremonyPerfReport({ ...base, meta: { ...META }, timers: [], commits: [] });
    expect(bare.some((l) => l.startsWith('Timer slip:'))).toBe(false);
    expect(bare.some((l) => l.startsWith('Commit lag:'))).toBe(false);
    expect(bare.some((l) => l.startsWith('At tear:'))).toBe(false);
  });

  it('isDrawStateSyncInFlight mirrors setDrawStateSyncInFlight', () => {
    expect(isDrawStateSyncInFlight()).toBe(false);
    setDrawStateSyncInFlight(true);
    expect(isDrawStateSyncInFlight()).toBe(true);
    setDrawStateSyncInFlight(false);
    expect(isDrawStateSyncInFlight()).toBe(false);
  });
});
