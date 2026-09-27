// ceremonyCues — the pure, phase-relative audio/haptic cue table for the draw
// ceremony (MGACHA-05, G43; v2 re-choreography I06). Every cue is expressed as an offset
// from the START of its phase, so DrawCeremonyScreen can schedule them all in one tick from
// the same start timestamp as the phase timers. Nothing here touches the audio/haptic modules —
// the screen's `fireCue` dispatcher does — so this stays a pure, testable function.
//
// v2: the noise bed, the ducking and the tails are gone. Every sound is a one-shot hit:
// the charge pulses three times through the anticipation, the tear opens the pack, and the
// full-screen burst fires at the flash (with the peak stinger on the featured path only —
// the spotlight's own flip cues play the stinger on the tap flow).

import { stingerForRarity } from '../../../components/ceremonyAudio';
import type { CeremonyHitName } from '../../../components/ceremonyAudio';
import type { HapticImpact } from '../../../components/ceremonyHaptics';
import type { CeremonyPhase, PeakRarity, ResolvedCeremonyTimings } from './ceremonyTimings';
import { CHARGE_PULSE_FRACTION_OF_HOLD } from './ceremonyTimings';

/** One audio/haptic side effect. v2 has only one-shot hits, haptic impacts and the LEG success. */
export type CeremonyCueAction =
  | { kind: 'hit'; name: CeremonyHitName }
  | { kind: 'impact'; style: HapticImpact }
  | { kind: 'success' };

/** A cue placed `offsetMs` after the start of `phase`. Array order is firing order
 *  within the same moment (same phase + offset). */
export type CeremonyCue = { phase: CeremonyPhase; offsetMs: number; action: CeremonyCueAction };

/**
 * The v2 cue table. Offsets are relative to the start of their phase; array order is the firing
 * order within a single moment.
 */
export function buildCeremonyCues(input: {
  peakRarity: PeakRarity;
  isMulti: boolean;
  timings: ResolvedCeremonyTimings;
  tapFlow: boolean;
  reduceMotion?: boolean;
}): CeremonyCue[] {
  const { peakRarity, isMulti, timings, tapFlow, reduceMotion = false } = input;
  const cues: CeremonyCue[] = [];

  // Reduce Motion is a parallel ceremony (§3.4): no charge / tear / burst. On the tap flow the
  // spotlight's crossfade plays the stinger; on the featured path the flash plays it here.
  if (reduceMotion) {
    if (tapFlow) return cues;
    cues.push({ phase: 'flash-reveal', offsetMs: 0, action: { kind: 'hit', name: stingerForRarity(peakRarity) } });
    if (peakRarity === 'LEG') cues.push({ phase: 'flash-reveal', offsetMs: 0, action: { kind: 'success' } });
    return cues;
  }

  // approach: the charge fires once (its three plucks land on the three pulse haptics) and the
  // first, lightest pulse.
  cues.push({ phase: 'approach', offsetMs: 0, action: { kind: 'hit', name: 'charge' } });
  cues.push({ phase: 'approach', offsetMs: 0, action: { kind: 'impact', style: 'light' } });

  // hold: the second (medium) pulse at the start, the third (heavy) at mid-hold — nothing else.
  cues.push({ phase: 'hold', offsetMs: 0, action: { kind: 'impact', style: 'medium' } });
  cues.push({
    phase: 'hold',
    offsetMs: Math.round(timings.hold * CHARGE_PULSE_FRACTION_OF_HOLD),
    action: { kind: 'impact', style: 'heavy' },
  });

  // tear-flip: the tear and its light impact; the cards spill at the midpoint (multi only).
  cues.push({ phase: 'tear-flip', offsetMs: 0, action: { kind: 'hit', name: 'tear' } });
  cues.push({ phase: 'tear-flip', offsetMs: 0, action: { kind: 'impact', style: 'light' } });
  if (isMulti) {
    cues.push({ phase: 'tear-flip', offsetMs: Math.round(timings.tearFlip * 0.5), action: { kind: 'hit', name: 'flyout' } });
  }

  // flash-reveal: the burst, then — on the featured path only — the peak stinger (LEG Success
  // BEFORE the heavy impact, G09 / MGACHA-08), then the heavy impact.
  cues.push({ phase: 'flash-reveal', offsetMs: 0, action: { kind: 'hit', name: 'burst' } });
  if (!tapFlow) {
    cues.push({ phase: 'flash-reveal', offsetMs: 0, action: { kind: 'hit', name: stingerForRarity(peakRarity) } });
    if (peakRarity === 'LEG') cues.push({ phase: 'flash-reveal', offsetMs: 0, action: { kind: 'success' } });
  }
  cues.push({ phase: 'flash-reveal', offsetMs: 0, action: { kind: 'impact', style: 'heavy' } });

  // settle: no cues.
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
