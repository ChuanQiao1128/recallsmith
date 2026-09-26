// useCeremonyTimeline — the single owner of every Reanimated shared value the
// Seam of Light draw ceremony animates, plus one pure phase -> target table.
//
// The stage (B05), the pack (B06) and the screen (B09) read these shared values;
// none of them own motion state. Every transition is a Reanimated animation
// assigned to `.value` and routed through the B02 guard (`./reanimatedGuard`),
// which is the only door to Reanimated. Under vitest the guard's fallback makes
// every `with*` collapse to its final target, so the whole choreography can be
// pinned as a phase -> target-value table without a device.
//
// Units are contractual (B00 §2.10 "Units", §9 #16): `raysAngle` and
// `spill[i].rot` are radians (Skia `rotate`), `spill[i].x/.y` are pt offsets from
// the stage centre, `shiver`/`packY` are px, and `cameraRot` is degrees (the
// screen renders it as a `${deg}deg` string). `spillSlotOffset(...).rot` stays in
// degrees for the screen's fallback view; the hook converts to radians with
// `* Math.PI / 180` before assigning `spill[i].rot`.

import { useEffect, useMemo } from 'react';

import { Reanimated } from './reanimatedGuard';
import type { SharedValue } from './reanimatedGuard';
import type { CeremonyPhase, PeakRarity, ResolvedCeremonyTimings } from '../../features/gacha/draw/ceremonyTimings';
import { TELL_FRACTION_OF_HOLD } from '../../features/gacha/draw/ceremonyTimings';
import type { SpillSchedule } from '../../features/gacha/draw/spillSchedule';

const { withTiming, withDelay, withSequence, withRepeat, cancelAnimation } = Reanimated;

// ── Public types ───────────────────────────────────────────────────────────

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
  /** true when the RN tap table owns the face-down cards (B09 `enableTapFlow`). The Skia
   *  StageRims are drawn at the spill slots, which only coincide with the table's cards for a
   *  one-row hand; from 6 cards the table fans two rows on its own geometry and the rims showed
   *  as ghost outlines beside the cards. With the table in charge, `rim` stays 0 in every
   *  phase — driven through the shared values, never by re-rendering the canvas. */
  tapFlow?: boolean;
  /** true while `playCeremonyTimeline` owns the approach→settle choreography on the UI
   *  thread (G43). When set, the per-phase effect skips every phase except
   *  'cards-on-table' — running the per-phase reset would clobber the assigned plan. It
   *  flips true while the phase is still 'swipe', so the 'swipe' reset is skipped too. */
  planned?: boolean;
};

// ── Constants (B00 §2.10 verbatim) ───────────────────────────────────────────

export const EASING = {
  EMPHASIZED_OUT: 'bezier(0.05,0.7,0.1,1)', STANDARD: 'bezier(0.2,0,0,1)', LINEAR: 'linear', OUT_CUBIC: 'out(cubic)', OUT_QUAD: 'out(quad)',
} as const;
export const TELL_COLORS = { NEUTRAL: '#FFF7EC', COM: '#FFF3E0', RAR: '#A78BD8', LEG: '#F5C95E' } as const;
export const LEG_HIT_PAUSE_MS = 32;            // §3.1 S3
export const LEG_DIM = 0.3;                    // backdrop dims 30 % (§3.2)

export type TimelineTargets = { tell: number; dim: number; leak: number; flash: number; cameraScale: number; packScale: number; rays: number; halo: number; peel: number; cardOut: number; rim: number };

// ── Additional exports (pure helpers the hook needs and that B09 reuses) ──────

export type EasingName = (typeof EASING)[keyof typeof EASING];
export const MAX_TIMELINE_CARDS = 10;
export const RAYS_ANGLE_PERIOD_MS = 14000;      // equals StageCanvas.RAY_REVOLUTION_MS (B05); one linear revolution = Math.PI * 2 radians
export const RM_CROSSFADE_MS = 180;             // §3.4: every RM transition is an opacity-only 180 ms crossfade
export const SHIVER_HZ = 18;                    // §3.1 S2: LEG pack shivers at 18 Hz during the beat
export const SHIVER_PX = 3;                     // amplitude of that shiver in px (PackTear reads `shiver` as translateX px)
export const SEAM_PRECUT = 0.15;                // the finger's nick: `seam` rests here from approach until the S3 sweep (B00 §9 #14)
export const SEAM_PRECUT_MS = 120;              // approach: seam relaxes from the finger's value to SEAM_PRECUT over this (OUT_QUAD)

/** Sub-beats of 'tear-flip' as fractions of timings.tearFlip (§3.1 S3 single 600: rip 0-250, peel 250-450, card out 350-600;
 *  M3 multi 1800: rip 0-300, peel 300-550, stack slide 550-900, fan 900-1800 via SpillSchedule). */
export const TEAR_BEATS = Object.freeze({
  single: { seamEnd: 250 / 600, peelStart: 250 / 600, peelEnd: 450 / 600, cardOutStart: 350 / 600, cardOutEnd: 1 },
  multi:  { seamEnd: 300 / 1800, peelStart: 300 / 1800, peelEnd: 550 / 1800, cardOutStart: 550 / 1800, cardOutEnd: 900 / 1800 },
});

// ── Easing resolution ────────────────────────────────────────────────────────

/** Maps an EASING string to the guard's Reanimated.Easing curve (identity under fallback). */
export function resolveEasing(name: EasingName): (t: number) => number {
  const E = Reanimated.Easing;
  if (name === 'linear') return E.linear;
  if (name === 'out(cubic)') return E.out(E.cubic);
  if (name === 'out(quad)') return E.out(E.quad);
  const bezier = /^bezier\(([^)]+)\)$/.exec(name);
  if (bezier) {
    const parts = bezier[1].split(',').map((p) => Number(p.trim()));
    if (parts.length === 4 && parts.every((v) => Number.isFinite(v))) {
      return E.bezier(parts[0], parts[1], parts[2], parts[3]);
    }
  }
  return E.linear; // unknown string -> linear (never throw)
}

// ── Table geometry (shared with the tap table, DrawCeremonyScreen.tsx:1199-1256) ──

/** Table geometry shared with the tap table: card size by count and the row split. */
export function tableSlotLayout(count: number): { width: number; height: number; rowLength: number; rows: number } {
  if (count <= 0) return { width: 132, height: 184, rowLength: 0, rows: 0 };
  const width = count === 1 ? 132 : count <= 5 ? 80 : 72;
  const height = count === 1 ? 184 : count <= 5 ? 116 : 100;
  const rowLength = count <= 5 ? count : Math.ceil(count / 2);
  const rows = count <= 5 ? 1 : 2;
  return { width, height, rowLength, rows };
}

/** Offset of slot `slot` from the stage centre, in pt, including the fanned-hand arc.
 *  `rot` is in DEGREES (the RN fallback renders it as `${rot}deg`); the hook multiplies
 *  by Math.PI / 180 before assigning `spill[i].rot`, which B05 passes to Skia `rotate`. */
export function spillSlotOffset(slot: number, count: number): { x: number; y: number; rot: number } {
  const { width, height, rowLength, rows } = tableSlotLayout(count);
  const row = slot < rowLength ? 0 : 1;
  const col = slot - row * rowLength;
  const rowTotal = row === 0 ? rowLength : count - rowLength;
  const centre = (rowTotal - 1) / 2;
  const t = rowTotal > 1 ? (col - centre) / Math.max(centre, 1) : 0;
  const x = (col - centre) * (width - 4);          // marginHorizontal: -2 overlap of tapCardSlot
  const y = (row - (rows - 1) / 2) * (height + 18) + t * t * 28; // rowGap: 18, arc lift t*t*28
  const rot = t * 14;                               // degrees
  return { x, y, rot };
}

// ── Colour tell ──────────────────────────────────────────────────────────────

function lerpHex(a: string, b: string, t: number): string {
  'worklet';
  const ar = parseInt(a.slice(1, 3), 16);
  const ag = parseInt(a.slice(3, 5), 16);
  const ab = parseInt(a.slice(5, 7), 16);
  const br = parseInt(b.slice(1, 3), 16);
  const bg = parseInt(b.slice(3, 5), 16);
  const bb = parseInt(b.slice(5, 7), 16);
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  const hex = (n: number): string => n.toString(16).padStart(2, '0');
  return ('#' + hex(r) + hex(g) + hex(bl)).toUpperCase();
}

/** Pure, deterministic on `peakRarity` only (§2 "Honest tells only"). Uppercase #RRGGBB. */
export function haloColorForTell(tell: number, peakRarity: PeakRarity): string {
  'worklet';
  const t = tell < 0 ? 0 : tell > 1 ? 1 : tell;
  if (peakRarity === 'COM') return lerpHex(TELL_COLORS.NEUTRAL, TELL_COLORS.COM, t);
  if (peakRarity === 'RAR') return lerpHex(TELL_COLORS.NEUTRAL, TELL_COLORS.RAR, t);
  // LEG two-step "it went gold" (§3.2): white -> violet -> gold.
  if (t <= 0.4) return lerpHex(TELL_COLORS.NEUTRAL, TELL_COLORS.RAR, t / 0.4);
  if (t < 0.6) return lerpHex(TELL_COLORS.RAR, TELL_COLORS.LEG, (t - 0.4) / 0.2);
  return TELL_COLORS.LEG;
}

// ── Phase -> target table ────────────────────────────────────────────────────

/** The phase -> resting-target table (B00 §2.10, change 2). Records resting targets:
 *  the flash bloom and the camera punch are withSequence moves that return to rest. */
export function timelineTargets(
  input: Pick<TimelineInput, 'phase' | 'peakRarity' | 'isMulti' | 'reduceMotion' | 'tapFlow'>,
): TimelineTargets {
  const { phase, peakRarity, isMulti: m, reduceMotion: rm, tapFlow = false } = input;
  const L = peakRarity === 'LEG';
  const C = peakRarity === 'COM';
  const packAnticipate = rm ? 1 : m ? 1.1 : 1.12;
  const raysAnticipate = m ? 0.26 : 0.22;
  const dimHold = L ? LEG_DIM : 0;
  // The settle rim is the face-down rarity tell (0.55, COM none). It belongs to the Skia
  // stage's own table; when the RN tap table owns the cards the rim has nothing to sit
  // behind, so it is withheld in every phase.
  const rimSettle = C || tapFlow ? 0 : 0.55;
  switch (phase) {
    case 'swipe':
      return { tell: 0, dim: 0, leak: 0, flash: 0, cameraScale: 1, packScale: 1, rays: 0.1, halo: 0.25, peel: 0, cardOut: 0, rim: 0 };
    case 'approach':
      return { tell: 0, dim: 0, leak: 0, flash: 0, cameraScale: 1, packScale: packAnticipate, rays: raysAnticipate, halo: 0.45, peel: 0, cardOut: 0, rim: 0 };
    case 'hold':
      return { tell: 1, dim: dimHold, leak: 1, flash: 0, cameraScale: 1, packScale: packAnticipate, rays: raysAnticipate, halo: 0.6, peel: 0, cardOut: 0, rim: 0 };
    case 'tear-flip':
      return { tell: 1, dim: dimHold, leak: 1, flash: 0, cameraScale: 1, packScale: packAnticipate, rays: raysAnticipate, halo: 0.6, peel: 1, cardOut: 1, rim: 0 };
    case 'flash-reveal':
      return { tell: 1, dim: dimHold, leak: 0, flash: rm ? 0 : 0.85, cameraScale: 1, packScale: 1, rays: raysAnticipate, halo: 0.6, peel: 1, cardOut: 1, rim: rm ? rimSettle : 0 };
    case 'settle':
    case 'cards-on-table':
    default:
      return { tell: 1, dim: 0, leak: 0, flash: 0, cameraScale: 1, packScale: 1, rays: 0.1, halo: 0.35, peel: 1, cardOut: 1, rim: rimSettle };
  }
}

// ── The hook ─────────────────────────────────────────────────────────────────

type SpillValue = { x: SharedValue<number>; y: SharedValue<number>; rot: SharedValue<number> };

export function useCeremonyTimeline(input: TimelineInput): CeremonyTimeline {
  const { phase, peakRarity, isMulti, cardCount, timings, spill, reduceMotion, compressed, tapFlow = false, planned = false } = input;
  const n = Math.max(0, Math.min(cardCount, MAX_TIMELINE_CARDS));

  // Every shared value at its `swipe` rest value.
  const tell = Reanimated.useSharedValue(0);
  const dim = Reanimated.useSharedValue(0);
  const seam = Reanimated.useSharedValue(0);
  const leak = Reanimated.useSharedValue(0);
  const flash = Reanimated.useSharedValue(0);
  const cameraScale = Reanimated.useSharedValue(1);
  const cameraRot = Reanimated.useSharedValue(0);
  const shiver = Reanimated.useSharedValue(0);
  const packScale = Reanimated.useSharedValue(1);
  const packY = Reanimated.useSharedValue(0);
  const peel = Reanimated.useSharedValue(0);
  const cardOut = Reanimated.useSharedValue(0);
  const rays = Reanimated.useSharedValue(0.1);
  const raysAngle = Reanimated.useSharedValue(0);
  const halo = Reanimated.useSharedValue(0.25);

  // Per-card arrays created with the constant bound so the hook count never changes.
  const spillAll: SpillValue[] = [];
  const rimAll: SharedValue<number>[] = [];
  for (let i = 0; i < MAX_TIMELINE_CARDS; i++) {
    const x = Reanimated.useSharedValue(0);
    const y = Reanimated.useSharedValue(0);
    const rot = Reanimated.useSharedValue(0);
    spillAll.push({ x, y, rot });
    rimAll.push(Reanimated.useSharedValue(0));
  }

  const timeline = useMemo<CeremonyTimeline>(
    () => ({
      tell, dim, seam, leak, flash, cameraScale, cameraRot, shiver,
      packScale, packY, peel, cardOut, rays, raysAngle, halo,
      spill: spillAll.slice(0, n),
      rim: rimAll.slice(0, n),
    }),
    // Same object identity across renders for a given `n`; the shared value refs are stable.
    [n],
  );

  // Rays revolution loop (radians). B05 feeds `raysAngle` straight into Skia `rotate`.
  useEffect(() => {
    if (!reduceMotion) {
      raysAngle.value = withRepeat(
        withTiming(Math.PI * 2, { duration: RAYS_ANGLE_PERIOD_MS, easing: resolveEasing(EASING.LINEAR) }),
        -1,
        false,
      );
    } else {
      cancelAnimation(raysAngle);
      raysAngle.value = 0;
    }
    return () => {
      cancelAnimation(raysAngle);
    };
  }, [reduceMotion]);

  // Phase effect: apply the phase's animations to every shared value.
  useEffect(() => {
    // While a UI-thread plan owns the approach→settle choreography (G43), the per-phase
    // path must not re-assign anything — that would clobber the withDelay/withSequence
    // offsets `playCeremonyTimeline` set at the tear. Reduce Motion and fast-forward
    // (compressed) keep the per-phase path; 'cards-on-table' always runs (it lands after
    // the plan, cancels the ray loop and re-asserts the resting targets). 'swipe' is
    // skipped too: `planned` flips true while the phase is still 'swipe'.
    if (planned && !reduceMotion && !compressed && phase !== 'cards-on-table') return;
    const T = timelineTargets({ phase, peakRarity, isMulti, reduceMotion, tapFlow });
    const E = resolveEasing;

    // Reduce Motion is a parallel ceremony (§3.4): opacity-only crossfades, no
    // scale/rotate/flash, cards laid out statically with no deal flight.
    if (reduceMotion) {
      const cross = { duration: RM_CROSSFADE_MS, easing: E(EASING.LINEAR) };
      const rest = { duration: 0 };
      tell.value = withTiming(T.tell, cross);
      dim.value = withTiming(T.dim, cross);
      leak.value = withTiming(T.leak, cross);
      rays.value = withTiming(T.rays, cross);
      halo.value = withTiming(T.halo, cross);
      peel.value = withTiming(T.peel, cross);
      cardOut.value = withTiming(T.cardOut, cross);
      for (let i = 0; i < n; i++) rimAll[i].value = withTiming(T.rim, cross);
      packScale.value = withTiming(1, rest);
      cameraScale.value = withTiming(1, rest);
      cameraRot.value = withTiming(0, rest);
      shiver.value = withTiming(0, rest);
      flash.value = withTiming(0, rest);
      // `seam` stays where it is (the finger / earlier phase own it).
      if (spill) {
        for (const entry of spill.entries) {
          if (entry.index < n) {
            const o = spillSlotOffset(entry.slot, n);
            spillAll[entry.index].x.value = withTiming(o.x, rest);
            spillAll[entry.index].y.value = withTiming(o.y, rest);
            spillAll[entry.index].rot.value = withTiming((o.rot * Math.PI) / 180, rest);
          }
        }
      }
      return;
    }

    switch (phase) {
      case 'swipe': {
        const std = { duration: 200, easing: E(EASING.STANDARD) };
        const now = { duration: 0 };
        tell.value = withTiming(T.tell, std);
        dim.value = withTiming(T.dim, std);
        leak.value = withTiming(T.leak, std);
        flash.value = withTiming(T.flash, std);
        peel.value = withTiming(T.peel, std);
        cardOut.value = withTiming(T.cardOut, std);
        packScale.value = withTiming(1, std);
        halo.value = withTiming(0.25, std);
        rays.value = withTiming(0.1, std);
        seam.value = withTiming(0, std); // the pack heals; the gesture drives seam during swipe
        cancelAnimation(shiver);
        cameraScale.value = withTiming(1, std);
        cameraRot.value = withTiming(0, std);
        shiver.value = withTiming(0, std);
        for (let i = 0; i < n; i++) {
          spillAll[i].x.value = withTiming(0, now);
          spillAll[i].y.value = withTiming(0, now);
          spillAll[i].rot.value = withTiming(0, now);
          rimAll[i].value = withTiming(0, now);
        }
        break;
      }
      case 'approach': {
        const emph = { duration: timings.approach, easing: E(EASING.EMPHASIZED_OUT) };
        const std = { duration: timings.approach, easing: E(EASING.STANDARD) };
        packScale.value = withTiming(T.packScale, emph);
        packY.value = withTiming(-24, emph); // glide to stage centre (px)
        rays.value = withTiming(T.rays, std);
        halo.value = withTiming(T.halo, std);
        // The tell is withheld here (§3.2): `tell` stays 0.
        // The finger drove `seam` to 1 at commit; from here the hook owns the cut
        // and relaxes it to the pre-cut nick so S3 has a sweep left to make (B00 §9 #14).
        seam.value = withTiming(SEAM_PRECUT, { duration: SEAM_PRECUT_MS, easing: E(EASING.OUT_QUAD) });
        break;
      }
      case 'hold': {
        const tellMs = compressed ? 0 : Math.round(timings.hold * TELL_FRACTION_OF_HOLD);
        const tc = { duration: tellMs, easing: E(EASING.STANDARD) };
        tell.value = withTiming(1, tc);
        dim.value = withTiming(T.dim, tc);
        leak.value = withTiming(1, tc);
        halo.value = withTiming(0.6, tc);
        // Silence beat (§2 "Silence before the hit"): the LEG pack shivers at the
        // peak of the glow; nothing else moves and `seam` stays at SEAM_PRECUT.
        if (peakRarity === 'LEG') {
          const beatStart = Math.max(0, timings.hold - timings.beatMs);
          const half = Math.round(1000 / SHIVER_HZ / 2);
          shiver.value = withDelay(
            beatStart,
            withRepeat(
              withSequence(
                withTiming(SHIVER_PX, { duration: half, easing: E(EASING.LINEAR) }),
                withTiming(-SHIVER_PX, { duration: half, easing: E(EASING.LINEAR) }),
              ),
              -1,
              false,
            ),
          );
        }
        break;
      }
      case 'tear-flip': {
        cancelAnimation(shiver);
        shiver.value = withTiming(0, { duration: 40, easing: E(EASING.LINEAR) });
        const pause = peakRarity === 'LEG' ? LEG_HIT_PAUSE_MS : 0;
        const B = isMulti ? TEAR_BEATS.multi : TEAR_BEATS.single;
        const tear = timings.tearFlip;
        // Seam sweeps from SEAM_PRECUT left -> right (S3).
        seam.value = withDelay(pause, withTiming(1, { duration: Math.round(tear * B.seamEnd), easing: E(EASING.OUT_CUBIC) }));
        // The leak flare: snap to 0.6, bloom to 1.0 in 60 ms.
        leak.value = withDelay(pause, withSequence(withTiming(0.6, { duration: 0 }), withTiming(1, { duration: 60, easing: E(EASING.LINEAR) })));
        peel.value = withDelay(
          pause + Math.round(tear * B.peelStart),
          withTiming(1, { duration: Math.round(tear * (B.peelEnd - B.peelStart)), easing: E(EASING.EMPHASIZED_OUT) }),
        );
        cardOut.value = withDelay(
          pause + Math.round(tear * B.cardOutStart),
          withTiming(1, { duration: Math.round(tear * (B.cardOutEnd - B.cardOutStart)), easing: E(EASING.EMPHASIZED_OUT) }),
        );
        // LEG decaying rock (§2 "Screenshake/rock decays and is reserved") — LEG only.
        if (peakRarity === 'LEG') {
          cameraRot.value = withDelay(
            pause,
            withSequence(
              withTiming(-0.5, { duration: 90, easing: E(EASING.OUT_QUAD) }),
              withTiming(0.4, { duration: 90, easing: E(EASING.OUT_QUAD) }),
              withTiming(-0.25, { duration: 90, easing: E(EASING.OUT_QUAD) }),
              withTiming(0, { duration: 90, easing: E(EASING.OUT_QUAD) }),
            ),
          );
        }
        // Spill (multi only): each card flies from the centre to its table slot.
        if (spill) {
          for (const entry of spill.entries) {
            if (entry.index < n) {
              const o = spillSlotOffset(entry.slot, n);
              const cfg = { duration: spill.travelMs, easing: E(EASING.EMPHASIZED_OUT) };
              spillAll[entry.index].x.value = withDelay(pause + entry.leaveAt, withTiming(o.x, cfg));
              spillAll[entry.index].y.value = withDelay(pause + entry.leaveAt, withTiming(o.y, cfg));
              spillAll[entry.index].rot.value = withDelay(pause + entry.leaveAt, withTiming((o.rot * Math.PI) / 180, cfg));
            }
          }
        }
        break;
      }
      case 'flash-reveal': {
        // A bloom, not a snap (§3.1 S4).
        flash.value = withSequence(
          withTiming(0.85, { duration: 60, easing: E(EASING.LINEAR) }),
          withTiming(0, { duration: 260, easing: E(EASING.OUT_QUAD) }),
        );
        cameraScale.value = withSequence(
          withTiming(1.04, { duration: 60, easing: E(EASING.LINEAR) }),
          withTiming(1, { duration: 260, easing: E(EASING.OUT_QUAD) }),
        );
        leak.value = withTiming(0, { duration: 200, easing: E(EASING.STANDARD) });
        packScale.value = withTiming(1, { duration: 200, easing: E(EASING.STANDARD) });
        break;
      }
      case 'settle': {
        const std = { duration: timings.settleMs, easing: E(EASING.STANDARD) };
        halo.value = withTiming(0.35, std);
        dim.value = withTiming(0, std);
        rays.value = withTiming(0.1, std);
        for (let i = 0; i < n; i++) {
          rimAll[i].value = withDelay(i * 40, withTiming(T.rim, { duration: 200, easing: E(EASING.STANDARD) }));
        }
        cancelAnimation(shiver);
        cameraRot.value = withTiming(0, std);
        shiver.value = withTiming(0, std);
        break;
      }
      case 'cards-on-table':
      default: {
        // Nothing new starts (§2 "Settle is mandatory"); re-assert resting targets
        // with duration 0 so a late mount still reads the resting state.
        // MGACHA-11: stop the ray revolution so the Skia stage stops redrawing every
        // frame once the cards are on the table — the rays freeze at their current angle
        // and rest at their 0.1 resting opacity. The mount-time loop, the reduce-motion
        // branch and the cleanup stay as they are.
        cancelAnimation(raysAngle);
        const z = { duration: 0 };
        tell.value = withTiming(T.tell, z);
        dim.value = withTiming(T.dim, z);
        leak.value = withTiming(T.leak, z);
        flash.value = withTiming(T.flash, z);
        cameraScale.value = withTiming(T.cameraScale, z);
        packScale.value = withTiming(T.packScale, z);
        rays.value = withTiming(T.rays, z);
        halo.value = withTiming(T.halo, z);
        peel.value = withTiming(T.peel, z);
        cardOut.value = withTiming(T.cardOut, z);
        for (let i = 0; i < n; i++) rimAll[i].value = withTiming(T.rim, z);
        break;
      }
    }
  }, [phase, peakRarity, isMulti, reduceMotion, compressed, timings, spill, n, tapFlow, planned]);

  return timeline;
}

// ── UI-thread plan (G43) ──────────────────────────────────────────────────────
//
// The per-phase switch above assigns each shared value when React commits a phase, so a
// busy JS thread stretches the phases and drifts sound from picture. `playCeremonyTimeline`
// assigns the WHOLE approach→settle choreography once, at the tear, with `withDelay` /
// `withSequence` offsets so it runs on the UI thread regardless of JS load. React `phase`
// state is then only for copy, a11y, skip gating and the table mount, and the per-phase
// effect skips itself via `planned`. Reduce Motion and fast-forward keep the per-phase path.

type SequenceStep = { at: number; durationMs: number; animation: unknown };

/**
 * Lay `steps` end-to-end on one shared value as a single `withSequence`. Steps are sorted by
 * their absolute `at`; a cursor tracks where the previous step finished, and each step becomes
 * `withDelay(gap, animation)` (or the bare animation when the gap is 0) with
 * `gap = max(0, round(at - cursor))` — never negative — then `cursor += gap + durationMs`.
 * Returns the single part when there is one, else `withSequence(...parts)`.
 */
export function sequenceAt(steps: ReadonlyArray<SequenceStep>): unknown {
  const sorted = steps
    .map((step, i) => ({ step, i }))
    .sort((a, b) => a.step.at - b.step.at || a.i - b.i)
    .map(({ step }) => step);
  let cursor = 0;
  const parts: unknown[] = [];
  for (const step of sorted) {
    const gap = Math.max(0, Math.round(step.at - cursor));
    parts.push(gap === 0 ? step.animation : withDelay(gap, step.animation));
    cursor += gap + step.durationMs;
  }
  if (parts.length === 1) return parts[0];
  return withSequence(...parts);
}

/**
 * Assign every shared value ONE `sequenceAt([...])` covering approach→settle, reproducing the
 * per-phase switch exactly (same targets, durations and easings). Called once at the tear by
 * DrawCeremonyScreen when motion is on; the per-phase effect then skips itself via `planned`.
 */
export function playCeremonyTimeline(
  timeline: CeremonyTimeline,
  input: {
    peakRarity: PeakRarity;
    isMulti: boolean;
    timings: ResolvedCeremonyTimings;
    spill: SpillSchedule | null;
    tapFlow?: boolean;
  },
): void {
  const { peakRarity, isMulti, timings, spill, tapFlow = false } = input;
  const E = resolveEasing;

  const A = timings.approach;
  const H = timings.hold;
  const TF = timings.tearFlip;
  const FR = timings.flashReveal;
  const S = timings.settleMs;
  const tHold = A;
  const tTear = A + H;
  const tFlash = tTear + TF;
  const tSettle = tFlash + FR;
  const tellMs = Math.round(H * TELL_FRACTION_OF_HOLD);
  const pause = peakRarity === 'LEG' ? LEG_HIT_PAUSE_MS : 0;
  const B = isMulti ? TEAR_BEATS.multi : TEAR_BEATS.single;
  const n = timeline.rim.length;

  const approachT = timelineTargets({ phase: 'approach', peakRarity, isMulti, reduceMotion: false, tapFlow });
  const holdT = timelineTargets({ phase: 'hold', peakRarity, isMulti, reduceMotion: false, tapFlow });
  const settleT = timelineTargets({ phase: 'settle', peakRarity, isMulti, reduceMotion: false, tapFlow });

  // `sequenceAt` returns the opaque animation record the guard produces; assign it to the
  // shared value through one typed cast so each call site stays a plain `assign(...)`.
  const assign = (sv: SharedValue<number>, steps: ReadonlyArray<SequenceStep>): void => {
    sv.value = sequenceAt(steps) as number;
  };

  assign(timeline.packScale, [
    { at: 0, durationMs: A, animation: withTiming(approachT.packScale, { duration: A, easing: E(EASING.EMPHASIZED_OUT) }) },
    { at: tFlash, durationMs: 200, animation: withTiming(1, { duration: 200, easing: E(EASING.STANDARD) }) },
  ]);
  assign(timeline.packY, [
    { at: 0, durationMs: A, animation: withTiming(-24, { duration: A, easing: E(EASING.EMPHASIZED_OUT) }) },
  ]);
  assign(timeline.rays, [
    { at: 0, durationMs: A, animation: withTiming(approachT.rays, { duration: A, easing: E(EASING.STANDARD) }) },
    { at: tSettle, durationMs: S, animation: withTiming(0.1, { duration: S, easing: E(EASING.STANDARD) }) },
  ]);
  assign(timeline.halo, [
    { at: 0, durationMs: A, animation: withTiming(approachT.halo, { duration: A, easing: E(EASING.STANDARD) }) },
    { at: tHold, durationMs: tellMs, animation: withTiming(0.6, { duration: tellMs, easing: E(EASING.STANDARD) }) },
    { at: tSettle, durationMs: S, animation: withTiming(0.35, { duration: S, easing: E(EASING.STANDARD) }) },
  ]);
  assign(timeline.seam, [
    { at: 0, durationMs: SEAM_PRECUT_MS, animation: withTiming(SEAM_PRECUT, { duration: SEAM_PRECUT_MS, easing: E(EASING.OUT_QUAD) }) },
    {
      at: tTear + pause,
      durationMs: Math.round(TF * B.seamEnd),
      animation: withTiming(1, { duration: Math.round(TF * B.seamEnd), easing: E(EASING.OUT_CUBIC) }),
    },
  ]);
  assign(timeline.tell, [
    { at: tHold, durationMs: tellMs, animation: withTiming(1, { duration: tellMs, easing: E(EASING.STANDARD) }) },
  ]);
  assign(timeline.dim, [
    { at: tHold, durationMs: tellMs, animation: withTiming(holdT.dim, { duration: tellMs, easing: E(EASING.STANDARD) }) },
    { at: tSettle, durationMs: S, animation: withTiming(0, { duration: S, easing: E(EASING.STANDARD) }) },
  ]);
  assign(timeline.leak, [
    { at: tHold, durationMs: tellMs, animation: withTiming(1, { duration: tellMs, easing: E(EASING.STANDARD) }) },
    {
      at: tTear + pause,
      durationMs: 60,
      animation: withSequence(withTiming(0.6, { duration: 0 }), withTiming(1, { duration: 60, easing: E(EASING.LINEAR) })),
    },
    { at: tFlash, durationMs: 200, animation: withTiming(0, { duration: 200, easing: E(EASING.STANDARD) }) },
  ]);
  if (peakRarity === 'LEG' && timings.beatMs > 0) {
    const half = Math.round(1000 / SHIVER_HZ / 2);
    const reps = Math.max(1, Math.round(timings.beatMs / (2 * half)));
    assign(timeline.shiver, [
      {
        at: tHold + Math.max(0, H - timings.beatMs),
        durationMs: reps * 2 * half,
        animation: withRepeat(
          withSequence(
            withTiming(SHIVER_PX, { duration: half, easing: E(EASING.LINEAR) }),
            withTiming(-SHIVER_PX, { duration: half, easing: E(EASING.LINEAR) }),
          ),
          reps,
          false,
        ),
      },
      { at: tTear, durationMs: 40, animation: withTiming(0, { duration: 40, easing: E(EASING.LINEAR) }) },
    ]);
  }
  assign(timeline.peel, [
    {
      at: tTear + pause + Math.round(TF * B.peelStart),
      durationMs: Math.round(TF * (B.peelEnd - B.peelStart)),
      animation: withTiming(1, { duration: Math.round(TF * (B.peelEnd - B.peelStart)), easing: E(EASING.EMPHASIZED_OUT) }),
    },
  ]);
  assign(timeline.cardOut, [
    {
      at: tTear + pause + Math.round(TF * B.cardOutStart),
      durationMs: Math.round(TF * (B.cardOutEnd - B.cardOutStart)),
      animation: withTiming(1, { duration: Math.round(TF * (B.cardOutEnd - B.cardOutStart)), easing: E(EASING.EMPHASIZED_OUT) }),
    },
  ]);
  if (peakRarity === 'LEG') {
    assign(timeline.cameraRot, [
      {
        at: tTear + pause,
        durationMs: 360,
        animation: withSequence(
          withTiming(-0.5, { duration: 90, easing: E(EASING.OUT_QUAD) }),
          withTiming(0.4, { duration: 90, easing: E(EASING.OUT_QUAD) }),
          withTiming(-0.25, { duration: 90, easing: E(EASING.OUT_QUAD) }),
          withTiming(0, { duration: 90, easing: E(EASING.OUT_QUAD) }),
        ),
      },
      { at: tSettle, durationMs: S, animation: withTiming(0, { duration: S, easing: E(EASING.STANDARD) }) },
    ]);
  }
  if (spill) {
    for (const entry of spill.entries) {
      if (entry.index < n) {
        const o = spillSlotOffset(entry.slot, n);
        const at = tTear + pause + entry.leaveAt;
        const dur = spill.travelMs;
        assign(timeline.spill[entry.index].x, [
          { at, durationMs: dur, animation: withTiming(o.x, { duration: dur, easing: E(EASING.EMPHASIZED_OUT) }) },
        ]);
        assign(timeline.spill[entry.index].y, [
          { at, durationMs: dur, animation: withTiming(o.y, { duration: dur, easing: E(EASING.EMPHASIZED_OUT) }) },
        ]);
        assign(timeline.spill[entry.index].rot, [
          { at, durationMs: dur, animation: withTiming((o.rot * Math.PI) / 180, { duration: dur, easing: E(EASING.EMPHASIZED_OUT) }) },
        ]);
      }
    }
  }
  assign(timeline.flash, [
    {
      at: tFlash,
      durationMs: 320,
      animation: withSequence(
        withTiming(0.85, { duration: 60, easing: E(EASING.LINEAR) }),
        withTiming(0, { duration: 260, easing: E(EASING.OUT_QUAD) }),
      ),
    },
  ]);
  assign(timeline.cameraScale, [
    {
      at: tFlash,
      durationMs: 320,
      animation: withSequence(
        withTiming(1.04, { duration: 60, easing: E(EASING.LINEAR) }),
        withTiming(1, { duration: 260, easing: E(EASING.OUT_QUAD) }),
      ),
    },
  ]);
  for (let i = 0; i < n; i++) {
    assign(timeline.rim[i], [
      { at: tSettle + i * 40, durationMs: 200, animation: withTiming(settleT.rim, { duration: 200, easing: E(EASING.STANDARD) }) },
    ]);
  }
}

/** Cancel every in-flight animation the plan started, so the per-phase path can take back
 *  ownership for a fast-forward. `raysAngle` is left alone (its revolution loop is owned by
 *  the mount effect, not the plan). */
export function cancelCeremonyTimeline(timeline: CeremonyTimeline): void {
  cancelAnimation(timeline.tell);
  cancelAnimation(timeline.dim);
  cancelAnimation(timeline.seam);
  cancelAnimation(timeline.leak);
  cancelAnimation(timeline.flash);
  cancelAnimation(timeline.cameraScale);
  cancelAnimation(timeline.cameraRot);
  cancelAnimation(timeline.shiver);
  cancelAnimation(timeline.packScale);
  cancelAnimation(timeline.packY);
  cancelAnimation(timeline.peel);
  cancelAnimation(timeline.cardOut);
  cancelAnimation(timeline.rays);
  cancelAnimation(timeline.halo);
  for (const s of timeline.spill) {
    cancelAnimation(s.x);
    cancelAnimation(s.y);
    cancelAnimation(s.rot);
  }
  for (const r of timeline.rim) cancelAnimation(r);
}
