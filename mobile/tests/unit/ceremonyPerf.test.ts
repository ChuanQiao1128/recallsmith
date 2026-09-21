import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  CEREMONY_PERF_STORAGE_KEY,
  CEREMONY_PERF_VERSION,
  DROPPED_FRAME_MS,
  MAX_FRAME_SAMPLES,
  clearActiveCeremonyPerf,
  collectDeviceInfo,
  createCeremonyPerfSession,
  finalizePhases,
  formatCeremonyPerfReport,
  getActiveCeremonyPerf,
  loadLastCeremonyPerfReport,
  parseCeremonyPerfReport,
  percentile,
  recordCeremonyAudioLatency,
  startCeremonyPerf,
  summarizeFrameIntervals,
  type CeremonyPerfDeviceInfo,
  type CeremonyPerfMeta,
  type CeremonyPerfReport,
} from '../../src/features/gacha/draw/ceremonyPerf';

const META: CeremonyPerfMeta = {
  renderer: 'skia', reduceMotion: false, cardCount: 5, peakRarity: 'LEG', isMulti: true, tapFlow: true, slug: 'csharp',
};
const DEVICE: CeremonyPerfDeviceInfo = {
  platform: 'ios', osVersion: '18.6', model: 'iPhone', jsEngine: 'hermes',
  appVersion: '1.6.0 (16)', updateId: 'abcdef0123456789', runtimeVersion: '1.6.0', channel: 'production',
};

/** A fake rAF driven by hand: `frame(ms)` advances the clock and runs the pending callback. */
function makeFrameClock() {
  let t = 0;
  let pending: ((ts: number) => void) | null = null;
  let id = 0;
  const cancelled: number[] = [];
  return {
    now: () => t,
    raf: (cb: (ts: number) => void) => {
      pending = cb;
      id += 1;
      return id;
    },
    caf: (i: number) => {
      cancelled.push(i);
      pending = null;
    },
    advance(ms: number) {
      t += ms;
    },
    frame(ms: number) {
      t += ms;
      const cb = pending;
      pending = null;
      cb?.(t);
    },
    hasPending: () => pending !== null,
    cancelled,
  };
}

afterEach(() => {
  clearActiveCeremonyPerf();
  vi.restoreAllMocks();
});

describe('ceremonyPerf pure helpers', () => {
  it('percentile is nearest-rank over a sorted array', () => {
    expect(percentile([], 50)).toBe(0);
    expect(percentile([10], 0)).toBe(10);
    expect(percentile([10], 100)).toBe(10);
    const twenty = [...Array(19).fill(16), 60];
    expect(percentile(twenty, 50)).toBe(16);
    expect(percentile(twenty, 95)).toBe(16);
    expect(percentile(twenty, 100)).toBe(60);
    const hundred = [...Array(95).fill(16), ...Array(5).fill(40)];
    expect(percentile(hundred, 95)).toBe(16);
    expect(percentile(hundred, 96)).toBe(40);
    expect(percentile([1, 2, 3, 4], 50)).toBe(2);
    expect(percentile([1, 2, 3, 4], 150)).toBe(4);
    expect(percentile([1, 2, 3, 4], -5)).toBe(1);
  });

  it('summarizeFrameIntervals reports p50/p95/max/mean and counts frames over the drop threshold', () => {
    expect(summarizeFrameIntervals([])).toBeNull();
    expect(summarizeFrameIntervals([NaN, -1, Infinity])).toBeNull();
    const input = [16.7, 16.6, 33.4, 16.7, 50.1, 16.6, 16.7, 16.7, 16.7, 16.7];
    const copy = [...input];
    const s = summarizeFrameIntervals(input)!;
    expect(input).toEqual(copy);
    expect(s.frames).toBe(10);
    expect(s.p50).toBe(16.7);
    expect(s.p95).toBe(50.1);
    expect(s.max).toBe(50.1);
    expect(s.dropped).toBe(2);
    expect(s.meanMs).toBe(21.7);
    expect(DROPPED_FRAME_MS).toBe(32);
    expect(summarizeFrameIntervals([32])!.dropped).toBe(0);
    expect(summarizeFrameIntervals([32.1])!.dropped).toBe(1);
  });

  it('finalizePhases derives each duration from the next mark (last from the end)', () => {
    expect(finalizePhases([], 100)).toEqual([]);
    expect(
      finalizePhases([{ phase: 'swipe', atMs: 0.4 }, { phase: 'approach', atMs: 1200.6 }, { phase: 'hold', atMs: 1800 }], 2500.2),
    ).toEqual([
      { phase: 'swipe', atMs: 0, durationMs: 1200 },
      { phase: 'approach', atMs: 1201, durationMs: 599 },
      { phase: 'hold', atMs: 1800, durationMs: 700 },
    ]);
    expect(finalizePhases([{ phase: 'x', atMs: 50 }], 10)[0].durationMs).toBeNull();
  });

  it('parseCeremonyPerfReport accepts only a plausible report', () => {
    expect(parseCeremonyPerfReport(null)).toBeNull();
    expect(parseCeremonyPerfReport('')).toBeNull();
    expect(parseCeremonyPerfReport('{')).toBeNull();
    expect(parseCeremonyPerfReport('"x"')).toBeNull();
    expect(parseCeremonyPerfReport(JSON.stringify({ version: 1 }))).toBeNull();
    const ok = { version: 1, durationMs: 10, phases: [], audio: [] };
    expect(parseCeremonyPerfReport(JSON.stringify(ok))).toEqual(ok);
  });

  it('collectDeviceInfo never throws under Node and always names a JS engine', () => {
    const info = collectDeviceInfo();
    expect(typeof info.platform).toBe('string');
    expect(['hermes', 'jsc']).toContain(info.jsEngine);
    for (const k of ['osVersion', 'model', 'appVersion', 'updateId', 'runtimeVersion', 'channel'] as const) {
      expect(info[k] === null || typeof info[k] === 'string').toBe(true);
    }
  });
});

describe('ceremonyPerf session', () => {
  it('samples rAF deltas only from the first non-swipe phase, marks phases, records audio and stops', async () => {
    const clock = makeFrameClock();
    const persist = vi.fn(async () => {});
    const session = createCeremonyPerfSession(META, {
      now: clock.now, raf: clock.raf, caf: clock.caf, persist, device: () => DEVICE,
      wallClock: () => new Date('2026-09-21T10:00:00.000Z'),
    });
    expect(session.active).toBe(true);
    session.markPhase('swipe');
    expect(clock.hasPending()).toBe(false); // idle on the swipe screen is not sampled
    clock.advance(500);
    session.markPhase('approach');
    expect(clock.hasPending()).toBe(true);
    clock.frame(0); // first callback: establishes the baseline, no interval yet
    clock.frame(16);
    clock.frame(17);
    clock.frame(40); // a dropped frame
    session.recordAudioLatency('rip', 3.14159);
    session.markPhase('hold');
    clock.frame(16);
    session.setUiSampler(() => ({ frames: 100, dropped: 1, max: 34, meanMs: 16.8 }));
    clock.advance(100);
    const report = session.stop();
    expect(session.active).toBe(false);
    expect(clock.cancelled).toHaveLength(1);
    expect(report.version).toBe(CEREMONY_PERF_VERSION);
    expect(report.startedAt).toBe('2026-09-21T10:00:00.000Z');
    expect(report.framesFromMs).toBe(500);
    expect(report.durationMs).toBe(500 + 73 + 16 + 100);
    // intervals [16, 17, 40, 16] → sorted [16, 16, 17, 40]: nearest-rank p50 = 16, p95 = 40
    expect(report.js).toEqual({ frames: 4, p50: 16, p95: 40, max: 40, meanMs: 22.3, dropped: 1 });
    expect(report.ui).toEqual({ frames: 100, dropped: 1, max: 34, meanMs: 16.8 });
    expect(report.phases).toEqual([
      { phase: 'swipe', atMs: 0, durationMs: 500 },
      { phase: 'approach', atMs: 500, durationMs: 73 },
      { phase: 'hold', atMs: 573, durationMs: 116 },
    ]);
    expect(report.audio).toEqual([{ name: 'rip', atMs: 573, latencyMs: 3.1 }]);
    expect(report.device).toEqual(DEVICE);
    expect(report.meta).toEqual(META);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenCalledWith(report);
    // stop() is idempotent and late calls are ignored.
    expect(session.stop()).toBe(report);
    session.markPhase('settle');
    session.recordAudioLatency('chime', 1);
    expect(session.report).toBe(report);
    expect(report.phases).toHaveLength(3);
    expect(report.audio).toHaveLength(1);
    expect(persist).toHaveBeenCalledTimes(1);
    // A frame that fires after stop is ignored.
    clock.frame(16);
    expect(report.js!.frames).toBe(4);
  });

  it('updateMeta patches the report meta after mount (Reduce Motion resolves late)', () => {
    const clock = makeFrameClock();
    const session = createCeremonyPerfSession(META, { now: clock.now, raf: clock.raf, caf: clock.caf, persist: async () => {}, device: () => DEVICE });
    session.updateMeta({ reduceMotion: true });
    const report = session.stop();
    expect(report.meta).toEqual({ ...META, reduceMotion: true });
    session.updateMeta({ reduceMotion: false });
    expect(report.meta.reduceMotion).toBe(true);
  });

  it('works without requestAnimationFrame (js stays null) and never throws on a broken persist/device', async () => {
    const session = createCeremonyPerfSession(META, {
      now: () => 0,
      raf: null,
      caf: null,
      persist: async () => { throw new Error('storage down'); },
      device: () => { throw new Error('no device'); },
    });
    session.markPhase('approach');
    session.beginFrames();
    session.recordAudioLatency('whoosh', NaN);
    session.recordAudioLatency('whoosh', 2);
    const report = session.stop();
    expect(report.js).toBeNull();
    expect(report.ui).toBeNull();
    expect(report.audio).toEqual([{ name: 'whoosh', atMs: 0, latencyMs: 2 }]);
    expect(typeof report.device.jsEngine).toBe('string');
    await Promise.resolve();
  });

  it('stops sampling at MAX_FRAME_SAMPLES', () => {
    const clock = makeFrameClock();
    const session = createCeremonyPerfSession(META, { now: clock.now, raf: clock.raf, caf: clock.caf, persist: async () => {}, device: () => DEVICE });
    session.beginFrames();
    clock.frame(0);
    for (let i = 0; i < MAX_FRAME_SAMPLES + 50; i += 1) {
      if (!clock.hasPending()) break;
      clock.frame(16);
    }
    expect(clock.hasPending()).toBe(false);
    const report = session.stop();
    expect(report.js!.frames).toBe(MAX_FRAME_SAMPLES);
  });

  it('startCeremonyPerf owns one active session; recordCeremonyAudioLatency routes to it', () => {
    expect(getActiveCeremonyPerf()).toBeNull();
    recordCeremonyAudioLatency('rip', 1); // no session: no-op
    const persist = vi.fn(async () => {});
    const a = startCeremonyPerf(META, { raf: null, persist, device: () => DEVICE });
    expect(getActiveCeremonyPerf()).toBe(a);
    recordCeremonyAudioLatency('rip', 4);
    const b = startCeremonyPerf(META, { raf: null, persist, device: () => DEVICE });
    expect(a.active).toBe(false); // a stale session is closed when a new one starts
    expect(a.report!.audio).toEqual([expect.objectContaining({ name: 'rip', latencyMs: 4 })]);
    expect(getActiveCeremonyPerf()).toBe(b);
    recordCeremonyAudioLatency('chime', 2);
    b.stop();
    expect(getActiveCeremonyPerf()).toBeNull();
    expect(b.report!.audio.map((x) => x.name)).toEqual(['chime']);
    expect(persist).toHaveBeenCalledTimes(2);
  });
});

describe('ceremonyPerf storage + presentation', () => {
  it('persists under the contract key and loads it back through AsyncStorage', async () => {
    const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
    let stored: string | null = null;
    const setItem = vi.spyOn(AsyncStorage, 'setItem').mockImplementation(async (_k: string, v: string) => { stored = v; });
    const getItem = vi.spyOn(AsyncStorage, 'getItem').mockImplementation(async () => stored);
    expect(CEREMONY_PERF_STORAGE_KEY).toBe('recallsmith:ceremonyPerf:last');
    const session = createCeremonyPerfSession(META, { now: () => 0, raf: null, caf: null, device: () => DEVICE });
    session.markPhase('approach');
    const report = session.stop();
    await Promise.resolve();
    await Promise.resolve();
    expect(setItem).toHaveBeenCalledWith(CEREMONY_PERF_STORAGE_KEY, JSON.stringify(report));
    const loaded = await loadLastCeremonyPerfReport();
    expect(getItem).toHaveBeenCalledWith(CEREMONY_PERF_STORAGE_KEY);
    expect(loaded).toEqual(report);
    stored = 'not json';
    expect(await loadLastCeremonyPerfReport()).toBeNull();
    getItem.mockImplementation(async () => { throw new Error('storage down'); });
    expect(await loadLastCeremonyPerfReport()).toBeNull();
  });

  it('formatCeremonyPerfReport renders one line per section with the headline numbers', () => {
    const report: CeremonyPerfReport = {
      version: 1,
      startedAt: '2026-09-21T10:00:00.000Z',
      durationMs: 6100,
      framesFromMs: 900,
      meta: META,
      js: { frames: 300, p50: 16.7, p95: 24, max: 71, meanMs: 17.2, dropped: 3 },
      ui: { frames: 310, dropped: 1, max: 35, meanMs: 16.7 },
      phases: [
        { phase: 'swipe', atMs: 0, durationMs: 900 },
        { phase: 'approach', atMs: 900, durationMs: 600 },
      ],
      audio: [
        { name: 'whoosh', atMs: 900, latencyMs: 2 },
        { name: 'rip', atMs: 1500, latencyMs: 9.5 },
        { name: 'chime', atMs: 2000, latencyMs: 1 },
      ],
      device: DEVICE,
    };
    const lines = formatCeremonyPerfReport(report);
    expect(lines[0]).toContain('skia');
    expect(lines[0]).toContain('5 cards');
    expect(lines[0]).toContain('LEG');
    expect(lines[0]).toContain('csharp');
    expect(lines[1]).toBe('Total 6100 ms · frames sampled from +900 ms');
    expect(lines[2]).toBe('JS frames: p50 16.7 ms · p95 24 ms · max 71 ms · 3 > 32 ms of 300');
    expect(lines[3]).toBe('UI frames: mean 16.7 ms · max 35 ms · 1 > 32 ms of 310');
    expect(lines[4]).toBe('Phases: swipe 900 ms → approach 600 ms');
    expect(lines[5]).toBe('Audio hits: 3 · p50 2 ms · max 9.5 ms (rip)');
    expect(lines[6]).toBe('Device: ios 18.6 · iPhone · hermes · app 1.6.0 (16) · update abcdef01 (production)');

    const bare = formatCeremonyPerfReport({
      ...report, js: null, ui: null, phases: [], audio: [], framesFromMs: null,
      meta: { ...META, cardCount: 1, reduceMotion: true, slug: undefined },
      device: { ...DEVICE, osVersion: null, model: null, appVersion: null, updateId: null, channel: null },
    });
    expect(bare[0]).toContain('reduce motion');
    expect(bare[0]).toContain('1 card ·');
    expect(bare).toContain('Total 6100 ms');
    expect(bare).toContain('JS frames: no samples (no requestAnimationFrame)');
    expect(bare).toContain('UI frames: not sampled');
    expect(bare).toContain('Audio hits: none');
    expect(bare[bare.length - 1]).toBe('Device: ios · hermes');
    expect(bare.some((l) => l.startsWith('Phases:'))).toBe(false);
  });
});
