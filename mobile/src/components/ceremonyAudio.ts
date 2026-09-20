// ceremonyAudio — three-layer ceremony mixer on expo-audio (bed / hit / tail).
// Guarded require: without expo-audio (or without any sample) every call is a
// silent no-op. Nothing here throws, nothing here is awaited by callers.
import { useMemo } from 'react';
import type { Rarity } from '../features/gacha/draw/cardRarity';

export type CeremonyBedName = 'crinkle' | 'air' | 'shimmer-pad' | 'choir-swell';
export type CeremonyHitName =
  | 'whoosh' | 'rip' | 'card-slide' | 'stack-thud' | 'seam-burst' | 'card-flip' | 'card-drop'
  | 'chime' | 'stinger' | 'shimmer' | 'legendary';
export type CeremonyTailName = 'sparkle-tail' | 'soft-chime';
export type CeremonySfxName = CeremonyBedName | CeremonyHitName | CeremonyTailName;
export type CeremonyAudioLayer = 'bed' | 'hit' | 'tail';
/** The six WAVs committed under mobile/assets/sfx. */
export type CeremonySfxFile = 'whoosh' | 'rip' | 'card-drop' | 'card-flip' | 'shimmer' | 'legendary';

export const SFX_ALIASES: Readonly<Record<CeremonySfxName, CeremonySfxFile>> = Object.freeze({
  crinkle: 'shimmer', air: 'shimmer', 'shimmer-pad': 'shimmer', 'choir-swell': 'legendary',
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
  prewarm(): void;
  bed(name: CeremonyBedName | null, opts?: { gain?: number; fadeMs?: number }): void;
  duck(gain: number, ms: number): void;
  hit(name: CeremonyHitName, opts?: { gain?: number }): void;
  tail(name: CeremonyTailName, opts?: { gain?: number }): void;
  /** Legacy alias of hit() — DrawCeremonyScreen.tsx:443 still calls play(). */
  play(name: CeremonySfxName): void;
  stopAll(): void;
};

const ALL_SFX_NAMES = Object.keys(SFX_ALIASES) as CeremonySfxName[];

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

// Six guarded requires of the committed WAVs under mobile/assets/sfx; a missing
// asset is skipped and every call for a name aliased onto it becomes a no-op.
export function loadSfxSources(): Partial<Record<CeremonySfxFile, unknown>> {
  const sources: Partial<Record<CeremonySfxFile, unknown>> = {};
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

export function createCeremonyAudioController(deps: {
  audio: ExpoAudioLike | null;
  sources: Partial<Record<CeremonySfxFile, unknown>>;
}): CeremonyAudioController {
  const { audio, sources } = deps;
  const players = new Map<CeremonySfxName, AudioPlayerLike>();
  const rampTimers = new Map<AudioPlayerLike, ReturnType<typeof setTimeout>>();
  let audioModeSet = false;
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

  function getPlayer(name: CeremonySfxName): AudioPlayerLike | undefined {
    if (!audio) return undefined;
    const existing = players.get(name);
    if (existing) return existing;
    const source = sources[SFX_ALIASES[name]];
    if (source === undefined) return undefined;
    ensureAudioMode();
    try {
      const p = audio.createAudioPlayer(source);
      players.set(name, p);
      return p;
    } catch {
      return undefined;
    }
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
    const player = getPlayer(name);
    if (!player) return;
    try {
      player.volume = gain;
      player.seekTo(0);
      player.play();
    } catch {}
  }

  function prewarm(): void {
    if (!audio) return;
    ensureAudioMode();
    for (const name of ALL_SFX_NAMES) getPlayer(name);
  }

  function bed(name: CeremonyBedName | null, opts?: { gain?: number; fadeMs?: number }): void {
    const gain = opts?.gain ?? CEREMONY_GAIN.bed.COM;
    const fadeMs = opts?.fadeMs ?? BED_FADE_MS;
    const outgoing = currentBed;
    if (outgoing) {
      const player = outgoing.player;
      rampVolume(player, 0, fadeMs, () => { try { player.pause(); } catch {} });
    }
    currentBed = null;
    if (name === null) return;
    const player = getPlayer(name);
    if (!player) return;
    try {
      player.loop = true;
      player.volume = 0;
      player.seekTo(0);
      player.play();
    } catch {}
    currentBed = { player };
    rampVolume(player, gain, fadeMs);
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
    fireOneShot(name, gainForPlay(name));
  }

  function stopAll(): void {
    for (const t of rampTimers.values()) clearTimeout(t);
    rampTimers.clear();
    for (const player of players.values()) {
      try { player.pause(); } catch {}
      try { player.seekTo(0); } catch {}
    }
    currentBed = null;
  }

  return { prewarm, bed, duck, hit, tail, play, stopAll };
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
  getCeremonyAudio().prewarm();
}

export function useCeremonyAudio(): CeremonyAudioController & { available: boolean } {
  const controller = getCeremonyAudio();
  return useMemo(() => ({ ...controller, available: ceremonyAudioAvailable }), []);
}
