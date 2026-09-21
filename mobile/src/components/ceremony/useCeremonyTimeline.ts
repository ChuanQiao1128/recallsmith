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
  const { phase, peakRarity, isMulti, cardCount, timings, spill, reduceMotion, compressed, tapFlow = false } = input;
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
  }, [phase, peakRarity, isMulti, reduceMotion, compressed, timings, spill, n, tapFlow]);

  return timeline;
}
