// useCeremonyAudio — fire-and-forget SFX trigger.
//
// `expo-av` is OPTIONAL. Without it every call is a no-op so the screen stays
// silent. Same wrapping pattern as the Lottie + Skia + Haptics modules.
//
// To activate:
//   npx expo install expo-av
//   npx expo prebuild
//   # rebuild dev client
//
// ─── How loading works ────────────────────────────────────────────────────
// Sounds are loaded LAZILY at module scope (not per-component-mount). That
// means:
//   • The screen never stalls waiting on audio I/O
//   • A given SFX is loaded at most ONCE across the entire app lifetime
//   • First play of each SFX pays a small latency (~100-500ms) for load + play;
//     subsequent plays are immediate
//   • Each createAsync gets a 3s timeout so a hung iOS audio session can't
//     wedge the cache (root cause of the "kMXSessionProperty_HasEchoCancelledInput"
//     warning loop on the simulator)
//
// Audio.setAudioModeAsync runs once before the first sound load. Without that
// call, iOS Simulator emits AudioSession warnings repeatedly and load times
// balloon.

import { useCallback } from 'react';

export type CeremonySfxName =
  | 'whoosh'
  | 'rip'
  | 'card-drop'
  | 'card-flip'
  | 'shimmer'
  | 'legendary';

function loadAudioModule(): { Sound: any | null; Audio: any | null } {
  let Sound: any = null;
  let Audio: any = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const av = require('expo-av');
    Audio = av?.Audio ?? null;
    Sound = av?.Audio?.Sound ?? null;
  } catch {
    Audio = null;
    Sound = null;
  }
  return { Sound, Audio };
}

function loadSfxSources(): Partial<Record<CeremonySfxName, any>> {
  const sources: Partial<Record<CeremonySfxName, any>> = {};
  const loaders: Array<[CeremonySfxName, () => any]> = [
    ['whoosh', () => require('../../assets/sfx/whoosh.wav')],
    ['rip', () => require('../../assets/sfx/rip.wav')],
    ['card-drop', () => require('../../assets/sfx/card-drop.wav')],
    ['card-flip', () => require('../../assets/sfx/card-flip.wav')],
    ['shimmer', () => require('../../assets/sfx/shimmer.wav')],
    ['legendary', () => require('../../assets/sfx/legendary.wav')],
  ];
  for (const [name, loader] of loaders) {
    try {
      sources[name] = loader();
    } catch {
      // Asset missing — skip; play() will silently no-op for this name
    }
  }
  return sources;
}

const { Sound, Audio } = loadAudioModule();
const sfxSources = loadSfxSources();
export const ceremonyAudioAvailable = !!Sound && Object.keys(sfxSources).length > 0;

// Wrap a promise with a timeout so a hung iOS audio session can't deadlock.
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    p,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

// Configure the iOS audio session ONCE before the first sound load. Without
// this expo-av on the simulator emits a steady stream of -50 errors as it
// queries an uninitialised session.
let audioModePromise: Promise<void> | null = null;
function ensureAudioMode(): Promise<void> {
  if (audioModePromise) return audioModePromise;
  if (!Audio?.setAudioModeAsync) {
    audioModePromise = Promise.resolve();
    return audioModePromise;
  }
  audioModePromise = (async () => {
    try {
      await withTimeout(
        Audio.setAudioModeAsync({
          playsInSilentModeIOS: true,
          allowsRecordingIOS: false,
          staysActiveInBackground: false,
          shouldDuckAndroid: true,
          playThroughEarpieceAndroid: false,
        }),
        2000,
      );
    } catch {
      // some expo-av versions error on unknown keys; ignore
    }
  })();
  return audioModePromise;
}

// Module-level lazy cache. Each sound loads at most once; subsequent plays
// reuse the cached Sound instance.
const soundCache = new Map<CeremonySfxName, Promise<any | null>>();

function getSound(name: CeremonySfxName): Promise<any | null> {
  if (!Sound) return Promise.resolve(null);
  const source = sfxSources[name];
  if (!source) return Promise.resolve(null);

  let promise = soundCache.get(name);
  if (!promise) {
    promise = (async () => {
      await ensureAudioMode();
      try {
        const result: any = await withTimeout<any>(
          Sound.createAsync(source, { shouldPlay: false, volume: 0.7 }),
          3000,
        );
        return result?.sound ?? null;
      } catch {
        return null;
      }
    })();
    soundCache.set(name, promise);
  }
  return promise;
}

export function useCeremonyAudio() {
  // play is intentionally fire-and-forget; never blocks render or returns a
  // promise the caller must await.
  const play = useCallback((name: CeremonySfxName) => {
    getSound(name)
      .then((sound) => {
        if (!sound) return;
        try {
          // Reset to 0 then play — same Sound instance can be retriggered
          sound.setPositionAsync?.(0)?.catch?.(() => {});
          sound.playAsync?.()?.catch?.(() => {});
        } catch {
          /* noop */
        }
      })
      .catch(() => {
        /* noop */
      });
  }, []);

  return { play, available: ceremonyAudioAvailable };
}
