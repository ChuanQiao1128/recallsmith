# B00 — Wave B shared contracts (`r16-b-ceremony`)

The interface contract every Wave B brief (B01–B15) must follow verbatim so that fifteen independently implemented issues assemble into one ceremony. When a brief and this file disagree, this file wins; when this file and the design doc disagree, the resolution is recorded in §9 and this file wins. Base: `delivery/r16-b-ceremony` (== `main@b39b0e8` after Wave A). Every line number below was read on that tree on 2026-09-20.

Sources: spec JSON (15 issues + scope change of 2026-09-20), `docs/release-1.6.0-plan-2026-09-19.md` §1 (:20-55), §2 (:56-82), §3 (:83-194), `docs/delivery-wave-1.6-plan-2026-09-19.md:81-99` (Wave B table) and `:140-156` (gate design).

---

## 0. Non-negotiables (restated from the spec's 2026-09-20 scope change)

- **Sentry is OUT of 1.6.0.** No `@sentry/*` package, no `src/observability/`, no privacy-label change. B01 still adds a root `ErrorBoundary` (`mobile/src/components/RootErrorBoundary.tsx`) that renders a retry screen and logs with `console.error` only.
- **`vite` stays pinned `7.2.4`** (`mobile/package.json:64`, from PR #36). B01's `npm install` must not touch that line; every later verify greps `"vite": "7.2.4"`.
- **`lottie-react-native` and `expo-av` are removed in B01** (`package.json:41`, `:30`). From B02 on, no file under `mobile/src` may `import`/`require` either package; the only files that still reference them after B01 are `mobile/src/components/CeremonyLottie.tsx` (guarded `require('lottie-react-native')` at `:37`) and `mobile/src/components/ceremonyAudio.ts` (guarded `require('expo-av')` at `:41`) — B04 rewrites the latter, B11 deletes the former. Guarded requires keep the bundle building until then because Metro only fails on *static* requires of missing **files**, not missing packages inside `try {}`.
- **`@shopify/react-native-skia` stays exactly `2.2.12`** (`package.json:26`, already exact — B01 must not add `^`).
- **Frozen files, zero diff in every issue** (`mobile/gacha-v7.md` §2.1): `mobile/src/content/deckRepository.ts`, `mobile/src/sync/progressSync.ts`, `mobile/src/review/model.ts`. Every verify.sh has a frozen-file guard.
- **Only B01 changes dependencies** (`package.json` / `package-lock.json`). B01's worker runs `npm install` (not `npm ci`) in its worktree. Verified 2026-09-20 with npm 11.6.0: when `mobile/node_modules` is a symlink, `npm install` **deletes the symlink and materialises a private, real `node_modules` directory inside the worktree** (about 1 GB, 1567 lock entries); the shared `/Users/qc/src/recallsmith/mobile/node_modules` is not touched. Consequences: B01's verify runs against that private directory (a real directory is the expected state, not a defect); **after B01 merges, the driver runs `cd /Users/qc/src/recallsmith/mobile && npm install` on `delivery/r16-b-ceremony` once, before cutting any B02+ worktree**, so the shared tree the later worktrees symlink to gains the six packages and loses the two removed ones. No verify.sh runs `npm install`/`npm ci`/`eas`/anything with network. `fast-check ^4.9.0` is already a devDependency (`package.json:61`) — B03 uses it without adding anything.
- **No `babel.config.js`.** None exists today; `babel-preset-expo` (SDK 54) applies `react-native-worklets/plugin` automatically when the package is installed. B01 must not create one (double-applying the plugin breaks worklets). If `expo prebuild` ever demands one, it is `{ presets: ['babel-preset-expo'] }` and nothing else.
- Banned in any new identifier, comment or string under `mobile/src`, `frontend/src`, `src_C`: `humanizer`, `bypass`, `undetect`, `detector`, `evade`, `Gemini said`. The driver grep is **case-insensitive** (`grep -iqE`); the wave's `wave.conf` anchors the term as `\bdetector` (word start), so react-native-gesture-handler's `GestureDetector` does NOT match and may be spelled normally. The guard still exposes it under the alias `GestureHandler.PanHost` (§2.1, §9 #15) so consumers share one name. Use "skip", "escape hatch", "guard", "fallback", "probe" instead of the other terms.
- No `@ts-ignore`, `eslint-disable`, `.skip(`, `.only(` in any diff.

---

## 1. File map

"C" = creates, "E" = edits, "D" = deletes. An editor of a file created by another issue must list the creator among its deps (§5). Paths are repo-relative.

| Path | B01 | B02 | B03 | B04 | B05 | B06 | B07 | B08 | B09 | B10 | B11 | B12 | B13 | B14 | B15 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `mobile/package.json`, `mobile/package-lock.json` | E | | | | | | | | | | | | | | |
| `mobile/app.json` | E | | | | | | | | | | | | | | |
| `mobile/App.tsx` | E | | | | | | | | | | | | E | | E |
| `mobile/src/components/RootErrorBoundary.tsx` | C | | | | | | | | | | | | | | |
| `mobile/tests/unit/rootErrorBoundary.test.tsx` | C | | | | | | | | | | | | | | |
| `mobile/src/components/ceremony/reanimatedGuard.ts` | | C | | | | | | | | | | | | | |
| `mobile/src/features/gacha/draw/ceremonyTimings.ts` | | C | | | | | | | | | | | | | |
| `mobile/tests/setup/ceremony.ts` | | C | | | | | | | | | | | | | |
| `mobile/vitest.config.ts` | | E | | | | | | | | | | | | | |
| `mobile/src/config/featureFlags.ts` | | E | | | | | | | | | | | | | |
| `mobile/tests/unit/featureFlags.test.ts` | | E | | | | | | | | | | | | | |
| `mobile/tests/unit/ceremonyTimings.test.ts` | | C | | | | | | | | | | | | | |
| `mobile/tests/unit/reanimatedGuard.test.tsx` | | C | | | | | | | | | | | | | |
| `mobile/src/features/gacha/draw/spillSchedule.ts` | | | C | | | | | | | | | | | | |
| `mobile/src/features/gacha/draw/skipPolicy.ts` | | | C | | | | | | | | | | | | |
| `mobile/src/features/gacha/draw/ceremonyPrefs.ts` | | | C | | | | | | | | | | | | |
| `mobile/tests/unit/{spillSchedule,skipPolicy,ceremonyPrefs}.test.ts` | | | C | | | | | | | | | | | | |
| `mobile/src/components/ceremonyAudio.ts` | | | | E (rewrite) | | | | | | | | | | | |
| `mobile/src/components/ceremonyHaptics.ts` | | | | E (rewrite) | | | | | | | | | | | |
| `mobile/tests/unit/{ceremonyAudio,ceremonyHaptics}.test.ts` | | | | C | | | | | | | | | | | |
| `mobile/src/components/ceremony/StageCanvas.tsx` | | | | | C | | | | | | | | | | |
| `mobile/tests/unit/stageCanvas.test.tsx` | | | | | C | | | | | | | | | | |
| `mobile/src/components/ceremony/PackTear.tsx` | | | | | | C | | | | | | | | | |
| `mobile/src/theme/packArt.ts` | | | | | | E (append `SEAM_BAND_RATIO` only, at EOF) | | | | | | E | | | |
| `mobile/tests/unit/packTear.test.tsx` | | | | | | C | | | | | | | | | |
| `mobile/src/components/ceremony/useCeremonyTimeline.ts` | | | | | | | C | | | | | | | | |
| `mobile/tests/unit/useCeremonyTimeline.test.ts` | | | | | | | C | | | | | | | | |
| `mobile/src/components/ceremony/TapCard.tsx` | | | | | | | | C | | | | | | | |
| `mobile/src/components/ceremony/FoilLayer.tsx` | | | | | | | | C | | | | | | | |
| `mobile/src/components/ceremony/ceremonyStyles.ts` | | | | | | | | C (tapCard* subset) | E (screen styles) | | E (trim) | | | | |
| `mobile/src/components/HolographicLayer.tsx` | | | | | | | | E (reduce to re-export shim) | | | D | | | | |
| `mobile/tests/unit/{tapCard,foilLayer}.test.tsx` | | | | | | | | C | | | E (foilLayer only: delete the shim case) | | | | |
| `mobile/src/features/gacha/draw/ceremonyCopy.ts` | | | | | | | | | | E | | | | | |
| `mobile/src/navigation/types.ts` | | | | | | | | | | E (DrawCeremony/DrawResult params) | | | E (`CeremonyTuning` route only) | | |
| `mobile/src/screens/DrawResultScreen.tsx` | | | | | | | | | | E | | | | | E |
| `mobile/src/screens/DrawScreen.tsx` | | | | | | | | | | E | | | | | |
| `mobile/tests/integration/draw-result.screen.test.tsx` | | | | | | | | | | E | | | | | E |
| `mobile/src/screens/DrawCeremonyScreen.tsx` | | | | | | | | | E (rewrite) | | E (shadowRadius only) | | | | |
| `mobile/src/components/ceremony/FallbackStage.tsx` | | | | | | | | | C | | | | | | |
| `mobile/src/components/ceremony/SpillSampler.tsx` | | | | | | | | | C | | | | | | |
| `mobile/src/components/ceremony/FeaturedCard.tsx` | | | | | | | | | C | | E (trim) | | | | |
| `mobile/tests/integration/draw-ceremony.screen.test.tsx` | | | | | | | | | E | | | | | | |
| `mobile/src/components/CeremonyLottie.tsx` | | | | | | | | | | | D | | | | |
| `mobile/assets/lottie/` (dir), `mobile/scripts/gen_lottie.py` | | | | | | | | | | | D | | | | |
| gacha-tree files with `shadowRadius >= 16` (§7.4 list) | | | | | | | | | | | E | | | | |
| `mobile/scripts/{gen_card_frames,gen_card_back,gen_particles}.py` | | | | | | | | | | | | C | | | |
| `mobile/assets/ui/*` (§6) | | | | | | | | | | | | C | | | |
| `mobile/assets/packs/{ai,cloud,aws,premium-deck,default}-back.png` | | | | | | | | | | | | C | | | |
| `mobile/tests/unit/packArt.test.ts` | | | | | | | | | | | | E | | | |
| `mobile/src/screens/dev/CeremonyTuning.tsx` | | | | | | | | | | | | | C | | |
| `mobile/src/screens/DebugMenuScreen.tsx` | | | | | | | | | | | | | E | | |
| `mobile/tests/unit/ceremonyTuning.test.tsx` | | | | | | | | | | | | | C | | |
| `mobile/docs/qa/animation-quality-rubric.md` | | | | | | | | | | | | | | E (rewrite) | |
| `mobile/docs/design/v10-ceremony-seam-of-light.md` | | | | | | | | | | | | | | C | |
| `mobile/docs/design/v9-draw-final-spec-and-qa.md` (superseded banner only; the spec's `v9-copy-delta.md` also gets the banner) | | | | | | | | | | | | | | E | |
| `LICENSE-ASSETS` (repo root), `mobile/assets/sfx/LICENSES.md` | | | | | | | | | | | | | | C | |
| `mobile/src/features/gacha/share/shareDraw.ts` | | | | | | | | | | | | | | | C |
| `mobile/src/features/gacha/milestones/ratingPrompt.ts` | | | | | | | | | | | | | | | C |
| `mobile/src/navigation/linking.ts` | | | | | | | | | | | | | | | C |
| `mobile/tests/unit/{shareDraw,ratingPrompt,linking}.test.ts` | | | | | | | | | | | | | | | C |

Deviations from the spec's scope lists, all deliberate (reasons in §9): B08 creates `ceremonyStyles.ts` (not B11); B09 creates `FallbackStage.tsx`, `SpillSampler.tsx`, `FeaturedCard.tsx`; B11 becomes deletion + trimming; B13 may touch `App.tsx` for one `Stack.Screen`; B15 creates `navigation/linking.ts`; B14 puts the superseded banner on `v9-draw-final-spec-and-qa.md` as the design doc says (`release-1.6.0-plan:175`) **and** on `v9-copy-delta.md` as the spec says.

---

## 2. Exported APIs (signatures are verbatim contracts)

Shared type vocabulary (every module imports these from where they are defined; never redeclare with a different shape):

```ts
// ceremonyTimings.ts (B02) owns these two — DrawCeremonyScreen.tsx:55-64 defines them locally today; B09 deletes the local copies.
export type CeremonyPhase =
  | 'swipe' | 'approach' | 'hold' | 'tear-flip' | 'flash-reveal' | 'settle' | 'cards-on-table';
export type PeakRarity = 'COM' | 'RAR' | 'LEG';
// cardRarity.ts:3 already exports `Rarity` with the same members — PeakRarity is an alias kept for the ceremony vocabulary:
export type { Rarity } from './cardRarity'; // PeakRarity = Rarity
```

### 2.1 `mobile/src/components/ceremony/reanimatedGuard.ts` (B02)

Pattern: the guarded `require` of `HolographicLayer.tsx:23-33`, extended to three packages and one explicit test override.

```ts
import type React from 'react';

/** `{ value: T }` — the only shape any Wave B module may assume for a shared value. */
export type SharedValue<T> = { value: T };

/**
 * ONE discriminant (design §3, "一个判别量 motionAvailable"): true only when
 * react-native-reanimated, react-native-worklets AND @shopify/react-native-skia all
 * `require()` without throwing AND no test override is set. Chooses BOTH the timing
 * table (DEVICE vs TEST_BASE, ceremonyTimings.ts) and the renderer ('skia' vs 'fallback').
 * Read order: (1) `globalThis.__CEREMONY_MOTION_AVAILABLE__` when it is exactly `false`
 * (tests/setup/ceremony.ts sets it to false) → no motion, the requires are skipped;
 * (2) anything else (undefined, true, garbage) → the guarded requires decide. The override
 * can deny motion; it can never fake a native module. Module-level constant; never re-evaluated.
 */
export const motionAvailable: boolean;
/** Skia alone loaded (used by FoilLayer/StageCanvas to decide whether a Canvas can mount). */
export const skiaAvailable: boolean;

/** Guarded Reanimated surface. Every function has a deterministic no-op fallback when
 *  motionAvailable is false: useSharedValue → useRef({value}).current; withTiming/withSpring/
 *  withDelay/withRepeat/withSequence return their (final) target value immediately;
 *  cancelAnimation → void; runOnJS(fn) → fn; useAnimatedStyle(fn) → fn() (plain object);
 *  useDerivedValue(fn) → { value: fn() } recomputed per render; useAnimatedReaction → void;
 *  interpolate / interpolateColor → pure JS implementations; Easing.* → identity curves with
 *  the same shape (Easing.bezier(a,b,c,d) returns (t)=>t). */
export const Reanimated: {
  useSharedValue<T>(init: T): SharedValue<T>;
  useDerivedValue<T>(fn: () => T, deps?: unknown[]): SharedValue<T>;
  useAnimatedStyle<T extends object>(fn: () => T, deps?: unknown[]): T;
  useAnimatedReaction<T>(prepare: () => T, react: (v: T, prev: T | null) => void, deps?: unknown[]): void;
  withTiming(to: number, cfg?: { duration?: number; easing?: (t: number) => number }, cb?: (finished?: boolean) => void): number;
  withSpring(to: number, cfg?: Record<string, number>, cb?: (finished?: boolean) => void): number;
  withDelay(ms: number, anim: number): number;
  withSequence(...anims: number[]): number;
  withRepeat(anim: number, times?: number, reverse?: boolean): number;
  cancelAnimation(sv: SharedValue<number>): void;
  runOnJS<F extends (...a: any[]) => any>(fn: F): F;
  interpolate(v: number, input: number[], output: number[]): number;
  interpolateColor(v: number, input: number[], output: string[]): string;
  Easing: { bezier(a: number, b: number, c: number, d: number): (t: number) => number; linear: (t: number) => number; out(e: (t: number) => number): (t: number) => number; in(e: (t: number) => number): (t: number) => number; cubic: (t: number) => number; quad: (t: number) => number };
  /** Animated.View or RN View when unavailable. */
  View: React.ComponentType<any>;
  createAnimatedComponent<P>(c: React.ComponentType<P>): React.ComponentType<P>;
};

/** Guarded react-native-gesture-handler surface. `PanHost` IS the library's gesture host
 *  component (the one that takes `gesture={…}` and wraps the gestured subtree); it renders
 *  its children unchanged and `Gesture.Pan()` returns an inert chainable builder when
 *  unavailable. The member is named `PanHost` (an alias for the library's `GestureDetector`,
 *  read directly: `PanHost: loaded.gestureHandler.GestureDetector`). The driver's banned-term
 *  gate anchors its term at a word start (`\bdetector`, §0 / §7.5), so `GestureDetector` is
 *  allowed in code and comments. Consumers: B06 PackTear, B08 TapCard. */
export const GestureHandler: {
  available: boolean;
  PanHost: React.ComponentType<{ gesture: unknown; children?: React.ReactNode }>;
  Gesture: { Pan(): any; Tap(): any };
};

/** Guarded Skia namespace (the module object or null). Components must read
 *  `Skia.Canvas`, `Skia.Group`, `Skia.Rect`, `Skia.RoundedRect` (NOT RoundRect), `Skia.Image`,
 *  `Skia.Atlas`, `Skia.SweepGradient`, `Skia.RadialGradient`, `Skia.LinearGradient`,
 *  `Skia.Path`, `Skia.Shader`, `Skia.useImage`, `Skia.Skia` (the API object), `Skia.vec`,
 *  `Skia.rect`, `Skia.rrect` from here. NEVER destructure `useClock` or `useDerivedValue`
 *  from it: `useClock` (lib/module/external/reanimated/interpolators.js:27) goes through
 *  Skia's ReanimatedProxy and `useDerivedValue` is not a Skia export — that pair is the
 *  HolographicLayer.tsx:65-78 crash (destructured at :65-72, called at :74-79). */
export const SkiaModule: any | null;
```

`tests/setup/ceremony.ts` sets `globalThis.__CEREMONY_MOTION_AVAILABLE__ = false` before any import, so under vitest `motionAvailable === false` regardless of how the mocked packages load.

### 2.2 `mobile/src/features/gacha/draw/ceremonyTimings.ts` (B02, pure)

TEST_BASE is byte-for-byte today's base table (`DrawCeremonyScreen.tsx:97-125`, asserted by `draw-ceremony.screen.test.tsx:73-92` `MULTI_TIMING`/`SINGLE_TIMING`/`REDUCED_TIMING`). DEVICE comes from design §3.1 rows S1–S6/M1–M6 and §3.7 "ceremonyTimings" row, with one correction (§9 #3: multi approach 900, not 920).

```ts
export type CeremonyTimingTable = {
  single: { approach: number; hold: Record<PeakRarity, number>; tearFlip: number; flashReveal: number; settleMs: number };
  multi:  { approach: number; hold: Record<PeakRarity, number>; tearFlip: number; flashReveal: number; settleMs: number };
  /** settle → 'cards-on-table' (or goResult when tapFlow is off) delay after settleMs. */
  tableTailMs: number;
  /** Silence beat: the last beatMs of hold (§2 "Silence before the hit"; §3.1 S2/M2). */
  beatMs: Record<PeakRarity, number>;
  /** Per-tap flip rotate duration on the table (§3.1 S6). */
  flipMs: Record<PeakRarity, number>;
  /** Post-landing rim settle before the next queued tap may start its flip (§3.1 S6). */
  rimSettleMs: Record<PeakRarity, number>;
  liftMs: number; landMs: number; tapQueueMs: number;
};

export const TEST_BASE: CeremonyTimingTable = Object.freeze({
  single: { approach: 300, hold: { COM: 140, RAR: 180, LEG: 220 }, tearFlip: 360, flashReveal: 220, settleMs: 200 },
  multi:  { approach: 620, hold: { COM: 220, RAR: 260, LEG: 300 }, tearFlip: 940, flashReveal: 280, settleMs: 300 },
  tableTailMs: 500,                       // today's non-Lottie autoAdvanceTail, DrawCeremonyScreen.tsx:758
  beatMs: { COM: 0, RAR: 0, LEG: 0 },
  flipMs: { COM: 0, RAR: 0, LEG: 0 },
  rimSettleMs: { COM: 0, RAR: 0, LEG: 0 },
  liftMs: 0, landMs: 0, tapQueueMs: 90,
});

export const DEVICE: CeremonyTimingTable = Object.freeze({
  single: { approach: 600, hold: { COM: 360, RAR: 620, LEG: 880 }, tearFlip: 600, flashReveal: 320, settleMs: 520 },
  multi:  { approach: 900, hold: { COM: 600, RAR: 860, LEG: 1100 }, tearFlip: 1800, flashReveal: 400, settleMs: 600 },
  tableTailMs: 200,
  beatMs: { COM: 120, RAR: 180, LEG: 300 },        // §2 band 120–250 / LEG 250–400
  flipMs: { COM: 380, RAR: 480, LEG: 640 },
  rimSettleMs: { COM: 800, RAR: 1000, LEG: 1200 },
  liftMs: 80, landMs: 200, tapQueueMs: 90,
});

/** Device ceilings for swipe-release → 'cards-on-table' (wave plan B02 row; design DoD "§3D ceilings").
 *  LEG single = 600+880+600+320+520+200 = 3120 ≤ 3300; LEG multi = 900+1100+1800+400+600+200 = 5000 ≤ 5500. */
export const TO_TABLE_CAP_MS = Object.freeze({ single: 3300, multi: 5500 });

export const REDUCED_MOTION_FLASH_MS = 180;   // DrawCeremonyScreen.tsx:68
export const REDUCED_MOTION_SETTLE_MS = 240;  // :69
export const SWIPE_TRIGGER_DISTANCE = 72;     // :67
/** Colour tell finishes at this fraction of hold (§3.1 S2 "first 60% of hold"). */
export const TELL_FRACTION_OF_HOLD = 0.6;
/** Fast-forward becomes available at this fraction of hold (§3.1 FF). */
export const FAST_FORWARD_FROM_HOLD_FRACTION = 0.6;
/** Compressed tear/spill run at this speed-up (§3.1 "FF / RM / fallback for multi": 1.6×). */
export const FAST_FORWARD_TEAR_FACTOR = 1.6;
/** Spill: stagger between card departures, and the fraction of tearFlip at which the fan starts / travel length (§3.1 M3). */
export const SPILL_STAGGER_MS = 60;
export const SPILL_START_FRACTION = 0.5;      // 900 of 1800
export const SPILL_TRAVEL_FRACTION = 1 / 6;   // 300 of 1800

export type ResolvedCeremonyTimings = {
  table: 'TEST_BASE' | 'DEVICE';
  isMulti: boolean; peakRarity: PeakRarity;
  approach: number; hold: number; tearFlip: number; flashReveal: number; settleMs: number; tableTailMs: number;
  beatMs: number;                      // for peakRarity
  flipMs: Record<PeakRarity, number>; rimSettleMs: Record<PeakRarity, number>;
  liftMs: number; landMs: number; tapQueueMs: number;
  /** approach + hold + tearFlip + flashReveal + settleMs + tableTailMs */
  toTableMs: number;
};

/** motionAvailable false → TEST_BASE; true → DEVICE merged with the __DEV__ override (B13). */
export function resolveCeremonyTimings(input: { isMulti: boolean; peakRarity: PeakRarity; motionAvailable: boolean }): ResolvedCeremonyTimings;

/** Same shape DrawCeremonyScreen.tsx:97-125 returns today: swipe 0, 'cards-on-table' 0. */
export function phaseDurations(t: ResolvedCeremonyTimings): Record<CeremonyPhase, number>;

/** Rescheduled remaining durations after a 'compress' decision taken at `elapsedInHoldMs`:
 *  hold → max(0, beatMs − already-elapsed-in-beat) i.e. only the silence beat remains;
 *  tearFlip → round(tearFlip / FAST_FORWARD_TEAR_FACTOR); flashReveal, settleMs, tableTailMs unchanged. */
export function compressTimings(t: ResolvedCeremonyTimings, elapsedInHoldMs: number): ResolvedCeremonyTimings;

/** __DEV__-only in-memory override consumed by resolveCeremonyTimings when table === 'DEVICE'
 *  (CeremonyTuning sliders, B13). Outside __DEV__ it is a no-op. null clears. */
export function setCeremonyTimingOverride(override: Partial<CeremonyTimingTable> | null): void;
export function getCeremonyTimingOverride(): Partial<CeremonyTimingTable> | null;
```

B02's unit test (`tests/unit/ceremonyTimings.test.ts`) asserts, for DEVICE: `hold.COM < hold.RAR < hold.LEG` (single and multi); every adjacent hold tier gap ≥ 240 ms; anticipation = approach + hold: single COM ∈ [600, 1200], single RAR/LEG and every multi tier ∈ [1200, 2000] (§2 row 2); `toTableMs` ≤ `TO_TABLE_CAP_MS` for all six (isMulti × rarity) combinations; `beatMs` ≤ `hold × (1 − TELL_FRACTION_OF_HOLD)` for every tier (the beat fits after the tell); and that `resolveCeremonyTimings({motionAvailable:false})` equals TEST_BASE literally (`{approach:300, hold:180, tearFlip:360, flashReveal:220, settleMs:200, tableTailMs:500}` for single RAR, `{620, 300, 940, 280, 300, 500}` for multi LEG).

### 2.3 `mobile/src/features/gacha/draw/spillSchedule.ts` (B03, pure)

```ts
export type SpillEntry = { index: number; leaveAt: number; landAt: number; slot: number };
export type SpillSchedule = { entries: SpillEntry[]; startMs: number; travelMs: number; staggerMs: number; featuredIndex: number };

/** Which card is dealt last, to the centre slot: first LEG, else first RAR, else index 0
 *  (same rule as pickFeaturedCard, DrawCeremonyScreen.tsx:133-140). Returns -1 for an empty list. */
export function featuredCardIndex(cards: ReadonlyArray<{ rarity: PeakRarity }>): number;

/** Slot the featured card lands on: the middle of the top row —
 *  rowLength = count <= 5 ? count : ceil(count / 2); centreSlot = floor((rowLength − 1) / 2). */
export function centreSlot(count: number): number;

/**
 * Deal schedule for `cards.length` cards (1..10) inside a tear phase of `tearMs`.
 * startMs = round(tearMs × SPILL_START_FRACTION); travelMs = round(tearMs × SPILL_TRAVEL_FRACTION);
 * staggerMs = count <= 1 ? 0 : min(SPILL_STAGGER_MS, floor((tearMs − startMs − travelMs) / (count − 1)));
 * order: non-featured cards in index order, featured card LAST; entry i: leaveAt = startMs + order × staggerMs,
 * landAt = leaveAt + travelMs; slot = centreSlot(count) for the featured card, the remaining slots in
 * index order for the others. Invariants (property-tested with fast-check): entries.length === count
 * (never padded to 6 — replaces DrawCeremonyScreen.tsx:828-836); every landAt ≤ tearMs; slots are a
 * permutation of 0..count−1; featured card has the greatest leaveAt; leaveAt is non-decreasing in order.
 * DEVICE multi (tearMs 1800): startMs 900, travelMs 300, staggerMs 60. TEST_BASE (940): 470, 157, 34.
 */
export function buildSpillSchedule(cards: ReadonlyArray<{ rarity: PeakRarity }>, tearMs: number): SpillSchedule;
```

### 2.4 `mobile/src/features/gacha/draw/skipPolicy.ts` (B03, pure)

```ts
/** 'none' = no visible fast-forward control; 'compress' = show the × / accept a stage tap that compresses
 *  the timeline (§3.1 FF). There is NO 'goResult' member — the policy can never leave the ceremony. */
export type SkipDecision = 'none' | 'compress';

export type SkipPolicyInput = {
  ceremoniesCompleted: number;    // ceremonyPrefs, fail-closed 0
  phase: CeremonyPhase;
  phaseElapsedMs: number;         // ms since the current phase started
  phaseDurationMs: number;        // scheduled duration of the current phase
  reduceMotion: boolean;
  alreadyCompressed: boolean;
};

/** Rules: reduceMotion → 'none'; ceremoniesCompleted < 1 → 'none' (first-ever ceremony shows nothing
 *  before settle); alreadyCompressed → 'none'; phase 'swipe'|'approach' → 'none'; 'hold' →
 *  phaseElapsedMs >= FAST_FORWARD_FROM_HOLD_FRACTION × phaseDurationMs ? 'compress' : 'none';
 *  'tear-flip'|'flash-reveal' → 'compress'; 'settle'|'cards-on-table' → 'none' (the CTA owns those). */
export function skipPolicy(input: SkipPolicyInput): SkipDecision;
```

### 2.5 `mobile/src/features/gacha/draw/ceremonyPrefs.ts` (B03)

AsyncStorage pattern of `drawStateStore.ts:227-241` (`loadDrawState`) (getItem + parse in try/catch). Device-global key (ceremony familiarity is per device, not per account).

```ts
export const CEREMONY_PREFS_KEY = 'recallsmith:ceremony:completed:v1';
export const CEREMONY_PREFS_READ_TIMEOUT_MS = 250;

/** Fail-closed: any error, non-integer, negative value, or a read slower than the timeout resolves 0
 *  ("first ceremony" = no visual skip before settle). Never throws. */
export function readCeremoniesCompleted(): Promise<number>;
/** `readCeremoniesCompleted() + 1`, written back with setItem, returned. Write errors are swallowed
 *  (the promise still resolves with the incremented number) but NOTHING is retained in memory:
 *  storage is the only source of truth and the next read re-reads it. */
export function markCeremonyCompleted(): Promise<number>;

export type CeremonyDevOverrides = { forceRepeat: boolean; forceFallback: boolean };
/** In-memory, __DEV__-only. Outside __DEV__ setters are no-ops and the getter returns all-false. */
export function getCeremonyDevOverrides(): CeremonyDevOverrides;
export function setCeremonyDevOverride<K extends keyof CeremonyDevOverrides>(key: K, value: boolean): void;
/** ceremoniesCompleted as the screen should use it: forceRepeat (dev) → max(stored, 1). */
export function effectiveCeremoniesCompleted(stored: number): number;
```

**No module-level memo of the count** (no `let` at module scope in this file; the only module state is the dev-override object). Every `readCeremoniesCompleted()` hits AsyncStorage; a timed-out, thrown or failed-write result is never cached. This is what keeps §4.2 honest: the integration file's case 1 presses `'Continue'` (→ `markCeremonyCompleted()`) and case 8 assumes a first-ever ceremony with the statically imported screen — under that file's `react-native` mock the real AsyncStorage rejects, so with no in-memory count every case reads 0 whatever ran before it, and case order never matters.

### 2.6 `mobile/src/components/ceremonyAudio.ts` (B04, rewrite on `expo-audio`)

Three layers (§2 "Sound in three layers"), guarded `require('expo-audio')` (never `expo-av`), prewarm, per-name gain table, fire-and-forget, never throws. **Test observability (resolved 2026-09-20):** `vi.mock('expo-audio')` never intercepts a CJS `require`, so the players B02's setup file collects at `globalThis.__ceremonyMocks.audio.players` (§4.1 item 5) are NOT how B04's tests observe this module — that mock is only a safety net against an accidental static `import 'expo-audio'` elsewhere. B04 keeps the guarded require and exposes a dependency-injected factory (`createCeremonyAudioController(deps)`); its tests inject fakes through the factory and never `vi.mock('expo-audio')`. Production code never reads `globalThis.__ceremonyMocks`. `useCeremonyAudio().play(name)` remains as an alias of `hit(name)` so nothing else breaks (only `DrawCeremonyScreen.tsx:443` calls it today).

```ts
export type CeremonyBedName = 'crinkle' | 'air' | 'shimmer-pad' | 'choir-swell';
export type CeremonyHitName =
  | 'whoosh' | 'rip' | 'card-slide' | 'stack-thud' | 'seam-burst' | 'card-flip' | 'card-drop'
  | 'chime' | 'stinger' | 'shimmer' | 'legendary';
export type CeremonyTailName = 'sparkle-tail' | 'soft-chime';
export type CeremonySfxName = CeremonyBedName | CeremonyHitName | CeremonyTailName;
export type CeremonyAudioLayer = 'bed' | 'hit' | 'tail';

/** Committed sample files today: whoosh, rip, card-drop, card-flip, shimmer, legendary (mobile/assets/sfx).
 *  Names without a committed file are ALIASED to a committed one here (static requires of missing files
 *  break Metro): crinkle→shimmer, air→shimmer, shimmer-pad→shimmer, choir-swell→legendary, card-slide→card-drop,
 *  stack-thud→card-drop, seam-burst→rip, chime→shimmer, stinger→legendary, sparkle-tail→shimmer, soft-chime→shimmer.
 *  The owner replaces aliases with sourced files at wave end (B14's LICENSES.md lists the intended file names). */
export const SFX_ALIASES: Readonly<Record<CeremonySfxName, 'whoosh' | 'rip' | 'card-drop' | 'card-flip' | 'shimmer' | 'legendary'>>;

/** Gain by layer and rarity (0..1). bed: COM .30 RAR .35 LEG .40; table ambience .25; duck target .15 (≈ −12 dB
 *  relative to .60); hit: whoosh .6, rip .8, card-slide .5, stack-thud .6, seam-burst .7, card-flip .5, card-drop .5,
 *  chime .8, stinger 1.0, shimmer .7, legendary 1.0; tail: sparkle-tail .5, soft-chime .5. */
export const CEREMONY_GAIN: Readonly<{ bed: Record<PeakRarity, number>; bedTable: number; duck: number; hit: Record<CeremonyHitName, number>; tail: Record<CeremonyTailName, number> }>;

export type CeremonyAudioController = {
  /** Loads every source into a player once (module-level cache), sets the audio mode
   *  ({ playsInSilentMode: true, interruptionMode: 'mixWithOthers' }) once. Idempotent. */
  prewarm(): void;
  /** Start/replace the looping bed (crossfade `fadeMs`, default 200); null stops it. */
  bed(name: CeremonyBedName | null, opts?: { gain?: number; fadeMs?: number }): void;
  /** Ramp the bed to `gain` over `ms` (silence beat: duck to CEREMONY_GAIN.duck; 0 = mute). */
  duck(gain: number, ms: number): void;
  hit(name: CeremonyHitName, opts?: { gain?: number }): void;
  tail(name: CeremonyTailName, opts?: { gain?: number }): void;
  /** Legacy alias of hit(). */
  play(name: CeremonySfxName): void;
  stopAll(): void;
};
export const ceremonyAudioAvailable: boolean;
export function prewarmCeremonyAudio(): void;         // DrawScreen mount (B10)
export function getCeremonyAudio(): CeremonyAudioController;
export function useCeremonyAudio(): CeremonyAudioController & { available: boolean };
```

**Additive exports recorded from the B04 brief (not drift):** `loadExpoAudio(): ExpoAudioLike | null` (the guarded `require('expo-audio')`), `loadSfxSources(): Partial<Record<CeremonySfxFile, unknown>>` (the six guarded asset requires), `createCeremonyAudioController(deps: { audio: ExpoAudioLike | null; sources: Partial<Record<CeremonySfxFile, unknown>> }): CeremonyAudioController` (the DI factory the tests use — §9 #13: `vi.mock` cannot reach a guarded `require`), the types `AudioPlayerLike`, `ExpoAudioLike`, `CeremonySfxFile` (`'whoosh' | 'rip' | 'card-drop' | 'card-flip' | 'shimmer' | 'legendary'`) and `BED_FADE_MS` (the default bed crossfade, 200). `Rarity` from `cardRarity.ts` stands in for `PeakRarity` (same members; B04 does not depend on B02).

### 2.7 `mobile/src/components/ceremonyHaptics.ts` (B04, rewrite)

```ts
export type HapticImpact = 'light' | 'medium' | 'heavy' | 'soft' | 'rigid';
export const HAPTIC_RATE_LIMIT = Object.freeze({ maxEvents: 3, windowMs: 1000 });

/** Pure limiter for tests: `allow()` returns false when 3 events already happened in the rolling window. */
export function createHapticLimiter(now: () => number = Date.now): { allow(): boolean; reset(): void };
// Same test rule as §2.6: guarded `require('expo-haptics')` is not reachable by `vi.mock`, so
// B04's tests inject a fake through `createCeremonyHapticsController(deps)`; the spies in
// `globalThis.__ceremonyMocks.haptics` (§4.1 item 6) are a safety net for accidental static imports only.

export type CeremonyHapticsController = {
  tick(): void;                                 // selectionAsync
  impact(style?: HapticImpact): void;           // impactAsync(ImpactFeedbackStyle[...]); default 'medium' (today's :44)
  success(): void;                              // notificationAsync(Success) — at most ONCE per reset()
  /** Call on ceremony mount. reduceMotion: true permits exactly one 'light' impact (the mount cue),
   *  unlimited 'soft' (still rate-limited), one success; every other impact style is dropped. */
  reset(opts?: { reduceMotion?: boolean }): void;
  available: boolean;
};
export const ceremonyHapticsAvailable: boolean;
export function getCeremonyHaptics(): CeremonyHapticsController;
export function useCeremonyHaptics(): CeremonyHapticsController;
```

Rate limit applies to every event kind combined (≤ 3 per rolling 1000 ms). The LEG-only rule for `success()` is the caller's (B09/B08 call it only for LEG); once-per-ceremony is enforced here. **Under `reduceMotion` `tick()` is dropped** (the RM vocabulary is one Light at mount, Soft per flip, one Success — design §3.1 RM row); a call dropped by the RM or once-only policy never consumes a limiter slot.

**Additive exports recorded from the B04 brief (not drift):** `loadExpoHaptics(): ExpoHapticsLike | null`, `createCeremonyHapticsController(deps: { haptics: ExpoHapticsLike | null; now?: () => number }): CeremonyHapticsController` (DI factory for tests) and the type `ExpoHapticsLike`.

### 2.8 `mobile/src/components/ceremony/StageCanvas.tsx` (B05)

ONE Skia `Canvas` for the stage light (design §3.5; the pack image the design lists in the same canvas lives in B06's own canvas — §7.3 budget of three). Renders `null` when `!skiaAvailable`. Never mounts the flash `Rect` when `reduceMotion`.

```ts
export type StageCanvasProps = {
  width: number; height: number;
  peakRarity: PeakRarity;
  timeline: CeremonyTimeline;                 // §2.10
  reduceMotion: boolean;
  /** RN asset sources (packArt.ts, B12); loaded here with SkiaModule.useImage; null → that layer is skipped. */
  particleSheet?: ImageSourcePropType;
  glowNineSlice?: ImageSourcePropType;
  cardCount: number;                          // rims to draw (≤ 10)
  testID?: string;                            // B09 passes 'draw-ceremony-stage-canvas'
};
export const STAGE_TESTID = 'draw-ceremony-stage-canvas';
export const RAY_COUNT = 12;
export const RAY_REVOLUTION_MS = 14000;       // §3.1 S0 "14 s/rev", linear
export const MAX_PARTICLES = 120;             // §3.5 "Atlas ≤ 120 sprites"
export function StageCanvas(props: StageCanvasProps): React.JSX.Element | null;   // React.JSX — §9 #19
```

Layer order (bottom → top): vignette (`RadialGradient`, alpha = `dim`), rays (`SweepGradient`, 24 alternating stops, rotation = `raysAngle`, alpha = `rays`), halo (`RadialGradient`, colour = `haloColor` derived from `tell`), seam light-leak rect (`BlendMode` `plus`, alpha = `leak`), face-down rims (`RoundedRect` stroke per card, alpha = `rim[i]`), particles (`Atlas`), flash rect (alpha = `flash`; not mounted under RM). **Units/origin (binding, §2.10):** `raysAngle` is in **radians** (0 → 2π per revolution) and is passed straight to Skia `rotate`; `spill[i].x/.y` are **offsets from the stage centre in pt** and `spill[i].rot` is in **radians**, so every per-card rim `Group` is nested inside one `<Group transform={[{ translateX: width / 2 }, { translateY: height / 2 }]}>` origin group — never used as absolute stage coordinates. Banned identifiers in this file (grepped): `BackdropBlur`, `BackdropFilter`, `<Blur`, `DisplacementMap`, `maskFilter`, `useClock`.

**Pack geometry (binding on B09, §9 #18):** `export type StageRect = { x: number; y: number; width: number; height: number }`; `packRectInStage(width, height): StageRect` — the pack BODY in stage px (width `min(width × 0.46, 200)`, height `× 1.5`, centred horizontally, centre y at `height × 0.45`; `(280, 360)` → `{ 75.6, 65.4, 128.8, 193.2 }`) is what the seam light-leak band and the particle burst origin are aligned to; `export const PACK_BODY_FRACTION = 0.7` (mirrors B06's); `packSlotInStage(width, height): StageRect` — `packRectInStage` inflated by `1 / PACK_BODY_FRACTION` about its centre (`(280, 360)` → `{ 48, 24, 184, 276 }`). **B09 mounts `<PackTear width={slot.width} height={slot.height}>` with `position: 'absolute', left: slot.x, top: slot.y` where `slot = packSlotInStage(280, 360)`** (a `useMemo` or a module constant), so that `PackTear.packBodyRect(slot.width, slot.height)` lands exactly on `packRectInStage` and the leak sits on the seam; the literal `width={240} height={336}` in the B09 brief is superseded by this rule.

**Additive exports recorded from the B05 brief (not drift):** `StageTimeline` (the nine-key structural subset of `CeremonyTimeline` this file reads; `CeremonyTimeline` is assignable to it), `STAGE_TELL_COLORS` (= `TELL_COLORS` literals, local because B05 does not depend on B07), `RIM_COLORS`, `FLASH_COLORS` (the three rgba literals of `DrawCeremonyScreen.tsx:127-131`), `PARTICLE_COUNT`, `PARTICLE_LIFE_MS`, `PARTICLE_SPRITE_SIZE = 64`, `PARTICLE_SHEET_COLUMNS = 4`, `LEAK_BAND_RATIO = 0.18`, `PACK_BODY_FRACTION`, `StageRect`, and the pure helpers `stageHaloColor`, `rayStops`, `tableCardSize`, `packRectInStage`, `packSlotInStage`, `particlePose`, `poseToRSXform`.

### 2.9 `mobile/src/components/ceremony/PackTear.tsx` (B06)

```ts
export type PackTearProps = {
  width: number; height: number;
  coverImage: ImageSourcePropType | undefined;
  palette: PackPalette;
  phase: CeremonyPhase;
  isMulti: boolean;
  pitySeal: boolean;
  timeline: CeremonyTimeline;                 // seam / peel / cardOut / packScale / packY / shiver
  /** true under reduceMotion or when phase !== 'swipe' (responders disabled, DrawCeremonyScreen.tsx:990-993). */
  disabled: boolean;
  /** Called exactly once when the seam commits (release ≥ SWIPE_TRIGGER_DISTANCE, or the a11y 'activate' action). */
  onTear: () => void;
  onSeamProgress?: (progress01: number) => void;
};
export const PACK_A11Y_LABEL = 'Reward pack';
export const PACK_A11Y_HINT = 'Swipe right or double-tap to open';
export const PACK_ACTIVATE_ACTION = 'activate';
/** Jagged seam: 14 vertices, normalised 0..1 × 0..1 inside the seam band; SEAM_BAND_RATIO (packArt.ts, B06) = 0.18 of pack height. */
export const SEAM_PATH_NORMALISED: ReadonlyArray<readonly [number, number]>;
export function seamProgressFromDelta(deltaX: number): number;   // clamp(deltaX / SWIPE_TRIGGER_DISTANCE, 0, 1)
export function PackTear(props: PackTearProps): React.JSX.Element;   // React.JSX — §9 #19
```

Root element props: `accessibilityRole="button"`, `accessibilityLabel={PACK_A11Y_LABEL}`, `accessibilityHint={PACK_A11Y_HINT}`, `accessibilityActions={[{ name: 'activate', label: 'Open pack' }]}`, `onAccessibilityAction` (→ `onTear()` when `!disabled`), `accessibilityState={{ disabled }}`, and **`testID = phase === 'swipe' ? 'draw-ceremony-swipe-pack' : isMulti ? 'draw-ceremony-multi-flyin' : 'draw-ceremony-single-pack-flyin'`** (test:480-481, :770-771 → kept case). The GH Pan gesture lives here (UI thread, drives `timeline.seam`); the raw-responder path that `armCeremonySwipe` in the test drives (`tests/…:114-121`, `onResponderGrant/Move/Release` on `draw-ceremony-stage`) stays on the **stage View in DrawCeremonyScreen** (B09), which forwards progress into `timeline.seam.value` and calls the same `onTear`. `packArt.ts` gains exactly one appended line, byte-exact `export const SEAM_BAND_RATIO = 0.18;` with NO trailing comment (B12.verify.sh compares the last non-empty line of the file to that string). `width`/`height` are the pack SLOT: B09 passes `packSlotInStage(280, 360)` from §2.8 and positions the root absolutely at its `x/y` (§9 #18), so `packBodyRect(width, height)` — the largest 2:3 rect × `PACK_BODY_FRACTION` (0.7), centred — coincides with the stage's `packRectInStage`. The gesture host is `GestureHandler.PanHost` (§2.1, §9 #15 — an alias for the library's `GestureDetector`; use the alias here).

**Additive exports recorded from the B06 brief (not drift):** `PackTimeline` (the six-key structural subset `seam / peel / cardOut / packScale / packY / shiver`; `CeremonyTimeline` is assignable to it), `PACK_ACTIVATE_LABEL = 'Open pack'`, `PACK_A11Y_ACTIONS`, `PACK_BODY_FRACTION = 0.7`, `PACK_CORNER_RADIUS`, `SEAM_VERTEX_COUNT = 14`, `PEEL_ROTATE_X_RAD`, `PEEL_LIFT_PX`, `PEEL_PERSPECTIVE`, `CARD_OUT_RISE_FRACTION`, `DECK_EDGE_OFFSETS`, `SEAM_EDGE_COLOR`, `SEAL_COLOR`, `RELEASE_SNAP_BACK_MS`, `PackRect`, and the pure helpers `packTestID(phase, isMulti)`, `packBodyRect(width, height)`, `seamPointsPx(body)`, `seamYAt(points, x)`. `onSeamProgress` is called at most once per tenth of progress during a drag (quantised, ≤ 11 calls) plus once with `0` on a failed release — B09 keys the selection haptic off the first value that reaches 1.

### 2.10 `mobile/src/components/ceremony/useCeremonyTimeline.ts` (B07)

```ts
export type CeremonyTimeline = {
  tell: SharedValue<number>; dim: SharedValue<number>; seam: SharedValue<number>; leak: SharedValue<number>;
  flash: SharedValue<number>; cameraScale: SharedValue<number>; cameraRot: SharedValue<number>; shiver: SharedValue<number>;
  packScale: SharedValue<number>; packY: SharedValue<number>; peel: SharedValue<number>; cardOut: SharedValue<number>;
  rays: SharedValue<number>; raysAngle: SharedValue<number>; halo: SharedValue<number>;
  spill: ReadonlyArray<{ x: SharedValue<number>; y: SharedValue<number>; rot: SharedValue<number> }>; // length = cardCount
  rim: ReadonlyArray<SharedValue<number>>;                                                         // length = cardCount
};
export type TimelineInput = {
  phase: CeremonyPhase; peakRarity: PeakRarity; isMulti: boolean; cardCount: number;
  timings: ResolvedCeremonyTimings; spill: SpillSchedule | null; reduceMotion: boolean; compressed: boolean;
};
export const EASING = {
  EMPHASIZED_OUT: 'bezier(0.05,0.7,0.1,1)', STANDARD: 'bezier(0.2,0,0,1)', LINEAR: 'linear', OUT_CUBIC: 'out(cubic)', OUT_QUAD: 'out(quad)',
} as const;
export const TELL_COLORS = { NEUTRAL: '#FFF7EC', COM: '#FFF3E0', RAR: '#A78BD8', LEG: '#F5C95E' } as const;
export const LEG_HIT_PAUSE_MS = 32;            // §3.1 S3
export const LEG_DIM = 0.3;                    // backdrop dims 30 % (§3.2)
/** Pure: the target values each phase drives to (unit-test table; the hook applies them with withTiming). */
export type TimelineTargets = { tell: number; dim: number; leak: number; flash: number; cameraScale: number; packScale: number; rays: number; halo: number; peel: number; cardOut: number; rim: number };
export function timelineTargets(input: Pick<TimelineInput, 'phase' | 'peakRarity' | 'isMulti' | 'reduceMotion'>): TimelineTargets;
export function haloColorForTell(tell: number, peakRarity: PeakRarity): string;  // NEUTRAL→(RAR violet | LEG violet@0.4→gold@0.6 | COM warm-white)
export function useCeremonyTimeline(input: TimelineInput): CeremonyTimeline;
```

Targets (verbatim, from §3.1): swipe → all rest (`rays` 0.10, `halo` 0.25, `tell` 0, `dim` 0, `packScale` 1, `seam` 0); approach → `rays` 0.22 (multi 0.26), `packScale` 1.12 (multi 1.10), `halo` 0.45, `tell` still 0, **`seam` → `SEAM_PRECUT` (0.15, the finger's nick — the hook owns the cut from approach onward, §9 #14)**; hold → `tell` 1 over the first 60 % then flat, `leak` 1, `dim` = LEG ? 0.3 : 0, `shiver` LEG 18 Hz ±`SHIVER_PX` (3 px) during the beat, `seam` stays at `SEAM_PRECUT`; tear-flip → `seam` `SEAM_PRECUT`→1 (250 ms OUT_CUBIC), `leak` flare 0.6→1.0 in 60 ms, `peel` 1 (200 ms), `cardOut` 1 (+350 ms), spill per `SpillSchedule`; flash-reveal → `flash` 0→0.85 in 60 ms then →0 over 260 ms OUT_QUAD (never under RM), `cameraScale` 1.04→1; settle → `rim[i]` 0.55 (COM 0), `halo` relax, `dim` 0; cards-on-table → unchanged. Under `reduceMotion` every target is applied with a 180 ms opacity-only `withTiming` and `packScale`/`cameraScale`/`cameraRot`/`shiver`/`flash` stay at rest.

**Units (binding on every consumer; §9 #16):** `raysAngle` **radians**, 0 → `2 * Math.PI` per `RAYS_ANGLE_PERIOD_MS` (B05 passes it to Skia `rotate` unchanged); `spill[i].x` / `spill[i].y` **pt offsets from the stage centre** (B05 draws them inside a centre-origin `Group`, B09's `FallbackStage` uses them as RN `translateX/Y` on a centred absolute view); `spill[i].rot` **radians** (B05 → Skia `rotate` unchanged; the RN fallback reads the degree value from `spillSlotOffset(...).rot` instead, never from the shared value); `shiver` / `packY` **px**; `cameraRot` **degrees** (its only consumer is the RN `rotate: \`${deg}deg\`` in B09's content wrapper, §9 #17); `cameraScale` unitless. B07 exports `SEAM_PRECUT = 0.15`, `SHIVER_PX = 3` and `spillSlotOffset(slot, count): { x, y, rot }` with `rot` in **degrees** (a layout helper for the RN fallback; the hook converts with `* Math.PI / 180` when it drives `spill[i].rot`).

### 2.11 `mobile/src/components/ceremony/TapCard.tsx` + `FoilLayer.tsx` (B08)

Extracted from `DrawCeremonyScreen.tsx:147-388` and rewritten on the guard. `DrawCeremonyScreen.tsx` keeps its inline `TapCard` until B09 deletes it (B08 does not edit the screen).

```ts
export type TapCardData = { stableUid: string; question: string; difficulty: number; rarity: PeakRarity; tag?: string };
export const TAP_QUEUE_GAP_MS = 90;
/** Pure FIFO used by the table: enqueue(uid) returns the ms delay at which that flip may start. */
export function createTapQueue(gapMs?: number, now?: () => number): { enqueue(uid: string): number; clear(): void };
export type TapCardProps = {
  card: TapCardData; index: number; total: number; width: number; height: number;
  /** true outside 'cards-on-table' — a disabled card never flips and reports accessibilityState.disabled. */
  disabled: boolean;
  flipped: boolean;
  onTapStart?: (card: TapCardData) => void;
  onFlipped: (uid: string) => void;
  cardBackImage?: ImageSourcePropType; frameImage?: ImageSourcePropType;
  reduceMotion: boolean;
  focused?: boolean; onFocusToggle?: (uid: string) => void;   // RAR/LEG focus fly-in
  timings: Pick<ResolvedCeremonyTimings, 'flipMs' | 'rimSettleMs' | 'liftMs' | 'landMs'>;
};
export function TapCard(props: TapCardProps): React.JSX.Element;   // React.JSX — §9 #19
```

Root `Pressable` props: `testID={`tap-card-${index}`}` (always, both renderers — today only the animated branch has it, `:279`), `accessibilityRole="button"`, `accessibilityLabel` = `flipped ? `Card ${index+1} of ${total}, ${rarityLabel} revealed` : `Card ${index+1} of ${total}, face down``, `accessibilityState={{ disabled }}`, `disabled={disabled}`. The face swap keeps the opacity step at 0.5 (`:254-261`) so the fallback path shows the front immediately on `flipped`.

```ts
// FoilLayer.tsx — replaces HolographicLayer; sweep driven by a Reanimated shared value via the guard, NOT Skia's useClock.
export type FoilLayerProps = { width: number; height: number; accentColor: string; rarity: PeakRarity; active: boolean; tilt?: SharedValue<{ x: number; y: number }> | null; lut?: ImageSourcePropType };
export function FoilLayer(props: FoilLayerProps): React.JSX.Element | null;   // null when !skiaAvailable || !motionAvailable || rarity === 'COM'
/** Compiles the SkSL once (RuntimeEffect.Make) — DrawScreen calls it on mount (B10). No-op when Skia is unavailable. */
export function prewarmFoilShader(): void;
export const foilAvailable: boolean;
```

`HolographicLayer.tsx` after B08 is exactly: `export { FoilLayer as HolographicLayer, foilAvailable as skiaAvailable } from './ceremony/FoilLayer';` plus a one-line comment; the grep guard is "no `useClock` and no `useDerivedValue` anywhere under `mobile/src/components`". B11 deletes the shim — and, because B08's `foilLayer.test.tsx` case 3 (`'HolographicLayer shim forwards to FoilLayer'`) imports it, B11 also deletes that one case and its import line (deletions only; cases 1–2 unchanged).

### 2.12 `ceremonyStyles.ts`, `FeaturedCard.tsx`, `FallbackStage.tsx`, `SpillSampler.tsx`

- `mobile/src/components/ceremony/ceremonyStyles.ts` — **B08 creates** it with `export const ceremonyStyles = StyleSheet.create({...})` containing the `tapCard*`, `tapTable`, `tapRow`, `tapTwoRows`, `pressed` entries copied from `CeremonyLottie.tsx:1001-1117` (minus any `shadowRadius ≥ 16`). **B09 appends** the screen-level entries it still needs (`safeArea`, `gradient`, `backdrop`, `content`, `stage`, `holdMarker`, `phaseCopyHidden`, `footerRarity`, `footerRarityHidden`, `skipButton`, `skipText`, `flash`, `ceremonySkipX`, `ceremonySkipXText`, `orbitStage`, `flipCard*`/`cardRarityChip`/`cardRarity`/`cardQuestion`/`cardBackText`, `swipePack`, `swipePackInner`, `stageCard`, `stageCardBack`, `leaveButton`, `spillCard`). **B11 trims** what is unreferenced after the Lottie deletion.
- `mobile/src/components/ceremony/FeaturedCard.tsx` — **B09 creates**: the static `RevealCard` (`CeremonyLottie.tsx:271-409`) without `Animated`: `export function FeaturedCard(props: { accent: string; rarityText: string; questionText: string; packPaletteCover: PackPalette['cover']; coverImage?: ImageSourcePropType; faceUp: boolean })`; keeps `testID="draw-ceremony-reveal-rarity"` and `testID="draw-ceremony-reveal-question"` on the face-up front; when `faceUp` is false it renders the front rotated away (`rotateY: '180deg'`, opacity 0) so both testIDs stay in the tree (§3.3 "RevealCard's front is rendered rotated away so its testIDs survive").
- `mobile/src/components/ceremony/FallbackStage.tsx` — **B09 creates**: the no-Skia renderer (plain RN Views, opacity crossfades, static rims via `glowNineSlice` tinted `tintColor`), `testID="draw-ceremony-fallback-stage"`, carrying the pack node with the same phase-dependent testID rule as PackTear (§2.9) and the same accessibility props, `draw-ceremony-hold-marker` during hold, `draw-ceremony-spill-card-${index}` static views during tear-flip (multi), and the `FeaturedCard` during flash-reveal/settle when tapFlow is off.
- `mobile/src/components/ceremony/SpillSampler.tsx` — **B09 creates** (design decision #9, `release-1.6.0-plan:299`: the orbit sampling contract is kept on a leaf). Mounted by both renderers during `'tear-flip'` when `isMulti`. `export const SPILL_SAMPLE_MS = 100;` Own `setInterval(SPILL_SAMPLE_MS)` and own state (a `React.memo` leaf — this is *not* the deleted `DrawCeremonyScreen.tsx:798-819` interval, which re-rendered the whole tree every 33 ms). Renders, verbatim testIDs: `draw-ceremony-orbit-stage` (root, `accessibilityLiveRegion="polite"`, `accessibilityLabel={`Dealing cards, ${Math.round(progress*100)} percent`}`), `draw-ceremony-orbit-progress` (`progress.toFixed(2)`), `draw-ceremony-orbit-samples` (integer count), `draw-ceremony-orbit-focus` (`Math.min(1, progress*1.35).toFixed(2)`), `draw-ceremony-orbit-mode` (`'skia' | 'fallback'`). Props: `{ durationMs: number; renderer: 'skia' | 'fallback' }`.

### 2.13 `mobile/src/features/gacha/draw/ceremonyCopy.ts` additions (B10)

`CEREMONY_COPY` (scanned by `tests/unit/ceremony-copy.test.ts:11-17` for `:`/`·`) is untouched. Edits to `CEREMONY_COPY_V9` (`:64-94`):

```ts
approach: { title: 'Pack inbound', body: 'Your pack is moving into focus.',
  rareTitles: { COM: 'Pack inbound', RAR: 'Pack inbound', LEG: 'Pack inbound' } },   // §3.2: rarity withheld in copy
'flash-reveal': { title: 'Pack open', body: 'Your cards are sliding out.' },
```
plus `const CEREMONY_FLASH_REVEAL_SINGLE = { title: 'Pack open', body: 'Your card is sliding out.' } as const;` returned by `getCeremonyPhaseCopy('flash-reveal', false)`; `CEREMONY_TEAR_FLIP_SINGLE` (`:96-99`, body `'Your card is spinning into place.'`) is unchanged (test:452). New export:

```ts
export const CEREMONY_COPY_V10 = {
  packA11yLabel: 'Reward pack', packA11yHint: 'Swipe right or double-tap to open', activateAction: 'Open pack',
  leaveCeremony: 'Leave ceremony', speedUp: 'Speed up', showResult: 'Show result', continueCta: 'Continue',
  skipProgress: (revealed: number, total: number) => `Skip · ${revealed}/${total}`,
  cardFaceDown: (n: number, total: number) => `Card ${n} of ${total}, face down`,
  cardRevealed: (n: number, total: number, rarity: string) => `Card ${n} of ${total}, ${rarity} revealed`,
  dealing: (percent: number) => `Dealing cards, ${percent} percent`,
  unrevealedChip: 'Not flipped',
  shareCta: 'Share this pull',
} as const;
```

### 2.14 `mobile/src/navigation/types.ts` (B10 params; B13 route)

```ts
DrawCeremony: { …existing…; tapFlow?: boolean; pityThreshold?: number; pityCardIndex?: number | null; poolExhausted?: boolean };
DrawResult:   { …existing…; revealedUids?: string[]; ceremonyEcho?: { rarity: 'COM' | 'RAR' | 'LEG'; phaseCue: string; tableReached?: boolean } | null };   // tableReached optional: B10 lands before B09, whose goResult is the only caller that passes it (always)
CeremonyTuning: undefined;   // B13, registered in App.tsx inside `__DEV__ ? <Stack.Screen name="CeremonyTuning" component={CeremonyTuningScreen} /> : null`
```

### 2.15 `mobile/src/features/gacha/share/shareDraw.ts`, `milestones/ratingPrompt.ts`, `navigation/linking.ts` (B15)

```ts
// shareDraw.ts — guarded dynamic import('react-native-view-shot') + import('expo-sharing') inside a function (§9 #13); never throws.
export type ShareDrawResult = { status: 'shared' | 'unavailable' | 'cancelled' | 'failed' };
export const SHARE_DRAW_TESTID = 'draw-result-share-button';
export function shareDrawImage(viewRef: React.RefObject<unknown>, opts: { slug: string; deckTitle?: string }): Promise<ShareDrawResult>;

// ratingPrompt.ts — guarded dynamic import('expo-store-review') inside a function (§9 #13); AsyncStorage key below; once per install, ever.
export const RATING_PROMPT_KEY = 'recallsmith:rating-prompt:v1';
export type RatingTrigger = 'first-legendary' | 'streak-7';
export type RatingPromptState = { requestedAt: number; trigger: RatingTrigger } | null;
export function shouldRequestRating(state: RatingPromptState, trigger: RatingTrigger): boolean;   // pure: state === null
export function maybeRequestRating(trigger: RatingTrigger): Promise<'requested' | 'already' | 'unavailable' | 'failed'>;

// linking.ts — scheme 'recallsmith' is added to app.json by B01.
export const linking: LinkingOptions<RootStackParamList> = {
  prefixes: ['recallsmith://'],
  config: { screens: { Home: 'home', Draw: 'draw/:slug?', Library: 'library', CardDetail: 'card/:cardId', DrawResult: 'result/:slug' } },
};
```

`App.tsx` (B15): `import { linking } from './src/navigation/linking';` and `<NavigationContainer linking={linking} …>` (`App.tsx:167`). Nothing else in App.tsx.

### 2.16 `mobile/src/screens/dev/CeremonyTuning.tsx` (B13)

```ts
export function summarizeFrameGaps(gapsMs: number[]): { p95: number; max: number; count: number };   // pure
export function useFrameGapProbe(active: boolean): { p95: number; max: number; count: number };        // requestAnimationFrame deltas
export function CeremonyTuningScreen(props: NativeStackScreenProps<RootStackParamList, 'CeremonyTuning'>): React.JSX.Element;   // React.JSX — §9 #19
export default CeremonyTuningScreen;
```
`__DEV__` gate: when `!__DEV__` the screen renders only `<Text testID="ceremony-tuning-unavailable">Not available in release builds</Text>`. Sliders write through `setCeremonyTimingOverride`. testIDs: `ceremony-tuning-root`, `ceremony-tuning-probe`, `ceremony-tuning-slider-${key}`. DebugMenu (B13) gains, `__DEV__`-only, the buttons `debug-seed-wallet` ('Seed wallet 30/5' → `saveRewardWalletState({ availablePulls: 30, reservePulls: 5 })`), `debug-only-legendary` ('Only Legendary left' → owns every non-LEG card of the active deck via `saveDrawState`), `debug-force-fallback` (toggle `setCeremonyDevOverride('forceFallback', …)`), `debug-force-repeat` (toggle `setCeremonyDevOverride('forceRepeat', …)`), `debug-ceremony-tuning` (→ `navigation.navigate('CeremonyTuning')`).

### 2.17 `mobile/src/components/RootErrorBoundary.tsx` (B01)

```ts
export class RootErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }>;
// fallback: <View testID="root-error-boundary"><Text>Something went wrong</Text><Pressable testID="root-error-retry" onPress={reset}>Try again</Pressable></View>; componentDidCatch → console.error only.
```
`App.tsx`: `<GestureHandlerRootView style={{ flex: 1 }}><RootErrorBoundary>` wraps the existing `<View style={styles.appShell}>` (`App.tsx:165`). The `__DEV__` worklet probe in `App.tsx` (top level, after `configureAmplifyOnce();` at `:90`) must contain the literal `_WORKLET`:

```ts
if (__DEV__) {
  // Reanimated 4 needs react-native-worklets/plugin (applied by babel-preset-expo when the package is
  // installed). `_WORKLET` is only true on the UI runtime; on the JS runtime a workletized function
  // carries `__workletHash`. No hash = the plugin did not run and ceremony motion will fall back.
  const workletProbe = () => {
    'worklet';
    return (globalThis as { _WORKLET?: boolean })._WORKLET === true;
  };
  if (typeof (workletProbe as unknown as { __workletHash?: number }).__workletHash !== 'number') {
    console.warn('[recallsmith] react-native-worklets babel plugin is not active');
  }
}
```

---

## 3. The phase machine (B09), feature flag (B02/B09), renderer and tapFlow

### 3.1 Phases

The `CeremonyPhase` union is unchanged from today (`DrawCeremonyScreen.tsx:56-63`) because copy keys (`ceremonyCopy.ts:64-94`, `:110-118`) and every test literal hang off it. Storyboard mapping (design §3.1): S0/M0 SWIPE = `'swipe'`; S1/M1 APPROACH = `'approach'`; S2/M2 HOLD (colour tell over the first 60 %, silence beat in the last `beatMs`) = `'hold'`; S3 TEAR / M3 TEAR+SPILL+FAN = `'tear-flip'`; S4/M4 FLASH-REVEAL = `'flash-reveal'`; S5/M5 SETTLE = `'settle'`; S6/M6 CARDS-ON-TABLE = `'cards-on-table'`. The beat, the LEG hit-pause and the spill are **sub-beats inside a phase** expressed by `useCeremonyTimeline` shared values, never new phases.

### 3.2 Timers drive every transition (no native callback, ever)

One `useEffect` keyed on `[sequenceToken, reduceMotion, timings]` (today `:702-796`) schedules, from `startSequence()` at t = 0: `'approach'` immediately; `'hold'` at `approach`; `'tear-flip'` at `+hold`; `'flash-reveal'` at `+tearFlip`; `'settle'` (+ `setCanSkip(true)`) at `+flashReveal`; then at `+settleMs + tableTailMs`: `enableTapFlow ? setPhase('cards-on-table') : goResult()`. `tableTailMs` is 500 under TEST_BASE and 200 under DEVICE, so the multi test's `advanceTimersByTime(820)` after settle (test:215-217) still sees `replace`. `compress()` (from the × / stage tap while `skipPolicy` says `'compress'`) clears the pending timers and reschedules from `compressTimings(timings, elapsedInHold)`; it never calls `goResult`. **Grep contract for B09.verify:** the source contains no `onAnimationFinish`, no `lottie`/`Lottie`, no `CeremonyLottie`, no `orbitTimerRef`, no `setInterval(` (the only `setInterval` in the ceremony tree is inside `SpillSampler.tsx`), and `goResult` is referenced only from: the settle CTA (`'Show result'`), the table CTA (`'Continue'` / `'Skip · n/N'`), the `'Leave ceremony'` control, and the RM/tapFlow-off tail timer.

### 3.3 Reduce Motion parallel path (§3.4)

`reduceMotion` from `AccessibilityInfo.isReduceMotionEnabled` + `reduceMotionChanged` (`:497-514`, kept). When true: no `'swipe'` (mount → `'flash-reveal'` at t = 0, title `'Pack open'`), `'settle'` + CTA `'Show result'` at `REDUCED_MOTION_FLASH_MS` (180), then at `+REDUCED_MOTION_SETTLE_MS` (420 total): `enableTapFlow ? 'cards-on-table' : goResult()` — byte-identical cadence to test:364-403 and :484-516. Stage responders disabled; `timeline` gets opacity-only 180 ms transitions; the contract `View testID="draw-ceremony-reveal-flash"` keeps `style[1] = { backgroundColor: flashColor(peakRarity), opacity: phase === 'flash-reveal' && !reduceMotion ? 0.85 : 0 }` (test:431-432, :716-718 rely on `style[1]`), and `StageCanvas` never mounts the flash rect. Haptics: `reset({ reduceMotion: true })` on mount → exactly one `'light'` at mount. Audio: `tail('soft-chime')` at mount instead of a bed. A mid-ceremony `reduceMotionChanged` restarts the effect (the dependency array does it) — snap, no tween.

### 3.4 Feature flag (B02 adds, B09 reads via `useFeatureFlags()`)

```ts
// featureFlags.ts — add to FeatureFlags, DEFAULT_FEATURE_FLAGS, snapshotsEqual and applyRemoteFeatures (boolean-typed, else default);
// RemoteFeatures in remoteConfig.ts is NOT edited (it is `features?: RemoteFeatures` with optional members; applyRemoteFeatures reads `features?.ceremony` through isRecord like paywall at :60-62).
ceremony: { seamOfLight: boolean; forceFallback: boolean };
DEFAULT_FEATURE_FLAGS.ceremony = Object.freeze({ seamOfLight: true, forceFallback: false });
```
Defaults and meaning: `seamOfLight: true` — the 1.6.0 binary ships the Skia stage on; `false` is the remote **kill switch** for a GPU/shader crash class found after release (renderer → `'fallback'`, everything else — timers, DEVICE table, tap table, audio, haptics — unchanged), so it can be flipped from S3 without an OTA. `forceFallback: false` — the **diagnostic** switch with the same renderer effect; DebugMenu flips its in-memory twin (`setCeremonyDevOverride('forceFallback')`) so a device can be driven through the fallback renderer for the DoD check without touching remote config; support can flip the remote one for a single build. Both are booleans so `applyRemoteFeatures` falls back to the default on any non-boolean. B02's `featureFlags.test.ts` edit rule: add new `it` cases **and** add `ceremony: { seamOfLight: true, forceFallback: false }` (or `ceremony: DEFAULT_FEATURE_FLAGS.ceremony`) to the existing full-object `toEqual` literals — all nine, verified 2026-09-20: `:75-83`, `:103-111`, `:115-118`, `:120-128`, `:142`, `:152-155`, `:171`, `:228-231`, `:251-259` (cases comparing to `DEFAULT_FEATURE_FLAGS` itself at `:74`, `:132`, `:190`, `:222`, `:277` need nothing) — those literals would otherwise fail on the extra key; no other existing line changes.

### 3.5 Renderer and tapFlow (B09)

```ts
const flags = useFeatureFlags();
const dev = getCeremonyDevOverrides();
const renderer: 'skia' | 'fallback' =
  motionAvailable && skiaAvailable && flags.ceremony.seamOfLight && !flags.ceremony.forceFallback && !dev.forceFallback
    ? 'skia' : 'fallback';
const timings = resolveCeremonyTimings({ isMulti, peakRarity, motionAvailable });   // table follows motionAvailable ALONE
const enableTapFlow = route.params.tapFlow ?? (motionAvailable && drawResult.cards.length > 0);   // design §3.3 verbatim
```
Under vitest `motionAvailable` is false → `'fallback'`, TEST_BASE, `tapFlow` off unless the test passes `tapFlow: true`. `renderer === 'skia'` mounts `StageCanvas` + `PackTear` + Reanimated `TapCard`s; `'fallback'` mounts `FallbackStage` + static `TapCard`s. Both mount `SpillSampler` (multi, tear-flip), the phase-copy Texts, the footer, the CTA, the contract flash View and the `Leave ceremony` control.

### 3.6 Controls and CTA copy

- `draw-ceremony-leave` (`accessibilityRole="button"`, `accessibilityLabel="Leave ceremony"`): always mounted, opacity 0 (still reachable by VoiceOver — `accessibilityElementsHidden` must NOT be set), `onPress={goResult}`. Replaces the always-visible × at `:884-895`.
- `draw-ceremony-fast-forward` (visible ×, `accessibilityLabel="Speed up"`): mounted only while `skipPolicy(...) === 'compress'`; `onPress={compress}`. A tap on `draw-ceremony-stage` while the decision is `'compress'` also calls `compress()`.
- `screen-draw-ceremony-primary-cta` / `nativeID="draw-ceremony-skip-hint"` (test:212-213): mounted from settle. Text: `'Show result'` in settle (→ `goResult`); on the table `CEREMONY_COPY_V10.skipProgress(flipped, total)` while cards remain (→ `goResult`), `'Continue'` once all are face-up (→ `markCeremonyCompleted()` then `goResult`).
- `goResult` passes `revealedUids: [...flippedSet]` and `ceremonyEcho: { rarity: peakRarity, phaseCue: CEREMONY_COPY_V9.settle.body, tableReached: phase === 'cards-on-table' }`.
- `draw-ceremony-footer-rarity` renders the rarity word (`'Legendary' | 'Rare' | 'Common'`) only when `phase === 'cards-on-table' ? flippedSet.size > 0 : phase === 'settle'`; otherwise its children are `''` (today's visually-hidden text at `:1358-1368` still leaks the word into `collectText`).
- `draw-ceremony-phase-copy` / `draw-ceremony-phase-body-copy` (`:968-985`) keep their testIDs and `numberOfLines={1}`; approach title = `CEREMONY_COPY_V9.approach.rareTitles[peakRarity]` (all `'Pack inbound'` after B10).

---

## 4. Test contracts

### 4.1 `mobile/tests/setup/ceremony.ts` (B02) and `vitest.config.ts`

`vitest.config.ts:30` becomes `setupFiles: ['./tests/setup/globals.ts', './tests/setup/ceremony.ts'],` (order matters: `globals.ts` defines `__DEV__` first). The file, in this order:

1. `(globalThis as any).__CEREMONY_MOTION_AVAILABLE__ = false;`
2. `vi.mock('react-native-reanimated', …)`: default export `{ View, Text, Image, createAnimatedComponent: (c) => c }` where the components render host elements named `'Animated.View'` etc.; named `useSharedValue(v) → ({ value: v })`, `useDerivedValue(fn) → ({ value: fn() })`, `useAnimatedStyle(fn) → fn()`, `useAnimatedReaction → undefined`, `withTiming/withSpring/withDelay/withRepeat` → their numeric target (2nd arg for withDelay), `withSequence(...a) → a[a.length-1]`, `cancelAnimation`, `runOnJS(fn) → fn`, `interpolate`, `interpolateColor → output[0]`, `Easing` (bezier/linear/out/in/cubic/quad all returning `(t) => t`), `makeMutable(v) → ({ value: v })`.
3. `vi.mock('react-native-worklets', () => ({}))`.
4. `vi.mock('@shopify/react-native-skia', …)`: every component (`Canvas, Group, Rect, RoundedRect, Image, Atlas, Path, Circle, SweepGradient, RadialGradient, LinearGradient, Shader, Paint, Fill, Mask`) renders `React.createElement('Skia.<Name>', props, children)`; `useImage → null`; `useImageAsTexture → null`; `useRSXformBuffer → []`; `useRectBuffer → []`; `vec/rect/rrect` return plain objects; `Skia: { Path: { Make: () => ({ moveTo(){return this}, lineTo(){return this}, close(){return this} }) }, RuntimeEffect: { Make: () => null }, Matrix4: () => [] , Color: (c: string) => c }`; `BlendMode: { Plus: 'plus', SrcOver: 'srcOver' }`; `Matrix4/rotateX/translate/multiply4/perspective` as identity helpers; **no `useClock`**.
5. `vi.mock('expo-audio', …)` (safety net only — B04's module uses a guarded `require` that this mock cannot reach; B04's tests inject fakes, §2.6): `createAudioPlayer(source) → player`, where `player = { play: vi.fn(), pause: vi.fn(), seekTo: vi.fn(), remove: vi.fn(), volume: 1, loop: false, playing: false, __source: source }` and every player is pushed to `globalThis.__ceremonyMocks.audio.players`; `setAudioModeAsync: vi.fn(async () => {})`; `useAudioPlayer → createAudioPlayer(...)`.
6. `vi.mock('expo-haptics', …)` (safety net only, §2.7): `{ impactAsync: vi.fn(async () => {}), selectionAsync: vi.fn(async () => {}), notificationAsync: vi.fn(async () => {}), ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy', Soft: 'soft', Rigid: 'rigid' }, NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' } }` — the same objects are exposed at `globalThis.__ceremonyMocks.haptics`.
7. `vi.mock('react-native-gesture-handler', …)`: `GestureHandlerRootView` and `GestureDetector` render `React.createElement('View', props, children)`; `Gesture.Pan()`/`Gesture.Tap()` return a chainable stub whose every method (`onBegin, onStart, onUpdate, onEnd, onFinalize, activeOffsetX, failOffsetY, enabled, minDistance, runOnJS, simultaneousWithExternalGesture`) returns `this`; `Directions`, `State` plain enums.
8. `vi.mock('expo-sharing', …)`, `vi.mock('expo-store-review', …)`, `vi.mock('react-native-view-shot', …)`: `isAvailableAsync: vi.fn(async () => true)`, `shareAsync: vi.fn(async () => {})`, `requestReview: vi.fn(async () => {})`, `captureRef: vi.fn(async () => 'file:///tmp/draw.png')` — also on `globalThis.__ceremonyMocks.{sharing,storeReview,viewShot}`. (B15's tests use `vi.mocked` on those; B02 adds the mocks now so nothing can reach a native module before B15.)
9. `beforeEach` (global): `players.length = 0`; `mockClear()` on every `vi.fn` above.
10. `declare global { var __ceremonyMocks: {...}; var __CEREMONY_MOTION_AVAILABLE__: boolean | undefined }` typed export so unit tests can `globalThis.__ceremonyMocks.haptics.impactAsync` without casts.

The draw-ceremony integration test's own `vi.mock('react-native', …)` (test:9-36) stays exactly as it is; the setup file must not mock `react-native`, `react`, `@react-native-async-storage/async-storage` or `expo-linear-gradient`.

### 4.2 `mobile/tests/integration/draw-ceremony.screen.test.tsx` — what B09 may change (exhaustive)

Base blob `7dd36b4dc2eb347f34e419b66cea856c51a2031d`, 787 lines. B09.verify.sh derives the **expected prefix** from the base file (`git show "$BASE_REF":mobile/tests/integration/draw-ceremony.screen.test.tsx`) with exactly this transform, in this order, and requires the new file to begin byte-for-byte with it (`head -n $(wc -l < expected_prefix) new | cmp - expected_prefix`):

1. Delete lines **518–580** (`it('shows deterministic reveal semantics for reduced-motion when lottie path is available'` + its trailing blank line).
2. Delete lines **581–635** (`it('ignores early lottie finish before settle'` + blank).
3. Delete lines **734–786** (blank + `it('keeps lottie single draw path free of multi-only orbit choreography'`).
4. Line 636: `keeps normal-motion lottie multi choreography and cadence parity` → `keeps normal-motion multi choreography and cadence parity`.
5. Delete lines **637–652** (the `vi.resetModules()`/`vi.doMock(...)`/dynamic-import scaffold and its blank line).
6. Line 657: `<DrawCeremonyScreenWithLottie` → `<DrawCeremonyScreen`.
7. Line 680: `.toBe('lottie')` → `.toBe('fallback')`.
8. Delete lines **730–732** (blank + `vi.doUnmock(...)` + `vi.resetModules()`).
9. Substitutions: `'Legendary inbound'` → `'Pack inbound'` (lines 152, 166, 667); `'Rare inbound'` → `'Pack inbound'` (243, 258); `'Card revealed'` → `'Pack open'` (197, 204, 288, 378, 384).
10. Drop the last line (`});` at 787).

That is: 3 Lottie cases deleted, 5 `… inbound` literals and 5 `'Card revealed'` literals changed, plus the four mechanical de-Lottie edits of the retained multi-choreography case (§9 #1). Everything after the prefix is **new `it(` cases only**, and the file ends with `});`. Timing tables `MULTI_TIMING`/`SINGLE_TIMING`/`REDUCED_TIMING` (:73-92) are inside the prefix, hence byte-identical.

New cases B09 adds (titles verbatim; each cites the grammar rule it encodes in a leading comment):

1. `'reaches the tap-to-flip table by timer when tapFlow is on and flips only on the table'` — multi, `params.tapFlow: true`; tap `tap-card-0` during flash-reveal → still `'Skip · 0/2'`-less (CTA absent) and card not flipped; at settle CTA text `'Show result'`; at `+500` `draw-ceremony-cards-on-table` present, CTA `'Skip · 0/2'`; tap card 0 → `'Skip · 1/2'`; tap card 1 → `'Continue'`; press → `replace('DrawResult', objectContaining({ revealedUids: ['1', '2'], ceremonyEcho: objectContaining({ tableReached: true }) }))`.
2. `'keeps the rarity word out of every text before a card is face up'` — single RAR with `tapFlow: true`: `collectText(tree)` contains neither `'Rare'` nor `'Legendary'` at swipe, approach, hold, tear-flip, flash-reveal and settle; after the first flip it contains `'Rare'`.
3. `'reduced motion with tapFlow keeps the reveal on the table with no flash'` — RM + `tapFlow: true`: t=0 title `'Pack open'`, `draw-ceremony-reveal-flash` `style[1].opacity === 0`; t=180 CTA `'Show result'`; t=420 `draw-ceremony-cards-on-table`, CTA `'Skip · 0/2'`, flash opacity still 0, `replace` not called; tap → `'Skip · 1/2'`.
4. `'exposes the pack as an accessible button whose activate action starts the ceremony'` — `findByProps({ accessibilityLabel: 'Reward pack' })` has `accessibilityRole 'button'` and an `accessibilityActions` entry `{ name: 'activate' }`; calling `onAccessibilityAction({ nativeEvent: { actionName: 'activate' } })` moves the title to `'Pack inbound'`.
5. `'renders the fallback stage when motion is unavailable and still reaches settle'` — `draw-ceremony-fallback-stage` present, no `draw-ceremony-stage-canvas`; after the single total the title is `'Cards in place'`.
6. `'spills exactly as many cards as were drawn'` — multi with 2 cards, at 980 ms: `findAllByProps({ testID: 'draw-ceremony-spill-card-0' })` and `-1` present, `-2` absent.
7. `'lets a repeat user compress from hold without leaving the ceremony'` — `vi.doMock('../../src/features/gacha/draw/ceremonyPrefs')` with `readCeremoniesCompleted: async () => 1`; multi; before `approach + 0.6 × hold` no `draw-ceremony-fast-forward`; after it the control exists; press → the CTA appears earlier than `multiTotal` and `replace` was never called by the press.
8. `'never shows a fast-forward control on a first-ever ceremony before settle'` — default prefs; `draw-ceremony-fast-forward` absent through hold, tear-flip and flash-reveal; `findByProps({ accessibilityLabel: 'Leave ceremony' })` exists at every phase.

### 4.3 testIDs that must survive (both renderers)

`screen-draw-ceremony-root`, `draw-ceremony-backdrop`, `draw-ceremony-stage` (with the raw responder props `onStartShouldSetResponder`, `onMoveShouldSetResponder`, `onResponderGrant`, `onResponderMove`, `onResponderRelease`, `onResponderTerminate`), `draw-ceremony-phase-copy`, `draw-ceremony-phase-body-copy`, `draw-ceremony-hold-marker`, `draw-ceremony-swipe-pack`, `draw-ceremony-single-pack-flyin`, `draw-ceremony-multi-flyin`, `draw-ceremony-orbit-stage`, `draw-ceremony-orbit-progress`, `draw-ceremony-orbit-samples`, `draw-ceremony-orbit-focus`, `draw-ceremony-orbit-mode`, `draw-ceremony-reveal-flash` (a plain RN `View` whose `style` is an array with the contract object at index 1), `draw-ceremony-reveal-rarity`, `draw-ceremony-reveal-question`, `draw-ceremony-cards-on-table`, `tap-card-${i}`, `draw-ceremony-footer-rarity`, `screen-draw-ceremony-primary-cta` + `nativeID="draw-ceremony-skip-hint"`. New: `draw-ceremony-stage-canvas`, `draw-ceremony-fallback-stage`, `draw-ceremony-spill-card-${i}`, `draw-ceremony-leave`, `draw-ceremony-fast-forward`. Dropped (asserted nowhere): `draw-ceremony-orbit-center`, `mock-ceremony-lottie`. DrawResult: every `screen-draw-result-*` / `draw-result-*` testID in `DrawResultScreen.tsx` stays; new `draw-result-share-button` (B15), `draw-result-unrevealed-chip-${index}` (B10).

### 4.4 Other existing test files touched

- `tests/unit/featureFlags.test.ts` (B02): rule in §3.4.
- `tests/unit/packArt.test.ts` (B12): the case at `:19-24` becomes "returns undefined for slugs that have no registered card back" with only `'totally-unknown-deck'` (ai/cloud now have backs); add `packImageForSlug('aws-saa-c03') === packImageForSlug('aws')` and `!== packImageForSlug('cloud')`, `cardBackImageForSlug('aws-saa-c03') === cardBackImageForSlug('aws')`, and `cardFrameForRarity('LEG')` defined.
- `tests/integration/draw-result.screen.test.tsx` (B10, B15): add cases only (`revealedUids` chips; share button calls `shareDrawImage`; rating prompt after `RATING_PROMPT_DELAY_MS`); no existing assertion changes.
- `tests/unit/linking.test.ts` (B15, new): asserts the `linking` config through `getStateFromPath` from `@react-navigation/core` (added beyond the spec's two B15 test files; listed in §1).
- `tests/unit/ceremony-copy.test.ts`: untouched by anyone.

---

## 5. Dependency edges and merge order

Spec edges plus the edges the spec is missing (marked +):

| Issue | deps | why the + edges |
|---|---|---|
| B01 | – | canary |
| B02 | B01 | needs the packages to exist for the guard's `require`s to be meaningful |
| B03 | B01, **+B02** | pure; fast-check already present; `spillSchedule.ts`/`skipPolicy.ts` import `CeremonyPhase`, `PeakRarity`, `SPILL_*` and `FAST_FORWARD_FROM_HOLD_FRACTION` from B02's `ceremonyTimings.ts` (§2 preamble, §2.3, §2.4) — B03 cannot typecheck on a tree without B02 |
| B04 | B01 | expo-audio installed by B01 |
| B05 | B02 | guard + timeline types |
| B06 | B02 | guard, `SWIPE_TRIGGER_DISTANCE` |
| B07 | B02, B03 | timings + spill schedule |
| B08 | B02, B04 | guard; haptics/audio types used by TapCard callers' contracts |
| B12 | B01, **+B06** | both edit `packArt.ts`; B06 appends one line at EOF, B12 edits the registry regions — serialised to avoid a merge conflict |
| B10 | **B02, B04, B08, B12** (spec said B09) | B10 supplies the copy literals (`'Pack inbound'`, `'Pack open'`), `types.ts` params (`tapFlow`, `revealedUids`, `tableReached`) and `CEREMONY_COPY_V10` that B09's screen and test edits depend on; DrawScreen preheat calls B04's `prewarmCeremonyAudio` and B08's `prewarmFoilShader`; DrawResult's CardFace uses B12's frames. Reversing the edge removes the B09→B10 cycle (§9 #2) |
| B09 | B05, B06, B07, B08, **+B10, +B12** | screen wiring imports every module; frames/particles/glow sources from packArt |
| B11 | B09 (**+B08** transitively) | deletes CeremonyLottie.tsx and the HolographicLayer shim once nothing imports them |
| B13 | B09 | dev overrides (B03), timing override (B02) reach it through B09 |
| B14 | B09 | documents the shipped numbers |
| B15 | B10, **+B13** | expo-sharing/view-shot/store-review from B01 (via B10); App.tsx edited by B13 and B15 — serialised |

Merge order implied (each row after its deps): **B01 → B02 → B03, B04, B06 → B12, B05, B07, B08 → B10 → B09 → B11, B13, B14 → B15.** Independent issues in a row may run in parallel worktrees.

---

## 6. Assets (B12 produces; B05/B06/B08/B09/B10 consume through `packArt.ts` exports)

All PNG, RGBA unless noted, ≤ 200 KB each after `pngquant` (design §3.6), sizes asserted by `sips -g pixelWidth -g pixelHeight` in B12.verify.sh, generated by `python3 mobile/scripts/gen_card_frames.py`, `gen_card_back.py`, `gen_particles.py` (Pillow only; exit 0; deterministic seed so re-runs are byte-stable).

| Path | Size | Producer | Export from `packArt.ts` | Consumers |
|---|---|---|---|---|
| `mobile/assets/ui/frame-com.png`, `frame-rar.png`, `frame-leg.png` | 400×560, transparent art window | gen_card_frames.py | `CARD_FRAME_IMAGES: Record<Rarity, ImageSourcePropType>`, `cardFrameForRarity(rarity)`, `CARD_FRAME_SIZE = { width: 400, height: 560 }`, `CARD_FRAME_ART_WINDOW = { x: 28, y: 64, width: 344, height: 296 }`, `CARD_FRAME_NINE_SLICE_INSET = 40` | B08 TapCard (`frameImage` prop), B10 DrawResult CardFace |
| `mobile/assets/ui/foil-lut.png` | 256×4 RGB | gen_card_frames.py | `FOIL_LUT` | B08 FoilLayer (`lut` prop) |
| `mobile/assets/ui/particles.png` | 256×64, four 64×64 sprites | gen_particles.py | `PARTICLE_SHEET`, `PARTICLE_SPRITES = { dot: 0, star: 64, fleck: 128, shard: 192 }` (x offsets), `PARTICLE_SPRITE_SIZE = 64` | B05 StageCanvas |
| `mobile/assets/ui/glow-9slice.png` | 96×96 alpha radial | gen_particles.py | `GLOW_9SLICE`, `GLOW_9SLICE_INSET = 32` | B05 rims, B09 FallbackStage rims, B10 DrawResult featured halo |
| `mobile/assets/packs/{ai,cloud,aws,premium-deck,default}-back.png` | 400×560 | gen_card_back.py | `CARD_BACK_IMAGES` gains `ai, cloud, aws, 'premium-deck'`; `DEFAULT_CARD_BACK` (the `default-back.png`, exported separately — `cardBackImageForSlug` keeps its undefined-on-miss contract, `packArt.ts:245-250`, test:19-31) | B08 TapCard, B09 |
| `mobile/assets/packs/csharp-back.png` | existing | untouched | already registered (`:189`) | — |

`normalizeSlugForPack` (`packArt.ts:198-223`): insert `if (s === 'aws' || s.startsWith('aws-')) return 'aws';` **before** the cloud branch (`:214-222`), and mirror it in `packPaletteFromSlug`'s canonical mapping (`:91-104`, which currently sends anything containing `aws` to `cloud`) so `aws-saa-c03` gets the `aws: 1` palette (`:79`). `PAGE_GRADIENT_CEREMONY` (`:131-135`) bottom stop `'#E8E2F2'` → `'#D9D2E6'` (§3.1 S0) — B12, not asserted by any test. `SEAM_BAND_RATIO = 0.18` is B06's single appended line; B12 must not move it.

---

## 7. Cleanup rules (B11) and grep guards shared by verify scripts

1. `mobile/src/components/CeremonyLottie.tsx`, `mobile/src/components/HolographicLayer.tsx`, `mobile/assets/lottie/` (README.md, pack-opening.json, pack-opening.lottie), `mobile/scripts/gen_lottie.py` are deleted. After B11: `grep -ri lottie mobile/src mobile/scripts` is empty; `grep -rn "expo-av" mobile/src` is empty.
2. Nothing under `mobile/src`, `mobile/App.tsx` or `mobile/tests` imports `CeremonyLottie`, `HolographicLayer`, `SparkleField`, `ParticleBurst`, `MultiPackFlyIn`, `buildParticles`, `ceremonyLottieAvailable` (B11 removes the one test case that did, §2.11).
3. One Skia `Canvas` in each of `StageCanvas.tsx` (B05), `PackTear.tsx` (B06) and `FoilLayer.tsx` (B08, mounted only on the focused RAR/LEG card) — grep `<Skia.Canvas` / `<Canvas` count in `mobile/src/components/ceremony` and `DrawCeremonyScreen.tsx` ≤ 3. (The design DoD's "one per stage plus one focused-card canvas" counts the pack as part of the stage; §2.8/§2.9 give it its own file and canvas.)
4. `shadowRadius` ≥ 16 removed in the **gacha/ceremony tree** only: `mobile/src/screens/DrawCeremonyScreen.tsx`, `mobile/src/components/ceremony/**`, `mobile/src/screens/DrawScreen.tsx` (`:893`, `:993`), `mobile/src/features/gacha/components/drawResultStyles.ts` (`:138`, `:559`), `mobile/src/features/gacha/components/RewardSummaryCard.tsx` (`:108`), plus the seven sites that die with `CeremonyLottie.tsx` (`:660, :716, :744, :790, :799, :850, :971`). Guard: `grep -rnE "shadowRadius: *(1[6-9]|[2-9][0-9])" mobile/src/screens/Draw*.tsx mobile/src/components/ceremony mobile/src/features/gacha` is empty, and every `shadowRadius: N` left in `DrawCeremonyScreen.tsx` + `mobile/src/components/ceremony/**` has N ≤ 8 (no style-key count: the design's "≤ 3 shadowed RN views" is a rendered-view count for B14's device review). Screens outside that tree (`AuthGateModal`, `WelcomeScreen`, `HomeScreen`, …) are out of scope for Wave B.
5. Diff-scoped banned terms (driver gate, all issues): `humanizer|bypass|undetect|detector|evade|Gemini said`, matched case-insensitively over added lines under `mobile/src frontend/src src_C/Vpc src_C/Worker`. The wave's `wave.conf` anchors the fourth term at a word start (`\bdetector`, verified against BSD grep), which is why `GestureDetector` passes (§9 #15).

---

## 8. verify.sh conventions (all issues)

Copy `docs/delivery/r16-issues/A02.verify.sh`'s skeleton: `#!/usr/bin/env bash`, `set -euo pipefail`, `ROOT="$(git rev-parse --show-toplevel)"; cd "$ROOT"`, `BASE_REF="${BASE_REF:-${BASE:-delivery/r16-b-ceremony}}"`, `fail()`, numbered `echo "[k/n] …"` steps, a header comment naming the step that fails on the untouched base and why, scope guard = `git diff --name-only "$(git merge-base "$BASE_REF" HEAD)" HEAD` ∪ `git ls-files --others --exclude-standard -- mobile/src mobile/tests mobile/App.tsx mobile/app.json mobile/package.json mobile/package-lock.json mobile/vitest.config.ts mobile/assets mobile/scripts mobile/docs docs LICENSE-ASSETS` (never unscoped: the `node_modules` symlink is untracked) filtered by an allow-regex of the issue's §1 row plus `^docs/delivery/r16-issues/`, a frozen-file guard (`git diff --quiet "$MB" HEAD -- mobile/src/content/deckRepository.ts mobile/src/sync/progressSync.ts mobile/src/review/model.ts`), positive and negative greps for the brief's literals, test-gutting greps (`\.skip\(|\.only\(|@ts-ignore|eslint-disable`), `"vite": "7.2.4"` present, no `@sentry`, and final `echo "B0N VERIFY OK"`. Targeted vitest files only, never piped into `tail`; `tsc` at most once; total < 5 min. B01 alone may run `npx expo prebuild --no-install --platform ios` and must `rm -rf mobile/ios` afterwards (also on failure, via `trap`).

---

## 9. Contradictions resolved (design/spec vs. code) — decisions binding on every brief

1. **"Delete 3 Lottie cases" vs. four Lottie-mocking tests, and "5 `… inbound` literals" (which counts line 667 inside the fourth).** Four tests mock `CeremonyLottie` (test:518, :581, :636, :735). Deleting all four leaves only four `inbound` literals; the design's count of five (`release-1.6.0-plan:269`, `:118`) means the multi-choreography case at :636 was meant to survive. Decision: delete :518 (duplicated by new RM case 3), :581 (its subject, `onAnimationFinish`, no longer exists) and :735 (asserts a mounted Lottie); keep :636 with the four mechanical edits listed in §4.2 (scaffold removed, title de-Lottied, `<DrawCeremonyScreen`, `'lottie'` → `'fallback'` because `draw-ceremony-orbit-mode` now reports the renderer). The orbit sampling contract itself is kept on `SpillSampler` (design decision #9, `:299`).
2. **B10 depends on B09 (spec) but B09's test edits need B10's copy** (`'Pack inbound'`/`'Pack open'` live in `ceremonyCopy.ts`, which is B10's file) and B09's screen needs `types.ts` params (`tapFlow`, `revealedUids`, `tableReached`) that B10 adds. Decision: reverse the edge — B10 (copy, params, DrawResult chips, DrawScreen preheat) runs before B09 with deps B02, B04, B08, B12; B09 depends on B10. B10's `revealedUids` handling is optional-prop-safe so it works before anyone passes it.
3. **§2 anticipation band (Rare+/multi 1200–2000 ms) vs. §3.1 M1 approach 920 + M2 LEG hold 1100 = 2020.** Decision: DEVICE multi approach = **900** (LEG multi anticipation 2000, table at 5000 ms; the storyboard's "5020" becomes 5000). A 20 ms trim to approach is invisible; a special case in the unit test would be a rule bent to fit. B14's docs copy the numbers from §2.2 here, not from §3.1.
4. **B11 was to create `ceremonyStyles.ts` + `FeaturedCard.tsx` while B09 (before it) may not import `Lottie`-named modules.** Decision: B08 creates `ceremonyStyles.ts` (tapCard subset), B09 extends it and creates `FeaturedCard.tsx`, `FallbackStage.tsx`, `SpillSampler.tsx`; B11 is deletion + trimming + shadowRadius.
5. **`packArt.test.ts:19-24` asserts `ai`/`cloud` have no card back; B12 adds backs for every deck.** Decision: B12 updates that case (its scope includes the test) and keeps `cardBackImageForSlug`'s undefined-on-miss for unregistered slugs by exporting `default-back.png` as `DEFAULT_CARD_BACK` instead of registering `default`.
6. **`featureFlags.test.ts` "add cases only" vs. full-object `toEqual` literals.** Decision: B02 may add the `ceremony` key to those literals (§3.4); nothing else in existing lines changes.
7. **Design lists `eas.json` (staging channel) and Sentry in the M2 commit.** Both are out: Sentry per the 2026-09-20 scope change; `eas.json` because the spec's B01 scope excludes it and the owner edits it at build time.
8. **"15 shadowRadius sites"** — the tree has 23 sites ≥ 16 under `mobile/src`, 12 of them in the gacha/ceremony tree (§7.4). Decision: B11 clears the gacha/ceremony tree only; the rubric's rule (§3.5) is scoped to the ceremony.
9. **Sound files for the new vocabulary are not committed** (only six synthesized WAVs exist, `mobile/assets/sfx`). Decision: B04 maps every new name onto a committed file through `SFX_ALIASES` (a static `require` of a missing file would break Metro); the owner swaps files in at wave end; B14's `LICENSES.md` lists the intended final names with empty source/licence cells.
10. **`CeremonyTuning` route without a `Stack.Screen`** — the spec's B13 scope had no `App.tsx`. Decision: B13 may add exactly one `__DEV__`-guarded `Stack.Screen` line and one import to `App.tsx`; B15 is serialised after B13.
11. **Where the fallback/test swipe lives.** The integration test drives `draw-ceremony-stage`'s raw responder (test:114-121), not the pack. Decision: the raw responder stays on the stage View in `DrawCeremonyScreen.tsx` (B09) and feeds `timeline.seam`; `PackTear`'s GH Pan is the device path; both end in the same `onTear`/`startSequence`.
12. **`RoundRect` in the design text.** Skia 2.2.12 exports `RoundedRect` (`lib/module/renderer/components/shapes/RoundedRect.js`); briefs use `RoundedRect`.
13. **`vi.mock` does not reach a CommonJS `require()` under this repo's vitest 4.1.5** (probe 2026-09-20, run from `mobile/`: `require('expo-sharing')` inside a `try` → `MODULE_NOT_FOUND` even with `vi.mock('expo-sharing', …)` registered; `await import('expo-sharing')` → the mock). vite-node gives each module Node's own `createRequire`, so only `import()` goes through the mock registry. Decisions: (a) B15's `shareDraw.ts` / `ratingPrompt.ts` load their optional native packages with a guarded **dynamic `import()` inside a function** (§2.15 wording amended from "guarded require"; signatures unchanged); (b) a module-scope guarded `require()` (B02 `reanimatedGuard.ts` §2.1, B04 `ceremonyAudio.ts` §2.6) is a DEVICE mechanism only — under vitest it is never redirected by the setup-file mocks of §4.1, so tests must rely on the `__CEREMONY_MOTION_AVAILABLE__` override (read before any require, §2.1) or mock the guard/audio module itself (`vi.mock('../../src/components/ceremony/reanimatedGuard', …)`), never on §4.1 item 2–5 reaching a `require()`; (c) any test that imports a module containing a module-scope guarded `require()` of a real installed package must expect that package's entry to actually execute under Node — mock the guard module instead (B13 does).
14. **Who cuts the seam.** B06's Pan and B09's raw responder drive `timeline.seam` with the finger (0..1 by `seamProgressFromDelta`), and both reach 1 at the commit; the S3 "seam sweeps in 250 ms" would then animate 1→1 and the pack would sit fully cut through approach and hold. Decision: **the hook owns the cut from approach onward** — B07's `approach` branch relaxes `seam` to `SEAM_PRECUT` (0.15, a nick) over 120 ms OUT_QUAD, `hold` keeps it, `tear-flip` sweeps `SEAM_PRECUT`→1 in 250 ms OUT_CUBIC. B06/B09 may still set `seam = 1` on the commit (it is re-targeted on the next effect tick); they never touch `seam` after `swipe`.
15. **`GestureDetector` vs the driver's banned term `detector`** (matched case-insensitively). Decision: `wave.conf` anchors the term as `\bdetector`, so the library name passes the gate unchanged; the guard exposes it as `GestureHandler.PanHost = GestureDetector` (§2.1) and consumers (B06, B08) use the alias; verify scripts grep `PanHost`. No runtime-assembled keys, no spelling bans.
16. **Timeline units were unspecified** (B05 read `raysAngle`/`spill[i].rot` as radians and `spill[i].x/.y` as absolute px; B07 produced degrees and centre offsets). Decision: §2.10 "Units" — radians for everything Skia rotates, pt offsets from the stage centre for the spill, B05 nests the rims in a centre-origin `Group`; `spillSlotOffset` keeps degrees for the RN fallback and the hook converts.
17. **`cameraScale`/`cameraRot` had no consumer** (produced by B07, read by neither B05 nor B06). Decision: B09's `styles.content` wrapper is a `Reanimated.View` with one `Reanimated.useAnimatedStyle` (`scale: cameraScale.value`, `rotate: \`${cameraRot.value}deg\``) — the single Reanimated hook the screen may call outside `useCeremonyTimeline`; under the guard fallback it is a plain `View` with a plain style object, so no test changes.
18. **Where the pack sits relative to the stage light.** B05's leak band and burst origin align to `packRectInStage(stageW, stageH)`; B06's `packBodyRect(slotW, slotH)` is 70 % of its slot; the B09 brief mounted `<PackTear width={240} height={336}>` with no position, so the two would not coincide (`packBodyRect(240, 336)` is 156.8 px wide vs. 128.8). Decision: the geometry lives in ONE place — B05 exports `PACK_BODY_FRACTION = 0.7` (B06 keeps its own equal constant) and `packSlotInStage(w, h)` = `packRectInStage` inflated by `1 / 0.7` about its centre (§2.8); B09 mounts `PackTear` at that slot, `position: 'absolute'`, and its `width={240} height={336}` literal is superseded. The B09 brief must be updated to match before B09 runs.
19. **`JSX.Element` in the verbatim signatures.** `@types/react` 19.1 declares `namespace JSX` only inside `namespace React` (`mobile/node_modules/@types/react/index.d.ts:4028`, no `declare global`), so a bare `JSX.Element` return annotation is TS2503 under `npm run test:typecheck` (probe 2026-09-20 with `expo/tsconfig.base`). Decision: every signature here and in the briefs reads `React.JSX.Element`; workers may also omit the return annotation. B05/B06 verify scripts grep bare `JSX.Element` as banned; B08/B09/B13/B15 workers apply the same rule.
