# B05 — Stage canvas (`stage-canvas`)

ONE Skia `Canvas` for the ceremony stage light — vignette, 12-spoke SweepGradient rays, halo whose colour is the rarity tell, seam light-leak (`plus` blend), face-down rarity rims, an Atlas particle burst and the flash rect — driven only by shared values from the timeline, never mounted under `!skiaAvailable`, with the flash/rays/particles never mounted under Reduce Motion; the pack itself is B06's `PackTear` canvas layered on top (B00 §7.3: three canvases in the ceremony tree), and this file exports the geometry (`packRectInStage`, `packSlotInStage`) B09 uses to put that pack exactly under the stage's seam light-leak; plus a render smoke test against a mocked guard.

## Context

Today's stage is RN `Animated` views: a halo/rays/core/sparkle stack pre-tinted with the peak rarity from frame 0 (`mobile/src/screens/DrawCeremonyScreen.tsx:465` `const haloColor = rarityHaloColor(peakRarity)` feeding `:925`, `:939`, `:950`), a JS `ParticleBurst`, a full-screen flash `View` that snaps to 0.85 and back (`:1393-1403`, the opacity step at `:1399`), and per-card Skia canvases with `useClock` in `HolographicLayer.tsx:65-78` (the RAR/LEG mount crash: `useDerivedValue` is not a Skia export and `useClock` goes through Skia's ReanimatedProxy, `node_modules/@shopify/react-native-skia/lib/module/external/reanimated/interpolators.js:27-36`). The audit calls this out as "The scene never darkens" (`docs/release-1.6.0-plan-2026-09-19.md:44`) and "No real light or particle system reaches the screen" (`:38`).

The design puts the stage light in one Skia canvas (`release-1.6.0-plan:85`; code row `:158`; the pack image the design lists in the same canvas is drawn by B06's `PackTear` in its own canvas — an RN accessible root with a gesture-handler Pan cannot live inside a Skia canvas — so the ceremony tree carries three canvases, B00 §7.3; recipe `:147` "SweepGradient with 24 alternating alpha stops, RadialGradient halo"; storyboard `:96` S0 "12-spoke SweepGradient rays rotating linearly 14 s/rev at alpha 0.10", neutral warm-white halo with no rarity tint; `:98` S2 colour tell COM `#FFF3E0` / RAR `#A78BD8` / LEG violet→gold `#F5C95E`; `:99` S3 "leak flares 0.6 → 1.0"; `:100` S4 "Flash = Canvas Rect opacity 0 → 0.85 in 60 ms then → 0 over 260 ms"; `:101` S5 "halo relaxes to a steady rarity rim (RoundRect stroke + 2 px inner glow 0.55; COM none)"; `:104` RM "the Canvas flash rect never mounts", no particles; perf budget `:131` — BANNED `BackdropBlur`/`Blur` image filters, `DisplacementMap`, per-frame `maskFilter` blur, one canvas per card; Atlas ≤ 120 sprites). B00 §2.8 (`docs/delivery/r16-issues/B00-contracts.md`, navigate by heading) fixes the props, the constants, the layer order, the units/origin rule and the banned identifiers; §2.1 fixes the guard surface you must go through; §2.10 fixes the timeline shape, its units and the tell colours.

Two things this brief resolves because B05 depends on B02 only (B00 §5 `:743`):
- `CeremonyTimeline` is declared in B07's `useCeremonyTimeline.ts` (B00 §2.10), which does not exist in your worktree. `StageCanvas` therefore declares `StageTimeline`, the structural subset it reads (nine of the seventeen keys); B07's full type is assignable to it, so B09 can pass the whole timeline unchanged.
- `haloColorForTell` / `TELL_COLORS` are also B07 exports. `StageCanvas` implements `stageHaloColor(tell, peakRarity)` locally with the same hex literals (B00 §2.10 `TELL_COLORS`); the values are contract literals and are grepped.
- The guard mock's `GestureHandler` member is `PanHost` (B00 §2.1 / §9 #15 — the library's own export name is a driver-banned substring and is never written under `mobile/src`; B06 copies this mock).
- Sprite-sheet geometry (`PARTICLE_SPRITES`, `PARTICLE_SPRITE_SIZE`) is exported from `packArt.ts` by B12 (B00 §6), also not a dep. `StageCanvas` declares `PARTICLE_SPRITE_SIZE = 64` and `PARTICLE_SHEET_COLUMNS = 4` locally (the sheet is 256×64, four 64×64 sprites, `release-1.6.0-plan:143`); the image itself arrives through the `particleSheet` prop.

**Test-infrastructure fact (verified on this tree):** `vi.mock('@shopify/react-native-skia', …)` does not reach a guarded `require(...)` — vite-node hands `require` to Node's loader. So the smoke test does not mock packages; it mocks the guard module `../../src/components/ceremony/reanimatedGuard` by its B00 §2.1 contract (Skia components rendered as `'Skia.<Name>'` host elements, Reanimated hooks as plain-value fakes). That keeps the test independent of how B02 loads the packages.

## Read first

1. `docs/delivery/r16-issues/B00-contracts.md` — B00 is edited by several fixers, so navigate by section heading, not line: §2.1 (guard: `motionAvailable`, `skiaAvailable`, `Reanimated.*`, `SkiaModule`, `GestureHandler.PanHost` and the `useClock`/`useDerivedValue` ban), §2.8 (this file's contract, incl. the binding "Units/origin" paragraph), §2.10 (timeline keys + `TELL_COLORS` + targets per phase + the "Units" paragraph), §4.1 (the host-element mock shape your test must be compatible with), §7.3 (canvas count — three: stage, pack, foil), §8 (verify conventions), §9 #16 (timeline UNITS: `raysAngle` and `spill[i].rot` are RADIANS passed to Skia `rotate` unchanged; `spill[i].x/.y` are pt offsets from the stage centre, so the rims live inside one centre-origin `Group`), §9 #15 (the gesture host alias is `GestureHandler.PanHost`), §9 #18 (`packSlotInStage` is yours; B09 mounts `PackTear` there), §9 #19 (`React.JSX.Element`).
2. `mobile/src/components/HolographicLayer.tsx:21-33` (the guarded-require pattern B02 generalises) and `:60-100` (the `useClock` canvas you must NOT reproduce).
3. `mobile/src/screens/DrawCeremonyScreen.tsx:127-131` (`flashColor(rarity)` — reuse these three rgba literals for the flash rect), `:465`, `:919-958` (today's halo stack, for the geometry: halo behind the pack, centred), `:1199-1200` (card sizes 132×184 / 80×116 / 72×100 — `tableCardSize` mirrors them).
4. Skia 2.2.12 typings (read, do not guess): `node_modules/@shopify/react-native-skia/lib/module/dom/types/Common.d.ts:36-59` (`transform`, `origin`, `clip`, `color`, `strokeWidth`, `blendMode`, `style`, `opacity`), `dom/types/Shaders.d.ts:34-52` (`RadialGradient { c, r, colors, positions }`, `SweepGradient { c, start, end, colors, positions }`), `dom/types/Drawings.d.ts:23-32` (`RoundedRect { x, y, width, height, r }`, `Atlas { image, sprites, transforms, colors }`), `renderer/Canvas.d.ts:20-28` (`Canvas` takes `ViewProps` → `testID`, `style`, `pointerEvents`), `external/reanimated/buffers.js:10-33` (`useBuffer` reads `modifier.__closure` and runs it in a Reanimated mapper — the modifier MUST be a `'worklet'`; `useRSXformBuffer(size, modifier)` at `:33`), `renderer/processors/Animations/Animations.d.ts:1-7` (`AnimatedProp<T> = T | { value: T }` — every Skia prop accepts a shared value), `skia/types/RSXform.d.ts:2-8` (`val.set(scos, ssin, tx, ty)`).
5. `mobile/tests/integration/draw-ceremony.screen.test.tsx:1-50` (the `react-native` mock shape to copy into the smoke test) and `:637-652` (the `vi.resetModules()` + `vi.doMock` + dynamic-import pattern for the "renders null" case).
6. `docs/release-1.6.0-plan-2026-09-19.md:96-104`, `:131`, `:143`, `:147`, `:158`.

## Constraints

- **Scope (the ONLY files that may change):**
  - `mobile/src/components/ceremony/StageCanvas.tsx` (new)
  - `mobile/tests/unit/stageCanvas.test.tsx` (new)
- **Frozen files — zero diff:** `mobile/src/content/deckRepository.ts`, `mobile/src/sync/progressSync.ts`, `mobile/src/review/model.ts`. Also untouched: `reanimatedGuard.ts`, `ceremonyTimings.ts`, `packArt.ts`, `DrawCeremonyScreen.tsx`, `vitest.config.ts`, `tests/setup/*`.
- **No dependency changes.** `"vite": "7.2.4"` stays.
- **Every Skia and Reanimated symbol comes from the guard.** The only imports are `react`, `import type { ImageSourcePropType } from 'react-native'`, `{ Reanimated, SkiaModule, skiaAvailable, type SharedValue } from './reanimatedGuard'` and `import type { PeakRarity } from '../../features/gacha/draw/ceremonyTimings'`. No `import … from '@shopify/react-native-skia'`, `'react-native-reanimated'`, `'react-native-worklets'` and no `require(` in this file.
- **Banned identifiers in this file (grepped, comments included — write "the Skia clock hook" instead of its name):** `BackdropBlur`, `BackdropFilter`, `<Blur`, `DisplacementMap`, `maskFilter`, `useClock`, `SkiaModule.useDerivedValue`, `setInterval(`, `Animated.` (RN Animated), `shadowRadius`, `Math.random`, `require(`. Exactly one `<Canvas` in the file.
- **Worklet rules** (the UI-thread pitfalls the mocked test cannot catch): destructure at module scope — `const { useSharedValue, useDerivedValue, useAnimatedReaction, withTiming, withRepeat, cancelAnimation, interpolateColor, interpolate, Easing } = Reanimated;` — and inside any `useDerivedValue`/`useAnimatedReaction`/buffer-modifier callback reference only those destructured functions, shared values, plain numbers/strings and module-level pure functions that begin with `'worklet';`. Never reference the `Reanimated` or `SkiaModule` namespace objects inside a worklet (they would be serialised to the UI runtime with non-worklet members). Every pure helper called from a worklet (`stageHaloColor`, `particlePose`, `poseToRSXform`) starts with the `'worklet';` directive. Every callback passed to those hooks also starts with `'worklet';` (harmless under the mock, required on device when the hook is reached through a property access the babel plugin does not auto-workletize).
- **Hooks count is fixed per render:** no hook inside `.map` over cards — rims are a child component (`StageRim`) rendered once per card.
- **Test literal rules:** no existing test changes. The new test mocks `react-native` (copy `draw-ceremony.screen.test.tsx:9-36`'s shape, only `View`/`Text`/`StyleSheet` are needed) and the guard module; it must not `vi.mock('@shopify/react-native-skia')` or `'react-native-reanimated'`.
- **Banned literals in identifiers/comments/strings:** `humanizer`, `bypass`, `undetect`, `detector` (case-insensitive driver gate; the gesture-handler library's host-component export name contains it and must never be spelled anywhere under `mobile/src`, comments included — the guard calls it `GestureHandler.PanHost`, B00 §9 #15; this file does not use it), `evade`, `Gemini said`.
- **Return-type annotations:** `@types/react` 19.1 has no global `JSX` namespace (`mobile/node_modules/@types/react/index.d.ts:4028` declares it inside `namespace React` only) — write `React.JSX.Element`, never bare `JSX.Element` (TS2503 under `npm run test:typecheck`).
- **Units and origin (B00 §2.10 "Units", §9 #16, binding):** `timeline.raysAngle` is RADIANS (B07 drives it 0 → 2π per revolution) and goes to Skia `rotate` unchanged — never multiply it by `Math.PI / 180`; `spill[i].rot` is radians, also unchanged; `spill[i].x/.y` are pt OFFSETS FROM THE STAGE CENTRE, so every per-card rim `Group` sits inside one `<Group transform={[{ translateX: width / 2 }, { translateY: height / 2 }]}>` origin group and is never used as an absolute stage coordinate.
- No new testIDs beyond `STAGE_TESTID`; no copy; no screen wiring (B09).

## Changes required

### 1. `mobile/src/components/ceremony/StageCanvas.tsx`

Exports (B00 §2.8 verbatim, plus the local types/helpers explained in Context):

```ts
import React, { useEffect, useMemo } from 'react';
import type { ImageSourcePropType } from 'react-native';
import { Reanimated, SkiaModule, skiaAvailable, type SharedValue } from './reanimatedGuard';
import type { PeakRarity } from '../../features/gacha/draw/ceremonyTimings';

/** Structural subset of CeremonyTimeline (B00 §2.10) this canvas reads. */
export type StageTimeline = {
  tell: SharedValue<number>; dim: SharedValue<number>; leak: SharedValue<number>; flash: SharedValue<number>;
  rays: SharedValue<number>; raysAngle: SharedValue<number>; /* RADIANS, 0..2π per revolution (B07, B00 §2.10) — passed to Skia `rotate` unchanged */ halo: SharedValue<number>;
  rim: ReadonlyArray<SharedValue<number>>;
  spill: ReadonlyArray<{ x: SharedValue<number>; y: SharedValue<number>; rot: SharedValue<number> }>;  // x/y: pt offsets from the stage centre; rot: radians (B00 §2.10)
};
export type StageCanvasProps = {
  width: number; height: number;
  peakRarity: PeakRarity;
  timeline: StageTimeline;
  reduceMotion: boolean;
  particleSheet?: ImageSourcePropType;
  glowNineSlice?: ImageSourcePropType;
  cardCount: number;
  testID?: string;
};
export const STAGE_TESTID = 'draw-ceremony-stage-canvas';
export const RAY_COUNT = 12;
export const RAY_REVOLUTION_MS = 14000;
export const MAX_PARTICLES = 120;
export const STAGE_TELL_COLORS = { NEUTRAL: '#FFF7EC', COM: '#FFF3E0', RAR: '#A78BD8', LEG: '#F5C95E' } as const;
export const RIM_COLORS: Readonly<Record<PeakRarity, string>> = { COM: 'rgba(255,255,255,0)', RAR: '#A78BD8', LEG: '#F5C95E' };
export const FLASH_COLORS: Readonly<Record<PeakRarity, string>> = { COM: 'rgba(255,255,255,0.88)', RAR: 'rgba(201,173,247,0.95)', LEG: 'rgba(245,201,94,0.95)' }; // DrawCeremonyScreen.tsx:127-131
export const PARTICLE_COUNT: Readonly<Record<PeakRarity, number>> = { COM: 24, RAR: 64, LEG: 120 };
export const PARTICLE_LIFE_MS: Readonly<Record<PeakRarity, number>> = { COM: 600, RAR: 900, LEG: 1500 };
export const PARTICLE_SPRITE_SIZE = 64;
export const PARTICLE_SHEET_COLUMNS = 4;
export const LEAK_BAND_RATIO = 0.18;   // = packArt.SEAM_BAND_RATIO (B06); top 18 % of the pack rect
export const PACK_BODY_FRACTION = 0.7;      // mirrors PackTear.PACK_BODY_FRACTION (B06): pack body = 70 % of its slot (B00 §9 #18)

export function stageHaloColor(tell: number, peakRarity: PeakRarity): string;                 // 'worklet'
export function rayStops(count?: number): { colors: string[]; positions: number[] };            // 2×count alternating stops
export function tableCardSize(cardCount: number): { width: number; height: number };          // 1 → 132×184, ≤5 → 80×116, else 72×100
export type StageRect = { x: number; y: number; width: number; height: number };
export function packRectInStage(width: number, height: number): StageRect;   // the pack BODY in stage px (leak band + burst origin align to it)
export function packSlotInStage(width: number, height: number): StageRect;   // packRectInStage inflated by 1 / PACK_BODY_FRACTION about its centre — B09 mounts <PackTear> here, position 'absolute'
export function particlePose(index: number, elapsedMs: number, lifeMs: number, origin: { x: number; y: number }, spread: number): { x: number; y: number; scale: number; rotation: number; alpha: number };   // 'worklet'
export function poseToRSXform(pose: { x: number; y: number; scale: number; rotation: number }, spriteSize: number): { scos: number; ssin: number; tx: number; ty: number };   // 'worklet'
export function StageCanvas(props: StageCanvasProps): React.JSX.Element | null;   // React.JSX — no global JSX namespace in @types/react 19 (B00 §9 #19)
```

Pure helpers (unit-tested; all deterministic — "Honest tells only", `release-1.6.0-plan:75`, no `Math.random`):

- `stageHaloColor(tell, r)`: `'worklet'`; `r === 'LEG'` → `interpolateColor(tell, [0, 0.4, 0.6, 1], [NEUTRAL, RAR, LEG, LEG])`; `r === 'RAR'` → `interpolateColor(tell, [0, 1], [NEUTRAL, RAR])`; `COM` → `interpolateColor(tell, [0, 1], [NEUTRAL, COM])` (the two-step "it went gold" of `:98`).
- `rayStops(count = RAY_COUNT)`: `2 × count` stops; even index `'rgba(255,247,236,0.9)'`, odd index `'rgba(255,247,236,0)'`; `positions[i] = i / (2 × count)`.
- `tableCardSize(n)`: mirrors `DrawCeremonyScreen.tsx:1199-1200`.
- `packRectInStage(w, h)`: pack width `min(w * 0.46, 200)`, height `width * 1.5`, centred horizontally, centre y at `h * 0.45`. `packRectInStage(280, 360)` → `{ x: 75.6, y: 65.4, width: 128.8, height: 193.2 }`. This is the rect the leak band and the burst origin are aligned to.
- `packSlotInStage(w, h)`: `pack = packRectInStage(w, h)`; `sw = pack.width / PACK_BODY_FRACTION`, `sh = pack.height / PACK_BODY_FRACTION`; `{ x: pack.x - (sw - pack.width) / 2, y: pack.y - (sh - pack.height) / 2, width: sw, height: sh }`. `packSlotInStage(280, 360)` → `{ x: 48, y: 24, width: 184, height: 276 }` (`toBeCloseTo`). B09 mounts B06's `PackTear` with `width={slot.width} height={slot.height}` and `position: 'absolute', left: slot.x, top: slot.y` so that `PackTear.packBodyRect(slot.width, slot.height)` (= `min(sw, sh × 2/3) × 0.7` = `pack.width`, centred) lands exactly on `packRectInStage` and the seam light-leak sits on the seam (B00 §2.8 / §9 #18). The two `PACK_BODY_FRACTION` constants (here and in `PackTear.tsx`) are both `0.7`; B09 asserts they are equal.
- `particlePose(i, elapsed, life, origin, spread)`: `'worklet'`; outside `[0, life)` (or `life <= 0`) → `{ x: origin.x, y: origin.y, scale: 0, rotation: 0, alpha: 0 }`; otherwise with `seed = ((i * 9301 + 49297) % 233280) / 233280`, `seed2 = ((i * 7919 + 104729) % 233280) / 233280`, `t = elapsed / life`, `angle = -π/2 + (seed − 0.5) × 1.2π` (upward cone), `speed = spread × (0.5 + seed2)`: `x = origin.x + cos(angle) × speed × t`, `y = origin.y + sin(angle) × speed × t + 0.5 × spread × t²` (gravity), `scale = (1 − t) × (0.5 + 0.5 × seed2)`, `rotation = t × 2π × (seed − 0.5)`, `alpha = 1 − t`.
- `poseToRSXform(pose, size)`: `'worklet'`; `scos = scale × cos(rotation)`, `ssin = scale × sin(rotation)`, `half = size / 2`, `tx = x − (scos × half − ssin × half)`, `ty = y − (ssin × half + scos × half)` (sprite centred on the pose).

Component:

a. `if (!skiaAvailable || !SkiaModule) return null;` first line of the body (before any hook — the early return is legal because the guard values are module constants, so the hook count never changes between renders of a mounted instance).
b. `const { Canvas, Group, Rect, RoundedRect, Image, Atlas, SweepGradient, RadialGradient, useImage, vec, rect, Skia } = SkiaModule;` (never the Skia clock hook, never a derived-value hook from here — `useDerivedValue`/`useSharedValue`/`useAnimatedReaction` come from the destructured `Reanimated` guard object only).
c. Derived shared values (all through the destructured guard functions, each callback `'worklet'`): `haloColors = useDerivedValue(() => [stageHaloColor(tell.value, peakRarity), 'rgba(255,247,236,0)'])`; `rayTransform = useDerivedValue(() => [{ rotate: raysAngle.value }])` (`raysAngle` is already RADIANS — B07 drives it 0 → `2 * Math.PI` once per `RAYS_ANGLE_PERIOD_MS`, B00 §2.10 "Units" — so it is passed to Skia `rotate` unchanged; a `* Math.PI / 180` here would make the rays crawl at 1/57 of the design speed); `leakColors = useDerivedValue(() => [stageHaloColor(tell.value, peakRarity), 'rgba(255,247,236,0)'])`.
d. Particle clock: `const clock = useSharedValue(0); const burstAt = useSharedValue(-1);` `useEffect(() => { if (reduceMotion) { clock.value = 0; return undefined; } clock.value = withRepeat(withTiming(RAY_REVOLUTION_MS, { duration: RAY_REVOLUTION_MS, easing: Easing.linear }), -1, false); return () => cancelAnimation(clock); }, [clock, reduceMotion])` — the effect is always registered; only its body is conditional, and it re-runs when `reduceMotion` flips mid-mount. Burst trigger: `useAnimatedReaction(() => flash.value, (v, prev) => { 'worklet'; if (prev !== null && prev < 0.4 && v >= 0.4) burstAt.value = clock.value; })`. The burst origin is the seam band centre of `packRectInStage(width, height)`; `spread = width * 0.35`.
e. `transforms = useRSXformBuffer(MAX_PARTICLES, (val, i) => { 'worklet'; const count = PARTICLE_COUNT[peakRarity]; if (i >= count || burstAt.value < 0) { val.set(0, 0, 0, 0); return; } const elapsed = (clock.value - burstAt.value + RAY_REVOLUTION_MS) % RAY_REVOLUTION_MS; const pose = particlePose(i, elapsed, PARTICLE_LIFE_MS[peakRarity], origin, spread); const r = poseToRSXform(pose, PARTICLE_SPRITE_SIZE); val.set(r.scos, r.ssin, r.tx, r.ty); })` where `useRSXformBuffer` is read as `SkiaModule.useRSXformBuffer` (a hook: call it on EVERY render, `reduceMotion` included — `reduceMotion` can flip mid-mount via the screen's `reduceMotionChanged` listener, so the hook count must not depend on it; the modifier captures `reduceMotion` as a plain boolean and returns `val.set(0, 0, 0, 0)` immediately when it is true; only the JSX differs between the two modes). `sprites = useMemo(() => Array.from({ length: MAX_PARTICLES }, (_, i) => rect((i % PARTICLE_SHEET_COLUMNS) * PARTICLE_SPRITE_SIZE, 0, PARTICLE_SPRITE_SIZE, PARTICLE_SPRITE_SIZE)), [rect])`. `particleImage = useImage(particleSheet ?? null)`, `glowImage = useImage(glowNineSlice ?? null)` (both `null` → layer skipped).
f. JSX, in this order (B00 §2.8 layer order; every dynamic prop is a shared value passed directly, no `.value` reads in render):

```tsx
<Canvas style={{ position: 'absolute', left: 0, top: 0, width, height }} pointerEvents="none" testID={testID ?? STAGE_TESTID}>
  {/* 1 vignette */}
  <Rect x={0} y={0} width={width} height={height} opacity={timeline.dim}>
    <RadialGradient c={vec(width / 2, height / 2)} r={Math.max(width, height) * 0.75} colors={['rgba(8,4,20,0)', 'rgba(8,4,20,1)']} />
  </Rect>
  {/* 2 rays — not mounted under reduceMotion */}
  {!reduceMotion ? (
    <Rect x={0} y={0} width={width} height={height} opacity={timeline.rays} transform={rayTransform} origin={vec(width / 2, packCentreY)}>
      <SweepGradient c={vec(width / 2, packCentreY)} colors={stops.colors} positions={stops.positions} />
    </Rect>
  ) : null}
  {/* 3 halo */}
  <Rect x={0} y={0} width={width} height={height} opacity={timeline.halo}>
    <RadialGradient c={vec(width / 2, packCentreY)} r={width * 0.45} colors={haloColors} />
  </Rect>
  {/* 4 seam light-leak (plus blend) */}
  <Rect x={pack.x - 12} y={pack.y - 8} width={pack.width + 24} height={pack.height * LEAK_BAND_RATIO + 16} opacity={timeline.leak} blendMode="plus">
    <RadialGradient c={vec(width / 2, pack.y + pack.height * LEAK_BAND_RATIO / 2)} r={pack.width * 0.7} colors={leakColors} />
  </Rect>
  {/* 5 rims, one StageRim per card (≤ 10), inside ONE centre-origin group: spill x/y are offsets from the stage centre (B00 §2.10) */}
  <Group transform={[{ translateX: width / 2 }, { translateY: height / 2 }]}>
    {Array.from({ length: Math.min(cardCount, 10) }, (_, i) => <StageRim key={i} … />)}
  </Group>
  {/* 6 particles — only with an image and not under reduceMotion */}
  {!reduceMotion && particleImage ? <Atlas image={particleImage} sprites={sprites} transforms={transforms} blendMode="plus" /> : null}
  {/* 7 flash — never mounted under reduceMotion */}
  {!reduceMotion ? <Rect x={0} y={0} width={width} height={height} color={FLASH_COLORS[peakRarity]} opacity={timeline.flash} /> : null}
</Canvas>
```

`StageRim` (`{ index, x, y, rot, alpha, size, color, glowImage }` — `x/y/rot/alpha` are the card's shared values `timeline.spill[i].x/.y/.rot` and `timeline.rim[i]`; `spill[i].x/.y` are pt OFFSETS FROM THE STAGE CENTRE and `spill[i].rot` is radians, B00 §2.10 "Units" / §9 #16 — so layer 5 is one origin group `<Group transform={[{ translateX: width / 2 }, { translateY: height / 2 }]}>` (a plain array, no hook) wrapping every `StageRim`, and each rim's own transform is the offset/rotation only): `const transform = useDerivedValue(() => [{ translateX: x.value }, { translateY: y.value }, { rotate: rot.value }])`; renders `<Group transform={transform} opacity={alpha}>` with, when `glowImage` is non-null, an `<Image image={glowImage} x={-size.width/2 - 12} y={-size.height/2 - 12} width={size.width + 24} height={size.height + 24} fit="fill" opacity={0.6} />` behind a `<RoundedRect x={-size.width/2} y={-size.height/2} width={size.width} height={size.height} r={10} color={color} style="stroke" strokeWidth={2} />`. `size = tableCardSize(cardCount)`, `color = RIM_COLORS[peakRarity]`. A missing `spill[i]`/`rim[i]` entry (timeline shorter than `cardCount`) renders nothing for that index — never throw.

### 2. `mobile/tests/unit/stageCanvas.test.tsx` (new, ≥ 11 `it(` blocks)

Setup (top of file, hoisted mocks):

```ts
vi.mock('react-native', () => { const React = require('react'); return { View: (p: any) => React.createElement('View', p, p.children), Text: (p: any) => React.createElement('Text', p, p.children), StyleSheet: { create: (s: any) => s, absoluteFillObject: {} } }; });
const guardState = vi.hoisted(() => ({ skiaAvailable: true, useImage: (_s: unknown): unknown => null }));
vi.mock('../../src/components/ceremony/reanimatedGuard', () => {
  const React = require('react');
  const host = (name: string) => (p: any) => React.createElement(`Skia.${name}`, p, p.children);
  const SkiaModule = {
    Canvas: host('Canvas'), Group: host('Group'), Rect: host('Rect'), RoundedRect: host('RoundedRect'), Image: host('Image'), Atlas: host('Atlas'),
    Path: host('Path'), Circle: host('Circle'), SweepGradient: host('SweepGradient'), RadialGradient: host('RadialGradient'), LinearGradient: host('LinearGradient'),
    useImage: (s: unknown) => guardState.useImage(s), useRSXformBuffer: () => [], useRectBuffer: () => [],
    vec: (x: number, y: number) => ({ x, y }), rect: (x: number, y: number, width: number, height: number) => ({ x, y, width, height }), rrect: (r: any, rx: number, ry: number) => ({ rect: r, rx, ry }),
    Skia: { Path: { Make: () => ({ moveTo() { return this; }, lineTo() { return this; }, close() { return this; } }) }, RuntimeEffect: { Make: () => null }, Matrix4: () => [], Color: (c: string) => c },
    BlendMode: { Plus: 'plus', SrcOver: 'srcOver' },
  };
  const Reanimated = {
    useSharedValue: (v: any) => ({ value: v }), useDerivedValue: (fn: () => any) => ({ value: fn() }), useAnimatedStyle: (fn: () => any) => fn(), useAnimatedReaction: () => undefined,
    withTiming: (to: number) => to, withSpring: (to: number) => to, withDelay: (_ms: number, a: number) => a, withSequence: (...a: number[]) => a[a.length - 1], withRepeat: (a: number) => a,
    cancelAnimation: () => undefined, runOnJS: (fn: any) => fn,
    interpolate: (v: number, i: number[], o: number[]) => o[Math.max(0, i.findLastIndex((x) => v >= x))],
    interpolateColor: (v: number, i: number[], o: string[]) => o[Math.max(0, i.findLastIndex((x) => v >= x))],
    Easing: { bezier: () => (t: number) => t, linear: (t: number) => t, out: (e: any) => e, in: (e: any) => e, cubic: (t: number) => t, quad: (t: number) => t },
    View: (p: any) => React.createElement('Animated.View', p, p.children), createAnimatedComponent: (c: any) => c,
  };
  return { get skiaAvailable() { return guardState.skiaAvailable; }, motionAvailable: false, SkiaModule, Reanimated, GestureHandler: { available: false, PanHost: (p: any) => p.children, Gesture: { Pan: () => ({}), Tap: () => ({}) } } };
});
```

A `makeTimeline(cardCount)` helper builds `{ tell, dim, leak, flash, rays, raysAngle, halo: { value: 0 } …, rim: [...], spill: [{x,y,rot}, ...] }` with distinct object identities so the test can assert `opacity === timeline.flash` by identity.

Cases:
1. Renders exactly one `Skia.Canvas` with `testID === STAGE_TESTID` by default and the given `testID` when passed; `pointerEvents === 'none'`.
2. Layer order: the Canvas children (filter out `null`) start with a `Skia.Rect` whose child is `Skia.RadialGradient` (vignette, `opacity === timeline.dim`), then a `Skia.Rect` with a `Skia.SweepGradient` child whose `colors.length === 24` and `positions.length === 24` (`opacity === timeline.rays`), then the halo `Skia.Rect` (`opacity === timeline.halo`); the last child is the flash `Skia.Rect` with `opacity === timeline.flash` and `color === FLASH_COLORS.LEG` for `peakRarity 'LEG'`.
3. Exactly one `Skia.Rect` has `blendMode === 'plus'` (the leak) and its `opacity === timeline.leak`.
4. `cardCount: 3` → exactly 3 `Skia.RoundedRect` (each `style === 'stroke'`, `strokeWidth === 2`) and each is inside a `Skia.Group` whose `opacity` is the matching `timeline.rim[i]`, and all of those sit under one `Skia.Group` whose `transform` deep-equals `[{ translateX: 140 }, { translateY: 180 }]` for a 280×360 stage (the centre-origin group, B00 §2.10); with `spill[1] = { x: { value: 30 }, y: { value: -12 }, rot: { value: 0.4 } }` the second rim Group's `transform.value` is `[{ translateX: 30 }, { translateY: -12 }, { rotate: 0.4 }]` (offsets and radians pass through untouched); `cardCount: 0` → none; `cardCount: 12` → 10.
5. `guardState.useImage = () => null` (default) → no `Skia.Atlas` and no `Skia.Image`; `guardState.useImage = () => ({ fake: true })` → one `Skia.Atlas` with `sprites.length === MAX_PARTICLES`, `blendMode 'plus'`, and one `Skia.Image` per rim (glow).
6. `reduceMotion: true` → no `Skia.SweepGradient`, no `Skia.Atlas` (even with an image), and no `Skia.Rect` whose `opacity === timeline.flash`; vignette, halo, leak and rims are still present.
7. `skiaAvailable: false` → `StageCanvas` returns `null` (set `guardState.skiaAvailable = false`, then `vi.resetModules()` and `await import('../../src/components/ceremony/StageCanvas')`, restore in `afterEach`).
8. Pure: `stageHaloColor(0, 'LEG') === STAGE_TELL_COLORS.NEUTRAL`, `(0.4, 'LEG') === RAR`, `(1, 'LEG') === LEG`, `(1, 'RAR') === RAR`, `(1, 'COM') === COM`, `(0, 'COM') === NEUTRAL`; `rayStops().colors.length === 24`, positions strictly increasing from 0 and `< 1`, alternating alpha (`colors[0] !== colors[1]`, `colors[0] === colors[2]`).
9. Pure: `tableCardSize(1)` → `{132,184}`, `(5)` → `{80,116}`, `(6)` → `{72,100}`; `particlePose(3, -1, 900, o, 100).scale === 0`, `(3, 900, 900, …).scale === 0`, `(3, 450, 900, …)` has `scale > 0`, `alpha === 0.5` and differs from `particlePose(4, 450, …)`; calling it twice with the same inputs gives deep-equal results; `poseToRSXform({ x: 10, y: 20, scale: 1, rotation: 0 }, 64)` → `{ scos: 1, ssin: 0, tx: -22, ty: -12 }`.
10. Constants: `RAY_COUNT === 12`, `RAY_REVOLUTION_MS === 14000`, `MAX_PARTICLES === 120`, every `PARTICLE_COUNT[r] <= MAX_PARTICLES`, `LEAK_BAND_RATIO === 0.18`, `PACK_BODY_FRACTION === 0.7`.
11. Rays unit (radians pass-through, B00 §2.10): render with a timeline whose `raysAngle = { value: Math.PI }` → the rays `Skia.Rect` (the one with the `Skia.SweepGradient` child) has `transform.value[0].rotate === Math.PI` exactly (the guard mock's `useDerivedValue(fn)` returns `{ value: fn() }`; any degree→radian conversion would make it ≈ 0.0548); with `raysAngle = { value: 0 }` it is `0`.
12. Pack geometry: `packRectInStage(280, 360)` `toBeCloseTo` `{ x: 75.6, y: 65.4, width: 128.8, height: 193.2 }`; `packSlotInStage(280, 360)` `toBeCloseTo` `{ x: 48, y: 24, width: 184, height: 276 }`; for `(280, 360)` and `(390, 520)`: `slot.width * PACK_BODY_FRACTION === pack.width`, `slot.height === slot.width * 1.5`, and the slot's centre equals the pack's centre (the invariant that makes `PackTear.packBodyRect(slot.width, slot.height)` coincide with `packRectInStage`).

Estimated size: `StageCanvas.tsx` ≈ 270 LOC, test ≈ 250 LOC.

## Acceptance

Run from `mobile/`. `docs/delivery/r16-issues/B05.verify.sh` runs exactly these.

1. `npx vitest run tests/unit/stageCanvas.test.tsx --reporter=dot` exits 0; the file has ≥ 11 `it(` blocks.
2. `npm run test:typecheck` exits 0.
3. Positive greps on `src/components/ceremony/StageCanvas.tsx`: `export const STAGE_TESTID = 'draw-ceremony-stage-canvas'`, `export const RAY_COUNT = 12`, `export const RAY_REVOLUTION_MS = 14000`, `export const MAX_PARTICLES = 120`, `export function StageCanvas`, `export type StageCanvasProps`, `export type StageTimeline`, `export function stageHaloColor`, `export function rayStops`, `export function tableCardSize`, `export function particlePose`, `export function poseToRSXform`, `export function packRectInStage`, `export function packSlotInStage`, `export const PACK_BODY_FRACTION = 0.7`, the un-converted ray rotation `rotate: raysAngle.value }` (fixed string), the centre-origin group `translateX: width / 2 }, { translateY: height / 2 }` (fixed string), `'#FFF7EC'`, `'#FFF3E0'`, `'#A78BD8'`, `'#F5C95E'`, `blendMode="plus"`, `from './reanimatedGuard'`, `SweepGradient`, `RadialGradient`, `RoundedRect`, `Atlas`, `useRSXformBuffer`, `'worklet'`.
4. Negative greps on the same file: `BackdropBlur`, `BackdropFilter`, `<Blur`, `DisplacementMap`, `maskFilter`, `useClock`, `SkiaModule.useDerivedValue`, `setInterval(`, `shadowRadius`, `Math.random`, `require(`, `from '@shopify/react-native-skia'`, `from 'react-native-reanimated'`, `from 'react-native-worklets'`, `eslint-disable`, `@ts-ignore`, `@ts-expect-error`, `raysAngle.value * Math.PI`, `raysAngle.value * (Math.PI`, `/ 180` (no degree conversion of a radian value) — all absent; no bare `JSX.Element` (only `React.JSX.Element`); no spelling of the gesture-handler host's export name (case-insensitive `detector`); `grep -c "<Canvas"` is exactly 1.
5. The test mocks the guard, not the packages: `stageCanvas.test.tsx` contains `vi.mock('../../src/components/ceremony/reanimatedGuard'`, the literals `STAGE_TESTID`, `stageHaloColor`, `particlePose`, `packSlotInStage`, `Math.PI`, `translateX: 140` and `reduceMotion: true` (cases 1, 4, 6, 8, 9, 11, 12 above), and does not contain `vi.mock('@shopify/react-native-skia'`, `vi.mock('react-native-reanimated'` or `vi.mock('react-native-worklets'`.
6. Scope + frozen guard: only the two scope files (plus `docs/delivery/r16-issues/*`) differ from the merge-base; frozen files unchanged; `"vite": "7.2.4"`; no `@sentry`; no `.skip(`/`.only(` in the diff.

## Do NOT

- Do not create or edit `useCeremonyTimeline.ts`, `PackTear.tsx`, `FoilLayer.tsx`, `TapCard.tsx`, `ceremonyStyles.ts` or `DrawCeremonyScreen.tsx` — B06/B07/B08/B09 own them. Do not draw the pack here (B06's `PackTear` owns it and its Canvas — the ceremony tree's budget is three canvases, B00 §7.3). Do not convert `raysAngle` or `spill[i].rot` (both radians, B00 §2.10) and do not treat `spill[i].x/.y` as absolute stage coordinates (they are offsets from the centre — nest the rims in the origin group); do not change `PACK_BODY_FRACTION` away from `0.7` (it mirrors B06's); StageCanvas has no gesture host of its own (B00 §9 #15: the alias is `GestureHandler.PanHost`, used by B06/B08).
- Do not import `TELL_COLORS`/`haloColorForTell` from `useCeremonyTimeline.ts` (not in your worktree) and do not import `PARTICLE_SPRITES`/`GLOW_9SLICE` from `packArt.ts` (B12); take images through props only.
- Do not read `useClock`, `useDerivedValue`, `useSharedValue` or any Reanimated hook from `SkiaModule`; do not use RN `Animated`; do not add a second `Canvas`, a per-card canvas, a `RuntimeShader`, an image filter or a mask filter.
- Do not add `padding`/`layout` logic for the RN pack or cards; the canvas is `position: 'absolute'` behind them and `pointerEvents="none"`.
- Do not `vi.mock('@shopify/react-native-skia')` or `vi.mock('react-native-reanimated')` in the test; do not touch `tests/setup/*` or `vitest.config.ts`.
- Standing rules: no `git push`, no PR, never target or touch `main`, no `npm install`/`eas`/`expo prebuild`, no disabling/skipping/gutting tests, no `@ts-ignore`/`@ts-expect-error`/`eslint-disable`, no loosening of `tsconfig`.
