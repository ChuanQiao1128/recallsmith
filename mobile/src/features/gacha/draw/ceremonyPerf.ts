// ceremonyPerf — a tiny, production-reachable recorder for one draw ceremony.
//
// While a ceremony runs it samples JS-thread frame intervals (requestAnimationFrame
// deltas), counts frames over DROPPED_FRAME_MS, keeps the phase timestamps and every
// audio hit's trigger latency, and can absorb a UI-thread summary handed in by the
// screen (Reanimated frame callback). stop() turns that into a CeremonyPerfReport and
// stores it under CEREMONY_PERF_STORAGE_KEY; DebugMenu shows the last one. Everything
// is guarded: no requestAnimationFrame → no frame samples; a storage failure is
// swallowed. The recorder never touches the ceremony's timers or shared values.
import AsyncStorage from '@react-native-async-storage/async-storage';

export const CEREMONY_PERF_STORAGE_KEY = 'recallsmith:ceremonyPerf:last';
export const CEREMONY_PERF_HISTORY_KEY = 'recallsmith:ceremonyPerf:history';
export const CEREMONY_PERF_VERSION = 2;
/** How many reports the rolling history keeps (newest first). */
export const CEREMONY_PERF_HISTORY_LIMIT = 5;
/** A JS frame interval above this counts as a dropped frame (two 60 Hz frames). */
export const DROPPED_FRAME_MS = 32;
/** Sampling stops after this many intervals (~66 s at 60 Hz) so a long table sit stays bounded. */
export const MAX_FRAME_SAMPLES = 4000;
/** Timer-slip samples stop being added past this count so a long tap-flow sit stays bounded. */
export const MAX_TIMER_SAMPLES = 200;

export type FrameStats = {
  frames: number; p50: number; p95: number; max: number; meanMs: number; dropped: number;
};
export type UiFrameStats = { frames: number; dropped: number; max: number; meanMs: number };
export type PhaseMark = { phase: string; atMs: number; durationMs: number | null };
export type AudioLatencySample = { name: string; atMs: number; latencyMs: number };
/** A scheduled timer's planned-vs-actual fire time (v2): slip = fired − planned. */
export type TimerSlipSample = { name: string; plannedMs: number; firedMs: number; slipMs: number };
/** The moment React committed a phase's effect, relative to the ceremony start (v2). */
export type PhaseCommitMark = { phase: string; atMs: number };
export type CeremonyPerfMeta = {
  renderer: 'skia' | 'fallback'; reduceMotion: boolean; cardCount: number; peakRarity: string;
  isMulti: boolean; tapFlow: boolean; slug?: string;
  // v2, optional so stored v1 reports and the existing test literals still type-check.
  audioWarmAtTear?: boolean; syncInFlightAtTear?: boolean;
};
export type CeremonyPerfDeviceInfo = {
  platform: string; osVersion: string | null; model: string | null; jsEngine: string;
  appVersion: string | null; updateId: string | null; runtimeVersion: string | null; channel: string | null;
};
export type CeremonyPerfReport = {
  version: number;
  startedAt: string;
  durationMs: number;
  framesFromMs: number | null;
  meta: CeremonyPerfMeta;
  js: FrameStats | null;
  ui: UiFrameStats | null;
  phases: PhaseMark[];
  audio: AudioLatencySample[];
  device: CeremonyPerfDeviceInfo;
  // v2, optional so stored v1 reports and the existing test literals still type-check.
  timers?: TimerSlipSample[];
  commits?: PhaseCommitMark[];
};

export type CeremonyPerfSession = {
  /** Records the phase and (first non-'swipe' phase) starts JS frame sampling. */
  markPhase(phase: string): void;
  /** Starts JS frame sampling now if it has not started. Idempotent. */
  beginFrames(): void;
  recordAudioLatency(name: string, latencyMs: number): void;
  /** Records a scheduled timer's planned-vs-fired slip (v2). No-op when inactive or any arg non-finite. */
  recordTimerSlip(name: string, plannedMs: number, firedMs: number): void;
  /** Records when React committed a phase's effect, relative to the ceremony start (v2). */
  markPhaseCommit(phase: string): void;
  /** The screen hands in a reader for its UI-thread counters; read once at stop(). */
  setUiSampler(read: (() => UiFrameStats | null) | null): void;
  /** Late facts (Reduce Motion resolves asynchronously after mount). */
  updateMeta(patch: Partial<CeremonyPerfMeta>): void;
  /** Stops sampling, builds the report, persists it (fire-and-forget). Idempotent. */
  stop(): CeremonyPerfReport;
  readonly active: boolean;
  readonly report: CeremonyPerfReport | null;
};

type RafLike = (cb: (t: number) => void) => number;
type CafLike = (id: number) => void;

export type CeremonyPerfDeps = {
  now?: () => number;
  raf?: RafLike | null;
  caf?: CafLike | null;
  persist?: (report: CeremonyPerfReport) => Promise<void>;
  device?: () => CeremonyPerfDeviceInfo;
  wallClock?: () => Date;
};

// ── Pure helpers ────────────────────────────────────────────────────────────

/** Nearest-rank percentile over an ascending-sorted array. p in 0..100. Empty → 0. */
export function percentile(sortedAsc: ReadonlyArray<number>, p: number): number {
  const n = sortedAsc.length;
  if (n === 0) return 0;
  const clamped = Math.min(100, Math.max(0, p));
  const rank = Math.max(1, Math.ceil((clamped / 100) * n));
  return sortedAsc[rank - 1];
}

/** Summarises frame intervals (ms). Never mutates the input. null when empty. */
export function summarizeFrameIntervals(intervals: ReadonlyArray<number>): FrameStats | null {
  const clean = intervals.filter((v) => Number.isFinite(v) && v >= 0);
  if (clean.length === 0) return null;
  const sorted = [...clean].sort((a, b) => a - b);
  let sum = 0;
  let dropped = 0;
  for (const v of clean) {
    sum += v;
    if (v > DROPPED_FRAME_MS) dropped += 1;
  }
  const round = (v: number): number => Math.round(v * 10) / 10;
  return {
    frames: clean.length,
    p50: round(percentile(sorted, 50)),
    p95: round(percentile(sorted, 95)),
    max: round(sorted[sorted.length - 1]),
    meanMs: round(sum / clean.length),
    dropped,
  };
}

/** Fills durationMs for each phase from the next phase's timestamp (last one from endMs). */
export function finalizePhases(marks: ReadonlyArray<{ phase: string; atMs: number }>, endMs: number): PhaseMark[] {
  return marks.map((m, i) => {
    const nextAt = i + 1 < marks.length ? marks[i + 1].atMs : endMs;
    const d = nextAt - m.atMs;
    return { phase: m.phase, atMs: Math.round(m.atMs), durationMs: Number.isFinite(d) && d >= 0 ? Math.round(d) : null };
  });
}

// Guarded requires (device mechanisms only). This module is imported by ceremonyAudio,
// whose unit tests run without a react-native mock, so react-native is never a static
// import here: under Node the require throws on RN's Flow syntax and is swallowed.
function guardedRequire(name: 'react-native' | 'expo-constants' | 'expo-updates' | 'expo-application'): any | null {
  try {
    if (name === 'react-native') return require('react-native');
    if (name === 'expo-constants') return require('expo-constants');
    if (name === 'expo-updates') return require('expo-updates');
    return require('expo-application');
  } catch {
    return null;
  }
}

/** Device / build facts for the report. Every source is optional and guarded; nothing personal
 *  (no device name, no identifiers) is recorded. */
export function collectDeviceInfo(): CeremonyPerfDeviceInfo {
  const info: CeremonyPerfDeviceInfo = {
    platform: 'unknown',
    osVersion: null,
    model: null,
    jsEngine: (globalThis as { HermesInternal?: unknown }).HermesInternal ? 'hermes' : 'jsc',
    appVersion: null,
    updateId: null,
    runtimeVersion: null,
    channel: null,
  };
  try {
    const Platform = guardedRequire('react-native')?.Platform;
    if (Platform && typeof Platform.OS === 'string') {
      info.platform = Platform.OS;
      const c = Platform.constants ?? {};
      const os = c.osVersion ?? c.systemVersion ?? c.Release;
      if (os != null) info.osVersion = String(os);
      const model = c.Model ?? c.Brand ?? c.interfaceIdiom;
      if (model != null) info.model = String(model);
    }
  } catch {}
  try {
    const mod = guardedRequire('expo-constants');
    const Constants = mod?.default ?? mod;
    const iosModel = Constants?.platform?.ios?.model;
    if (typeof iosModel === 'string' && iosModel) info.model = iosModel;
    const v = Constants?.expoConfig?.version;
    if (typeof v === 'string') info.appVersion = v;
  } catch {}
  try {
    const app = guardedRequire('expo-application');
    const native = app?.nativeApplicationVersion;
    const build = app?.nativeBuildVersion;
    if (typeof native === 'string') info.appVersion = build ? `${native} (${build})` : native;
  } catch {}
  try {
    const Updates = guardedRequire('expo-updates');
    if (Updates) {
      if (typeof Updates.updateId === 'string') info.updateId = Updates.updateId;
      if (typeof Updates.runtimeVersion === 'string') info.runtimeVersion = Updates.runtimeVersion;
      if (typeof Updates.channel === 'string') info.channel = Updates.channel;
    }
  } catch {}
  return info;
}

/** High-resolution monotonic clock: `performance.now()` when available, else `Date.now()`. */
export function perfNow(): number {
  const perf = (globalThis as { performance?: { now?: () => number } }).performance;
  if (perf && typeof perf.now === 'function') return perf.now();
  return Date.now();
}

function defaultRaf(): RafLike | null {
  const g = globalThis as { requestAnimationFrame?: RafLike };
  return typeof g.requestAnimationFrame === 'function' ? g.requestAnimationFrame.bind(globalThis) : null;
}

function defaultCaf(): CafLike | null {
  const g = globalThis as { cancelAnimationFrame?: CafLike };
  return typeof g.cancelAnimationFrame === 'function' ? g.cancelAnimationFrame.bind(globalThis) : null;
}

async function defaultPersist(report: CeremonyPerfReport): Promise<void> {
  // Prepend to the rolling history (newest first, capped), then overwrite the "last" key.
  // History is written FIRST and the last key SECOND: the persistence test captures the
  // final setItem value, which must stay the single latest report under the contract key.
  let history: CeremonyPerfReport[] = [];
  try {
    const raw = await AsyncStorage.getItem(CEREMONY_PERF_HISTORY_KEY);
    if (typeof raw === 'string') {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) history = parsed as CeremonyPerfReport[];
    }
  } catch {
    history = [];
  }
  const next = [report, ...history].slice(0, CEREMONY_PERF_HISTORY_LIMIT);
  await AsyncStorage.setItem(CEREMONY_PERF_HISTORY_KEY, JSON.stringify(next));
  await AsyncStorage.setItem(CEREMONY_PERF_STORAGE_KEY, JSON.stringify(report));
}

// ── Session ─────────────────────────────────────────────────────────────────

export function createCeremonyPerfSession(meta: CeremonyPerfMeta, deps: CeremonyPerfDeps = {}): CeremonyPerfSession {
  const now = deps.now ?? perfNow;
  const raf = deps.raf === undefined ? defaultRaf() : deps.raf;
  const caf = deps.caf === undefined ? defaultCaf() : deps.caf;
  const persist = deps.persist ?? defaultPersist;
  const device = deps.device ?? collectDeviceInfo;
  const wallClock = deps.wallClock ?? (() => new Date());

  const t0 = now();
  const startedAt = wallClock().toISOString();
  let liveMeta: CeremonyPerfMeta = { ...meta };
  const intervals: number[] = [];
  const marks: Array<{ phase: string; atMs: number }> = [];
  const audio: AudioLatencySample[] = [];
  const timers: TimerSlipSample[] = [];
  const commits: PhaseCommitMark[] = [];
  const round1 = (v: number): number => Math.round(v * 10) / 10;
  let uiRead: (() => UiFrameStats | null) | null = null;
  let active = true;
  let framesStarted = false;
  let framesFromMs: number | null = null;
  let lastFrameAt = -1;
  let rafId: number | null = null;
  let report: CeremonyPerfReport | null = null;

  const tick = (): void => {
    if (!active) return;
    const t = now();
    if (lastFrameAt >= 0) intervals.push(t - lastFrameAt);
    lastFrameAt = t;
    if (intervals.length >= MAX_FRAME_SAMPLES || !raf) {
      rafId = null;
      return;
    }
    try {
      rafId = raf(tick);
    } catch {
      rafId = null;
    }
  };

  function beginFrames(): void {
    if (!active || framesStarted) return;
    framesStarted = true;
    framesFromMs = now() - t0;
    if (!raf) return;
    try {
      rafId = raf(tick);
    } catch {
      rafId = null;
    }
  }

  function markPhase(phase: string): void {
    if (!active) return;
    marks.push({ phase, atMs: now() - t0 });
    if (phase !== 'swipe') beginFrames();
  }

  function recordAudioLatency(name: string, latencyMs: number): void {
    if (!active) return;
    if (!Number.isFinite(latencyMs)) return;
    if (audio.length >= 200) return;
    audio.push({ name, atMs: Math.round(now() - t0), latencyMs: Math.round(latencyMs * 10) / 10 });
  }

  function recordTimerSlip(name: string, plannedMs: number, firedMs: number): void {
    if (!active) return;
    if (!Number.isFinite(plannedMs) || !Number.isFinite(firedMs)) return;
    if (timers.length >= MAX_TIMER_SAMPLES) return;
    timers.push({ name, plannedMs: Math.round(plannedMs), firedMs: round1(firedMs), slipMs: round1(firedMs - plannedMs) });
  }

  function markPhaseCommit(phase: string): void {
    if (!active) return;
    commits.push({ phase, atMs: Math.round(now() - t0) });
  }

  function setUiSampler(read: (() => UiFrameStats | null) | null): void {
    uiRead = read;
  }

  function updateMeta(patch: Partial<CeremonyPerfMeta>): void {
    if (!active) return;
    liveMeta = { ...liveMeta, ...patch };
  }

  function stop(): CeremonyPerfReport {
    if (report) return report;
    active = false;
    if (rafId !== null && caf) {
      try { caf(rafId); } catch {}
    }
    rafId = null;
    const endMs = now() - t0;
    let ui: UiFrameStats | null = null;
    if (uiRead) {
      try { ui = uiRead(); } catch { ui = null; }
    }
    let dev: CeremonyPerfDeviceInfo;
    try {
      dev = device();
    } catch {
      dev = collectDeviceInfo();
    }
    report = {
      version: CEREMONY_PERF_VERSION,
      startedAt,
      durationMs: Math.round(endMs),
      framesFromMs: framesFromMs === null ? null : Math.round(framesFromMs),
      meta: liveMeta,
      js: summarizeFrameIntervals(intervals),
      ui,
      phases: finalizePhases(marks, endMs),
      audio: [...audio],
      device: dev,
      timers: [...timers],
      commits: [...commits],
    };
    try {
      Promise.resolve(persist(report)).catch(() => {});
    } catch {}
    return report;
  }

  return {
    markPhase,
    beginFrames,
    recordAudioLatency,
    recordTimerSlip,
    markPhaseCommit,
    setUiSampler,
    updateMeta,
    stop,
    get active() {
      return active;
    },
    get report() {
      return report;
    },
  };
}

// ── Module-level active session (the audio controller reports into it) ──────

let activeSession: CeremonyPerfSession | null = null;

export function startCeremonyPerf(meta: CeremonyPerfMeta, deps?: CeremonyPerfDeps): CeremonyPerfSession {
  if (activeSession && activeSession.active) {
    try { activeSession.stop(); } catch {}
  }
  activeSession = createCeremonyPerfSession(meta, deps);
  return activeSession;
}

export function getActiveCeremonyPerf(): CeremonyPerfSession | null {
  return activeSession && activeSession.active ? activeSession : null;
}

/** Called by ceremonyAudio for every hit; a no-op without an active session. */
export function recordCeremonyAudioLatency(name: string, latencyMs: number): void {
  const s = activeSession;
  if (!s || !s.active) return;
  try { s.recordAudioLatency(name, latencyMs); } catch {}
}

/** Test/cleanup hook: forgets the active session without stopping it. */
export function clearActiveCeremonyPerf(): void {
  activeSession = null;
}

// ── Storage + presentation ──────────────────────────────────────────────────

export function parseCeremonyPerfReport(raw: unknown): CeremonyPerfReport | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if (typeof parsed.version !== 'number' || typeof parsed.durationMs !== 'number') return null;
    if (!Array.isArray(parsed.phases) || !Array.isArray(parsed.audio)) return null;
    return parsed as CeremonyPerfReport;
  } catch {
    return null;
  }
}

export async function loadLastCeremonyPerfReport(): Promise<CeremonyPerfReport | null> {
  try {
    const raw = await AsyncStorage.getItem(CEREMONY_PERF_STORAGE_KEY);
    return parseCeremonyPerfReport(raw);
  } catch {
    return null;
  }
}

/** The rolling report history (newest first). Drops entries parse rejects; [] on any error. */
export async function loadCeremonyPerfHistory(): Promise<CeremonyPerfReport[]> {
  try {
    const raw = await AsyncStorage.getItem(CEREMONY_PERF_HISTORY_KEY);
    if (typeof raw !== 'string') return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: CeremonyPerfReport[] = [];
    for (const entry of parsed) {
      const report = parseCeremonyPerfReport(JSON.stringify(entry));
      if (report) out.push(report);
    }
    return out;
  } catch {
    return [];
  }
}

/** Human lines for the DebugMenu card (pure). */
export function formatCeremonyPerfReport(report: CeremonyPerfReport): string[] {
  const lines: string[] = [];
  const m = report.meta;
  lines.push(`${report.startedAt} · ${m.renderer}${m.reduceMotion ? ' · reduce motion' : ''} · ${m.cardCount} card${m.cardCount === 1 ? '' : 's'} · ${m.peakRarity}${m.slug ? ` · ${m.slug}` : ''}`);
  lines.push(`Total ${report.durationMs} ms${report.framesFromMs != null ? ` · frames sampled from +${report.framesFromMs} ms` : ''}`);
  if (report.js) {
    const j = report.js;
    lines.push(`JS frames: p50 ${j.p50} ms · p95 ${j.p95} ms · max ${j.max} ms · ${j.dropped} > ${DROPPED_FRAME_MS} ms of ${j.frames}`);
  } else {
    lines.push('JS frames: no samples (no requestAnimationFrame)');
  }
  if (report.ui) {
    const u = report.ui;
    lines.push(`UI frames: mean ${u.meanMs} ms · max ${u.max} ms · ${u.dropped} > ${DROPPED_FRAME_MS} ms of ${u.frames}`);
  } else {
    lines.push('UI frames: not sampled');
  }
  if (report.phases.length > 0) {
    lines.push(
      'Phases: ' + report.phases.map((p) => `${p.phase} ${p.durationMs == null ? '?' : p.durationMs} ms`).join(' → '),
    );
  }
  if (report.audio.length > 0) {
    const lat = report.audio.map((a) => a.latencyMs);
    const worst = report.audio.reduce((acc, a) => (a.latencyMs > acc.latencyMs ? a : acc), report.audio[0]);
    const sorted = [...lat].sort((a, b) => a - b);
    lines.push(`Audio hits: ${report.audio.length} · p50 ${percentile(sorted, 50)} ms · max ${worst.latencyMs} ms (${worst.name})`);
  } else {
    lines.push('Audio hits: none');
  }
  if (report.timers && report.timers.length > 0) {
    const sorted = [...report.timers.map((t) => t.slipMs)].sort((a, b) => a - b);
    const worst = report.timers.reduce((acc, t) => (t.slipMs > acc.slipMs ? t : acc), report.timers[0]);
    lines.push(`Timer slip: ${report.timers.length} timers · p50 ${percentile(sorted, 50)} ms · max ${worst.slipMs} ms (${worst.name})`);
  }
  if (report.commits && report.commits.length > 0) {
    let maxLag = -Infinity;
    let maxPhase = '';
    let matched = 0;
    for (const c of report.commits) {
      // Lag against the latest phase mark of the same name at or before this commit.
      let markAt: number | null = null;
      for (const p of report.phases) {
        if (p.phase === c.phase && p.atMs <= c.atMs && (markAt === null || p.atMs > markAt)) markAt = p.atMs;
      }
      if (markAt === null) continue; // skip commits with no matching mark
      matched += 1;
      const lag = c.atMs - markAt;
      if (lag > maxLag) { maxLag = lag; maxPhase = c.phase; }
    }
    if (matched > 0) lines.push(`Commit lag: max ${maxLag} ms (${maxPhase}) · ${matched} phases`);
  }
  if (report.meta.audioWarmAtTear !== undefined || report.meta.syncInFlightAtTear !== undefined) {
    const warm = report.meta.audioWarmAtTear === undefined ? '?' : report.meta.audioWarmAtTear ? 'warm' : 'cold';
    const sync = report.meta.syncInFlightAtTear === undefined ? '?' : report.meta.syncInFlightAtTear ? 'in flight' : 'idle';
    lines.push(`At tear: audio ${warm} · sync ${sync}`);
  }
  const d = report.device;
  lines.push(
    `Device: ${d.platform}${d.osVersion ? ` ${d.osVersion}` : ''}${d.model ? ` · ${d.model}` : ''} · ${d.jsEngine}` +
      `${d.appVersion ? ` · app ${d.appVersion}` : ''}${d.updateId ? ` · update ${d.updateId.slice(0, 8)}` : ''}${d.channel ? ` (${d.channel})` : ''}`,
  );
  return lines;
}
