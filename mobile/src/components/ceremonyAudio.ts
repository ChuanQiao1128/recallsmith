// ceremonyAudio — three-layer ceremony mixer on expo-audio (bed / hit / tail).
// Guarded require: without expo-audio (or without any sample) every call is a
// silent no-op. Nothing here throws, nothing here is awaited by callers.
//
// Player model (2026-09-21, the "抽卡的声音一直卡顿" fix):
// - Every player is created up front by warmUp()/prewarm() — DrawScreen calls it
//   while the player is still choosing a pack and DrawCeremonyScreen calls it again
//   at mount, before the tear is interactive. createAudioPlayer is never reached
//   from a phase timer once the set is warm; lazy creation only remains as the
//   fallback for a warm-up that never ran (or threw).
// - Hits play from a small pool (HIT_POOL_SIZE players per FILE, rotated), so a
//   retrigger starts a fresh, idle player instead of seekTo(0) on one that is
//   still sounding (the seek is async on iOS and restarts the sound audibly).
// - Beds share ONE looping player per file (all four bed names alias the 8 s
//   seamless ambience loop), so switching beds is a volume ramp on a player that
//   keeps looping, never a restart. Looping a 0.25 s placeholder through
//   expo-audio's end-notification → seek → play loop was the audible stutter.
// - Players are created with a 60 s status interval so expo-audio's periodic
//   playbackStatusUpdate events stay off the JS thread during the ceremony.
// - Each hit records its JS-side trigger latency (Date.now around play()) into
//   the ceremony perf recorder (features/gacha/draw/ceremonyPerf).
import { useMemo } from 'react';
import type { Rarity } from '../features/gacha/draw/cardRarity';
import { recordCeremonyAudioLatency } from '../features/gacha/draw/ceremonyPerf';

export type CeremonyBedName = 'crinkle' | 'air' | 'shimmer-pad' | 'choir-swell';
export type CeremonyHitName =
  | 'whoosh' | 'rip' | 'card-slide' | 'stack-thud' | 'seam-burst' | 'card-flip' | 'card-drop'
  | 'chime' | 'stinger' | 'shimmer' | 'legendary';
export type CeremonyTailName = 'sparkle-tail' | 'soft-chime';
export type CeremonySfxName = CeremonyBedName | CeremonyHitName | CeremonyTailName;
export type CeremonyAudioLayer = 'bed' | 'hit' | 'tail';
/** The seven WAVs committed under mobile/assets/sfx (all synthesised by scripts/gen_sfx.py). */
export type CeremonySfxFile = 'ambience' | 'whoosh' | 'rip' | 'card-drop' | 'card-flip' | 'shimmer' | 'legendary';

export const SFX_FILES: ReadonlyArray<CeremonySfxFile> = Object.freeze([
  'ambience', 'whoosh', 'rip', 'card-drop', 'card-flip', 'shimmer', 'legendary',
]);
/** The one file that loops (the bed layer). Everything else is a one-shot. */
export const SFX_LOOP_FILES: ReadonlySet<CeremonySfxFile> = new Set<CeremonySfxFile>(['ambience']);

export const SFX_ALIASES: Readonly<Record<CeremonySfxName, CeremonySfxFile>> = Object.freeze({
  crinkle: 'ambience', air: 'ambience', 'shimmer-pad': 'ambience', 'choir-swell': 'ambience',
  whoosh: 'whoosh', rip: 'rip', 'card-slide': 'card-drop', 'stack-thud': 'card-drop', 'seam-burst': 'rip',
  'card-flip': 'card-flip', 'card-drop': 'card-drop', chime: 'shimmer', stinger: 'legendary',
  shimmer: 'shimmer', legendary: 'legendary', 'sparkle-tail': 'shimmer', 'soft-chime': 'shimmer',
});

export const CEREMONY_GAIN = Object.freeze({
  bed: Object.freeze({ COM: 0.30, RAR: 0.35, LEG: 0.40 }) as Readonly<Record<Rarity, number>>,
  bedTable: 0.25,
  duck: 0.15,
  hit: Object.freeze({
    whoosh: 0.6, rip: 0.8, 'card-slide': 0.5, 'stack-thud': 0.6, 'seam-burst': 0.7, 'card-flip': 0.5,
    'card-drop': 0.5, chime: 0.8, stinger: 1.0, shimmer: 0.7, legendary: 1.0,
  }) as Readonly<Record<CeremonyHitName, number>>,
  tail: Object.freeze({ 'sparkle-tail': 0.5, 'soft-chime': 0.5 }) as Readonly<Record<CeremonyTailName, number>>,
});
export const BED_FADE_MS = 200;
const RAMP_STEP_MS = 20;
/** One-shot players per file; a retrigger inside a sound's tail takes the other player. */
export const HIT_POOL_SIZE = 2;
/** Status-event interval handed to createAudioPlayer (default 500 ms would post ~2 events/s per playing player to JS). */
export const PLAYER_UPDATE_INTERVAL_MS = 60000;

/** Minimal surface of an expo-audio AudioPlayer this module touches. */
export type AudioPlayerLike = {
  play(): void; pause(): void; seekTo(seconds: number): unknown; remove?(): void;
  volume: number; loop: boolean; playing?: boolean;
};
/** Minimal surface of the expo-audio module this module touches. */
export type ExpoAudioLike = {
  createAudioPlayer(source: unknown, options?: unknown): AudioPlayerLike;
  setAudioModeAsync(mode: Record<string, unknown>): Promise<void>;
};

export type CeremonyAudioController = {
  /** Creates every player once (beds + hit pools) and sets the audio mode once. Idempotent. */
  prewarm(): void;
  /** Same as prewarm(); the name DrawCeremonyScreen calls at mount, before the tear is interactive. */
  warmUp(): void;
  /** true once warmUp()/prewarm() has created every player the sources allow. */
  isWarm(): boolean;
  bed(name: CeremonyBedName | null, opts?: { gain?: number; fadeMs?: number }): void;
  duck(gain: number, ms: number): void;
  hit(name: CeremonyHitName, opts?: { gain?: number }): void;
  tail(name: CeremonyTailName, opts?: { gain?: number }): void;
  /** Legacy alias: bed names start that bed, every other name plays as a one-shot. */
  play(name: CeremonySfxName): void;
  stopAll(): void;
};

const BED_NAMES: ReadonlySet<string> = new Set<CeremonyBedName>(['crinkle', 'air', 'shimmer-pad', 'choir-swell']);

// guarded require('expo-audio') — a device mechanism only. Under vitest this is
// never redirected by vi.mock, which is why the controller is dependency-injected.
export function loadExpoAudio(): ExpoAudioLike | null {
  try {
    const mod = require('expo-audio');
    return mod && typeof mod.createAudioPlayer === 'function' ? (mod as ExpoAudioLike) : null;
  } catch {
    return null;
  }
}

// Seven guarded requires of the committed WAVs under mobile/assets/sfx; a missing
// asset is skipped and every call for a name aliased onto it becomes a no-op.
export function loadSfxSources(): Partial<Record<CeremonySfxFile, unknown>> {
  const sources: Partial<Record<CeremonySfxFile, unknown>> = {};
  try { sources.ambience = require('../../assets/sfx/ambience.wav'); } catch {}
  try { sources.whoosh = require('../../assets/sfx/whoosh.wav'); } catch {}
  try { sources.rip = require('../../assets/sfx/rip.wav'); } catch {}
  try { sources['card-drop'] = require('../../assets/sfx/card-drop.wav'); } catch {}
  try { sources['card-flip'] = require('../../assets/sfx/card-flip.wav'); } catch {}
  try { sources.shimmer = require('../../assets/sfx/shimmer.wav'); } catch {}
  try { sources.legendary = require('../../assets/sfx/legendary.wav'); } catch {}
  return sources;
}

function gainForPlay(name: CeremonySfxName): number {
  if (name in CEREMONY_GAIN.hit) return CEREMONY_GAIN.hit[name as CeremonyHitName];
  if (name in CEREMONY_GAIN.tail) return CEREMONY_GAIN.tail[name as CeremonyTailName];
  return CEREMONY_GAIN.bed.COM;
}

type HitPool = { players: AudioPlayerLike[]; next: number };

/** expo-audio's seekTo is async on iOS; a rejected seek must never surface as an unhandled rejection. */
function seekToStart(player: AudioPlayerLike): void {
  try {
    const r = player.seekTo(0) as { catch?: (fn: () => void) => unknown } | undefined;
    if (r && typeof r.catch === 'function') r.catch(() => {});
  } catch {}
}
type BedState = 'playing' | 'fading' | 'stopped';

export function createCeremonyAudioController(deps: {
  audio: ExpoAudioLike | null;
  sources: Partial<Record<CeremonySfxFile, unknown>>;
  /** Receives every hit's JS-side trigger latency; defaults to the ceremony perf recorder. */
  onHitLatency?: (name: CeremonySfxName, latencyMs: number) => void;
  now?: () => number;
}): CeremonyAudioController {
  const { audio, sources } = deps;
  const onHitLatency = deps.onHitLatency ?? recordCeremonyAudioLatency;
  const now = deps.now ?? Date.now;
  const bedPlayers = new Map<CeremonySfxFile, AudioPlayerLike>();
  const bedStates = new Map<AudioPlayerLike, BedState>();
  const hitPools = new Map<CeremonySfxFile, HitPool>();
  const rampTimers = new Map<AudioPlayerLike, ReturnType<typeof setTimeout>>();
  let audioModeSet = false;
  let warm = false;
  let currentBed: { player: AudioPlayerLike } | null = null;

  function ensureAudioMode(): void {
    if (!audio || audioModeSet) return;
    audioModeSet = true;
    try {
      Promise.resolve(
        audio.setAudioModeAsync({ playsInSilentMode: true, interruptionMode: 'mixWithOthers' }),
      ).catch(() => {});
    } catch {}
  }

  function createPlayer(file: CeremonySfxFile): AudioPlayerLike | undefined {
    if (!audio) return undefined;
    const source = sources[file];
    if (source === undefined) return undefined;
    ensureAudioMode();
    try {
      return audio.createAudioPlayer(source, { updateInterval: PLAYER_UPDATE_INTERVAL_MS });
    } catch {
      return undefined;
    }
  }

  function getBedPlayer(name: CeremonyBedName): AudioPlayerLike | undefined {
    const file = SFX_ALIASES[name];
    const existing = bedPlayers.get(file);
    if (existing) return existing;
    const p = createPlayer(file);
    if (!p) return undefined;
    try { p.loop = true; } catch {}
    bedPlayers.set(file, p);
    bedStates.set(p, 'stopped');
    return p;
  }

  function getHitPool(file: CeremonySfxFile): HitPool | undefined {
    const existing = hitPools.get(file);
    if (existing && existing.players.length >= HIT_POOL_SIZE) return existing;
    const pool: HitPool = existing ?? { players: [], next: 0 };
    while (pool.players.length < HIT_POOL_SIZE) {
      const p = createPlayer(file);
      if (!p) break;
      pool.players.push(p);
    }
    if (pool.players.length === 0) return undefined;
    hitPools.set(file, pool);
    return pool;
  }

  function pickFromPool(pool: HitPool): AudioPlayerLike {
    const n = pool.players.length;
    let idx = pool.next % n;
    for (let i = 0; i < n; i += 1) {
      const candidate = pool.players[(idx + i) % n];
      let busy = false;
      try { busy = candidate.playing === true; } catch {}
      if (!busy) {
        idx = (idx + i) % n;
        break;
      }
    }
    pool.next = (idx + 1) % n;
    return pool.players[idx];
  }

  function clearRamp(player: AudioPlayerLike): void {
    const t = rampTimers.get(player);
    if (t !== undefined) {
      clearTimeout(t);
      rampTimers.delete(player);
    }
  }

  function rampVolume(player: AudioPlayerLike, to: number, ms: number, onDone?: () => void): void {
    clearRamp(player);
    if (ms <= 0) {
      try { player.volume = to; } catch {}
      if (onDone) { try { onDone(); } catch {} }
      return;
    }
    const steps = Math.max(1, Math.round(ms / RAMP_STEP_MS));
    let from = 0;
    try { from = player.volume; } catch {}
    const delta = (to - from) / steps;
    const stepMs = ms / steps;
    let i = 0;
    const step = () => {
      i += 1;
      if (i < steps) {
        try { player.volume = from + delta * i; } catch {}
        rampTimers.set(player, setTimeout(step, stepMs));
      } else {
        try { player.volume = to; } catch {}
        rampTimers.delete(player);
        if (onDone) { try { onDone(); } catch {} }
      }
    };
    rampTimers.set(player, setTimeout(step, stepMs));
  }

  function fireOneShot(name: CeremonySfxName, gain: number): void {
    const file = SFX_ALIASES[name];
    if (SFX_LOOP_FILES.has(file)) return; // a loop file never plays as a one-shot
    const pool = getHitPool(file);
    if (!pool) return;
    const player = pickFromPool(pool);
    const t0 = now();
    try {
      player.volume = gain;
      seekToStart(player);
      player.play();
    } catch {}
    const dt = now() - t0;
    try { onHitLatency(name, dt); } catch {}
  }

  function warmUp(): void {
    if (!audio) return;
    ensureAudioMode();
    let complete = true;
    for (const file of SFX_FILES) {
      if (sources[file] === undefined) continue;
      if (SFX_LOOP_FILES.has(file)) {
        const bedName = (Object.keys(SFX_ALIASES) as CeremonySfxName[]).find(
          (n) => BED_NAMES.has(n) && SFX_ALIASES[n] === file,
        ) as CeremonyBedName | undefined;
        if (bedName && !getBedPlayer(bedName)) complete = false;
      } else {
        const pool = getHitPool(file);
        if (!pool || pool.players.length < HIT_POOL_SIZE) complete = false;
      }
    }
    warm = complete;
  }

  function bed(name: CeremonyBedName | null, opts?: { gain?: number; fadeMs?: number }): void {
    const gain = opts?.gain ?? CEREMONY_GAIN.bed.COM;
    const fadeMs = opts?.fadeMs ?? BED_FADE_MS;
    const next = name === null ? undefined : getBedPlayer(name);
    const outgoing = currentBed?.player;
    if (outgoing && outgoing !== next) {
      bedStates.set(outgoing, 'fading');
      rampVolume(outgoing, 0, fadeMs, () => {
        try { outgoing.pause(); } catch {}
        bedStates.set(outgoing, 'stopped');
      });
    }
    currentBed = null;
    if (!next) return;
    const state = bedStates.get(next) ?? 'stopped';
    if (state === 'stopped') {
      // Cold start: from the top, silent, then ramp in.
      try {
        next.loop = true;
        next.volume = 0;
        seekToStart(next);
        next.play();
      } catch {}
    }
    // 'playing' / 'fading': the loop keeps running; only the level moves (no restart, no seek).
    bedStates.set(next, 'playing');
    currentBed = { player: next };
    rampVolume(next, gain, fadeMs);
  }

  function duck(gain: number, ms: number): void {
    if (!currentBed) return;
    rampVolume(currentBed.player, gain, ms);
  }

  function hit(name: CeremonyHitName, opts?: { gain?: number }): void {
    fireOneShot(name, opts?.gain ?? CEREMONY_GAIN.hit[name]);
  }

  function tail(name: CeremonyTailName, opts?: { gain?: number }): void {
    fireOneShot(name, opts?.gain ?? CEREMONY_GAIN.tail[name]);
  }

  function play(name: CeremonySfxName): void {
    if (BED_NAMES.has(name)) {
      bed(name as CeremonyBedName);
      return;
    }
    fireOneShot(name, gainForPlay(name));
  }

  function stopAll(): void {
    for (const t of rampTimers.values()) clearTimeout(t);
    rampTimers.clear();
    const all: AudioPlayerLike[] = [...bedPlayers.values()];
    for (const pool of hitPools.values()) all.push(...pool.players);
    for (const player of all) {
      try { player.pause(); } catch {}
      seekToStart(player);
    }
    for (const p of bedPlayers.values()) bedStates.set(p, 'stopped');
    currentBed = null;
  }

  return { prewarm: warmUp, warmUp, isWarm: () => warm, bed, duck, hit, tail, play, stopAll };
}

const expoAudio = loadExpoAudio();
const sfxSources = loadSfxSources();
export const ceremonyAudioAvailable = !!expoAudio && Object.keys(sfxSources).length > 0;

let singleton: CeremonyAudioController | null = null;
export function getCeremonyAudio(): CeremonyAudioController {
  if (!singleton) singleton = createCeremonyAudioController({ audio: expoAudio, sources: sfxSources });
  return singleton;
}

export function prewarmCeremonyAudio(): void {
  getCeremonyAudio().warmUp();
}

export function useCeremonyAudio(): CeremonyAudioController & { available: boolean } {
  const controller = getCeremonyAudio();
  return useMemo(() => ({ ...controller, available: ceremonyAudioAvailable }), []);
}
