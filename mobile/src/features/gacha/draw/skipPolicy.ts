// Pure fast-forward decision for the draw ceremony. It can only ever return 'none' or
// 'compress' — the union has no third member, so "the skip control leaves the ceremony"
// (the pre-1.6 defect at DrawCeremonyScreen.tsx:884-894/1370-1386) is unrepresentable.
// The 60 %-of-hold threshold comes from ceremonyTimings.ts (design §3.1 FF).

import { FAST_FORWARD_FROM_HOLD_FRACTION, type CeremonyPhase } from './ceremonyTimings';

/** 'none' = no visible fast-forward control; 'compress' = show the × / accept a stage tap that
 *  compresses the timeline. There is deliberately no third member: this policy can never
 *  leave the ceremony. */
export type SkipDecision = 'none' | 'compress';

export type SkipPolicyInput = {
  ceremoniesCompleted: number;    // ceremonyPrefs, fail-closed 0
  phase: CeremonyPhase;
  phaseElapsedMs: number;         // ms since the current phase started
  phaseDurationMs: number;        // scheduled duration of the current phase
  reduceMotion: boolean;
  alreadyCompressed: boolean;
};

/** Reaching settle or the table counts the ceremony as completed exactly once, so players who
 *  always press Skip (never the Continue CTA) still unlock the fast-forward next time (MGACHA-09). */
export function shouldMarkCeremonyComplete(phase: CeremonyPhase, alreadyMarked: boolean): boolean {
  return !alreadyMarked && (phase === 'settle' || phase === 'cards-on-table');
}

export function skipPolicy(input: SkipPolicyInput): SkipDecision {
  // 1. Reduce motion is a parallel ceremony with its own 180/420 ms path (B00 §3.3);
  //    there is nothing to compress.
  if (input.reduceMotion) return 'none';
  // 2. First-ever ceremony shows nothing before settle. Written with the negated
  //    comparison so NaN, undefined-as-number and negatives all fail closed.
  if (!(input.ceremoniesCompleted >= 1)) return 'none';
  // 3. One compression per ceremony.
  if (input.alreadyCompressed) return 'none';

  switch (input.phase) {
    // The tell has not landed yet (design §2 "skip appears after the meteor colour").
    case 'swipe':
    case 'approach':
      return 'none';
    // A NaN on either side compares false → 'none'.
    case 'hold':
      return input.phaseElapsedMs >= FAST_FORWARD_FROM_HOLD_FRACTION * input.phaseDurationMs
        ? 'compress'
        : 'none';
    case 'tear-flip':
    case 'flash-reveal':
      return 'compress';
    // The settle CTA owns these phases (setCanSkip(true) at :750/:768 today).
    case 'settle':
    case 'cards-on-table':
      return 'none';
    default:
      return 'none';
  }
}
