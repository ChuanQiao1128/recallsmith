# B02 — reanimatedGuard + ceremonyTimings + ceremony test setup + ceremony feature flag (`reanimated-guard-timings`)

The single discriminant `motionAvailable` (guarded `require` of Reanimated + worklets + Skia, with a deterministic no-op surface when any is missing), the pure timing module that owns `CeremonyPhase`/`PeakRarity`, `TEST_BASE` (today's table, byte-for-byte) and `DEVICE` (the Seam-of-Light table), the global vitest setup file that mocks every native package Wave B touches and pins `motionAvailable` to `false` under tests, and `FeatureFlags.ceremony { seamOfLight, forceFallback }`.

## Context

Every phase transition and every renderer choice in the new ceremony hangs off one boolean (`docs/release-1.6.0-plan-2026-09-19.md:87`: "一个判别量 `motionAvailable` … 同时决定时长表（真机 DEVICE / 测试 TEST_BASE）和渲染器（skia / fallback）；测试里显式 mock 成 false"). Today that decision is smeared over three places: `DrawCeremonyScreen.tsx:52` `hasAnimated = typeof A.Value === 'function'` picks `TIMING_SCALE` 2.5 vs 1 (`:95`), `HolographicLayer.tsx:23-33` has its own guarded `require('@shopify/react-native-skia')`, and `CeremonyLottie.tsx:37` a third for Lottie. The timing table lives inline in `DrawCeremonyScreen.tsx:97-125` (`phaseDurations`) with the three constants at `:67-69`; the integration test asserts exactly those numbers (`tests/integration/draw-ceremony.screen.test.tsx:73-92` `MULTI_TIMING`/`SINGLE_TIMING`/`REDUCED_TIMING`) and B09 keeps that test's prefix byte-identical (B00 §4.2), so `TEST_BASE` must reproduce them literally.

`HolographicLayer.tsx:65-78` is also the latent crash: it destructures `useClock` and `useDerivedValue` from the Skia module — the latter is not a Skia export, the former goes through Skia's ReanimatedProxy — and the table would crash at mount with any RAR/LEG card. B08 replaces that file; B02's job is to make sure no Wave B module can repeat the mistake: everything Reanimated-shaped is read from `reanimatedGuard.ts` (B00 §2.1), which never re-exports `useClock`.

Verified on this tree (2026-09-20, vitest 4.1): `vi.mock()` intercepts ESM `import`s but **not** `require()` calls — a guarded `require('@shopify/react-native-skia')` inside a test process throws `ERR_MODULE_NOT_FOUND` regardless of any `vi.mock`, and `require('react-native-reanimated')` throws because the package is not resolvable under Node. That is why the guard reads an explicit test override first (`globalThis.__CEREMONY_MOTION_AVAILABLE__`, set by the new setup file) and never lets the requires decide under vitest, and why the setup file's `vi.mock`s exist at all: they catch any Wave B module that mistakenly `import`s a native package directly, so nothing can reach a native binding before B15.

Metro has the opposite constraint, and it decides the *shape* of the guarded requires: a `require()` whose argument is not a string literal is rejected at bundle time for app source (`mobile/node_modules/metro-transform-worker/src/index.js:60-66` — `dynamicDepsInPackages: 'throwAtRuntime'` (`metro-config/src/defaults/index.js:100`) only relaxes it under `node_modules`; everything else is `'reject'`, `metro/src/ModuleGraph/worker/collectDependencies.js:341-347`), and a literal require of a package that is not installed only builds when the call sits directly inside a `try {}` block and `allowOptionalDependencies` is on (`collectDependencies.js:393-418`; Expo sets it to `true`, `mobile/node_modules/expo/node_modules/@expo/metro-config/build/ExpoMetroConfig.js:308`). So the guard uses four separate `try { return require('<literal>'); } catch { return null; }` loaders — exactly `HolographicLayer.tsx:23-30` four times — and never a `require(name)` helper.

The feature flag: `src/config/featureFlags.ts:5-15` (`FeatureFlags`), `:17-27` (frozen defaults), `:36-44` (`snapshotsEqual`), `:56-97` (`applyRemoteFeatures`, boolean-typed fallbacks per field) — Wave A's A01 shape. `ceremony.seamOfLight` is the remote kill switch for a post-release shader/GPU crash class (renderer → fallback without an OTA); `ceremony.forceFallback` is the diagnostic twin (B00 §3.4). `RemoteFeatures` in `src/config/remoteConfig.ts:38-41` is NOT extended (B00 §3.4): `applyRemoteFeatures` already reads `features` as `Record<string, unknown>` after `isRecord` (`featureFlags.ts:57-58`), so `features?.ceremony` type-checks; the unit test passes `ceremony` through the existing `asRemoteConfig()` cast (`tests/unit/featureFlags.test.ts:38-40`).

B01 (merged before this issue) added `react-native-reanimated`, `react-native-worklets`, `expo-audio`, `expo-store-review`, `expo-sharing`, `react-native-view-shot` to `package.json` and removed `lottie-react-native` / `expo-av`; the driver then ran `npm install` on the shared checkout, so the `mobile/node_modules` your worktree symlinks to already holds the new packages (B00 §0). B02 adds no dependency and runs no npm command.

One naming rule shapes the gesture surface: react-native-gesture-handler's wrapping component — the export that takes `gesture={…}` and wraps the gestured subtree — has a name ending in "Detector", and the driver's banned-term gate greps every added line under `mobile/src` **case-insensitively** for `detector` (B00 §0, §9 #15). The wave's `wave.conf` anchors that term at a word start (`\bdetector`), so `GestureDetector` passes the gate and may be written normally. The guard exposes it under the alias `GestureHandler.PanHost` (read directly as `loaded.gestureHandler.GestureDetector`) so B06/B08 share one name.

## Read first

1. `docs/delivery/r16-issues/B00-contracts.md` §2 preamble (`CeremonyPhase`/`PeakRarity` ownership), §2.1 (guard — signatures verbatim), §2.2 (timings — tables and functions verbatim, plus the unit-test paragraph after the code block), §3.4 (flag), §4.1 (setup file, items 1–10), §8 (verify conventions), §9 #3 (multi approach 900) and #6 (test literals may gain the `ceremony` key).
2. `mobile/src/screens/DrawCeremonyScreen.tsx:40-52` (`readRN`, `hasAnimated`), `:57-69` (phase union, `PeakRarity` alias, the three constants), `:90-125` (`TIMING_SCALE` + `phaseDurations` — the source of `TEST_BASE`), `:758` (`autoAdvanceTail … : 500` — the source of `TEST_BASE.tableTailMs`).
3. `mobile/tests/integration/draw-ceremony.screen.test.tsx:73-92` (the three timing tables that must keep passing) and `:9-36` (the test's own `react-native` mock — the setup file must not collide with it).
4. `mobile/src/components/HolographicLayer.tsx:23-33` (guard pattern to copy — without the `eslint-disable` comment) and `:65-78` (the crash you are designing out).
5. `mobile/src/features/gacha/draw/cardRarity.ts:3` (`Rarity`).
6. `mobile/src/config/featureFlags.ts:1-108` (whole file) and `mobile/tests/unit/featureFlags.test.ts:1-40, 65-87, 101-129, 131-178, 222-262` (every full-object `toEqual`).
7. `mobile/vitest.config.ts:26-31` and `mobile/tests/setup/globals.ts` (why `__DEV__` is a setup file; yours runs after it).
8. `mobile/tests/unit/libraryCardTile.test.tsx:1-25` (the `react-native` mock your guard test needs) and `mobile/tests/unit/forceUpdateGate.test.tsx:51-53`.
9. `docs/release-1.6.0-plan-2026-09-19.md:96-117` (storyboard rows S0–S6 / M0–M6 with the DEVICE numbers), `:156-157` (the two code rows for this issue).

## Constraints

- **Scope (the ONLY files that may change):**
  - `mobile/src/components/ceremony/reanimatedGuard.ts` (new; creates the `ceremony/` directory)
  - `mobile/src/features/gacha/draw/ceremonyTimings.ts` (new)
  - `mobile/tests/setup/ceremony.ts` (new)
  - `mobile/tests/unit/ceremonyTimings.test.ts` (new)
  - `mobile/tests/unit/reanimatedGuard.test.tsx` (new — listed in the spec JSON scope and B00 §1 since 2026-09-20; the guard's no-op semantics are what B05–B09 build on and no other issue asserts them; `.tsx` because cases 5–6 render JSX)
  - `mobile/vitest.config.ts` (one line: `setupFiles`)
  - `mobile/src/config/featureFlags.ts` (add the `ceremony` group only)
  - `mobile/tests/unit/featureFlags.test.ts` (add cases; add the `ceremony` key to the existing full-object `toEqual` literals — nothing else in existing lines)
- **Frozen (zero diff):** `mobile/src/content/deckRepository.ts`, `mobile/src/sync/progressSync.ts`, `mobile/src/review/model.ts`. Also untouched in this issue: `mobile/src/config/remoteConfig.ts`, `mobile/src/screens/DrawCeremonyScreen.tsx`, `mobile/src/components/HolographicLayer.tsx`, `mobile/tests/setup/globals.ts`, `mobile/package.json`.
- **No dependency changes.** `mobile/package.json` / `package-lock.json` are not in scope; every package the setup file mocks is already installed by B01.
- **Pure modules stay pure:** `ceremonyTimings.ts` imports nothing but `import type { Rarity } from './cardRarity'` (no `react`, no `react-native`, no guard). The guard imports `react`, `react-native` (`View` only) and does guarded `require`s — nothing else.
- **`__DEV__`** is a global declared by RN's types (used bare at `src/config/appEnv.ts:25`); read it at call time, never at module load, so a test can flip `globalThis.__DEV__`.
- **Guarded requires are four literal `require('<package>')` calls, each directly inside its own `try {}`** — never `require(name)` with a variable (Metro rejects non-literal requires in app source; see Context) and never a shared `tryRequire(name)` helper. No `eslint-disable-next-line` comment (the driver's suppression gate rejects it; `HolographicLayer.tsx:25` predates the gate). No static `import … from 'react-native-reanimated' | 'react-native-worklets' | '@shopify/react-native-skia' | 'react-native-gesture-handler'` anywhere in the guard. verify.sh greps the four literal strings and fails on any `require(` whose next character is not a quote — that includes comments, so never write `require(x)`-style prose in this file.
- **Never export or reference `useClock`** from the guard or the setup mock (B00 §2.1; grep-guarded).
- **Gesture host alias:** the guard's member is `PanHost` (B00 §2.1, §9 #15), read directly as `loaded.gestureHandler.GestureDetector`. The driver's banned-term gate matches `\bdetector` (word start, case-insensitive), so `GestureDetector` is fine in code, comments and tests; consumers must still use `GestureHandler.PanHost`, and verify.sh greps for `PanHost:`.
- **Test-literal rules:** in `featureFlags.test.ts` existing `it(` titles and assertions stay; the only permitted edit to an existing line is adding `ceremony: { seamOfLight: true, forceFallback: false },` (or `ceremony: DEFAULT_FEATURE_FLAGS.ceremony,`) inside a full-object `toEqual` literal so it still matches. `draw-ceremony.screen.test.tsx` is not touched (its timing tables must pass against the base screen — they do, because `DrawCeremonyScreen.tsx` is not edited here).
- **Banned literals in new/changed lines:** `humanizer`, `bypass`, `undetect`, `detector`, `evade`, `Gemini said`. No `@ts-ignore`, `@ts-expect-error`, `eslint-disable`, `.skip(`, `.only(`.
- **Numbers are contracts.** `TEST_BASE` and `DEVICE` object literals must appear exactly as printed in change 2 (one row per line, same key order, same spacing) — verify.sh greps those lines with `grep -F`.

## Changes required

1. **`mobile/src/components/ceremony/reanimatedGuard.ts` (new)** — exports exactly the surface of B00 §2.1. Shape:
   ```ts
   import React, { useRef } from 'react';
   import { View } from 'react-native';

   /** `{ value: T }` — the only shape any Wave B module may assume for a shared value. */
   export type SharedValue<T> = { value: T };

   type Loaded = { reanimated: any; worklets: any; skia: any; gestureHandler: any };

   // Four literal requires, one try block each: Metro only tolerates a missing package
   // when the literal require sits directly inside a try {} (see Context), and it rejects a
   // non-literal require argument outright in app source — so no shared loader helper.
   function loadReanimated(): any | null {
     try {
       return require('react-native-reanimated');
     } catch {
       return null;
     }
   }
   function loadWorklets(): any | null {
     try {
       return require('react-native-worklets');
     } catch {
       return null;
     }
   }
   function loadSkia(): any | null {
     try {
       return require('@shopify/react-native-skia');
     } catch {
       return null;
     }
   }
   function loadGestureHandler(): any | null {
     try {
       return require('react-native-gesture-handler');
     } catch {
       return null;
     }
   }

   /**
    * Test override. tests/setup/ceremony.ts sets it to false before any import so vitest
    * never lets a guarded require decide (vi.mock does not intercept CJS requires — verified on this
    * tree). Only `false` is honoured: the flag can deny motion, it can never fake a native
    * module. Anything other than `false` (undefined, true) → the guarded requires decide.
    */
   const override = (globalThis as { __CEREMONY_MOTION_AVAILABLE__?: unknown }).__CEREMONY_MOTION_AVAILABLE__;
   const loaded: Loaded | null =
     override === false
       ? null
       : {
           reanimated: loadReanimated(),
           worklets: loadWorklets(),
           skia: loadSkia(),
           gestureHandler: loadGestureHandler(),
         };

   export const motionAvailable: boolean = !!(loaded?.reanimated && loaded?.worklets && loaded?.skia);
   export const skiaAvailable: boolean = !!loaded?.skia;
   export const SkiaModule: any | null = loaded?.skia ?? null;
   ```
   Then the `Reanimated` object: when `motionAvailable`, every member is the real export (`RA.useSharedValue`, `RA.useDerivedValue`, `RA.useAnimatedStyle`, `RA.useAnimatedReaction`, `RA.withTiming`, `RA.withSpring`, `RA.withDelay`, `RA.withSequence`, `RA.withRepeat`, `RA.cancelAnimation`, `RA.runOnJS`, `RA.interpolate`, `RA.interpolateColor`, `RA.Easing`, `RA.default.View`, `RA.default.createAnimatedComponent`, with `RA = loaded.reanimated`). Otherwise the deterministic fallbacks, verbatim semantics from B00 §2.1:
   - `useSharedValue<T>(init)` → `useRef<SharedValue<T>>({ value: init }).current` (same object across renders);
   - `useDerivedValue(fn)` → `{ value: fn() }` (recomputed on every render, no memo);
   - `useAnimatedStyle(fn)` → `fn()`;
   - `useAnimatedReaction()` → `undefined`;
   - `withTiming(to, cfg?, cb?)` → `cb?.(true)` synchronously, return `to`; `withSpring` likewise; `withDelay(ms, anim)` → `anim`; `withSequence(...a)` → `a[a.length - 1] ?? 0`; `withRepeat(anim)` → `anim`; `cancelAnimation()` → `undefined`; `runOnJS(fn)` → `fn`;
   - `interpolate(v, input, output)` → piecewise-linear over the stops, extending beyond both ends (Reanimated's default `EXTEND`), returning `output[0]` when `input.length < 2`;
   - `interpolateColor(v, input, output)` → find the two neighbouring stops as above, parse each colour (`#RGB`, `#RRGGBB`, `#RRGGBBAA`, `rgb(...)`, `rgba(...)`), mix per channel and return `` `rgba(${r},${g},${b},${a})` `` with `r,g,b` rounded integers and `a` at most 3 decimals; if either stop fails to parse return the nearer stop's string unchanged; `v` at or before the first stop returns `output[0]` **unchanged**, at or after the last returns the last stop unchanged (so a caller reading a hex constant back gets its hex);
   - `Easing`: `bezier(a,b,c,d)` → `(t) => t`; `linear`, `cubic`, `quad` → `(t) => t`; `out(e)` and `in(e)` → `e`;
   - `View` → RN `View`; `createAnimatedComponent(c)` → `c`.
   Then `GestureHandler` (B00 §2.1 — `PanHost` IS the library's `GestureDetector`; one alias so B06/B08 share a name):
   ```ts
   export const GestureHandler: {
     available: boolean;
     PanHost: React.ComponentType<{ gesture: unknown; children?: React.ReactNode }>;
     Gesture: { Pan(): any; Tap(): any };
   } = motionAvailable && loaded?.gestureHandler
     ? { available: true, PanHost: loaded.gestureHandler.GestureDetector, Gesture: loaded.gestureHandler.Gesture }
     : { available: false, PanHost: ({ children }) => React.createElement(React.Fragment, null, children), Gesture: { Pan: inertGesture, Tap: inertGesture } };
   ```
   where `inertGesture()` returns an object whose methods `onBegin, onStart, onUpdate, onChange, onEnd, onFinalize, activeOffsetX, activeOffsetY, failOffsetX, failOffsetY, enabled, minDistance, maxPointers, runOnJS, simultaneousWithExternalGesture, requireExternalGestureToFail, hitSlop, shouldCancelWhenOutside` all return the same object (a Proxy is acceptable; a literal is fine). `GestureHandler.available` is `false` whenever `motionAvailable` is false — the tear Pan has nothing to drive without Reanimated.
   Module-level constants only; nothing in this file may be re-evaluated later. File header comment: one paragraph naming the crash it prevents (`HolographicLayer.tsx:65-78`) and the rule that no consumer may read the Skia clock hook or a derived-value hook from `SkiaModule` (they come from `Reanimated` above). **Do not spell the token `useClock` anywhere in this file, not even in that comment** — verify.sh greps the bare token; write "the Skia clock hook" instead.

2. **`mobile/src/features/gacha/draw/ceremonyTimings.ts` (new, pure)** — exactly B00 §2.2. Types:
   ```ts
   import type { Rarity } from './cardRarity';

   export type CeremonyPhase =
     | 'swipe' | 'approach' | 'hold' | 'tear-flip' | 'flash-reveal' | 'settle' | 'cards-on-table';
   export type PeakRarity = Rarity;
   export type { Rarity };

   export type CeremonyTimingTable = {
     single: { approach: number; hold: Record<PeakRarity, number>; tearFlip: number; flashReveal: number; settleMs: number };
     multi:  { approach: number; hold: Record<PeakRarity, number>; tearFlip: number; flashReveal: number; settleMs: number };
     tableTailMs: number;
     beatMs: Record<PeakRarity, number>;
     flipMs: Record<PeakRarity, number>;
     rimSettleMs: Record<PeakRarity, number>;
     liftMs: number; landMs: number; tapQueueMs: number;
   };
   ```
   Tables — these lines verbatim (verify.sh `grep -F`s each `single:`/`multi:`/`tableTailMs`/`beatMs`/`flipMs`/`rimSettleMs`/`liftMs` line of both):
   ```ts
   export const TEST_BASE: CeremonyTimingTable = Object.freeze({
     single: { approach: 300, hold: { COM: 140, RAR: 180, LEG: 220 }, tearFlip: 360, flashReveal: 220, settleMs: 200 },
     multi:  { approach: 620, hold: { COM: 220, RAR: 260, LEG: 300 }, tearFlip: 940, flashReveal: 280, settleMs: 300 },
     tableTailMs: 500,
     beatMs: { COM: 0, RAR: 0, LEG: 0 },
     flipMs: { COM: 0, RAR: 0, LEG: 0 },
     rimSettleMs: { COM: 0, RAR: 0, LEG: 0 },
     liftMs: 0, landMs: 0, tapQueueMs: 90,
   });

   export const DEVICE: CeremonyTimingTable = Object.freeze({
     single: { approach: 600, hold: { COM: 360, RAR: 620, LEG: 880 }, tearFlip: 600, flashReveal: 320, settleMs: 520 },
     multi:  { approach: 900, hold: { COM: 600, RAR: 860, LEG: 1100 }, tearFlip: 1800, flashReveal: 400, settleMs: 600 },
     tableTailMs: 200,
     beatMs: { COM: 120, RAR: 180, LEG: 300 },
     flipMs: { COM: 380, RAR: 480, LEG: 640 },
     rimSettleMs: { COM: 800, RAR: 1000, LEG: 1200 },
     liftMs: 80, landMs: 200, tapQueueMs: 90,
   });
   ```
   (`TEST_BASE` = `DrawCeremonyScreen.tsx:97-120` with `TIMING_SCALE` 1 and `tableTailMs` = the non-Lottie `autoAdvanceTail` at `:758`; `DEVICE` = design §3.1 rows with the §9 #3 correction — multi approach **900**, not 920. Comments may sit on their own lines above; the object rows themselves must not carry trailing comments.) Constants, each on its own `export const` line with these exact values: `TO_TABLE_CAP_MS = Object.freeze({ single: 3300, multi: 5500 })`, `REDUCED_MOTION_FLASH_MS = 180`, `REDUCED_MOTION_SETTLE_MS = 240`, `SWIPE_TRIGGER_DISTANCE = 72`, `TELL_FRACTION_OF_HOLD = 0.6`, `FAST_FORWARD_FROM_HOLD_FRACTION = 0.6`, `FAST_FORWARD_TEAR_FACTOR = 1.6`, `SPILL_STAGGER_MS = 60`, `SPILL_START_FRACTION = 0.5`, `SPILL_TRAVEL_FRACTION = 1 / 6`. Functions:
   ```ts
   export type ResolvedCeremonyTimings = {
     table: 'TEST_BASE' | 'DEVICE';
     isMulti: boolean; peakRarity: PeakRarity;
     approach: number; hold: number; tearFlip: number; flashReveal: number; settleMs: number; tableTailMs: number;
     beatMs: number;
     flipMs: Record<PeakRarity, number>; rimSettleMs: Record<PeakRarity, number>;
     liftMs: number; landMs: number; tapQueueMs: number;
     toTableMs: number;
   };
   export function resolveCeremonyTimings(input: { isMulti: boolean; peakRarity: PeakRarity; motionAvailable: boolean }): ResolvedCeremonyTimings;
   export function phaseDurations(t: ResolvedCeremonyTimings): Record<CeremonyPhase, number>;
   export function compressTimings(t: ResolvedCeremonyTimings, elapsedInHoldMs: number): ResolvedCeremonyTimings;
   export function setCeremonyTimingOverride(override: Partial<CeremonyTimingTable> | null): void;
   export function getCeremonyTimingOverride(): Partial<CeremonyTimingTable> | null;
   ```
   Semantics:
   - `resolveCeremonyTimings`: `motionAvailable === false` → `TEST_BASE` as-is (the override is ignored). `true` → `DEVICE` merged with the override (two levels deep: `single`/`multi` are merged key-by-key and their `hold` records merged key-by-key; `beatMs`/`flipMs`/`rimSettleMs` merged key-by-key; scalars replaced). Pick `single`/`multi` by `isMulti`; `hold = row.hold[peakRarity]`; `beatMs = table.beatMs[peakRarity]`; `toTableMs = approach + hold + tearFlip + flashReveal + settleMs + tableTailMs`. Return a frozen object.
   - `phaseDurations(t)` → `{ swipe: 0, approach: t.approach, hold: t.hold, 'tear-flip': t.tearFlip, 'flash-reveal': t.flashReveal, settle: t.settleMs, 'cards-on-table': 0 }` — the same shape `DrawCeremonyScreen.tsx:112-120` builds today.
   - `compressTimings(t, elapsedInHoldMs)`: `beatStart = t.hold − t.beatMs`; `elapsedInBeat = max(0, elapsedInHoldMs − beatStart)`; returns `{ ...t, hold: max(0, t.beatMs − elapsedInBeat), tearFlip: Math.round(t.tearFlip / FAST_FORWARD_TEAR_FACTOR) }` with `toTableMs` recomputed from the new fields by the same sum (it is the sum of the remaining fields, not wall-clock from the swipe). `flashReveal`, `settleMs`, `tableTailMs` unchanged. Pure; input not mutated.
   - Override: module-level `let override: Partial<CeremonyTimingTable> | null = null`. `setCeremonyTimingOverride(o)`: when `__DEV__` is falsy → no-op; else store `o` (null clears). `getCeremonyTimingOverride()` returns the stored value (null outside `__DEV__`). The override only ever reaches `resolveCeremonyTimings` when the table is `DEVICE`.
   Header comment: two lines saying TEST_BASE is byte-for-byte the pre-1.6 table asserted by `draw-ceremony.screen.test.tsx:73-92` and must never change; DEVICE is tuned through `CeremonyTuning` (B13) and documented by B14.

3. **`mobile/tests/setup/ceremony.ts` (new)** — B00 §4.1 items 1–10, in that order. `import { beforeEach, vi } from 'vitest';` at the top; the first statement after imports is `(globalThis as any).__CEREMONY_MOTION_AVAILABLE__ = false;`. Every `vi.mock` factory does `const React = require('react');` inside itself (factories are hoisted; the pattern is `libraryCardTile.test.tsx:6`). Mocks:
   1. `react-native-reanimated`: default `{ View, Text, Image, createAnimatedComponent: (c) => c }` whose components render host elements `'Animated.View'`, `'Animated.Text'`, `'Animated.Image'`; named `useSharedValue(v) → ({ value: v })`, `useDerivedValue(fn) → ({ value: fn() })`, `useAnimatedStyle(fn) → fn()`, `useAnimatedReaction → undefined`, `withTiming(to) → to`, `withSpring(to) → to`, `withDelay(ms, a) → a`, `withRepeat(a) → a`, `withSequence(...a) → a[a.length - 1]`, `cancelAnimation → undefined`, `runOnJS(fn) → fn`, `interpolate(v, i, o) → o[0]`, `interpolateColor(v, i, o) → o[0]`, `Easing` (`bezier`, `linear`, `out`, `in`, `cubic`, `quad`, `ease`, `inOut` — every one resolves to `(t) => t`), `makeMutable(v) → ({ value: v })`.
   2. `react-native-worklets` → `{}`.
   3. `@shopify/react-native-skia`: components `Canvas, Group, Rect, RoundedRect, Image, Atlas, Path, Circle, SweepGradient, RadialGradient, LinearGradient, Shader, Paint, Fill, Mask` each `({ children, ...props }) => React.createElement('Skia.<Name>', props, children)`; `useImage → null`, `useImageAsTexture → null`, `useRSXformBuffer → []`, `useRectBuffer → []`; `vec(x, y) → ({ x, y })`, `rect(x, y, width, height) → ({ x, y, width, height })`, `rrect(r, rx, ry) → ({ rect: r, rx, ry })`; `Skia: { Path: { Make: () => chainable moveTo/lineTo/close returning itself }, RuntimeEffect: { Make: () => null }, Matrix4: () => [], Color: (c) => c }`; `BlendMode: { Plus: 'plus', SrcOver: 'srcOver' }`; `Matrix4 → []`, `rotateX`, `translate`, `multiply4`, `perspective` as identity helpers returning their first argument or `[]`. **No `useClock` key** (write the mock so the token never appears in the file).
   4. `expo-audio` (a safety net against an accidental static `import 'expo-audio'` somewhere in Wave B — B04's module keeps a guarded `require`, which `vi.mock` cannot reach, and B04's tests inject fakes through a factory instead of reading `globalThis.__ceremonyMocks`; B00 §2.6): `createAudioPlayer(source)` returns `{ play: vi.fn(), pause: vi.fn(), seekTo: vi.fn(), remove: vi.fn(), volume: 1, loop: false, playing: false, __source: source }` and pushes it to `globalThis.__ceremonyMocks.audio.players`; `setAudioModeAsync: vi.fn(async () => {})`; `useAudioPlayer(source) → createAudioPlayer(source)`.
   5. `expo-haptics` (same safety-net status, B00 §2.7): `{ impactAsync, selectionAsync, notificationAsync }` as `vi.fn(async () => {})` plus `ImpactFeedbackStyle { Light: 'light', Medium: 'medium', Heavy: 'heavy', Soft: 'soft', Rigid: 'rigid' }` and `NotificationFeedbackType { Success: 'success', Warning: 'warning', Error: 'error' }`; the same object is `globalThis.__ceremonyMocks.haptics`.
   6. `react-native-gesture-handler`: `GestureHandlerRootView` and `GestureDetector` render `React.createElement('View', props, children)`; `Gesture.Pan()` / `Gesture.Tap()` return a chainable stub (methods `onBegin, onStart, onUpdate, onChange, onEnd, onFinalize, activeOffsetX, activeOffsetY, failOffsetX, failOffsetY, enabled, minDistance, maxPointers, runOnJS, simultaneousWithExternalGesture, requireExternalGestureToFail, hitSlop, shouldCancelWhenOutside` returning `this`); `Directions` and `State` plain enums.
   7. `expo-sharing` `{ isAvailableAsync: vi.fn(async () => true), shareAsync: vi.fn(async () => {}) }`; `expo-store-review` `{ isAvailableAsync: vi.fn(async () => true), hasAction: vi.fn(async () => true), requestReview: vi.fn(async () => {}) }`; `react-native-view-shot` `{ captureRef: vi.fn(async () => 'file:///tmp/draw.png') }` — also exposed at `globalThis.__ceremonyMocks.sharing / .storeReview / .viewShot`.
   8. Global `beforeEach`: `players.length = 0` and `mockClear()` on every `vi.fn` above (walk the four mock objects).
   9. `declare global { var __ceremonyMocks: { audio: { players: any[]; setAudioModeAsync: …; createAudioPlayer: … }; haptics: …; sharing: …; storeReview: …; viewShot: … }; var __CEREMONY_MOTION_AVAILABLE__: boolean | undefined; }` and `export {};`.
   **Do not** mock `react-native`, `react`, `@react-native-async-storage/async-storage`, `expo-linear-gradient` or `react-native-safe-area-context` here (the integration tests own those mocks per file). Because `vi.mock` for a hoisted factory cannot see module-scope variables, build `globalThis.__ceremonyMocks` **inside** the factories (assign on first factory run) or via `vi.hoisted`.

4. **`mobile/vitest.config.ts:30`** → `setupFiles: ['./tests/setup/globals.ts', './tests/setup/ceremony.ts'],` (order matters: `globals.ts` defines `__DEV__` first). No other line changes.

5. **`mobile/src/config/featureFlags.ts`**
   a. `FeatureFlags` (`:5-15`): add `ceremony: { seamOfLight: boolean; forceFallback: boolean };` after `paywall`.
   b. `DEFAULT_FEATURE_FLAGS` (`:17-27`): add `ceremony: Object.freeze({ seamOfLight: true, forceFallback: false }),` after `paywall`.
   c. `snapshotsEqual` (`:36-44`): append `&& left.ceremony.seamOfLight === right.ceremony.seamOfLight && left.ceremony.forceFallback === right.ceremony.forceFallback`.
   d. `applyRemoteFeatures` (`:56-97`): `const remoteCeremony = features?.ceremony; const ceremony = isRecord(remoteCeremony) ? remoteCeremony : undefined;` next to `:59-62`, and in `nextSnapshot` add
      ```ts
      ceremony: Object.freeze({
        seamOfLight:
          typeof ceremony?.seamOfLight === 'boolean'
            ? ceremony.seamOfLight
            : DEFAULT_FEATURE_FLAGS.ceremony.seamOfLight,
        forceFallback:
          typeof ceremony?.forceFallback === 'boolean'
            ? ceremony.forceFallback
            : DEFAULT_FEATURE_FLAGS.ceremony.forceFallback,
      }),
      ```
      after the `paywall` block (`:84-89`). Add a two-line comment above the type members: `seamOfLight` = remote kill switch (renderer → fallback, timings unchanged), `forceFallback` = diagnostic twin of DebugMenu's in-memory override. Nothing else changes; `remoteConfig.ts` is not edited.

6. **`mobile/tests/unit/featureFlags.test.ts`**
   a. Add `ceremony: { seamOfLight: true, forceFallback: false },` (or `ceremony: DEFAULT_FEATURE_FLAGS.ceremony,`) to every existing full-object `toEqual` literal so the existing cases keep passing: `:75-83`, `:103-111`, `:115-118`, `:120-128`, `:142`, `:152-155`, `:171`, `:228-231`, `:251-259`. Cases comparing to `DEFAULT_FEATURE_FLAGS` itself (`:74`, `:132`, `:190`, `:222`, `:277`) need nothing. Do not rename, reorder or delete any `it(`.
   b. Append inside `describe('feature flags')`, titles verbatim:
      1. `it('ships the ceremony defaults frozen: seamOfLight on, forceFallback off', …)` — `getFeatureFlags().ceremony` toEqual `{ seamOfLight: true, forceFallback: false }`; `Object.isFrozen(getFeatureFlags().ceremony)` true; `DEFAULT_FEATURE_FLAGS.ceremony` is the same values.
      2. `it('applies boolean ceremony overrides and falls back per field on anything else', …)` — `applyRemoteFeatures(asRemoteConfig({ features: { ceremony: { seamOfLight: false, forceFallback: true } } })).ceremony` toEqual `{ seamOfLight: false, forceFallback: true }` (and `.mcq`/`.paywall` equal defaults); `asRemoteConfig({ features: { ceremony: { seamOfLight: 'off', forceFallback: 1 } } })` → ceremony equals defaults; `asRemoteConfig({ features: { ceremony: [] } })` → defaults; `asRemoteConfig({ features: { ceremony: { seamOfLight: false } } })` → `{ seamOfLight: false, forceFallback: false }`.
      3. `it('notifies subscribers when only a ceremony flag changes', …)` — subscribe a `vi.fn`, apply `{ features: { ceremony: { seamOfLight: false } } }` (via `asRemoteConfig`) → called once; apply the same again → still once (identity preserved); apply `null` → twice; unsubscribe.
   Every new remote-config literal that carries `ceremony` goes through `asRemoteConfig()` (`:38-40`) — `RemoteFeatures` has no `ceremony` member and a raw literal would fail the excess-property check under `tsc`.

7. **`mobile/tests/unit/ceremonyTimings.test.ts` (new)** — pure, no mocks. Cases (titles verbatim; each a separate `it`):
   1. `it('TEST_BASE is byte-for-byte the pre-1.6 table', …)` — `resolveCeremonyTimings({ isMulti: false, peakRarity: 'RAR', motionAvailable: false })` toMatchObject `{ table: 'TEST_BASE', approach: 300, hold: 180, tearFlip: 360, flashReveal: 220, settleMs: 200, tableTailMs: 500 }`; multi LEG → `{ approach: 620, hold: 300, tearFlip: 940, flashReveal: 280, settleMs: 300, tableTailMs: 500 }`; single COM/LEG hold 140/220, multi COM/RAR hold 220/260; `phaseDurations(...)` for single RAR toEqual `{ swipe: 0, approach: 300, hold: 180, 'tear-flip': 360, 'flash-reveal': 220, settle: 200, 'cards-on-table': 0 }`; `TEST_BASE.tapQueueMs === 90`.
   2. `it('DEVICE hold tiers rise COM < RAR < LEG with gaps of at least 240 ms', …)` — for `single` and `multi`: `hold.COM < hold.RAR < hold.LEG`, `hold.RAR − hold.COM >= 240`, `hold.LEG − hold.RAR >= 240`.
   3. `it('DEVICE anticipation sits inside the grammar band', …)` — `approach + hold`: single COM within `[600, 1200]`; single RAR, single LEG and every multi tier within `[1200, 2000]` (§2 row 2; multi LEG is exactly 2000 — that is why multi approach is 900).
   4. `it('DEVICE reaches the table under the ceilings', …)` — for all six `isMulti × rarity`: `toTableMs <= TO_TABLE_CAP_MS[single|multi]`; also assert the two extremes literally: single LEG `3120`, multi LEG `5000`.
   5. `it('the silence beat fits after the colour tell', …)` — for every tier of `single` and `multi`: `DEVICE.beatMs[r] <= hold[r] * (1 − TELL_FRACTION_OF_HOLD)`; and `TEST_BASE.beatMs` all 0.
   6. `it('compress keeps only the beat of hold and speeds the tear by 1.6x', …)` — DEVICE multi LEG (`hold 1100`, `beatMs 300`, `tearFlip 1800`): `compressTimings(t, 660)` → `hold 300`, `tearFlip 1125`, `flashReveal/settleMs/tableTailMs` unchanged, `toTableMs` = sum; at `900` → `hold 200`; at `2000` → `hold 0`; the input object is not mutated.
   7. `it('the __DEV__ override reaches DEVICE only and clears with null', …)` — `setCeremonyTimingOverride({ single: { approach: 1000 } as any })` → DEVICE single approach 1000 while single hold RAR still 620 and multi approach still 900; TEST_BASE unaffected; `getCeremonyTimingOverride()` returns the object; `setCeremonyTimingOverride(null)` → back to 600 and getter null; with `(globalThis as any).__DEV__ = false` the setter is a no-op (restore `true` in `finally`).
   8. `it('exports the shared constants', …)` — `REDUCED_MOTION_FLASH_MS 180`, `REDUCED_MOTION_SETTLE_MS 240`, `SWIPE_TRIGGER_DISTANCE 72`, `TELL_FRACTION_OF_HOLD 0.6`, `FAST_FORWARD_FROM_HOLD_FRACTION 0.6`, `FAST_FORWARD_TEAR_FACTOR 1.6`, `SPILL_STAGGER_MS 60`, `SPILL_START_FRACTION 0.5`, `SPILL_TRAVEL_FRACTION` closeTo `1/6`; `Object.isFrozen(TEST_BASE)`, `Object.isFrozen(DEVICE)`.

8. **`mobile/tests/unit/reanimatedGuard.test.tsx` (new)** — `vi.mock('react-native', …)` as `libraryCardTile.test.tsx:5-18` (View/Text/Pressable/StyleSheet), then import the guard. (`.tsx`: cases 5 and 6 render JSX with `react-test-renderer`.) Cases (titles verbatim):
   1. `it('reports no motion under vitest', …)` — `motionAvailable === false`, `skiaAvailable === false`, `SkiaModule === null`, `GestureHandler.available === false`, and `globalThis.__CEREMONY_MOTION_AVAILABLE__ === false` (proves the setup file ran).
   2. `it('animation helpers return their targets immediately', …)` — `withTiming(0.85, { duration: 60 }) === 0.85` and its callback is invoked with `true`; `withSpring(1) === 1`; `withDelay(100, 0.5) === 0.5`; `withSequence(1, 0.3, 0) === 0`; `withRepeat(0.2, -1, true) === 0.2`; `runOnJS(fn) === fn`; `cancelAnimation({ value: 1 })` returns undefined.
   3. `it('interpolates numbers and colours in plain JS', …)` — `interpolate(0.5, [0, 1], [0, 100]) === 50`; `interpolate(2, [0, 1], [0, 100]) === 200`; `interpolate(0.25, [0, 0.5, 1], [0, 10, 100]) === 5`; `interpolateColor(0.5, [0, 1], ['#000000', '#FFFFFF']) === 'rgba(128,128,128,1)'`; `interpolateColor(0, [0, 1], ['#FFF7EC', '#A78BD8']) === '#FFF7EC'`; `interpolateColor(1, …) === '#A78BD8'`.
   4. `it('easings are identity curves with the same shape', …)` — `Easing.bezier(0.05, 0.7, 0.1, 1)(0.3) === 0.3`; `Easing.out(Easing.cubic)(0.7) === 0.7`; `Easing.in(Easing.quad)(0.2) === 0.2`; `Easing.linear(0.9) === 0.9`.
   5. `it('hooks behave as plain refs inside a component', …)` — render a probe with `react-test-renderer` that calls `useSharedValue(3)`, `useDerivedValue(() => sv.value * 2)`, `useAnimatedStyle(() => ({ opacity: 0.5 }))`, `useAnimatedReaction(...)` and pushes them to an array; re-render (`tree.update`) and assert the shared value object is the same reference across renders, `derived.value === 6`, the style equals `{ opacity: 0.5 }`, reaction returned `undefined`.
   6. `it('falls back to RN View and inert gestures', …)` — `Reanimated.createAnimatedComponent(Probe) === Probe`; rendering `<Reanimated.View testID="x" />` yields a host `'View'` with `testID 'x'`; `GestureHandler.PanHost` renders its children (write `PanHost` — the library's export name must not appear in this test file either, see Constraints); `GestureHandler.Gesture.Pan().onUpdate(() => {}).enabled(false).activeOffsetX([-10, 10]).runOnJS(true)` is chainable (each call returns an object with an `onEnd` function).

Estimated size: guard ~240 lines, timings ~170, setup ~200, featureFlags +30, tests ~110 + ~120 + ~40. The spec budgets 90 minutes for this issue. Land in this order so a partial attempt still leaves the contract files usable by B03–B08: (1) `ceremonyTimings.ts` + its test, (2) `reanimatedGuard.ts` + `tests/setup/ceremony.ts` + `vitest.config.ts` (run the unit tree once here — the setup file must not break any existing test), (3) the feature flag + its tests, (4) `reanimatedGuard.test.tsx` cases 1–2 and 5–6 first, then cases 3–4 (interpolate / colour / easing) last.

## Acceptance

Run from the worktree root. `docs/delivery/r16-issues/B02.verify.sh` re-runs exactly these.

1. Files exist: `mobile/src/components/ceremony/reanimatedGuard.ts`, `mobile/src/features/gacha/draw/ceremonyTimings.ts`, `mobile/tests/setup/ceremony.ts`, `mobile/tests/unit/ceremonyTimings.test.ts`, `mobile/tests/unit/reanimatedGuard.test.tsx`.
2. Literal guards (exit 0):
   - timings `g=mobile/src/features/gacha/draw/ceremonyTimings.ts`: every `TEST_BASE`/`DEVICE` row line from change 2 present via `grep -F`; `export const TO_TABLE_CAP_MS = Object.freeze({ single: 3300, multi: 5500 });` present; the nine scalar constants present with their values; `export function resolveCeremonyTimings`, `phaseDurations`, `compressTimings`, `setCeremonyTimingOverride`, `getCeremonyTimingOverride`, `export type CeremonyPhase`, `export type PeakRarity`, `export type CeremonyTimingTable`, `export type ResolvedCeremonyTimings` present; `! grep -E "from 'react|require\(|reanimatedGuard" "$g"`.
   - guard `r=mobile/src/components/ceremony/reanimatedGuard.ts`: `export const motionAvailable`, `export const skiaAvailable`, `export const SkiaModule`, `export const Reanimated`, `export const GestureHandler`, `PanHost: loaded.gestureHandler.GestureDetector`, `export type SharedValue<T> = { value: T };`, `__CEREMONY_MOTION_AVAILABLE__`, and the four `require('react-native-reanimated')` / `require('react-native-worklets')` / `require('@shopify/react-native-skia')` / `require('react-native-gesture-handler')` present; `! grep -Eq "useClock|eslint-disable|from '(react-native-reanimated|react-native-worklets|@shopify/react-native-skia|react-native-gesture-handler)'" "$r"`; `! grep -iq "detector" "$r"` and `! grep -iq "detector" mobile/tests/unit/reanimatedGuard.test.tsx` (the driver gate's case-insensitive term); `! grep -Eq "require\([^'\"]" "$r"` (every `require(` takes a string literal).
   - setup `s=mobile/tests/setup/ceremony.ts`: `__CEREMONY_MOTION_AVAILABLE__ = false` present; `vi.mock('<pkg>'` present for each of `react-native-reanimated`, `react-native-worklets`, `@shopify/react-native-skia`, `expo-audio`, `expo-haptics`, `react-native-gesture-handler`, `expo-sharing`, `expo-store-review`, `react-native-view-shot`; `__ceremonyMocks` present; `! grep -Eq "vi\.mock\('(react-native|react|@react-native-async-storage/async-storage|expo-linear-gradient|react-native-safe-area-context)'|useClock" "$s"`.
   - `grep -Fq "setupFiles: ['./tests/setup/globals.ts', './tests/setup/ceremony.ts']," mobile/vitest.config.ts`.
   - flags `ff=mobile/src/config/featureFlags.ts`: `seamOfLight: boolean; forceFallback: boolean` (type), `seamOfLight: true, forceFallback: false` (default), `left.ceremony.seamOfLight === right.ceremony.seamOfLight`, `left.ceremony.forceFallback === right.ceremony.forceFallback`, `typeof ceremony?.seamOfLight === 'boolean'`, `typeof ceremony?.forceFallback === 'boolean'` all present; `git diff --quiet <merge-base> -- mobile/src/config/remoteConfig.ts`.
   - flags test: the nine existing `it(` titles still present; the three new titles present; `grep -c "ceremony:" mobile/tests/unit/featureFlags.test.ts` ≥ 9.
   - no `.skip(`, `.only(`, `@ts-ignore`, `@ts-expect-error`, `eslint-disable` in any scope file.
3. `cd mobile && npm run test:typecheck` — exit 0.
4. `cd mobile && npx vitest run tests/unit tests/integration/draw-ceremony.screen.test.tsx --reporter=dot` — exit 0 (the whole unit tree now loads the new setup file; the draw-ceremony integration test proves the setup mocks do not collide with a per-file `react-native` mock). `ceremonyTimings.test.ts` has ≥ 8 `it(`, `reanimatedGuard.test.tsx` ≥ 6.
5. Scope + frozen guard: `mb=$(git merge-base HEAD delivery/r16-b-ceremony)`; `git diff --numstat "$mb" -- mobile/src/content/deckRepository.ts mobile/src/sync/progressSync.ts mobile/src/review/model.ts mobile/src/config/remoteConfig.ts mobile/src/screens/DrawCeremonyScreen.tsx mobile/src/components/HolographicLayer.tsx mobile/tests/setup/globals.ts mobile/package.json mobile/package-lock.json` empty; `{ git diff --name-only "$mb"; git ls-files --others --exclude-standard -- mobile/src mobile/tests mobile/App.tsx mobile/app.json mobile/package.json mobile/package-lock.json mobile/vitest.config.ts mobile/assets mobile/scripts mobile/docs docs LICENSE-ASSETS; }` contains only the eight scope paths and `docs/delivery/r16-issues/*`.

## Do NOT

- Do NOT edit `DrawCeremonyScreen.tsx` (B09 deletes its local `phaseDurations`/types and imports yours), `HolographicLayer.tsx` (B08), `ceremonyAudio.ts`/`ceremonyHaptics.ts` (B04), `remoteConfig.ts`, `globals.ts`, `package.json`.
- Do NOT create `spillSchedule.ts` / `skipPolicy.ts` / `ceremonyPrefs.ts` (B03), `StageCanvas.tsx` (B05) or any other `ceremony/` file.
- Do NOT `import` any of the four native packages statically in the guard; do NOT write `require(<variable>)` or a `tryRequire(name)` helper (Metro rejects it); do NOT export `useClock` (or spell the token anywhere in the guard or the setup file); the guard member stays `PanHost` (= the library's `GestureDetector`, which the gate allows); do NOT make `motionAvailable` re-evaluate at call time.
- Do NOT mock `react-native`, `react`, AsyncStorage, `expo-linear-gradient` or `react-native-safe-area-context` in the setup file; do NOT set `__DEV__` there (globals.ts owns it).
- Do NOT change any existing timing number: `TEST_BASE` is the pre-1.6 table verbatim; `DEVICE` multi approach is 900 (B00 §9 #3), not the storyboard's 920.
- Do NOT extend `RemoteFeatures`; do NOT change any existing `it(` title or assertion in `featureFlags.test.ts` beyond adding the `ceremony` key to full-object literals.
- Do NOT add a `babel.config.js`, a `jest` config, or a `vitest` alias.
- Standing rules: no `git push`, no PR, never touch `main`, no deploy / EAS / `npm install` / `npm ci`, no test gutting (no `.skip`, no `@ts-ignore`, no `eslint-disable`), no loosening of `tsconfig`.
