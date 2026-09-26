// ceremonyCues — the pure, phase-relative audio/haptic cue table for the draw
// ceremony (MGACHA-05, G43). Every cue the per-phase `[phase]` effect used to fire
// at a phase boundary is expressed here as an offset from the START of its phase, so
// DrawCeremonyScreen can schedule them all in one tick from the same start timestamp
// as the phase timers. Nothing here touches the audio/haptic modules — the screen's
// `fireCue` dispatcher does — so this stays a pure, testable function.
//
// Type-only imports from the B04 controllers keep this OTA-safe; only CEREMONY_GAIN is
// a runtime import (the gain levels are the same numbers the old phase effect passed).

import { CEREMONY_GAIN } from '../../../components/ceremonyAudio';
import type { CeremonyBedName, CeremonyHitName, CeremonyTailName } from '../../../components/ceremonyAudio';
import type { HapticImpact } from '../../../components/ceremonyHaptics';
import type { CeremonyPhase, PeakRarity, ResolvedCeremonyTimings } from './ceremonyTimings';
import { FAST_FORWARD_FROM_HOLD_FRACTION } from './ceremonyTimings';

/** One audio/haptic side effect. `fireCue` passes `{ gain, fadeMs }` through to
 *  `audio.bed` only when defined. */
export type CeremonyCueAction =
  | { kind: 'bed'; name: CeremonyBedName | null; gain?: number; fadeMs?: number }
  | { kind: 'hit'; name: CeremonyHitName }
  | { kind: 'tail'; name: CeremonyTailName }
  | { kind: 'duck'; gain: number; ms: number }
  | { kind: 'impact'; style: HapticImpact }
  | { kind: 'success' };

/** A cue placed `offsetMs` after the start of `phase`. Array order is firing order
 *  within the same moment (same phase + offset). */
export type CeremonyCue = { phase: CeremonyPhase; offsetMs: number; action: CeremonyCueAction };

/** Bed ambience name by peak rarity (LEG choir, RAR shimmer, COM air), matching the
 *  pre-G43 `bedName` in DrawCeremonyScreen. */
function bedNameFor(peakRarity: PeakRarity): CeremonyBedName {
  return peakRarity === 'LEG' ? 'choir-swell' : peakRarity === 'RAR' ? 'shimmer-pad' : 'air';
}

/**
 * The ported cue table. Offsets are relative to the start of their phase; array order is
 * the firing order within a single moment. Ported verbatim from the per-phase `[phase]`
 * and `[tellLanded]` effects (including G09's LEG `success()`-before-impact order).
 */
export function buildCeremonyCues(input: {
  peakRarity: PeakRarity;
  isMulti: boolean;
  timings: ResolvedCeremonyTimings;
}): CeremonyCue[] {
  const { peakRarity, isMulti, timings } = input;
  const bedName = bedNameFor(peakRarity);
  const cues: CeremonyCue[] = [];

  // hold: the bed starts; the tell impact lands with the colour (RAR/LEG only); the beat
  // duck ramps the bed down just before the hit (only when there is a silence beat).
  cues.push({ phase: 'hold', offsetMs: 0, action: { kind: 'bed', name: bedName, gain: CEREMONY_GAIN.bed[peakRarity] } });
  if (peakRarity !== 'COM') {
    cues.push({
      phase: 'hold',
      offsetMs: Math.round(timings.hold * FAST_FORWARD_FROM_HOLD_FRACTION),
      action: { kind: 'impact', style: peakRarity === 'LEG' ? 'heavy' : 'medium' },
    });
  }
  if (timings.beatMs > 0) {
    cues.push({ phase: 'hold', offsetMs: timings.hold - timings.beatMs, action: { kind: 'duck', gain: CEREMONY_GAIN.duck, ms: 80 } });
  }

  // tear-flip: the rip and its light impact; the stack thud lands at the midpoint (multi only).
  cues.push({ phase: 'tear-flip', offsetMs: 0, action: { kind: 'hit', name: 'rip' } });
  cues.push({ phase: 'tear-flip', offsetMs: 0, action: { kind: 'impact', style: 'light' } });
  if (isMulti) {
    cues.push({ phase: 'tear-flip', offsetMs: Math.round(timings.tearFlip * 0.5), action: { kind: 'hit', name: 'stack-thud' } });
  }

  // flash-reveal: the seam burst, the rarity sting, and the impact. The LEG Success climax
  // fires BEFORE the heavy impact (G09 / MGACHA-08) so the limiter can never crowd it out.
  cues.push({ phase: 'flash-reveal', offsetMs: 0, action: { kind: 'hit', name: 'seam-burst' } });
  if (peakRarity === 'LEG') cues.push({ phase: 'flash-reveal', offsetMs: 0, action: { kind: 'hit', name: 'stinger' } });
  else if (peakRarity === 'RAR') cues.push({ phase: 'flash-reveal', offsetMs: 0, action: { kind: 'hit', name: 'chime' } });
  if (peakRarity === 'LEG') cues.push({ phase: 'flash-reveal', offsetMs: 0, action: { kind: 'success' } });
  cues.push({
    phase: 'flash-reveal',
    offsetMs: 0,
    action: { kind: 'impact', style: peakRarity === 'LEG' ? 'heavy' : peakRarity === 'RAR' ? 'medium' : 'light' },
  });

  // settle: the sparkle tail (non-COM) and the bed drops to its quiet table level.
  if (peakRarity !== 'COM') cues.push({ phase: 'settle', offsetMs: 0, action: { kind: 'tail', name: 'sparkle-tail' } });
  cues.push({ phase: 'settle', offsetMs: 0, action: { kind: 'bed', name: bedName, gain: CEREMONY_GAIN.bedTable } });

  return cues;
}

/**
 * Resolve the phase-relative cue table into absolute times from one start: for every
 * schedule entry whose phase has cues, `at = entry.at + cue.offsetMs`. The result is
 * stable-sorted ascending by `at` (ties keep their build order, so a single moment fires
 * in the order `buildCeremonyCues` listed them).
 */
export function cueTimesFromSchedule(
  cues: ReadonlyArray<CeremonyCue>,
  entries: ReadonlyArray<{ at: number; phase: CeremonyPhase | 'tail' }>,
): Array<{ at: number; action: CeremonyCueAction }> {
  const out: Array<{ at: number; action: CeremonyCueAction; seq: number }> = [];
  let seq = 0;
  for (const entry of entries) {
    for (const cue of cues) {
      if (cue.phase === entry.phase) {
        out.push({ at: entry.at + cue.offsetMs, action: cue.action, seq: seq++ });
      }
    }
  }
  out.sort((a, b) => a.at - b.at || a.seq - b.seq);
  return out.map(({ at, action }) => ({ at, action }));
}
