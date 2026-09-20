# B07 — useCeremonyTimeline.ts: all shared values + phase mapping (named easings e.g. EMPHASIZED_OUT, LEG hit-pause, silence beat) (`ceremony-timeline`)

One hook owns every Reanimated shared value the Seam of Light ceremony animates, and one pure table says what value each phase drives each of them to — so the stage (B05), the pack (B06) and the screen (B09) never own motion state and the unit test can pin the whole choreography as a phase → target table without a device.

## Context

Today every animated quantity of the ceremony lives as an RN `Animated.Value` inside `DrawCeremonyScreen.tsx` (`bobRef`/`scaleRef`/`rotateRef`/`flipRef`/`shakeRef` `:416-420`, `sceneScaleRef`/`sceneRotZRef` `:431-432`, `haloIntensityRef`/`haloRotateRef` `:436-440`) and is driven from a phase `useEffect` (`:543-700`) with uniform default easings, single-property moves and six equal 40 ms linear shake steps (`:678-685`) — the "prototype motion" the design audit calls out (`docs/release-1.6.0-plan-2026-09-19.md:34` and `:38`, §1 table rows "default easeInOut with a single animated property" and "pure rotateY with a hard face swap"). The hold phase animates `scaleRef` which the multi path never mounts (`:596` vs `:1272-1281`), the halo is pre-tinted from frame 0 (`haloColor = rarityHaloColor(peakRarity)` at `:465` feeding `:925-958`), and there is no silence beat, no LEG hit-pause and no colour tell (§2 rows `:64` "Telegraph rarity", `:66` "Silence before the hit", `:67` "Payoff = ease-out impact").

Design §3.7 (`docs/release-1.6.0-plan-2026-09-19.md:160`, the `useCeremonyTimeline.ts` row) moves all of that into `src/components/ceremony/useCeremonyTimeline.ts`: "Owns all shared values (tell, dim, seam, leak, flash, cameraScale, cameraRot, shiver, spill[i] x/y/rot, rim[i]) and maps phase → withTiming/withSequence/withSpring with named easings (EMPHASIZED_OUT = bezier(0.05,0.7,0.1,1), STANDARD, LINEAR)". The contract for the hook, its input, the `EASING`/`TELL_COLORS`/`LEG_HIT_PAUSE_MS`/`LEG_DIM` constants, the `TimelineTargets` table and `haloColorForTell` is `docs/delivery/r16-issues/B00-contracts.md` §2.10 (`:477-508`) and is verbatim below. The consumers are B05 `StageCanvas` (reads `tell`, `dim`, `rays`, `raysAngle`, `halo`, `leak`, `flash`, `rim[i]`, `spill[i]`; B00 §2.8), B06 `PackTear` (reads `seam`, `peel`, `cardOut`, `packScale`, `packY`, `shiver`; B00 §2.9) and B09 `DrawCeremonyScreen` (constructs `TimelineInput`, passes the timeline down, and is the only reader of `cameraScale`/`cameraRot` through its content wrapper; B00 §3.5, §9 #17). Because B05 hands `raysAngle` and `spill[i].rot` straight to Skia `rotate` and draws the rims inside a centre-origin `Group`, the **units are part of the contract** (B00 §2.10 "Units", §9 #16): radians for both angles, pt offsets from the stage centre for `spill[i].x/.y`, px for `shiver`/`packY`, degrees only for `cameraRot` (an RN `rotate` string in B09). And because the finger (B06's Pan, B09's raw responder) drives `seam` to 1 by the time it commits, **this hook owns the cut from `approach` onward** (B00 §9 #14): approach relaxes `seam` to the `SEAM_PRECUT` nick so the 250 ms S3 sweep has somewhere to sweep from.

Everything goes through the B02 guard (`mobile/src/components/ceremony/reanimatedGuard.ts`, B00 §2.1): under vitest `tests/setup/ceremony.ts` sets `globalThis.__CEREMONY_MOTION_AVAILABLE__ = false`, so `Reanimated.useSharedValue(v)` is `useRef({ value: v }).current`, `withTiming/withSpring/withDelay/withRepeat/withSequence` return their final numeric target immediately and `Easing.*` are identity curves. That is what makes the "mock reanimated: phase → target-value table" verify in the wave plan (`docs/delivery-wave-1.6-plan-2026-09-19.md:89`, the B07 row) deterministic: after the hook applies a phase, every shared value holds the table's number.

Timings come from B02 (`mobile/src/features/gacha/draw/ceremonyTimings.ts`, B00 §2.2: `ResolvedCeremonyTimings`, `TELL_FRACTION_OF_HOLD = 0.6`, `FAST_FORWARD_TEAR_FACTOR = 1.6`, `SPILL_*`) and the deal order from B03 (`mobile/src/features/gacha/draw/spillSchedule.ts`, B00 §2.3: `SpillSchedule`/`SpillEntry`, `centreSlot`). Both exist on the branch when this issue runs (deps B02, B03).

## Read first

1. `docs/delivery/r16-issues/B00-contracts.md` §2.1 (`:107-186`, guard surface: `SharedValue<T>`, `Reanimated.*`, `motionAvailable`), §2.2 (`:187-273`, `ResolvedCeremonyTimings`, the constants), §2.3 (`:274-301`, `SpillSchedule`), §2.10 (this module's contract — verbatim, plus the "Units" paragraph), §3.1 (`:646-648`, phases vs sub-beats), §4.1 (`:694-710`, what the test setup mocks), §8 (verify conventions), §9 #14, #16, #17 (seam ownership, units, camera consumer).
2. `docs/release-1.6.0-plan-2026-09-19.md:96-104` (S0–S6 + FF + RM rows: every number the targets table encodes — S0 `:96` rays 0.10 / 14 s per revolution, S1 `:97` pack 1.0 → 1.12 with `Easing.bezier(0.05,0.7,0.1,1)` and rays 0.10 → 0.22, S2 `:98` tell over the first 60 % of hold / LEG violet at ~40 % → gold at ~60 %, S3 `:99` rip 0-250 / peel 250-450 / card out 350-600 / 32 ms hit-pause / leak 0.6 → 1.0 in 60 ms, S4 `:100` flash 0 → 0.85 in 60 ms then → 0 over 260 ms `Easing.out(quad)`, S5 `:101` rim 0.55 / COM none), `:110-117` (M0–M6: M1 `:111` scale 1.10 / rays 0.26, M3 `:113` rip 0-300 / peel 300-550 / stack 550-900 / fan 900-1800), `:121` (§3.2 colour tell: white → violet → gold two-step), `:129` (§3.4 RM: opacity-only 180 ms, no scale/rotate/shake), `:133` (§3.5: ≤ 24 shared values animated concurrently).
3. `docs/release-1.6.0-plan-2026-09-19.md:62-77` (§2 rules: `:63` "Anticipation … ≥ 2 changing parameters", `:66` "Silence before the hit", `:67` "Payoff = ease-out impact", `:68` "Screenshake/rock decays and is reserved", `:69` "Settle is mandatory", `:75` "Honest tells only", `:76` "Reduce Motion is a parallel ceremony").
4. `mobile/src/screens/DrawCeremonyScreen.tsx:543-700` (the effect you are replacing — read the LEG shake `:676-695`, the camera punch `:657-662`, the halo ramp `:601-607`) and `:215-219` (the table arc math `t`, `arcAngle`, `arcLift` that `spillSlotOffset` must reproduce so a dealt card lands exactly where B08's `TapCard` sits) and `:1199-1200` (card sizes 132×184 / 80×116 / 72×100) and `:1202-1256` (row split: ≤ 5 one row, else two rows of `ceil(n/2)`).
5. `mobile/src/components/ceremony/reanimatedGuard.ts` (B02, on the branch) — confirm the exact names you import: `Reanimated`, `SharedValue` (and that `motionAvailable` exists but is not yours to read).
6. `mobile/src/features/gacha/draw/ceremonyTimings.ts` (B02) and `mobile/src/features/gacha/draw/spillSchedule.ts` (B03) — confirm `ResolvedCeremonyTimings`, `TELL_FRACTION_OF_HOLD`, `SpillSchedule`, `SpillEntry`, `centreSlot`.
7. `mobile/tests/unit/libraryCardTile.test.tsx:1-25` (the `vi.mock('react-native', …)` shape every component-touching unit test in this repo declares itself; copy it) and `mobile/tests/setup/ceremony.ts` (B02; already registered in `vitest.config.ts`, you do not register anything).

## Constraints

- **Scope (the ONLY files that may change; both are new):**
  - `mobile/src/components/ceremony/useCeremonyTimeline.ts`
  - `mobile/tests/unit/useCeremonyTimeline.test.ts`
- **Frozen files, zero diff:** `mobile/src/content/deckRepository.ts`, `mobile/src/sync/progressSync.ts`, `mobile/src/review/model.ts` (`mobile/gacha-v7.md` §2.1). Also untouched by this issue: `reanimatedGuard.ts`, `ceremonyTimings.ts`, `spillSchedule.ts`, `DrawCeremonyScreen.tsx`, `CeremonyLottie.tsx`, `vitest.config.ts`, `tests/setup/*`.
- **No dependency changes** (`package.json`/`package-lock.json` untouched; `"vite": "7.2.4"` stays). Only B01 changes dependencies.
- **Imports allowed in `useCeremonyTimeline.ts`:** `react` (`useEffect`, `useMemo`, `useRef`), `./reanimatedGuard` (`Reanimated` and type `SharedValue` only — never `motionAvailable`, see change 4), `../../features/gacha/draw/ceremonyTimings` (types `CeremonyPhase`, `PeakRarity`, `ResolvedCeremonyTimings`; constants `TELL_FRACTION_OF_HOLD`), `../../features/gacha/draw/spillSchedule` (types `SpillSchedule`, `SpillEntry`; `centreSlot`). **Nothing from `react-native`**, nothing from `@shopify/react-native-skia`, `react-native-reanimated` or `react-native-worklets` directly — the guard is the only door (B00 §2.1: "the only shape any Wave B module may assume for a shared value"). No import from B05/B06/B08/B09 files (they depend on you, not the reverse).
- **Hook discipline:** `Reanimated.useSharedValue` is a hook. The per-card arrays are created by a `for` loop with the constant bound `MAX_TIMELINE_CARDS = 10` so the hook count never changes between renders; `cardCount` only slices what the returned timeline exposes (`Math.min(cardCount, MAX_TIMELINE_CARDS)`, never throw).
- **Every transition is a Reanimated animation assigned to `.value`** (`sv.value = Reanimated.withTiming(...)`). No `setTimeout`, no `setInterval`, no `requestAnimationFrame`, no `Date.now()` in this module — timers belong to the screen (B00 §3.2) and the sampler (B00 §2.12). The one exception is none.
- **Test-literal rules:** `mobile/tests/unit/useCeremonyTimeline.test.ts` is new; no existing test changes. Do not edit `tests/unit/ceremonyTimings.test.ts` or `tests/unit/spillSchedule.test.ts` (you import their subjects, you do not touch their tests).
- **No testIDs, no UI copy, no components** — this module renders nothing and exports no React component.
- **Banned literals** in identifiers/comments/strings (driver gate): `humanizer`, `bypass`, `undetect`, `detector`, `evade`, `Gemini said`. Say "skip", "guard", "fallback". No `@ts-ignore`, `@ts-expect-error`, `eslint-disable`, `.skip(`, `.only(`.
- **Units are contractual (B00 §2.10 "Units"):** `raysAngle` and `spill[i].rot` are driven in **radians** (Skia `rotate` in B05 takes radians; one revolution is `Math.PI * 2`, never `360`); `spill[i].x/.y` are **pt offsets from the stage centre** (B05 draws the rims inside a centre-origin `Group`; B09's fallback uses them as RN `translateX/Y` on a centred absolute view); `shiver`, `packY` are px; `cameraRot` is degrees (B09 renders it as `` `${deg}deg` ``); `spillSlotOffset(...).rot` stays in **degrees** because the RN fallback consumes it directly — the hook converts with `* Math.PI / 180` when it assigns `spill[i].rot`.
- **Worklet hygiene:** `haloColorForTell` and its helper `lerpHex` begin with the `'worklet';` directive so B05 may call them inside a UI-thread derived value; under vitest (no babel plugin) the directive is an inert string. No other function in this file needs it.

## Changes required

1. **`mobile/src/components/ceremony/useCeremonyTimeline.ts` — types and constants (B00 §2.10 verbatim).**
   ```ts
   import type { SharedValue } from './reanimatedGuard';
   import type { CeremonyPhase, PeakRarity, ResolvedCeremonyTimings } from '../../features/gacha/draw/ceremonyTimings';
   import type { SpillSchedule } from '../../features/gacha/draw/spillSchedule';

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
   export type TimelineTargets = { tell: number; dim: number; leak: number; flash: number; cameraScale: number; packScale: number; rays: number; halo: number; peel: number; cardOut: number; rim: number };
   export function timelineTargets(input: Pick<TimelineInput, 'phase' | 'peakRarity' | 'isMulti' | 'reduceMotion'>): TimelineTargets;
   export function haloColorForTell(tell: number, peakRarity: PeakRarity): string;
   export function useCeremonyTimeline(input: TimelineInput): CeremonyTimeline;
   ```
   Additional exports this brief adds (not in B00; pure helpers the hook needs and that B09 reuses — see Do NOT for the naming rule):
   ```ts
   export type EasingName = (typeof EASING)[keyof typeof EASING];
   /** Maps an EASING string to the guard's Reanimated.Easing curve (identity under fallback). */
   export function resolveEasing(name: EasingName): (t: number) => number;
   export const MAX_TIMELINE_CARDS = 10;
   export const RAYS_ANGLE_PERIOD_MS = 14000;      // equals StageCanvas.RAY_REVOLUTION_MS (B05); one linear revolution = Math.PI * 2 radians
   export const RM_CROSSFADE_MS = 180;             // §3.4: every RM transition is an opacity-only 180 ms crossfade
   export const SHIVER_HZ = 18;                    // §3.1 S2: LEG pack shivers at 18 Hz during the beat
   export const SHIVER_PX = 3;                     // amplitude of that shiver in px (PackTear reads `shiver` as translateX px; today's shake is ±6, DrawCeremonyScreen.tsx:679-684)
   export const SEAM_PRECUT = 0.15;                // the finger's nick: `seam` rests here from approach until the S3 sweep (B00 §9 #14)
   export const SEAM_PRECUT_MS = 120;              // approach: seam relaxes from the finger's value to SEAM_PRECUT over this (OUT_QUAD)
   /** Sub-beats of 'tear-flip' as fractions of timings.tearFlip (§3.1 S3 single 600: rip 0-250, peel 250-450, card out 350-600;
    *  M3 multi 1800: rip 0-300, peel 300-550, stack slide 550-900, fan 900-1800 via SpillSchedule). */
   export const TEAR_BEATS = Object.freeze({
     single: { seamEnd: 250 / 600, peelStart: 250 / 600, peelEnd: 450 / 600, cardOutStart: 350 / 600, cardOutEnd: 1 },
     multi:  { seamEnd: 300 / 1800, peelStart: 300 / 1800, peelEnd: 550 / 1800, cardOutStart: 550 / 1800, cardOutEnd: 900 / 1800 },
   });
   /** Table geometry shared with the tap table (DrawCeremonyScreen.tsx:1199-1256 today): card size by count and the row split. */
   export function tableSlotLayout(count: number): { width: number; height: number; rowLength: number; rows: number };
   /** Offset of slot `slot` from the stage centre, in pt, including the fanned-hand arc (DrawCeremonyScreen.tsx:215-219).
    *  `rot` is in DEGREES (the RN fallback renders it as `${rot}deg`); the hook multiplies by Math.PI / 180 before
    *  assigning `spill[i].rot`, which B05 passes to Skia `rotate` (radians). */
   export function spillSlotOffset(slot: number, count: number): { x: number; y: number; rot: number };
   ```
   - `resolveEasing`: `'linear'` → `Reanimated.Easing.linear`; `'out(cubic)'` → `Reanimated.Easing.out(Reanimated.Easing.cubic)`; `'out(quad)'` → `Reanimated.Easing.out(Reanimated.Easing.quad)`; `'bezier(a,b,c,d)'` → parse the four numbers and return `Reanimated.Easing.bezier(a, b, c, d)`. Unknown string → `Reanimated.Easing.linear` (never throw).
   - `tableSlotLayout(count)`: `width = count === 1 ? 132 : count <= 5 ? 80 : 72`; `height = count === 1 ? 184 : count <= 5 ? 116 : 100`; `rowLength = count <= 5 ? count : Math.ceil(count / 2)` (identical to B03's `centreSlot` rule — assert `centreSlot(count) === Math.floor((rowLength - 1) / 2)` in the test); `rows = count <= 5 ? 1 : 2`. `count <= 0` → `{ 132, 184, 0, 0 }`.
   - `spillSlotOffset(slot, count)`: `row = slot < rowLength ? 0 : 1`; `col = slot - row * rowLength`; `rowTotal = row === 0 ? rowLength : count - rowLength`; `centre = (rowTotal - 1) / 2`; `t = rowTotal > 1 ? (col - centre) / Math.max(centre, 1) : 0`; `x = (col - centre) * (width - 4)` (the `marginHorizontal: -2` overlap of `tapCardSlot`); `y = (row - (rows - 1) / 2) * (height + 18) + t * t * 28` (`rowGap: 18` of `tapTwoRows`, arc lift `t*t*28`); `rot = t * 14` (degrees). `spillSlotOffset(2, 5)` must be `{ x: 0, y: 0, rot: 0 }`; `spillSlotOffset(0, 5)` is `{ x: -152, y: 28, rot: -14 }`.

2. **`timelineTargets` — the phase → target table.** Return exactly these numbers (`m` = `isMulti`, `L` = `peakRarity === 'LEG'`, `C` = `peakRarity === 'COM'`, `rm` = `reduceMotion`):

   | phase | tell | dim | leak | flash | cameraScale | packScale | rays | halo | peel | cardOut | rim |
   |---|---|---|---|---|---|---|---|---|---|---|---|
   | `swipe` | 0 | 0 | 0 | 0 | 1 | 1 | 0.10 | 0.25 | 0 | 0 | 0 |
   | `approach` | 0 | 0 | 0 | 0 | 1 | rm ? 1 : (m ? 1.10 : 1.12) | m ? 0.26 : 0.22 | 0.45 | 0 | 0 | 0 |
   | `hold` | 1 | L ? 0.3 : 0 | 1 | 0 | 1 | rm ? 1 : (m ? 1.10 : 1.12) | m ? 0.26 : 0.22 | 0.60 | 0 | 0 | 0 |
   | `tear-flip` | 1 | L ? 0.3 : 0 | 1 | 0 | 1 | rm ? 1 : (m ? 1.10 : 1.12) | m ? 0.26 : 0.22 | 0.60 | 1 | 1 | 0 |
   | `flash-reveal` | 1 | L ? 0.3 : 0 | 0 | rm ? 0 : 0.85 | 1 | 1 | m ? 0.26 : 0.22 | 0.60 | 1 | 1 | rm ? (C ? 0 : 0.55) : 0 |
   | `settle` | 1 | 0 | 0 | 0 | 1 | 1 | 0.10 | 0.35 | 1 | 1 | C ? 0 : 0.55 |
   | `cards-on-table` | same row as `settle` | | | | | | | | | | |

   `dim` uses `LEG_DIM`. `cameraScale` is 1 in every row: the 1.04 punch is a `withSequence` that returns to rest, and the table records resting targets (the test asserts `flash` and `cameraScale` separately, change 4). Under `reduceMotion`, `packScale` is 1 everywhere and `flash` is 0 everywhere (§3.4: no scale, no flash); `rim` appears one phase earlier (at `flash-reveal`, which is the RM mount phase) so "the rim colour IS the tell" from t = 0.

3. **`haloColorForTell(tell, peakRarity)`** — pure, `'worklet'`, deterministic on `peakRarity` only (§2 "Honest tells only"). Clamp `tell` to 0..1. Returns an uppercase `#RRGGBB` string:
   - `COM`: `lerpHex(TELL_COLORS.NEUTRAL, TELL_COLORS.COM, tell)`.
   - `RAR`: `lerpHex(NEUTRAL, RAR, tell)`.
   - `LEG` (two-step "it went gold", §3.2): `tell <= 0.4` → `lerpHex(NEUTRAL, RAR, tell / 0.4)`; `0.4 < tell < 0.6` → `lerpHex(RAR, LEG, (tell - 0.4) / 0.2)`; `tell >= 0.6` → `TELL_COLORS.LEG`.
   - `lerpHex(a, b, t)` (module-private, `'worklet'`): per-channel linear interpolation of two `#RRGGBB` strings, `Math.round`, `toString(16).padStart(2, '0')`, uppercase. `haloColorForTell(0, any) === '#FFF7EC'`, `haloColorForTell(1, 'RAR') === '#A78BD8'`, `haloColorForTell(0.4, 'LEG') === '#A78BD8'`, `haloColorForTell(0.6, 'LEG') === '#F5C95E'`, `haloColorForTell(1, 'COM') === '#FFF3E0'`.

4. **`useCeremonyTimeline(input)` — the hook.**
   - Create every shared value with `Reanimated.useSharedValue` at its `swipe` rest value: `tell 0, dim 0, seam 0, leak 0, flash 0, cameraScale 1, cameraRot 0, shiver 0, packScale 1, packY 0, peel 0, cardOut 0, rays 0.10, raysAngle 0, halo 0.25`; then a `for (let i = 0; i < MAX_TIMELINE_CARDS; i++)` loop creating `spillAll[i] = { x, y, rot }` (all 0) and `rimAll[i]` (0). Return `useMemo(() => ({ ...singles, spill: spillAll.slice(0, n), rim: rimAll.slice(0, n) }), [n])` with `n = Math.max(0, Math.min(input.cardCount, MAX_TIMELINE_CARDS))` — the same object identity across renders for a given `n`.
   - **Rays loop** (`useEffect` on `[reduceMotion]`): when `!reduceMotion`, `raysAngle.value = withRepeat(withTiming(Math.PI * 2, { duration: RAYS_ANGLE_PERIOD_MS, easing: resolveEasing(EASING.LINEAR) }), -1, false)` (**radians** — B05 feeds this straight into Skia `rotate`; `360` here would spin the rays ~57 times per revolution); when `reduceMotion`, `cancelAnimation(raysAngle)` and `raysAngle.value = 0`. Cleanup cancels. (Fixes the easeInOut loop of `DrawCeremonyScreen.tsx:518-529`.) Under the guard fallback the shared value therefore reads `Math.PI * 2` after mount.
   - **Phase effect** (`useEffect` on `[phase, peakRarity, isMulti, reduceMotion, compressed, timings, spill, n]`): compute `T = timelineTargets(input)`, `E = (name) => resolveEasing(name)`, and apply:
     - **Reduce Motion (any phase):** every value in `T` is applied with `withTiming(target, { duration: RM_CROSSFADE_MS, easing: E(EASING.LINEAR) })` for `tell, dim, leak, rays, halo, peel, cardOut, rim[i]`; `packScale, cameraScale, cameraRot, shiver, flash, seam` are set to rest (`1, 1, 0, 0, 0, seam stays where it is`) with duration 0; `spill[i]` snaps to `spillSlotOffset(slot, n)` for every entry of `input.spill` (duration 0; `rot` converted to radians as in `tear-flip`) — RM lays cards out statically, no deal flight (§3.1 "FF / RM / fallback for multi"). Return early.
     - **`swipe`:** `tell, dim, leak, flash, peel, cardOut → T` over 200 ms `STANDARD`; `packScale → 1`, `halo → 0.25`, `rays → 0.10` over 200 ms `STANDARD`; `seam → 0` (the pack heals; the screen/PackTear drive `seam` during the gesture); `cameraScale → 1`, `cameraRot → 0`, `shiver → 0` (cancel first); every `spill[i]` → `{0,0,0}` and `rim[i] → 0` (duration 0).
     - **`approach`:** `packScale → T.packScale` over `timings.approach` ms `EMPHASIZED_OUT`; `packY → -24` over `timings.approach` `EMPHASIZED_OUT` (glide to stage centre); `rays → T.rays` and `halo → T.halo` over `timings.approach` `STANDARD`; `tell` stays 0 (the tell is withheld — §3.2); **`seam.value = withTiming(SEAM_PRECUT, { duration: SEAM_PRECUT_MS, easing: E(OUT_QUAD) })`** — the finger drove `seam` to 1 at the commit (B06 Pan / B09 responder); from here the hook owns the cut and relaxes it to a nick so S3 has a sweep left to make (B00 §9 #14).
     - **`hold`:** `tellMs = compressed ? 0 : Math.round(timings.hold * TELL_FRACTION_OF_HOLD)`; `tell → 1` over `tellMs` `STANDARD`; `dim → T.dim` over `tellMs` `STANDARD`; `leak → 1` over `tellMs` `STANDARD`; `halo → 0.60` over `tellMs`. Silence beat: `beatStart = Math.max(0, timings.hold - timings.beatMs)`; when `peakRarity === 'LEG' && timings.beatMs > 0`: `shiver.value = withDelay(beatStart, withRepeat(withSequence(withTiming(SHIVER_PX, { duration: half, easing: E(LINEAR) }), withTiming(-SHIVER_PX, { duration: half, easing: E(LINEAR) })), -1, false))` with `half = Math.round(1000 / SHIVER_HZ / 2)` (= 28 ms) — `shiver` is **px** (B06's `packTransform` uses it as `translateX`); under the fallback it collapses to `-SHIVER_PX`. `seam` is not touched (stays at `SEAM_PRECUT`). No other value moves during the beat (§2 "Silence before the hit": glow holds at peak).
     - **`tear-flip`:** `cancelAnimation(shiver); shiver → 0` over 40 ms; `pause = peakRarity === 'LEG' ? LEG_HIT_PAUSE_MS : 0`; `B = isMulti ? TEAR_BEATS.multi : TEAR_BEATS.single`; `tear = timings.tearFlip`;
       `seam.value = withDelay(pause, withTiming(1, { duration: Math.round(tear * B.seamEnd), easing: E(OUT_CUBIC) }))` (sweeps from `SEAM_PRECUT`, where approach left it — S3 "seam clip path sweeps left → right in 250 ms");
       `leak.value = withDelay(pause, withSequence(withTiming(0.6, { duration: 0 }), withTiming(1, { duration: 60, easing: E(LINEAR) })))` (the flare);
       `peel.value = withDelay(pause + Math.round(tear * B.peelStart), withTiming(1, { duration: Math.round(tear * (B.peelEnd - B.peelStart)), easing: E(EMPHASIZED_OUT) }))`;
       `cardOut.value = withDelay(pause + Math.round(tear * B.cardOutStart), withTiming(1, { duration: Math.round(tear * (B.cardOutEnd - B.cardOutStart)), easing: E(EMPHASIZED_OUT) }))`;
       LEG decaying rock (§2 "Screenshake/rock decays and is reserved"; replaces the six equal linear steps of `DrawCeremonyScreen.tsx:678-685`): `cameraRot.value = withDelay(pause, withSequence(withTiming(-0.5, { duration: 90, easing: E(OUT_QUAD) }), withTiming(0.4, { duration: 90, easing: E(OUT_QUAD) }), withTiming(-0.25, { duration: 90, easing: E(OUT_QUAD) }), withTiming(0, { duration: 90, easing: E(OUT_QUAD) })))` — LEG only; RAR and COM leave `cameraRot` at 0.
       Spill (multi only, `input.spill !== null`): for each `entry` of `spill.entries` with `entry.index < n`: `const o = spillSlotOffset(entry.slot, n)`; `spill[entry.index].x.value = withDelay(pause + entry.leaveAt, withTiming(o.x, { duration: spill.travelMs, easing: E(EMPHASIZED_OUT) }))`, same for `y` (target `o.y`) and `rot` (target **`o.rot * Math.PI / 180`** — radians for Skia; `x`/`y` are pt offsets from the stage centre, B05 draws them inside its centre-origin `Group`). Single (`spill === null`): `spill[0]` stays at 0 (the single card is `cardOut`, drawn by PackTear).
     - **`flash-reveal`:** `flash.value = withSequence(withTiming(0.85, { duration: 60, easing: E(LINEAR) }), withTiming(0, { duration: 260, easing: E(OUT_QUAD) }))` (a bloom, not a snap — §3.1 S4); `cameraScale.value = withSequence(withTiming(1.04, { duration: 60, easing: E(LINEAR) }), withTiming(1, { duration: 260, easing: E(OUT_QUAD) }))`; `leak → 0` over 200 ms `STANDARD`; `packScale → 1` over 200 ms; `rim[i]` stays 0 (non-RM).
     - **`settle`:** `halo → 0.35`, `dim → 0`, `rays → 0.10` over `timings.settleMs` `STANDARD`; `rim[i].value = withDelay(i * 40, withTiming(T.rim, { duration: 200, easing: E(STANDARD) }))` for `i < n` (multi tell #2, staggered rims); `cameraRot → 0`, `shiver → 0` (cancel first).
     - **`cards-on-table`:** nothing new starts (§2 "Settle is mandatory"); re-assert `T` targets with duration 0 so a late mount still reads the resting state.
   - The hook never reads `motionAvailable` itself: the guard's fallback makes every `with*` collapse to the target, which is exactly the test contract. Do not branch on it.

5. **`mobile/tests/unit/useCeremonyTimeline.test.ts` (new).** Declare `vi.mock('react-native', …)` at the top with the `View`/`Text`/`StyleSheet` shape of `tests/unit/libraryCardTile.test.tsx:5-17` (the guard imports `View`; the test file's own mock is what stops vitest loading the real `react-native`). Use `react-test-renderer` with `React.createElement` (this is a `.ts` file — no JSX) and a `Probe` component that calls `useCeremonyTimeline(props.input)` and hands the timeline to `props.onTimeline`. Cases (each its own `it`; titles are yours except where the verify greps a literal, marked ▸):
   1. ▸ `'timelineTargets encodes the storyboard rest values per phase'` — assert the full table of change 2 for `swipe`, `approach` (single 1.12/0.22, multi 1.10/0.26), `hold` (LEG dim 0.3, RAR dim 0), `tear-flip` (peel/cardOut 1), `flash-reveal` (flash 0.85, packScale 1), `settle` (rim 0.55 for RAR/LEG, 0 for COM, halo 0.35, rays 0.10), `cards-on-table` equals `settle`.
   2. ▸ `'reduce motion keeps packScale and flash at rest in every phase'` — for every phase × rarity with `reduceMotion: true`: `packScale === 1`, `flash === 0`, `cameraScale === 1`; and at `flash-reveal` `rim === 0.55` for RAR.
   3. ▸ `'haloColorForTell withholds rarity until the tell and goes violet then gold for LEG'` — the five equalities of change 3 plus `haloColorForTell(0.2, 'COM') !== TELL_COLORS.RAR`.
   4. `resolveEasing` returns a function for every `EASING` member and, under the test fallback, is identity at 0.25/0.5/0.75.
   5. `tableSlotLayout` (1 → 132×184 row 1; 5 → 80×116 row 5; 10 → 72×100 rowLength 5 rows 2; `centreSlot(count) === Math.floor((rowLength - 1) / 2)` for 1..10) and `spillSlotOffset` (`(2,5) → {0,0,0}`; `(0,5) → {-152, 28, -14}`; `(5,10)` → row 1, `x` of col 0 of a 5-row with width 72 → `-136`; slots of a 10-card table are 10 distinct points).
   6. ▸ `'drives every shared value to the phase target under the guard fallback'` — render `Probe` with `{ phase: 'swipe', peakRarity: 'LEG', isMulti: true, cardCount: 2, timings: resolveCeremonyTimings({ isMulti: true, peakRarity: 'LEG', motionAvailable: false }), spill: buildSpillSchedule(cards, 940), reduceMotion: false, compressed: false }`; then `update` through `approach → hold → tear-flip → flash-reveal → settle → cards-on-table` (inside `act`) and after each assert `tl.tell.value, dim, leak, packScale, rays, halo, peel, cardOut` equal `timelineTargets(...)`; after mount (non-RM): `raysAngle.value === Math.PI * 2` (radians, the fallback collapses the loop to its target); at `approach`: `seam.value === SEAM_PRECUT` (0.15 — the hook took the cut over from the finger); at `hold` (LEG): `shiver.value === -SHIVER_PX` (the beat's sequence collapses to its last member) and `seam.value === SEAM_PRECUT`; at `tear-flip`: `seam.value === 1`, `shiver.value === 0`, `spill[0].x.value === spillSlotOffset(schedule.entries.find(e => e.index === 0)!.slot, 2).x` (and `y`), `spill[0].rot.value === spillSlotOffset(slot0, 2).rot * Math.PI / 180` (radians), same for index 1; `cameraRot.value === 0` after the sequence collapses; at `flash-reveal`: `flash.value === 0` and `cameraScale.value === 1` (the sequences collapse to their last member — the peak is pinned by case 1); at `settle`: `rim[0].value === 0.55 && rim[1].value === 0.55`; `spill.length === 2 && rim.length === 2`.
   7. `reduce motion path`: same probe with `reduceMotion: true` at `flash-reveal` → `flash.value === 0`, `packScale.value === 1`, `rim[i].value === 0.55`, and `spill[i]` already at its slot (static layout).
   8. `stability`: the timeline object returned on two renders with the same `cardCount` is the same reference (`toBe`); `cardCount: 12` yields arrays of length 10; `cardCount: 0` yields empty arrays without throwing.
   9. `compressed hold`: with `compressed: true` at `hold` the targets are unchanged (`tell === 1`) — the compression shortens durations, never targets.

   Import `resolveCeremonyTimings` from `../../src/features/gacha/draw/ceremonyTimings` and `buildSpillSchedule`/`centreSlot` from `../../src/features/gacha/draw/spillSchedule` (real modules, not mocks).

Estimated size: ~330 LOC module, ~260 LOC test.

## Acceptance

Run from `mobile/`. `docs/delivery/r16-issues/B07.verify.sh` runs exactly these from the worktree root.

1. Files exist: `src/components/ceremony/useCeremonyTimeline.ts`, `tests/unit/useCeremonyTimeline.test.ts` (≥ 9 `it(` blocks).
2. `npx vitest run tests/unit/useCeremonyTimeline.test.ts tests/unit/ceremonyTimings.test.ts tests/unit/spillSchedule.test.ts --reporter=dot` exits 0.
3. `npm run test:typecheck` exits 0.
4. Literal guards on `src/components/ceremony/useCeremonyTimeline.ts` (all must hold, fixed-string grep): `export function useCeremonyTimeline(` · `export function timelineTargets(` · `export function haloColorForTell(` · `export type CeremonyTimeline =` · `export type TimelineInput =` · `export type TimelineTargets =` · `EMPHASIZED_OUT: 'bezier(0.05,0.7,0.1,1)'` · `STANDARD: 'bezier(0.2,0,0,1)'` · `LINEAR: 'linear'` · `OUT_CUBIC: 'out(cubic)'` · `OUT_QUAD: 'out(quad)'` · `NEUTRAL: '#FFF7EC'` · `COM: '#FFF3E0'` · `RAR: '#A78BD8'` · `LEG: '#F5C95E'` · `export const LEG_HIT_PAUSE_MS = 32` · `export const LEG_DIM = 0.3` · `export const MAX_TIMELINE_CARDS = 10` · `export const RAYS_ANGLE_PERIOD_MS = 14000` · `export const RM_CROSSFADE_MS = 180` · `export const SHIVER_HZ = 18` · `export const SHIVER_PX = 3` · `export const SEAM_PRECUT = 0.15` · `export const SEAM_PRECUT_MS = 120` · `Math.PI * 2` · `Math.PI / 180` · `withTiming(SEAM_PRECUT` · `withTiming(SHIVER_PX` · `export const TEAR_BEATS` · `export function spillSlotOffset(` · `export function tableSlotLayout(` · `export function resolveEasing(` · `TELL_FRACTION_OF_HOLD` · `'worklet'` (≥ 2 occurrences) · `from './reanimatedGuard'` · `from '../../features/gacha/draw/ceremonyTimings'` · `from '../../features/gacha/draw/spillSchedule'` · `withRepeat(` · `withSequence(` · `withDelay(` · `cancelAnimation(` · `withTiming(`. On the test file: the three ▸ titles of change 5 (cases 1–3) plus case 6's title `drives every shared value to the phase target under the guard fallback`, and the identifiers `resolveCeremonyTimings`, `buildSpillSchedule`, `vi.mock('react-native'`, `SEAM_PRECUT`, `SHIVER_PX`, `Math.PI` (the radian/px pins of case 6).
5. Negative guards on the same file (extended regex, none may match): `from 'react-native'` · `react-native-reanimated` · `@shopify/react-native-skia` · `react-native-worklets` · `react-native-gesture-handler` · `setTimeout(` · `setInterval(` · `Date.now(` · `requestAnimationFrame` · `useClock` · `useDerivedValue` · `\bAnimated.` (RN Animated) · `motionAvailable` · `Math.random` · `useState(` · `withTiming(360` (rays in degrees) · `withTiming(1, { duration: half` / `withTiming(-1, { duration: half` (a normalised shiver) · `[Dd]etector` (driver-banned substring, see Banned literals).
6. Test-gutting/suppression grep over both scope files is empty: `\.skip\(|\.only\(|@ts-ignore|@ts-expect-error|eslint-disable`; `"vite": "7.2.4"` present in `package.json`; no `@sentry` anywhere in `mobile/package.json`.
7. Scope guard: `git diff --name-only $(git merge-base $BASE_REF HEAD) HEAD` ∪ the pathspec-scoped untracked scan lists only the two scope files (plus `docs/delivery/r16-issues/*`); frozen files have zero diff.

## Do NOT

- Do not add phases: the `CeremonyPhase` union is B02's and is closed (`'swipe' | 'approach' | 'hold' | 'tear-flip' | 'flash-reveal' | 'settle' | 'cards-on-table'`); the beat, the hit-pause and the spill are `withDelay`/`withSequence` sub-beats inside a phase (B00 §3.1).
- Do not import `react-native`, `react-native-reanimated`, `react-native-worklets`, `react-native-gesture-handler` or `@shopify/react-native-skia` here; do not re-declare `SharedValue` with a different shape; do not read `motionAvailable`.
- Do not schedule timers or read the clock; do not `setState`; do not export a component or a testID.
- Do not randomise anything (no `Math.random`, no seed-driven variation): every target is a function of `(phase, peakRarity, isMulti, reduceMotion, compressed, timings, spill)` only (§2 "Honest tells only").
- Do not touch `reanimatedGuard.ts`, `ceremonyTimings.ts`, `spillSchedule.ts`, `DrawCeremonyScreen.tsx`, `CeremonyLottie.tsx`, `vitest.config.ts`, `tests/setup/*`, or any existing test.
- Do not rename the B00 exports or change their signatures; the helpers this brief adds (`resolveEasing`, `MAX_TIMELINE_CARDS`, `RAYS_ANGLE_PERIOD_MS`, `RM_CROSSFADE_MS`, `SHIVER_HZ`, `SHIVER_PX`, `SEAM_PRECUT`, `SEAM_PRECUT_MS`, `TEAR_BEATS`, `tableSlotLayout`, `spillSlotOffset`, `EasingName`) are the only additions — B09 imports `tableSlotLayout`/`spillSlotOffset` by these exact names.
- Do not drive `raysAngle` or `spill[i].rot` in degrees, or `spill[i].x/.y` as absolute stage coordinates — B05 consumes radians and centre offsets (B00 §2.10 "Units"); do not make `spillSlotOffset` return radians (the RN fallback in B09 renders its `rot` as `${rot}deg`).
- Do not leave `seam` at the finger's value through approach/hold, and do not touch `seam` in `hold`/`flash-reveal`/`settle`: `swipe` → 0, `approach` → `SEAM_PRECUT`, `tear-flip` → 1 are the only three assignments (B00 §9 #14).
- Standing rules: no `git push`, no PR, never target or touch `main`, no `npm install`/`npm ci`/`eas`/`expo` commands, no disabling/skipping/gutting tests, no `@ts-ignore`/`@ts-expect-error`/`eslint-disable`, no loosening of `tsconfig`.
