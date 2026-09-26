// spotlightPlan — the pure sizing/timing/cue model for the single-pull RevealSpotlight
// (I04). No React / react-native imports: everything here is deterministic and unit
// tested, so RevealSpotlight (motion) and DrawResultScreen (layout) can read the same
// numbers, and I05/I06 can build the multi-pull sequence and the sound choreography on
// this exact API. Type-only imports keep it OTA-safe.

import type { CeremonyCueAction } from './ceremonyCues';
import type { PeakRarity } from './ceremonyTimings';

/**
 * The spotlight card size for a window: a 5:7 card that is at most 86 % of the width, at
 * most 62 % of the height, and never wider than 440 pt (so it does not balloon on a tablet).
 */
export function spotlightCardSize(win: { width: number; height: number }): { width: number; height: number } {
  const width = Math.floor(Math.min(0.86 * win.width, (0.62 * win.height) / 1.4, 440));
  const height = Math.round(width * 1.4);
  return { width, height };
}

/** Face fonts scaled to the card width (a floor keeps the smallest cards legible). */
export function revealFaceMetrics(cardWidth: number): {
  questionFontSize: number;
  questionLineHeight: number;
  chipFontSize: number;
  serialFontSize: number;
} {
  const w = cardWidth;
  const questionFontSize = Math.max(12, Math.round(0.045 * w));
  const questionLineHeight = Math.round(questionFontSize * 1.2);
  const chipFontSize = Math.max(11, Math.round(0.036 * w));
  const serialFontSize = Math.max(9, Math.round(0.028 * w));
  return { questionFontSize, questionLineHeight, chipFontSize, serialFontSize };
}

/** DrawResult's featured card width, sized from the window (was a fixed 260 pt). */
export function resultFeaturedCardWidth(windowWidth: number): number {
  return Math.round(Math.min(Math.max(windowWidth * 0.78, 260), 380));
}

export const SPOTLIGHT_ENTRANCE_MS = 420;
export const SPOTLIGHT_FLIP_MS = Object.freeze({ COM: 350, RAR: 450, LEG: 500 });
export const SPOTLIGHT_LEG_SHAKE_MS = 300;
export const SPOTLIGHT_LEG_EDGE_PAUSE_MS = 150;
export const SPOTLIGHT_RM_FADE_MS = 180;
export const SPOTLIGHT_SCRIM = '#08041A';
export const SPOTLIGHT_SCRIM_OPACITY = 0.85;
export const SPOTLIGHT_COPY = Object.freeze({
  readFull: 'Tap to read full question',
  close: 'Close',
  tapToReveal: 'Tap to reveal',
});

/**
 * The flip choreography, all times relative to the flip request (the tap or the autoFlip
 * timer) except `entranceMs`, which is measured from the spotlight becoming visible.
 */
export type SpotlightFlipPlan = {
  entranceMs: number;
  shakeMs: number;
  flipStartMs: number;
  flipMs: number;
  edgePauseMs: number;
  midpointMs: number;
  landMs: number;
};

export function spotlightFlipPlan(rarity: PeakRarity, reduceMotion: boolean): SpotlightFlipPlan {
  if (reduceMotion) {
    return { entranceMs: 180, shakeMs: 0, flipStartMs: 0, flipMs: 180, edgePauseMs: 0, midpointMs: 90, landMs: 180 };
  }
  if (rarity === 'LEG') {
    // shake 300 → first half 250 to edge-on → 150 edge-on pause → face at 700 → second half 250 → land 950.
    return { entranceMs: 420, shakeMs: 300, flipStartMs: 300, flipMs: 500, edgePauseMs: 150, midpointMs: 700, landMs: 950 };
  }
  if (rarity === 'RAR') {
    return { entranceMs: 420, shakeMs: 0, flipStartMs: 0, flipMs: 450, edgePauseMs: 0, midpointMs: 225, landMs: 450 };
  }
  return { entranceMs: 420, shakeMs: 0, flipStartMs: 0, flipMs: 350, edgePauseMs: 0, midpointMs: 175, landMs: 350 };
}

/** One flip sound/haptic cue, `at` ms after the flip request. */
export type SpotlightCue = { at: number; action: CeremonyCueAction };

/**
 * The flip cue list, stable-sorted ascending by `at` (ties keep their build order). The soft
 * touch impact fires at the request, the flip sound at flip start, the rarity sting at the
 * midpoint, and the success/heavy at landing. COM gets no rarity sting yet (I06 adds one).
 */
export function spotlightFlipCues(rarity: PeakRarity, plan: SpotlightFlipPlan): SpotlightCue[] {
  const cues: SpotlightCue[] = [];
  cues.push({ at: 0, action: { kind: 'impact', style: 'soft' } });
  cues.push({ at: plan.flipStartMs, action: { kind: 'hit', name: 'card-flip' } });
  cues.push({ at: plan.midpointMs, action: { kind: 'impact', style: 'rigid' } });
  if (rarity === 'RAR') cues.push({ at: plan.midpointMs, action: { kind: 'hit', name: 'chime' } });
  if (rarity === 'LEG') cues.push({ at: plan.midpointMs, action: { kind: 'hit', name: 'legendary' } });
  if (rarity === 'RAR') cues.push({ at: plan.landMs, action: { kind: 'success' } });
  if (rarity === 'LEG') {
    cues.push({ at: plan.landMs, action: { kind: 'impact', style: 'heavy' } });
    cues.push({ at: plan.landMs, action: { kind: 'success' } });
  }
  return cues
    .map((cue, index) => ({ cue, index }))
    .sort((a, b) => a.cue.at - b.cue.at || a.index - b.index)
    .map(({ cue }) => cue);
}
