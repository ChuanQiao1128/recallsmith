// ceremonyAudio — the v2 one-shot ceremony mixer on expo-audio (hits only).
// Guarded require: without expo-audio (or without any sample) every call is a
// silent no-op. Nothing here throws, nothing here is awaited by callers.
//
// v2 (release 1.7.0): the noise bed, the ducking and the sparkle tails are gone.
// The ceremony is a sequence of loudness-balanced Kenney CC0 one-shots under
// `mobile/assets/sfx/v2/`: charge (three plucks), tear, burst, flyout, flip and a
// stinger per rarity. `hit(name)` plays one, from a small idle-first pool.
//
// Player model (kept from the "抽卡的声音一直卡顿" fix):
// - Every player is created up front by warmUp()/prewarm() — DrawScreen calls it
//   while the player is still choosing a pack and DrawCeremonyScreen calls it again
//   at mount, before the tear is interactive. createAudioPlayer is never reached
//   from a phase timer once the set is warm; lazy creation only remains as the
//   fallback for a warm-up that never ran (or threw).
// - Hits play from a small pool (HIT_POOL_SIZE players per FILE, rotated), so a
//   retrigger starts a fresh, idle player instead of seekTo(0) on one that is
//   still sounding (the seek is async on iOS and restarts the sound audibly).
// - Players are created with a 60 s status interval so expo-audio's periodic
//   playbackStatusUpdate events stay off the JS thread during the ceremony.
// - Each hit records its JS-side trigger latency (performance.now around play()) into
//   the ceremony perf recorder (features/gacha/draw/ceremonyPerf).
import { useMemo } from 'react';
import type { Rarity } from '../features/gacha/draw/cardRarity';
import { perfNow, recordCeremonyAudioLatency } from '../features/gacha/draw/ceremonyPerf';
import { getFeedbackPrefsSync } from '../features/gacha/settings/feedbackPrefs';

/** The eight v2 one-shots committed under mobile/assets/sfx/v2 (Kenney CC0). */
export type CeremonySfxFile =
  | 'charge' | 'tear' | 'burst' | 'flyout' | 'flip' | 'stinger-com' | 'stinger-rar' | 'stinger-leg';
/** Every ceremony sound is a one-shot hit that plays its own file 1:1 (no aliases). */
export type CeremonyHitName = CeremonySfxFile;
export type CeremonySfxName = CeremonyHitName;

export const SFX_FILES: ReadonlyArray<CeremonySfxFile> = Object.freeze([
  'charge', 'tear', 'burst', 'flyout', 'flip', 'stinger-com', 'stinger-rar', 'stinger-leg',
]);

// The files are already loudness-set per role (loudnorm, true peak -1.5 dBTP); these gains
// keep the stingers escalating COM < RAR < LEG in ~1–2 dB steps, the burst just under the LEG
// stinger, and all foley at least 6 dB under the quietest stinger.
export const CEREMONY_GAIN = Object.freeze({
  hit: Object.freeze({
    charge: 0.9, tear: 0.9, burst: 0.7, flyout: 0.8, flip: 0.9,
    'stinger-com': 0.8, 'stinger-rar': 0.9, 'stinger-leg': 1.0,
  }) as Readonly<Record<CeremonyHitName, number>>,
});

/** The rarity's own stinger, played at the flip midpoint (COM included). */
export function stingerForRarity(rarity: Rarity): 'stinger-com' | 'stinger-rar' | 'stinger-leg' {
  if (rarity === 'LEG') return 'stinger-leg';
  if (rarity === 'RAR') return 'stinger-rar';
  return 'stinger-com';
}

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
  /** Creates every hit-pool player once and sets the audio mode once. Idempotent. */
  prewarm(): void;
  /** Same as prewarm(); the name DrawCeremonyScreen calls at mount, before the tear is interactive. */
  warmUp(): void;
  /** true once warmUp()/prewarm() has created every player the sources allow. */
  isWarm(): boolean;
  hit(name: CeremonyHitName, opts?: { gain?: number }): void;
  stopAll(): void;
};

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

// Eight guarded requires of the committed v2 WAVs; a missing asset is skipped and every
// hit for that name becomes a no-op. Metro needs each require path to be a literal string.
export function loadSfxSources(): Partial<Record<CeremonySfxFile, unknown>> {
  const sources: Partial<Record<CeremonySfxFile, unknown>> = {};
  try { sources.charge = require('../../assets/sfx/v2/charge.wav'); } catch {}
  try { sources.tear = require('../../assets/sfx/v2/tear.wav'); } catch {}
  try { sources.burst = require('../../assets/sfx/v2/burst.wav'); } catch {}
  try { sources.flyout = require('../../assets/sfx/v2/flyout.wav'); } catch {}
  try { sources.flip = require('../../assets/sfx/v2/flip.wav'); } catch {}
  try { sources['stinger-com'] = require('../../assets/sfx/v2/stinger-com.wav'); } catch {}
  try { sources['stinger-rar'] = require('../../assets/sfx/v2/stinger-rar.wav'); } catch {}
  try { sources['stinger-leg'] = require('../../assets/sfx/v2/stinger-leg.wav'); } catch {}
  return sources;
}

type HitPool = { players: AudioPlayerLike[]; next: number };

/** expo-audio's seekTo is async on iOS; a rejected seek must never surface as an unhandled rejection. */
function seekToStart(player: AudioPlayerLike): void {
  try {
    const r = player.seekTo(0) as { catch?: (fn: () => void) => unknown } | undefined;
    if (r && typeof r.catch === 'function') r.catch(() => {});
  } catch {}
}

export function createCeremonyAudioController(deps: {
  audio: ExpoAudioLike | null;
  sources: Partial<Record<CeremonySfxFile, unknown>>;
  /** Receives every hit's JS-side trigger latency; defaults to the ceremony perf recorder. */
  onHitLatency?: (name: CeremonySfxName, latencyMs: number) => void;
  now?: () => number;
  /** Device-global sound-effects gate; defaults to the feedback preference. */
  isEnabled?: () => boolean;
}): CeremonyAudioController {
  const { audio, sources } = deps;
  const onHitLatency = deps.onHitLatency ?? recordCeremonyAudioLatency;
  const now = deps.now ?? perfNow;
  const isEnabled = deps.isEnabled ?? (() => getFeedbackPrefsSync().soundEffects);
  const hitPools = new Map<CeremonySfxFile, HitPool>();
  let audioModeSet = false;
  let warm = false;

  function ensureAudioMode(): void {
    if (!audio || audioModeSet) return;
    audioModeSet = true;
    try {
      Promise.resolve(
        audio.setAudioModeAsync({ playsInSilentMode: false, interruptionMode: 'mixWithOthers' }),
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

  function fireOneShot(name: CeremonyHitName, gain: number): void {
    if (!isEnabled()) return; // sound effects off: every hit does nothing
    const pool = getHitPool(name);
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
      const pool = getHitPool(file);
      if (!pool || pool.players.length < HIT_POOL_SIZE) complete = false;
    }
    warm = complete;
  }

  function hit(name: CeremonyHitName, opts?: { gain?: number }): void {
    fireOneShot(name, opts?.gain ?? CEREMONY_GAIN.hit[name]);
  }

  function stopAll(): void {
    for (const pool of hitPools.values()) {
      for (const player of pool.players) {
        try { player.pause(); } catch {}
        seekToStart(player);
      }
    }
  }

  return { prewarm: warmUp, warmUp, isWarm: () => warm, hit, stopAll };
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
