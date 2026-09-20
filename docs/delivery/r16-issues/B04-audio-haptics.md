# B04 — Ceremony audio on expo-audio + haptic limiter (`audio-haptics`)

Rewrite `ceremonyAudio.ts` on `expo-audio` as a three-layer mixer (bed / hit / tail) with a per-name gain table, aliases onto the six committed WAVs and a prewarm; rewrite `ceremonyHaptics.ts` with a rolling rate limiter (≤ 3 events / 1000 ms), Success at most once per ceremony and a Reduce-Motion mode; both with unit tests that inject fake native modules.

## Context

Today's audio is a single fire-and-forget `play(name)` over `expo-av` (`mobile/src/components/ceremonyAudio.ts:36-49` guarded `require('expo-av')` at `:41`; `Sound.createAsync(source, { shouldPlay: false, volume: 0.7 })` at `:127` — every sample at a fixed 0.7; `useCeremonyAudio` at `:140-161`). There is no bed, no riser, no duck and no layering, which is the "six synthesized blips" finding of the audit (`docs/release-1.6.0-plan-2026-09-19.md:40`). `expo-av` is deprecated in SDK 54 and B01 removes it together with `lottie-react-native` (B00 §0, `:13`): after B01 the only file still naming `expo-av` is this one, and it must be gone after B04. Haptics (`mobile/src/components/ceremonyHaptics.ts:32-64`) expose `tick` / `impact('light'|'medium'|'heavy')` / `success` with no rate limit — rapid table taps (`DrawCeremonyScreen.tsx:1187-1190`) can fire a haptic per tap — and `success()` (`:53-61`) can fire any number of times.

The design (`release-1.6.0-plan:72` "Sound in three layers", `:73` "Haptics follow Apple's causality/harmony rules", `:66` "Silence before the hit" — bed ducks to −12 dB, no haptic in the beat; `:76` Reduce Motion keeps sound and a single light haptic; `:85` "触觉限速 ≤ 3 次/秒，Success 只在 Legendary 且每次仪式最多一次"; `:167-168` the two code-change rows) is fixed by B00 §2.6 and §2.7 (`docs/delivery/r16-issues/B00-contracts.md`, navigate by heading). The new sample vocabulary (17 names) has no committed files — only `whoosh, rip, card-drop, card-flip, shimmer, legendary` exist under `mobile/assets/sfx/` — so every name is aliased onto a committed file through `SFX_ALIASES` (B00 §9 #9, `:802`); a static `require` of a missing file would break Metro.

Callers today: `DrawCeremonyScreen.tsx:24-25` imports both hooks, `:443` `const { play: playSfx } = useCeremonyAudio();`, `:444` `const { tick: hapticTick, impact: hapticImpact, success: hapticSuccess } = useCeremonyHaptics();`, call sites `:556` (`whoosh`), `:621-622` (`rip` + `impact('heavy')`), `:666-673` (`legendary`/`shimmer`/`card-drop` + `success`/`impact('medium')`/`impact('light')`), `:1187-1190` (`tick` + per-card `legendary`/`shimmer`/`card-flip`). The screen is NOT edited in this issue (B09 rewires it); the rewritten modules must keep `play`, `tick`, `impact`, `success`, `available` working exactly as those lines use them, so `tests/integration/draw-ceremony.screen.test.tsx` (15 cases, green on base) stays green untouched.

**Test-infrastructure fact you must design around (verified on this tree):** under vitest, `vi.mock('expo-audio' | 'expo-haptics', …)` does NOT reach a guarded `require(...)` — vite-node hands `require` to Node's own loader, so `require('expo-haptics')` throws (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING` on `expo-haptics/src/Haptics.ts`) and `require('expo-audio')` either throws or loads the real package. That is why both modules get a dependency-injected factory (`createCeremonyAudioController`, `createCeremonyHapticsController`) and the tests inject fakes instead of mocking packages. B02's `tests/setup/ceremony.ts` mocks (B00 §4.1 items 5–6) are irrelevant to these tests and must not be relied on — B04 depends on B01 only and may run before B02 merges.

## Read first

1. `docs/delivery/r16-issues/B00-contracts.md` — B00 is edited by several fixers, so navigate by section heading, not line: §0 (non-negotiables), §2.6 (audio contract — signatures verbatim, plus the "Additive exports" paragraph listing your DI surface), §2.7 (haptics contract, incl. "under `reduceMotion` `tick()` is dropped"), §8 (verify conventions), §9 #9 (aliases), §9 #13 (a module-scope guarded `require()` is a device mechanism only — under vitest it is never redirected by `vi.mock`, which is why your tests inject fakes through the factories).
2. `mobile/src/components/ceremonyAudio.ts:1-161` (what you replace; keep the "never throws / fire-and-forget / module-level cache" spirit of `:11-24`, `:112-138`).
3. `mobile/src/components/ceremonyHaptics.ts:1-64` (keep the `tick`/`impact`/`success`/`available` surface of `:32-64`; the Capitalised style mapping at `:45-47`).
4. `mobile/src/screens/DrawCeremonyScreen.tsx:24-25`, `:443-444`, `:556`, `:621-622`, `:666-673`, `:1187-1190` (the only callers; do not edit).
5. `mobile/src/features/gacha/draw/cardRarity.ts:3` (`export type Rarity = 'COM' | 'RAR' | 'LEG'` — use this where B00 writes `PeakRarity`; B02's `ceremonyTimings.ts` may not exist in your worktree).
6. `docs/release-1.6.0-plan-2026-09-19.md:66`, `:72-73`, `:76`, `:96-104` (audio/haptic columns of S0–RM), `:113`, `:116`, `:167-168`.
7. `mobile/tests/unit/drawStateAdoption.test.ts` (if present) or `mobile/tests/unit/packArt.test.ts:1-30` for the vitest import style; `mobile/tests/integration/draw-ceremony.screen.test.tsx:1-60` to see why `react-native` must never be imported by these two modules at runtime.

## Constraints

- **Scope (the ONLY files that may change):**
  - `mobile/src/components/ceremonyAudio.ts` (rewrite)
  - `mobile/src/components/ceremonyHaptics.ts` (rewrite)
  - `mobile/tests/unit/ceremonyAudio.test.ts` (new)
  - `mobile/tests/unit/ceremonyHaptics.test.ts` (new)
- **Frozen files — zero diff:** `mobile/src/content/deckRepository.ts`, `mobile/src/sync/progressSync.ts`, `mobile/src/review/model.ts`.
- **No dependency changes.** `mobile/package.json` / `package-lock.json` untouched; `"vite": "7.2.4"` stays; `expo-audio` is already installed by B01 (guarded `require('expo-audio')`); `expo-haptics` is already a dependency (`package.json:35`).
- **`expo-av` must not appear anywhere in `mobile/src` after this issue** (B00 §0). The string `expo-av` is grepped as banned in both scope files. `react-native` must not be imported at runtime by either module (type imports are fine) — the draw-ceremony integration test replaces `react-native` with a 6-key mock (`test:9-36`).
- **Never throws, never awaits in the caller's path.** Every native call sits in `try {} catch {}`; every returned promise gets `.catch(() => {})`; every public method returns `void`. A missing module, a missing sample, a throwing `play()` or a rejected `setAudioModeAsync` must all degrade to silence.
- **No timers other than `setTimeout`.** Volume ramps use a recursive `setTimeout` step chain (B00 §3.2 reserves `setInterval` for `SpillSampler`; keep the ceremony tree grep-clean). Every pending ramp is cancellable and `stopAll()` cancels them.
- **Test literal rules:** no existing test changes. The two new test files are `.test.ts` (never `.test.tsx` — the scope guard is by exact name), so any React probe is built with `React.createElement`, not JSX. They use `vi.useFakeTimers()` where a ramp is asserted and `vi.useRealTimers()` in `afterEach`. They never `vi.mock('expo-audio')`/`vi.mock('expo-haptics')` (see Context) — they inject fakes through the factories.
- **Suppression comments:** the rewritten files are 100 % "added lines" to the diff gate, so they must contain no `eslint-disable`, `@ts-ignore`, `@ts-expect-error` (today's `// eslint-disable-next-line @typescript-eslint/no-require-imports` at `ceremonyAudio.ts:40` / `ceremonyHaptics.ts:21` disappears; there is no eslint config in `mobile/`, and `@types/node` types `require`).
- **Banned literals in identifiers/comments/strings:** `humanizer`, `bypass`, `undetect`, `detector`, `evade`, `Gemini said`. Say "guard", "skip", "fallback", "probe".
- No testIDs, no UI copy, no screen changes in this issue.

## Changes required

### 1. `mobile/src/components/ceremonyAudio.ts` — rewrite on `expo-audio`

Delete everything and write the module below. Exported names, types and signatures are the B00 §2.6 contract verbatim (only `Rarity` replaces `PeakRarity`, same members); the DI factory and the `*Like` types are additions required for testability.

```ts
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

export function loadExpoAudio(): ExpoAudioLike | null;                       // guarded require('expo-audio')
export function loadSfxSources(): Partial<Record<CeremonySfxFile, unknown>>;  // six guarded require('../../assets/sfx/<file>.wav')
export function createCeremonyAudioController(deps: {
  audio: ExpoAudioLike | null;
  sources: Partial<Record<CeremonySfxFile, unknown>>;
}): CeremonyAudioController;

export const ceremonyAudioAvailable: boolean;          // !!loadExpoAudio() && at least one source
export function prewarmCeremonyAudio(): void;          // getCeremonyAudio().prewarm() — DrawScreen mount (B10)
export function getCeremonyAudio(): CeremonyAudioController;   // module-level singleton
export function useCeremonyAudio(): CeremonyAudioController & { available: boolean };
```

Behaviour of the controller returned by `createCeremonyAudioController({ audio, sources })`:

a. **Players.** One `AudioPlayerLike` per *name* (17 max), created with `audio.createAudioPlayer(sources[SFX_ALIASES[name]])`, cached in a `Map<CeremonySfxName, AudioPlayerLike>`. A name whose aliased file is missing from `sources` has no player and every call for it is a no-op. Players are created either by `prewarm()` (all names whose file exists) or lazily on first use. `audio === null` → no players ever, every method a no-op.
b. **`prewarm()`** is idempotent: the second call creates nothing and does not call `setAudioModeAsync` again. It calls `audio.setAudioModeAsync({ playsInSilentMode: true, interruptionMode: 'mixWithOthers' })` exactly once (guarded, `.catch(() => {})`), then creates every player. Lazy creation (a `hit()` before any `prewarm()`) also triggers the one-time audio mode call.
c. **`hit(name, { gain })`**: player for `name`; `player.volume = gain ?? CEREMONY_GAIN.hit[name]`; `player.seekTo(0)`; `player.play()` — in that order, each guarded.
d. **`tail(name, { gain })`**: same as `hit` with `CEREMONY_GAIN.tail[name]`.
e. **`play(name)`**: legacy alias — a one-shot of the player for `name` at `CEREMONY_GAIN.hit[name]` when `name` is a hit name, `CEREMONY_GAIN.tail[name]` for a tail name, `CEREMONY_GAIN.bed.COM` for a bed name (no loop). `play('legendary')` must be observably identical to `hit('legendary')`.
f. **`bed(name | null, { gain = CEREMONY_GAIN.bed.COM, fadeMs = BED_FADE_MS })`**: if a bed is currently active, ramp its volume to 0 over `fadeMs` and `pause()` it when the ramp ends. If `name` is non-null: its player gets `loop = true`, `volume = 0`, `seekTo(0)`, `play()`, then a ramp `0 → gain` over `fadeMs`; it becomes the current bed and `gain` becomes the bed's target gain. `bed(null)` only fades the current bed out.
g. **`duck(gain, ms)`**: ramp the current bed's volume from its present value to `gain` over `ms` (0 = mute, still looping). No current bed → no-op. The ramp replaces any ramp in flight on that player.
h. **Ramps**: `rampVolume(player, to, ms)` with `RAMP_STEP_MS = 20`; steps = `max(1, round(ms / RAMP_STEP_MS))`; each step is a `setTimeout`; the final step sets `volume` to exactly `to` and runs the completion callback (used by `bed()` to `pause()` the outgoing bed). Every ramp is recorded so `stopAll()` and a replacing ramp can `clearTimeout` it. `ms <= 0` sets the volume immediately.
i. **`stopAll()`**: cancel every ramp, `pause()` + `seekTo(0)` every created player, clear the current bed. Players are kept (not removed) so the next ceremony is still prewarmed.
j. Module-level: `const expoAudio = loadExpoAudio(); const sfxSources = loadSfxSources();` evaluated once at import (same as today's `:71-72`); `ceremonyAudioAvailable = !!expoAudio && Object.keys(sfxSources).length > 0`; `getCeremonyAudio()` lazily builds the singleton with `createCeremonyAudioController({ audio: expoAudio, sources: sfxSources })`; `useCeremonyAudio()` returns `useMemo(() => ({ ...controller, available: ceremonyAudioAvailable }), [])` where `controller = getCeremonyAudio()` (the spread copies method references; the methods close over the singleton's state so identity of the state is preserved).
k. `loadExpoAudio()`: `try { const mod = require('expo-audio'); return mod && typeof mod.createAudioPlayer === 'function' ? mod : null; } catch { return null; }`. `loadSfxSources()`: the six `require('../../assets/sfx/<file>.wav')` each in its own `try`, exactly the loop shape of today's `:51-69`.

### 2. `mobile/src/components/ceremonyHaptics.ts` — rewrite with limiter

```ts
// ceremonyHaptics — one haptic vocabulary with a rolling rate limit (≤ 3 events per
// 1000 ms across every kind), Success at most once per ceremony and a Reduce-Motion
// mode. Guarded require of expo-haptics; every call is a silent no-op without it.
import { useMemo } from 'react';

export type HapticImpact = 'light' | 'medium' | 'heavy' | 'soft' | 'rigid';
export const HAPTIC_RATE_LIMIT = Object.freeze({ maxEvents: 3, windowMs: 1000 });

/** Pure rolling-window limiter. allow() records the event when it returns true. */
export function createHapticLimiter(now: () => number = Date.now): { allow(): boolean; reset(): void };

/** Minimal surface of expo-haptics this module touches. */
export type ExpoHapticsLike = {
  impactAsync(style: unknown): Promise<void>;
  selectionAsync(): Promise<void>;
  notificationAsync(type: unknown): Promise<void>;
  ImpactFeedbackStyle: Record<string, unknown>;
  NotificationFeedbackType: Record<string, unknown>;
};

export type CeremonyHapticsController = {
  tick(): void;                                 // selectionAsync
  impact(style?: HapticImpact): void;           // impactAsync(ImpactFeedbackStyle[Capitalised]); default 'medium'
  success(): void;                              // notificationAsync(NotificationFeedbackType.Success) — at most ONCE per reset()
  reset(opts?: { reduceMotion?: boolean }): void;
  available: boolean;
};

export function loadExpoHaptics(): ExpoHapticsLike | null;   // guarded require('expo-haptics')
export function createCeremonyHapticsController(deps: { haptics: ExpoHapticsLike | null; now?: () => number }): CeremonyHapticsController;
export const ceremonyHapticsAvailable: boolean;
export function getCeremonyHaptics(): CeremonyHapticsController;   // module-level singleton
export function useCeremonyHaptics(): CeremonyHapticsController;   // returns the singleton (useMemo)
```

Semantics (B00 §2.7 + `:405`):

a. **Limiter.** Keep the timestamps of allowed events; `allow()` first drops timestamps `t` with `now() - t >= windowMs`, then returns `false` if `maxEvents` remain, else pushes `now()` and returns `true`. `reset()` empties it. Three events at t=0 → the 4th at t=999 is `false`, at t=1000 it is `true`.
b. **Policy order** in every controller method: (1) module missing → return; (2) Reduce-Motion policy; (3) once-only policy (`success`); (4) `limiter.allow()`; (5) the guarded native call with `.catch(() => {})`. A call dropped by (2) or (3) does not consume a limiter slot.
c. **`reset({ reduceMotion })`** (called by the screen on ceremony mount, B09): `limiter.reset()`, `successUsed = false`, `rmLightUsed = false`, `reduceMotion = !!opts?.reduceMotion`. The controller starts as if `reset()` had been called with `reduceMotion: false`, so today's screen (which never calls `reset`) keeps working.
d. **`impact(style = 'medium')`**: under Reduce Motion, `'light'` is allowed exactly once per `reset()` (the mount cue), `'soft'` is always allowed (still rate-limited), every other style is dropped. Native call: `haptics.impactAsync(haptics.ImpactFeedbackStyle[style.charAt(0).toUpperCase() + style.slice(1)] ?? haptics.ImpactFeedbackStyle.Medium)`.
e. **`success()`**: at most once per `reset()` in both modes (the LEG-only rule is the caller's). Native: `notificationAsync(NotificationFeedbackType.Success)`.
f. **`tick()`**: dropped under Reduce Motion (the RM vocabulary is one Light at mount, Soft per flip, one Success — `release-1.6.0-plan:104`); otherwise rate-limited `selectionAsync()`.
g. `available` = `deps.haptics !== null`. `ceremonyHapticsAvailable = loadExpoHaptics() !== null` at module scope; `getCeremonyHaptics()` builds the singleton once with `{ haptics: loadExpoHaptics() }`; `useCeremonyHaptics()` = `useMemo(() => getCeremonyHaptics(), [])`.

### 3. `mobile/tests/unit/ceremonyAudio.test.ts` (new, ≥ 12 `it(` blocks)

Fake module (define in the test):

```ts
function makeFakeAudio() {
  const players: Array<AudioPlayerLike & { __source: unknown; play: ReturnType<typeof vi.fn>; pause: ReturnType<typeof vi.fn>; seekTo: ReturnType<typeof vi.fn> }> = [];
  const audio: ExpoAudioLike = {
    createAudioPlayer: vi.fn((source: unknown) => {
      const p = { play: vi.fn(), pause: vi.fn(), seekTo: vi.fn(), remove: vi.fn(), volume: 1, loop: false, playing: false, __source: source };
      players.push(p); return p;
    }),
    setAudioModeAsync: vi.fn(async () => {}),
  };
  return { audio, players };
}
const SOURCES = { whoosh: 'whoosh.wav', rip: 'rip.wav', 'card-drop': 'card-drop.wav', 'card-flip': 'card-flip.wav', shimmer: 'shimmer.wav', legendary: 'legendary.wav' };
```

Cases (each its own `it`, titles free):
1. `SFX_ALIASES` has exactly 17 keys, every value is one of the six files, and the six committed names map to themselves.
2. `CEREMONY_GAIN` literal check: `bed` `{ COM: 0.30, RAR: 0.35, LEG: 0.40 }`, `bedTable 0.25`, `duck 0.15`, `hit.rip 0.8`, `hit.stinger 1.0`, `hit.legendary 1.0`, `hit['card-flip'] 0.5`, `tail['soft-chime'] 0.5`.
3. `prewarm()` creates 17 players (one per name) with `__source` equal to the aliased file, and `setAudioModeAsync` called once with `{ playsInSilentMode: true, interruptionMode: 'mixWithOthers' }`; a second `prewarm()` creates none and does not call the mode again.
4. `hit('rip')` → the rip player has `volume 0.8`, `seekTo(0)` and `play()` each called once; `hit('rip', { gain: 0.3 })` → `volume 0.3`.
5. `tail('soft-chime')` → its player (`__source 'shimmer.wav'`) `volume 0.5`, `play()` once.
6. `play('legendary')` behaves as `hit('legendary')` (volume 1.0, seekTo, play).
7. `bed('shimmer-pad', { gain: 0.35, fadeMs: 200 })` with fake timers → player `loop === true`, `play()` called, `volume` `0` at t=0 and `toBeCloseTo(0.35)` after `vi.advanceTimersByTime(200)`.
8. Switching beds: after case 7, `bed('choir-swell', { gain: 0.4 })` → advancing 200 ms leaves the shimmer-pad player at volume `0` with `pause()` called once and the choir-swell player at `0.4`, looping.
9. `duck(0.15, 120)` on an active bed → after 120 ms the bed volume is `toBeCloseTo(0.15)` and `pause` was NOT called; `duck(0, 100)` → `0`, still not paused.
10. `bed(null)` → the active bed fades to 0 and is paused after `BED_FADE_MS`.
11. `stopAll()` → every created player `pause()`d and `seekTo(0)`; a ramp in flight is cancelled (advance 500 ms → volume unchanged from the moment of `stopAll`).
12. Never throws: a fake whose `play` throws and whose `setAudioModeAsync` rejects → `prewarm()`, `hit('rip')`, `bed('air')` return `undefined` without throwing; `createCeremonyAudioController({ audio: null, sources: SOURCES })` → every method is a no-op and no player is created; a controller with `sources: {}` creates no player.
13. Missing sample: `sources` without `legendary` → `hit('stinger')` (aliased to legendary) creates nothing and does not throw.
14. Module singletons: `getCeremonyAudio() === getCeremonyAudio()`; `typeof ceremonyAudioAvailable === 'boolean'`; `useCeremonyAudio()` rendered inside a probe component with `react-test-renderer` returns an object with `play`, `hit`, `bed`, `duck`, `tail`, `stopAll`, `prewarm` functions and a boolean `available`. The file is `.test.ts`, not `.tsx`, so NO JSX: build the probe as a plain function component that stores the hook result in a captured variable, and render it with `renderer.create(React.createElement(Probe))` inside `await act(async () => { … })` — the in-repo pattern is `mobile/tests/unit/featureFlags.test.ts:218-219` and `:245-246`. Do not rename the file to `.test.tsx` (the scope guard lists the `.test.ts` names).

### 4. `mobile/tests/unit/ceremonyHaptics.test.ts` (new, ≥ 9 `it(` blocks)

Fake: `{ impactAsync: vi.fn(async () => {}), selectionAsync: vi.fn(async () => {}), notificationAsync: vi.fn(async () => {}), ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy', Soft: 'soft', Rigid: 'rigid' }, NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' } }` (the same shape as B00 §4.1 item 6) and a manual clock `let t = 0; const now = () => t;`.

1. `HAPTIC_RATE_LIMIT` equals `{ maxEvents: 3, windowMs: 1000 }`.
2. Limiter: 3× `allow()` true at t=0, 4th false; t=999 false; t=1000 true; `reset()` → true again immediately.
3. `impact()` default → `impactAsync('medium')`; `impact('heavy')` → `'heavy'`; `impact('rigid')` → `'rigid'`.
4. Combined rate limit: `tick(); impact('light'); success();` at t=0 all reach the fake (3 calls); a 4th `impact('soft')` at t=10 is dropped; at t=1000 it fires.
5. Success once: `success(); success();` → `notificationAsync` once; `reset()` then `success()` → twice total.
6. Reduce Motion: `reset({ reduceMotion: true })`; `impact('light')` ×2 → `impactAsync` once with `'light'`; `impact('medium')`, `impact('heavy')`, `impact('rigid')` → no further calls; `tick()` → `selectionAsync` not called; `impact('soft')` → fires; `success()` → fires once (that is 3 events: light, soft, success); a 4th `impact('soft')` at t=10 is dropped by the limiter; at t=1000 it fires.
7. Dropped calls don't consume slots: under RM, `impact('heavy')` ×5 then `impact('soft')` ×3 → 3 soft calls.
8. `createCeremonyHapticsController({ haptics: null })` → `available false`, every method no-op, no throw; a fake whose `impactAsync` throws synchronously → `impact()` does not throw; a rejecting `selectionAsync` → `tick()` does not throw (await a microtask to be sure nothing is unhandled).
9. `getCeremonyHaptics() === getCeremonyHaptics()`; `useCeremonyHaptics()` inside a probe component (react-test-renderer) returns the same object as `getCeremonyHaptics()`. Same rule as audio case 14: the file is `.test.ts`, so the probe is rendered with `renderer.create(React.createElement(Probe))` inside `act` — no JSX (`mobile/tests/unit/featureFlags.test.ts:245-246`).

Estimated size: `ceremonyAudio.ts` ≈ 230 LOC, `ceremonyHaptics.ts` ≈ 120 LOC, tests ≈ 300 LOC.

## Acceptance

Run from `mobile/`. `docs/delivery/r16-issues/B04.verify.sh` runs exactly these.

1. `npx vitest run tests/unit/ceremonyAudio.test.ts tests/unit/ceremonyHaptics.test.ts tests/integration/draw-ceremony.screen.test.tsx --reporter=dot` exits 0; the two new files have ≥ 12 and ≥ 9 `it(` blocks.
2. `npm run test:typecheck` exits 0.
3. Literal guards on `src/components/ceremonyAudio.ts`: contains `require('expo-audio')`, `export const SFX_ALIASES`, `export const CEREMONY_GAIN`, `export function createCeremonyAudioController`, `export function prewarmCeremonyAudio`, `export function getCeremonyAudio`, `export function useCeremonyAudio`, `export const ceremonyAudioAvailable`, `playsInSilentMode: true`, `interruptionMode: 'mixWithOthers'`, `'choir-swell': 'legendary'`, `'seam-burst': 'rip'`, `'sparkle-tail': 'shimmer'`, `bedTable: 0.25`, `duck: 0.15`, `stinger: 1.0`, and exactly six occurrences of `require('../../assets/sfx/` (one per committed WAV); does NOT contain `expo-av`, `createAsync`, `playsInSilentModeIOS`, `setInterval(`, `from 'react-native'` (non-type), `eslint-disable`.
4. Literal guards on `src/components/ceremonyHaptics.ts`: contains `require('expo-haptics')`, `export const HAPTIC_RATE_LIMIT = Object.freeze({ maxEvents: 3, windowMs: 1000 })`, `export function createHapticLimiter`, `export function createCeremonyHapticsController`, `export function getCeremonyHaptics`, `export function useCeremonyHaptics`, `reduceMotion`, `notificationAsync`, `selectionAsync`, `impactAsync`; does NOT contain `eslint-disable`, `setInterval(`. Both test files contain `React.createElement(` (the probe of audio case 14 / haptics case 9) and no JSX (`.test.ts` files).
5. Repo-wide: `grep -rn "expo-av" mobile/src` is empty (B01 already removed the package; this issue removes the last reference).
6. Scope + frozen guard: only the four scope files (plus `docs/delivery/r16-issues/*`) differ from the merge-base; frozen files unchanged; `"vite": "7.2.4"` present; no `@sentry`; no `.skip(`/`.only(`/`@ts-ignore`/`eslint-disable` in the diff.

## Do NOT

- Do not edit `DrawCeremonyScreen.tsx`, `DrawScreen.tsx` or any test other than the two new files; B09/B10 wire `bed`/`duck`/`tail`/`reset`/`prewarmCeremonyAudio` into the screens.
- Do not add a static `require` for a sample file that is not committed (`mobile/assets/sfx/` has exactly six WAVs); do not add, rename or convert audio assets; do not touch `mobile/assets/sfx/README.md`.
- Do not `vi.mock('expo-audio')`/`vi.mock('expo-haptics')` in the new tests (it cannot reach the guarded `require`); do not read `globalThis.__ceremonyMocks` from production code.
- Do not import `react-native` at runtime in either module; do not import `react-native-reanimated` or the guard (B02) — these modules are plain JS.
- Do not change `package.json`, `package-lock.json`, `app.json`, `vitest.config.ts` or `tests/setup/*`.
- Standing rules: no `git push`, no PR, never target or touch `main`, no `npm install`/`eas`/`expo prebuild`, no disabling/skipping/gutting tests, no `@ts-ignore`/`@ts-expect-error`/`eslint-disable`, no loosening of `tsconfig`.
