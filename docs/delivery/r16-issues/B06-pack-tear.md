# B06 — Pack tear (`pack-tear`)

`PackTear.tsx`: the reward pack as one Skia image drawn twice under two clip paths split by a jagged 14-vertex seam that sweeps with `timeline.seam`, a top strip that peels away with a perspective `rotateX`, a face-down card hint that rises with `cardOut`, a multi-pull deck-thickness edge and a pity seal — wrapped in an accessible RN root (`accessibilityRole="button"`, `accessibilityActions` `activate`) carrying the phase-dependent pack testIDs and a gesture-handler Pan that drives the seam on the UI thread; plus `packArt.ts` gains exactly one line, `export const SEAM_BAND_RATIO = 0.18;`, and a unit test proving the accessibility action starts the sequence.

## Context

Today the pack never tears. During `'swipe'` it is an RN `AnimatedView` with a gradient, a cover `Image`, a **slider track** and the caption "Swipe right to rip open" (`mobile/src/screens/DrawCeremonyScreen.tsx:1044-1083`; the thumb moves, the pack does not — `:1073-1078`); during `'approach'`/`'hold'` it is a *different* component (`draw-ceremony-single-pack-flyin` at `:1283-1315`, `MultiPackFlyIn` at `:1274-1281` with three packs whatever the count) and during `'tear-flip'` it simply unmounts (`:1270-1271`). The audit rows "The pack never tears open" (`docs/release-1.6.0-plan-2026-09-19.md:32`), "The swipe phase looks like a form control, and the pack does not follow the finger" (`:46`) and "The 'hold' build-up is scale + glow only" (`:45`) are this component's brief. The swipe itself is a raw responder on the **stage** View (`:987-1020`: `onResponderMove` divides the drag by `SWIPE_TRIGGER_DISTANCE` = 72 at `:67`/`:1001`, `onResponderRelease` calls `startSequence()` at `:1009-1011`), and the integration test drives exactly that responder (`mobile/tests/integration/draw-ceremony.screen.test.tsx:114-121` `armCeremonySwipe`), which is why the responder stays on the stage in B09 and this component only adds the device path (B00 §9 #11).

The design: S0 "first visual response within one frame when the seam is driven by the GH Pan on the UI thread" (`release-1.6.0-plan:96`), M0 "release ≥ 72 px starts; accessible 'activate' action starts" (`:110`), S1 "the swipe pack, stage pack and torn pack are one Skia Image node" (`:97`), S3 "Seam clip path sweeps left → right in 250 ms splitting the pack Image into two clipped draws; top strip peels with Matrix4 rotateX(-70°) about its bottom edge + translateY(-40) + fade over 200 ms (perspective 800)" (`:99`), the seam asset row "jagged tear path (12-16 vertices as a Skia Path string)" (`:142`), the code row `:159`, DoD "the pack is announced as a button, 'activate' starts the ceremony" (`:185`). B00 §2.9 (`docs/delivery/r16-issues/B00-contracts.md`, navigate by heading) fixes the props, the four string constants, the testID rule, the accessibility props and the one-line `packArt.ts` change; §2.1 fixes the guard you go through (the gesture host is `GestureHandler.PanHost`, §9 #15); §2.10 fixes the timeline keys `seam / peel / cardOut / packScale / packY / shiver` and their phase targets (seam → 1 over 250 ms `OUT_CUBIC` in tear-flip, peel → 1 over 200 ms, cardOut → 1 at +350 ms).

Three things this brief resolves because B06 depends on B02 only (B00 §5, `:744`):
- `CeremonyTimeline` is B07's type (`useCeremonyTimeline.ts` does not exist in your worktree). `PackTear` declares `PackTimeline`, the structural six-key subset it reads; B07's full type is assignable to it, so B09 passes the whole timeline unchanged.
- The B00 §7.3 canvas budget is **three** `<Canvas` under `mobile/src/components/ceremony` + `DrawCeremonyScreen.tsx`: the stage-light canvas (`StageCanvas`, B05), the pack canvas (this file) and at most one focused-card canvas (`FoilLayer`, B08). This component needs its own because an RN accessible root with a gesture-handler Pan cannot live inside a Skia canvas and the pack image needs Skia clip paths driven on the UI thread. Ship it with exactly one `<Canvas` sized to the pack slot (the stage canvas is `pointerEvents="none"` behind it); B11's count guard (`B11.verify.sh` step 5) allows ≤ 3.
- The Skia clip/peel geometry is pure and exported so the smoke test (mocked guard, see below) can pin it without a GPU.

**Test-infrastructure fact (verified on this tree):** `vi.mock('@shopify/react-native-skia' | 'react-native-gesture-handler', …)` never reaches a guarded `require(...)` (vite-node hands `require` to Node's loader), and under vitest B02's guard reports `skiaAvailable === false`, `SkiaModule === null`, `GestureHandler.available === false` (`tests/setup/ceremony.ts` sets `__CEREMONY_MOTION_AVAILABLE__ = false`). So the smoke test mocks the guard module `../../src/components/ceremony/reanimatedGuard` by its B00 §2.1 contract — Skia components as `'Skia.<Name>'` host elements, Reanimated hooks as plain `{ value }` fakes, an inert `Gesture.Pan()` — exactly as B05's `stageCanvas.test.tsx` does.

## Read first

1. `docs/delivery/r16-issues/B00-contracts.md` — B00 is edited by several fixers, so navigate by section heading, not line: §0 (non-negotiables; the gesture host's library export name is a banned substring), §2.1 (guard surface: `Reanimated.*`, `GestureHandler` with its `PanHost` member, `SkiaModule`, the ban on reading the Skia clock hook / a derived-value hook from `SkiaModule`), §2.9 (this file's contract, verbatim), §2.10 (timeline keys + targets + the "Units" paragraph: `shiver`/`packY` px), §4.1 (mock shapes your test must be compatible with), §6 (`SEAM_BAND_RATIO` is yours, B12 must not move it), §7.3 (three canvases: stage, pack, foil), §8, §9 #11 (responder placement), #12 (`RoundedRect`), #14 (who cuts the seam — you may set `seam = 1` on the commit and never touch `seam` outside `'swipe'`), #15 (`GestureHandler.PanHost`, never the library's export name), #16 (units: `shiver`/`packY` are px), #18 (the pack slot geometry B09 mounts you at — `packSlotInStage` is B05's export; you only guarantee `packBodyRect`), #19 (`React.JSX.Element`).
2. `mobile/src/screens/DrawCeremonyScreen.tsx:67` (`SWIPE_TRIGGER_DISTANCE = 72`), `:987-1020` (the stage responder that stays in the screen), `:1044-1083` (the swipe pack you replace), `:1270-1315` (fly-in packs you replace), `:461-462` (`palette`/`coverImage` come from `packPaletteFromSlug`/`packImageForSlug`).
3. `mobile/src/theme/packArt.ts:6-21` (`PackPalette`: `cover` is a 4-stop tuple, `ring`, `halo`), `:227-232` (`packImageForSlug`), `:245-250` (EOF — you append after line 250).
4. `mobile/tests/integration/draw-ceremony.screen.test.tsx:9-37` (the `react-native` mock shape to copy), `:114-121` (`armCeremonySwipe`), `:480-481` and `:770-771` (the pack testID assertions your `packTestID` rule must satisfy).
5. `mobile/src/components/HolographicLayer.tsx:21-33` (the guarded-require pattern B02 generalises; you never `require` anything yourself).
6. Skia 2.2.12 typings (read, do not guess): `node_modules/@shopify/react-native-skia/lib/module/dom/types/Common.d.ts:4-5` (`PathDef = string | SkPath`, `ClipDef`), `:36-59` (`transform`, `origin`, `clip`, `color`, `strokeWidth`, `style`, `opacity`), `dom/types/Drawings.d.ts:6-10` (`ImageProps { fit, image }`), `:12-18` (`PathProps { path }`), `:25` (`RoundedRectProps`), `skia/types/Matrix4.d.ts:37-42` (`Transforms3d` accepts `{ perspective }`, `{ rotateX }` in **radians**, `{ translateY }`, `{ scale }`), `skia/core/Image.d.ts:5` (`useImage(source: DataSourceParam)` — an RN `require()` asset number is a valid `DataModule`), `renderer/processors/Animations/Animations.d.ts:1-7` (`AnimatedProp<T> = T | { value: T }` — every Skia prop accepts a shared value), `renderer/Canvas.d.ts:20-28` (`Canvas` takes `ViewProps`).
7. `docs/release-1.6.0-plan-2026-09-19.md:96-99`, `:110`, `:142`, `:159`, `:185`.
8. `docs/delivery/r16-issues/B05-stage-canvas.md` §"Changes required" 2 (the guard-mock block — copy it; add `GestureHandler` as described below).

## Constraints

- **Scope (the ONLY files that may change):**
  - `mobile/src/components/ceremony/PackTear.tsx` (new)
  - `mobile/src/theme/packArt.ts` (exactly ONE appended line at EOF, byte-exact `export const SEAM_BAND_RATIO = 0.18;` — NO trailing comment, no other line changes, no blank line, no removed line; B12.verify.sh:163-164 compares the last non-empty line of the file to that exact string)
  - `mobile/tests/unit/packTear.test.tsx` (new)
- **Frozen files — zero diff:** `mobile/src/content/deckRepository.ts`, `mobile/src/sync/progressSync.ts`, `mobile/src/review/model.ts`. Also untouched: `reanimatedGuard.ts`, `ceremonyTimings.ts`, `StageCanvas.tsx`, `DrawCeremonyScreen.tsx`, `tests/unit/packArt.test.ts`, `vitest.config.ts`, `tests/setup/*`.
- **No dependency changes.** `"vite": "7.2.4"` stays; `react-native-gesture-handler` is already a dependency (`package.json:44`) and reaches you only through `GestureHandler` from the guard.
- **Every Skia, Reanimated and gesture-handler symbol comes from the guard.** Allowed imports: `react`, `{ View } from 'react-native'` plus `import type { ImageSourcePropType } from 'react-native'`, `{ GestureHandler, Reanimated, SkiaModule, skiaAvailable, type SharedValue } from './reanimatedGuard'`, `{ SWIPE_TRIGGER_DISTANCE, type CeremonyPhase } from '../../features/gacha/draw/ceremonyTimings'`, `{ SEAM_BAND_RATIO, type PackPalette } from '../../theme/packArt'`. No `import … from '@shopify/react-native-skia'`, `'react-native-reanimated'`, `'react-native-worklets'`, `'react-native-gesture-handler'`, `'expo-linear-gradient'`; no `require(` in this file.
- **Banned identifiers in this file (grepped, comments included):** `useClock`, `SkiaModule.useDerivedValue`, `BackdropBlur`, `<Blur`, `maskFilter`, `setInterval(`, `Animated.` (RN Animated), `shadowRadius`, `onResponderGrant`/`onResponderMove`/`onResponderRelease`/`onStartShouldSetResponder` (the raw responder is the screen's, B00 §9 #11), `accessibilityElementsHidden`, `Math.random`, `require(`. Exactly one `<Canvas` in the file.
- **Worklet rules:** destructure at module scope — `const { useSharedValue, useDerivedValue, withTiming, runOnJS } = Reanimated;` and `const SkiaApi: any | null = SkiaModule ? SkiaModule.Skia : null;` — and inside any `useDerivedValue` / gesture callback reference only those destructured functions, `SkiaApi` (a JSI host object; Skia's own docs build paths with `Skia.Path.Make()` inside derived values), shared values, plain numbers/strings/arrays and module-level pure functions that begin with `'worklet';`. Never reference the `Reanimated`, `GestureHandler` or `SkiaModule` namespace objects inside a worklet. Every pure helper called from a worklet (`seamProgressFromDelta`, `seamYAt`, `seamPointsPx`, `makeStripPath`, `makeBodyPath`, `makeSeamEdgePath`) starts with the `'worklet';` directive, as does every callback passed to `useDerivedValue`, `onUpdate`, `onEnd`.
- **Hooks discipline:** `skiaAvailable`/`SkiaModule` are module constants, so `PackTear` (RN root, gesture, a11y — no Skia hooks) renders the inner `PackCanvas` (all Skia hooks) only when `skiaAvailable && SkiaModule`; inside `PackCanvas` every hook runs on every render (no hook behind `isMulti`, `pitySeal` or `phase`).
- **Test literal rules:** no existing test changes; `tests/unit/packArt.test.ts` must stay green untouched (your one line adds an export, it changes no behaviour). The new test mocks `react-native` (copy `draw-ceremony.screen.test.tsx:9-37`'s shape; only `View`, `Text`, `StyleSheet` are needed) and the guard module; it must not `vi.mock('@shopify/react-native-skia')`, `'react-native-reanimated'` or `'react-native-gesture-handler'`.
- **Banned literals in identifiers/comments/strings (driver gate, case-insensitive over every added line under `mobile/src`):** `humanizer`, `bypass`, `undetect`, `detector`, `evade`, `Gemini said`. The gate term is anchored `\bdetector` in wave.conf, so the library's `GestureDetector` is allowed — but the guard exposes it as **`GestureHandler.PanHost`** (B00 §2.1 / §9 #15) and that alias is the name you use in `PackTear.tsx`; your test mocks `PanHost` the same way.
- **Return-type annotations:** `@types/react` 19.1 has no global `JSX` namespace (`mobile/node_modules/@types/react/index.d.ts:4028` declares it inside `namespace React` only) — write `React.JSX.Element`, never bare `JSX.Element` (TS2503 under `npm run test:typecheck`).
- **testIDs:** only the three B00 §2.9 pack testIDs, chosen by `packTestID(phase, isMulti)`; nothing else in this file carries a `testID`. No copy other than the three exported a11y strings and `PACK_ACTIVATE_LABEL`.

## Changes required

### 1. `mobile/src/theme/packArt.ts` — one appended line

After line 250 (the closing `}` of `cardBackImageForSlug`) append exactly this line, byte for byte, with no trailing comment:

```ts
export const SEAM_BAND_RATIO = 0.18;
```

`git diff --numstat` for this file must read `1 0` and the added line must equal `export const SEAM_BAND_RATIO = 0.18;` exactly (B06.verify.sh step 5 does a string compare, and B12.verify.sh:163-164 later asserts the last non-empty line of `packArt.ts` is that exact string, so a `//` comment would fail B12 unconditionally). Put the explanation — "top 18 % of the pack height is the seam band (release-1.6.0-plan §3.6)" — in the header comment of `PackTear.tsx`, not here. B12 (after you) edits other regions of this file and must not move the line.

### 2. `mobile/src/components/ceremony/PackTear.tsx` (new)

Exports (B00 §2.9 verbatim, plus the local types/helpers explained in Context):

```ts
import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { View } from 'react-native';
import type { ImageSourcePropType } from 'react-native';
import { GestureHandler, Reanimated, SkiaModule, skiaAvailable, type SharedValue } from './reanimatedGuard';
import { SWIPE_TRIGGER_DISTANCE, type CeremonyPhase } from '../../features/gacha/draw/ceremonyTimings';
import { SEAM_BAND_RATIO, type PackPalette } from '../../theme/packArt';

/** Structural subset of CeremonyTimeline (B00 §2.10) this component reads. */
export type PackTimeline = {
  seam: SharedValue<number>;      // 0 = intact, 1 = cut edge-to-edge
  peel: SharedValue<number>;      // 0 = strip flat, 1 = strip folded away
  cardOut: SharedValue<number>;   // 0 = card inside, 1 = card hint fully risen
  packScale: SharedValue<number>; // 1 at rest, 1.12 (single) / 1.10 (multi) in approach
  packY: SharedValue<number>;     // px, stage-space translateY
  shiver: SharedValue<number>;    // px, LEG beat translateX
};
export type PackTearProps = {
  width: number; height: number;                 // the pack SLOT (root View + canvas size); the pack body is packBodyRect() inside it.
                                                 // B09 mounts this View position:'absolute' at StageCanvas.packSlotInStage(stageW, stageH) (B05 export, B00 §2.8 / §9 #18):
                                                 // that slot is packRectInStage inflated by 1 / PACK_BODY_FRACTION about its centre, so packBodyRect(slot.width, slot.height)
                                                 // offset by (slot.x, slot.y) === packRectInStage(...) and the stage's leak band sits on this seam. You only guarantee packBodyRect().
  coverImage: ImageSourcePropType | undefined;
  palette: PackPalette;
  phase: CeremonyPhase;
  isMulti: boolean;
  pitySeal: boolean;
  timeline: PackTimeline;
  /** true under reduceMotion or when phase !== 'swipe' (DrawCeremonyScreen.tsx:990-993). */
  disabled: boolean;
  /** Called exactly once when the seam commits (release ≥ SWIPE_TRIGGER_DISTANCE, or the a11y 'activate' action). */
  onTear: () => void;
  onSeamProgress?: (progress01: number) => void;
};
export const PACK_A11Y_LABEL = 'Reward pack';
export const PACK_A11Y_HINT = 'Swipe right or double-tap to open';
export const PACK_ACTIVATE_ACTION = 'activate';
export const PACK_ACTIVATE_LABEL = 'Open pack';
export const PACK_A11Y_ACTIONS = Object.freeze([{ name: PACK_ACTIVATE_ACTION, label: PACK_ACTIVATE_LABEL }]);
export const PACK_BODY_FRACTION = 0.7;          // pack body = 70 % of the slot; the rest is bleed for scale 1.12 + the peel
export const PACK_CORNER_RADIUS = 14;
export const SEAM_VERTEX_COUNT = 14;
/** Jagged seam, normalised: x across the pack width (0..1, strictly increasing, first 0, last 1),
 *  y inside the seam band (0..1 of SEAM_BAND_RATIO × pack height). */
export const SEAM_PATH_NORMALISED: ReadonlyArray<readonly [number, number]> = Object.freeze([
  [0, 0.55], [0.08, 0.42], [0.16, 0.66], [0.24, 0.38], [0.31, 0.6], [0.39, 0.46], [0.47, 0.7],
  [0.55, 0.4], [0.62, 0.62], [0.7, 0.36], [0.78, 0.64], [0.86, 0.44], [0.93, 0.68], [1, 0.52],
] as const);
export const PEEL_ROTATE_X_RAD = -(70 * Math.PI) / 180;   // §3.1 S3 rotateX(-70°), Skia takes radians
export const PEEL_LIFT_PX = 40;                            // §3.1 S3 translateY(-40)
export const PEEL_PERSPECTIVE = 800;                        // §3.1 S3 perspective 800
export const CARD_OUT_RISE_FRACTION = 0.2;                  // card hint rises 20 % of the body height at cardOut = 1
export const DECK_EDGE_OFFSETS: readonly number[] = Object.freeze([6, 3]);   // multi deck-thickness rects (px)
export const SEAM_EDGE_COLOR = 'rgba(255,247,236,0.95)';
export const SEAL_COLOR = '#F5C95E';
export const RELEASE_SNAP_BACK_MS = 160;

export type PackRect = { x: number; y: number; width: number; height: number };
export function seamProgressFromDelta(deltaX: number): number;           // 'worklet'; clamp(deltaX / SWIPE_TRIGGER_DISTANCE, 0, 1)
export function packTestID(phase: CeremonyPhase, isMulti: boolean): string;
export function packBodyRect(width: number, height: number): PackRect;    // largest 2:3 rect in the slot × PACK_BODY_FRACTION, centred
export function seamPointsPx(body: PackRect): Array<{ x: number; y: number }>;  // 'worklet'
export function seamYAt(points: ReadonlyArray<{ x: number; y: number }>, x: number): number;  // 'worklet'; linear interpolation, clamped to the end points
export function PackTear(props: PackTearProps): React.JSX.Element;   // React.JSX — no global JSX namespace in @types/react 19 (B00 §9 #19)
```

Pure helpers (unit-tested; deterministic — "Honest tells only", `release-1.6.0-plan:75`, one tear animation for every rarity, no `Math.random`):

- `seamProgressFromDelta(d)`: `'worklet'`; `Math.min(1, Math.max(0, d / SWIPE_TRIGGER_DISTANCE))`.
- `packTestID(phase, isMulti)`: `phase === 'swipe' ? 'draw-ceremony-swipe-pack' : isMulti ? 'draw-ceremony-multi-flyin' : 'draw-ceremony-single-pack-flyin'` (B00 §2.9; test:480-481, :770-771).
- `packBodyRect(w, h)`: `bw = Math.min(w, (h * 2) / 3) * PACK_BODY_FRACTION`, `bh = bw * 1.5`, `x = (w − bw) / 2`, `y = (h − bh) / 2`. `packBodyRect(200, 300)` → `{ x: 30, y: 45, width: 140, height: 210 }`.
- `seamPointsPx(body)`: `'worklet'`; `SEAM_PATH_NORMALISED.map(([nx, ny]) => ({ x: body.x + nx * body.width, y: body.y + ny * body.height * SEAM_BAND_RATIO }))`.
- `seamYAt(points, x)`: `'worklet'`; `x ≤ points[0].x` → `points[0].y`; `x ≥ last.x` → `last.y`; otherwise linear between the bracketing vertices.
- Path builders (module-level, `'worklet'`, each takes `SkiaApi` as its first argument and returns `SkiaApi.Path.Make()` built with `moveTo`/`lineTo`/`close`):
  - `makeStripPath(SkiaApi, body, points, progress)`: `cutX = body.x + progress × body.width`; `moveTo(body.x, body.y)` → `lineTo(cutX, body.y)` → `lineTo(cutX, seamYAt(points, cutX))` → for every vertex with `x ≤ cutX` in **reverse** order `lineTo(p.x, p.y)` → `close()`. At `progress 0` this is a degenerate sliver (nothing visible is torn).
  - `makeBodyPath(SkiaApi, body, points, progress)`: `moveTo(body.x, points[0].y)` → for every vertex with `x ≤ cutX` in order `lineTo(p.x, p.y)` → `lineTo(cutX, seamYAt(points, cutX))` → `lineTo(cutX, body.y)` → `lineTo(body.x + body.width, body.y)` → `lineTo(body.x + body.width, body.y + body.height)` → `lineTo(body.x, body.y + body.height)` → `close()`. At `progress 0` this is the full rect; at `1` it is the rect minus the strip.
  - `makeSeamEdgePath(SkiaApi, points, progress)`: the open polyline through every vertex with `x ≤ cutX` (`moveTo` first, `lineTo` rest; at least the first vertex).

Component structure:

a. **`PackTear`** (exported; no Skia hooks): 
   - `const { PanHost, Gesture } = GestureHandler;` (module scope; `PanHost` IS the library's gesture host component under its guard name, B00 §2.1).
   - `committedRef = useRef(false)`; `useEffect(() => { if (phase === 'swipe') committedRef.current = false; }, [phase])`.
   - `commit = useCallback(() => { if (disabled || committedRef.current) return; committedRef.current = true; timeline.seam.value = 1; onTear(); }, [disabled, onTear, timeline.seam])` — the **only** path to `onTear`, so it fires at most once per swipe phase.
   - `report = useCallback((p: number) => { onSeamProgress?.(p); }, [onSeamProgress])`.
   - `lastStep = useSharedValue(-1)` (a Reanimated hook via the guard — allowed here because the guard's fallback is a plain `useRef`).
   - `pan = useMemo(() => Gesture.Pan().enabled(!disabled).activeOffsetX(8).failOffsetY([-24, 24]).onUpdate((e) => { 'worklet'; const p = seamProgressFromDelta(e.translationX); seam.value = p; const step = Math.round(p * 10); if (step !== lastStep.value) { lastStep.value = step; runOnJS(report)(p); } }).onEnd((e) => { 'worklet'; lastStep.value = -1; if (e.translationX >= SWIPE_TRIGGER_DISTANCE) { seam.value = 1; runOnJS(commit)(); } else { seam.value = withTiming(0, { duration: RELEASE_SNAP_BACK_MS }); runOnJS(report)(0); } }), [disabled, seam, lastStep, report, commit])` where `seam = timeline.seam`. `onSeamProgress` is therefore called at most 11 times per drag (quantised tenths) plus once on a failed release — B09 uses it for the selection haptic when the value first reaches 1.
   - JSX:
     ```tsx
     <PanHost gesture={pan}>
       <View
         testID={packTestID(phase, isMulti)}
         accessible
         accessibilityRole="button"
         accessibilityLabel={PACK_A11Y_LABEL}
         accessibilityHint={PACK_A11Y_HINT}
         accessibilityActions={PACK_A11Y_ACTIONS}
         accessibilityState={{ disabled }}
         onAccessibilityAction={(event) => { if (event?.nativeEvent?.actionName === PACK_ACTIVATE_ACTION) commit(); }}
         style={{ width, height }}
       >
         {skiaAvailable && SkiaModule ? <PackCanvas {...props} /> : <View style={{ flex: 1, margin: '15%', borderRadius: PACK_CORNER_RADIUS, backgroundColor: palette.cover[1] }} />}
       </View>
     </PanHost>
     ```
     No element-hiding accessibility prop is ever set on this root or its children (VoiceOver must reach it, DoD `:185`); the token `accessibilityElementsHidden` is grepped as banned, so do not even mention it in a comment.

b. **`PackCanvas`** (module-private; receives `PackTearProps`; all Skia hooks): `const { Canvas, Group, Rect, RoundedRect, Image, Path, Circle, useImage, vec, rrect, rect } = SkiaModule;` at the top of the function body (SkiaModule is non-null here). Then, unconditionally:
   - `body = useMemo(() => packBodyRect(width, height), [width, height])`; `points = useMemo(() => seamPointsPx(body), [body])`; `centre = vec(body.x + body.width / 2, body.y + body.height / 2)`; `stripPivot = vec(centre.x, body.y + body.height * SEAM_BAND_RATIO)`.
   - `cover = useImage(coverImage ?? null)` (null → the fallback fill).
   - Derived values (each callback `'worklet'`): `packTransform = useDerivedValue(() => [{ translateX: shiver.value }, { translateY: packY.value }, { scale: packScale.value }])`; `bodyClip = useDerivedValue(() => makeBodyPath(SkiaApi, body, points, seam.value))`; `stripClip = useDerivedValue(() => makeStripPath(SkiaApi, body, points, seam.value))`; `seamEdge = useDerivedValue(() => makeSeamEdgePath(SkiaApi, points, seam.value))`; `peelTransform = useDerivedValue(() => [{ perspective: PEEL_PERSPECTIVE }, { translateY: -PEEL_LIFT_PX * peel.value }, { rotateX: PEEL_ROTATE_X_RAD * peel.value }])`; `stripOpacity = useDerivedValue(() => 1 - peel.value)`; `cardOutTransform = useDerivedValue(() => [{ translateY: -cardOut.value * body.height * CARD_OUT_RISE_FRACTION }])`.
   - JSX (bottom → top):
     ```tsx
     <Canvas style={{ width, height }} pointerEvents="none">
       <Group transform={packTransform} origin={centre}>
         {isMulti ? DECK_EDGE_OFFSETS.map((o, i) => <RoundedRect key={o} x={body.x + o} y={body.y + o} width={body.width} height={body.height} r={PACK_CORNER_RADIUS} color={palette.ring} opacity={0.45 + i * 0.2} />) : null}
         {/* face-down card hint rising out of the seam */}
         <RoundedRect x={body.x + body.width * 0.1} y={body.y + body.height * 0.05} width={body.width * 0.8} height={body.height * 0.9} r={10} color={palette.ring} opacity={timeline.cardOut} transform={cardOutTransform} />
         <Group clip={rrect(rect(body.x, body.y, body.width, body.height), PACK_CORNER_RADIUS, PACK_CORNER_RADIUS)}>
           <Group clip={bodyClip}>
             {cover ? <Image image={cover} x={body.x} y={body.y} width={body.width} height={body.height} fit="cover" /> : <Rect x={body.x} y={body.y} width={body.width} height={body.height} color={palette.cover[1]} />}
           </Group>
           <Group clip={stripClip} transform={peelTransform} origin={stripPivot} opacity={stripOpacity}>
             {cover ? <Image image={cover} x={body.x} y={body.y} width={body.width} height={body.height} fit="cover" /> : <Rect x={body.x} y={body.y} width={body.width} height={body.height} color={palette.cover[1]} />}
           </Group>
         </Group>
         <Path path={seamEdge} style="stroke" strokeWidth={2} color={SEAM_EDGE_COLOR} opacity={timeline.seam} />
         {pitySeal ? (<>
           <Circle cx={body.x + body.width - 18} cy={body.y + 18} r={12} color={SEAL_COLOR} />
           <Circle cx={body.x + body.width - 18} cy={body.y + 18} r={8} color={SEAM_EDGE_COLOR} style="stroke" strokeWidth={1.5} />
         </>) : null}
       </Group>
     </Canvas>
     ```
     Every dynamic prop is a shared/derived value passed directly — no `.value` reads in render.

c. Nothing here schedules timers, calls `onTear` from a timeline change, or reads `phase` for anything except the testID and the `committedRef` reset; the seam/peel/cardOut targets per phase are B07's, and the tear phase entry is B09's timer. Seam ownership (B00 §9 #14): the Pan and `commit()` write `timeline.seam` only while enabled (`phase === 'swipe'`, `!disabled`); setting `seam = 1` on the commit is allowed (B07 re-targets it to `SEAM_PRECUT` on the next effect tick and sweeps it to 1 in tear-flip); after `'swipe'` this file never writes `seam`.

### 3. `mobile/tests/unit/packTear.test.tsx` (new, ≥ 11 `it(` blocks)

Setup (top of file, hoisted mocks): the `react-native` mock from `draw-ceremony.screen.test.tsx:9-37` reduced to `View`/`Text`/`StyleSheet`, and the guard mock from `B05-stage-canvas.md` change 2 with these additions: `guardState` gains `useImage: (_s: unknown): unknown => null`; `GestureHandler` is `{ available: false, PanHost: (p: any) => p.children, Gesture: { Pan: () => inert, Tap: () => inert } }` where `inert` is an object whose `enabled/activeOffsetX/failOffsetY/onUpdate/onEnd/onBegin/onStart/onFinalize/minDistance/runOnJS` all return itself; `SkiaModule.Skia.Path.Make` returns `{ moveTo() { return this; }, lineTo() { return this; }, close() { return this; } }`; `rect`/`rrect`/`vec` return plain objects; `Reanimated.useSharedValue(v) → ({ value: v })`, `useDerivedValue(fn) → ({ value: fn() })`, `withTiming(to) → to`, `runOnJS(fn) → fn`. A `makeTimeline(over?)` helper returns `{ seam, peel, cardOut, packScale, packY, shiver }` as distinct `{ value }` objects (defaults `0, 0, 0, 1, 0, 0`), and `PALETTE: PackPalette = { cover: ['#1', '#2', '#3', '#4'], halo: '#h', ring: '#r', titleInk: '#t', badgeBg: '#b', badgeInk: '#i' }`. `renderPack(over: Partial<PackTearProps>)` renders `<PackTear width={200} height={300} coverImage={undefined} palette={PALETTE} phase="swipe" isMulti={false} pitySeal={false} timeline={makeTimeline()} disabled={false} onTear={vi.fn()} {...over} />` inside `act`.

Cases:
1. Root: `findByProps({ accessibilityLabel: 'Reward pack' })` has `accessibilityRole 'button'`, `accessibilityHint 'Swipe right or double-tap to open'`, `accessibilityActions` containing `{ name: 'activate', label: 'Open pack' }`, `accessibilityState` `{ disabled: false }`, `accessible === true`, and no `accessibilityElementsHidden`.
2. **Activate starts the sequence:** `onAccessibilityAction({ nativeEvent: { actionName: 'activate' } })` → `onTear` called once and `timeline.seam.value === 1`; calling it again → still once.
3. `disabled: true` → the same action does not call `onTear`; `accessibilityState.disabled === true`.
4. `actionName: 'escape'` → `onTear` not called.
5. Re-arming: render with `phase: 'swipe'`, activate (once), `update` to `phase: 'approach'`, `update` back to `phase: 'swipe'`, activate again → `onTear` called twice in total.
6. testID rule: `packTestID('swipe', true) === 'draw-ceremony-swipe-pack'`, `('approach', true) === 'draw-ceremony-multi-flyin'`, `('hold', false) === 'draw-ceremony-single-pack-flyin'`, `('tear-flip', false) === 'draw-ceremony-single-pack-flyin'`; a render with `phase: 'hold', isMulti: true` has root `testID 'draw-ceremony-multi-flyin'` and no `'draw-ceremony-swipe-pack'` anywhere.
7. Canvas: exactly one `Skia.Canvas` with `pointerEvents 'none'` and `style` `{ width: 200, height: 300 }`; exactly 2 `Skia.Group`s whose `clip.value` has a `moveTo` function (body + strip — under the guard mock `useDerivedValue(fn)` returns `{ value: fn() }`, so the derived clips arrive as `{ value: path }`) and exactly 1 whose `clip.rx` is defined (the rounded mask is a plain `rrect(...)` object, not a derived value); the outermost `Skia.Group` has `transform.value` deep-equal to `[{ translateX: 0 }, { translateY: 0 }, { scale: 1 }]` with the default timeline.
8. Cover fallback: with `guardState.useImage = () => null` → no `Skia.Image`, exactly 2 `Skia.Rect` with `color === PALETTE.cover[1]`; with `guardState.useImage = () => ({ fake: true })` and `coverImage: 7` → exactly 2 `Skia.Image`, both `fit === 'cover'` and the same `image` object, and 0 `Skia.Rect`.
9. Multi / seal: `isMulti: true` → 3 `Skia.RoundedRect` (2 deck edges with `color === PALETTE.ring` at `x` 36 and 33 for `packBodyRect(200,300).x === 30`, plus the card hint) vs 1 for single; `pitySeal: true` → 2 `Skia.Circle` (vs 0), the larger with `color === SEAL_COLOR`.
10. Peel geometry: timeline `{ peel: 0.5, packScale: 1.12, cardOut: 1 }` → the strip Group's `transform.value` is `[{ perspective: 800 }, { translateY: -20 }, { rotateX: PEEL_ROTATE_X_RAD * 0.5 }]` (`toBeCloseTo` on `rotateX`), its `opacity.value === 0.5`; the pack Group's transform contains `{ scale: 1.12 }`; the card-hint `RoundedRect` has `transform.value[0].translateY === -42` (210 × 0.2) and `opacity === timeline.cardOut` by identity.
11. Pure: `seamProgressFromDelta` for `-5, 0, 36, 72, 100` → `0, 0, 0.5, 1, 1`; `packBodyRect(200, 300)` → `{ x: 30, y: 45, width: 140, height: 210 }`; `SEAM_PATH_NORMALISED.length === 14` with `x` strictly increasing from `0` to `1` and every `y` in `(0, 1)`; `seamPointsPx(body)` has first `x === body.x`, last `x === body.x + body.width`, every `y` within `[body.y, body.y + body.height * 0.18]`; `seamYAt([{x:0,y:0},{x:10,y:10}], 5) === 5`, `(…, -1) === 0`, `(…, 11) === 10`.
12. Skia unavailable: `guardState.skiaAvailable = false`, `vi.resetModules()`, `await import('../../src/components/ceremony/PackTear')` → the render has no `Skia.Canvas`, the root still has `accessibilityRole 'button'` and the activate action still calls `onTear` (restore in `afterEach`).

Estimated size: `PackTear.tsx` ≈ 260 LOC, test ≈ 260 LOC, `packArt.ts` +1.

## Acceptance

Run from `mobile/`. `docs/delivery/r16-issues/B06.verify.sh` runs exactly these.

1. `npx vitest run tests/unit/packTear.test.tsx tests/unit/packArt.test.ts --reporter=dot` exits 0; `tests/unit/packTear.test.tsx` has ≥ 11 `it(` blocks.
2. `npm run test:typecheck` exits 0.
3. Positive greps on `src/components/ceremony/PackTear.tsx`: `export const PACK_A11Y_LABEL = 'Reward pack'`, `export const PACK_A11Y_HINT = 'Swipe right or double-tap to open'`, `export const PACK_ACTIVATE_ACTION = 'activate'`, `export const PACK_ACTIVATE_LABEL = 'Open pack'`, `export const SEAM_PATH_NORMALISED`, `export function seamProgressFromDelta`, `export function packTestID`, `export function packBodyRect`, `export function seamPointsPx`, `export function seamYAt`, `export function PackTear`, `export type PackTearProps`, `export type PackTimeline`, `'draw-ceremony-swipe-pack'`, `'draw-ceremony-multi-flyin'`, `'draw-ceremony-single-pack-flyin'`, `accessibilityRole="button"`, `accessibilityActions=`, `onAccessibilityAction=`, `accessibilityState={{ disabled }}`, `from './reanimatedGuard'`, `SWIPE_TRIGGER_DISTANCE`, `SEAM_BAND_RATIO`, `PanHost`, `<PanHost gesture=`, `Gesture.Pan()`, `rotateX`, `perspective`, `fit="cover"`, `'worklet'`.
4. Negative greps on the same file: `useClock`, `SkiaModule.useDerivedValue`, `BackdropBlur`, `<Blur`, `maskFilter`, `setInterval(`, `shadowRadius`, `Math.random`, `require(`, `onResponderGrant`, `onResponderMove`, `onResponderRelease`, `onStartShouldSetResponder`, `accessibilityElementsHidden`, `from '@shopify/react-native-skia'`, `from 'react-native-reanimated'`, `from 'react-native-worklets'`, `from 'react-native-gesture-handler'`, `from 'expo-linear-gradient'`, `eslint-disable`, `@ts-ignore`, `@ts-expect-error` — all absent; no bare `JSX.Element` (only `React.JSX.Element`); the six driver-banned terms absent case-insensitively from `PackTear.tsx` and `packTear.test.tsx` (so the gesture host is only ever `PanHost`); `grep -c "<Canvas"` is exactly 1.
5. `packArt.ts`: `grep -cx "export const SEAM_BAND_RATIO = 0.18;"` is 1; `git diff --numstat <merge-base> -- mobile/src/theme/packArt.ts` is exactly `1	0`; the single added line is byte-equal to `export const SEAM_BAND_RATIO = 0.18;` (no trailing comment or whitespace) and is the last non-empty line of the file.
6. The test mocks the guard, not the packages: `packTear.test.tsx` contains `vi.mock('../../src/components/ceremony/reanimatedGuard'` and `actionName: 'activate'`, and does not contain `vi.mock('@shopify/react-native-skia'`, `vi.mock('react-native-reanimated'` or `vi.mock('react-native-gesture-handler'`.
7. Scope + frozen guard: only the three scope files (plus `docs/delivery/r16-issues/*`) differ from the merge-base; frozen files unchanged; `"vite": "7.2.4"`; no `@sentry`; no `.skip(`/`.only(`/`@ts-ignore`/`eslint-disable` in the diff.

## Do NOT

- Do not create or edit `StageCanvas.tsx`, `useCeremonyTimeline.ts`, `TapCard.tsx`, `FoilLayer.tsx`, `FallbackStage.tsx`, `ceremonyStyles.ts` or `DrawCeremonyScreen.tsx` — B05/B07/B08/B09 own them. Do not draw the halo, rays, light-leak, flash or particles here (B05's stage canvas does).
- Do not put responder props (`onResponder*`, `onStartShouldSetResponder`) on the pack — the raw responder the integration test drives stays on the stage View in B09 (B00 §9 #11); the pack's device path is the GH Pan only.
- Do not change `packArt.ts` beyond the one appended line, and do not put a comment on that line (B12's verify compares it byte-for-byte): no registry edits, no `normalizeSlugForPack` change, no gradient-stop change (all B12).
- Do not read the Skia clock hook or a derived-value hook from `SkiaModule`; do not use RN `Animated`; do not add a second `Canvas`, an image filter, a mask filter or a `RuntimeShader`.
- Do not call `onTear` from a timeline value, a timer or an effect — only from the Pan release (≥ 72 px) and the accessibility action, through `commit()`.
- Do not `vi.mock('@shopify/react-native-skia')`, `'react-native-reanimated'` or `'react-native-gesture-handler'` in the test; do not touch `tests/setup/*`, `vitest.config.ts` or `tests/unit/packArt.test.ts`.
- Standing rules: no `git push`, no PR, never target or touch `main`, no `npm install`/`eas`/`expo prebuild`, no disabling/skipping/gutting tests, no `@ts-ignore`/`@ts-expect-error`/`eslint-disable`, no loosening of `tsconfig`.
