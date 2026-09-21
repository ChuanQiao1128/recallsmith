// mobile/src/features/gacha/mcq/mcqShuffle.ts
// Deterministic seeded option order for MCQ cards (D02, plan §6.4). The hash is imported
// (fnv1a32Hex, topics.ts:14); the PRNG is a module-private mulberry32 copy of the draw-pool
// arithmetic so behaviour never drifts, yet neither file imports the other (D00 §0).
import type { McqExport, McqOption } from '../../../types/deckExport';
import { fnv1a32Hex } from '../library/topics';

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;                       // NaN / Infinity / negative / fractional seeds are coerced, never thrown on
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function mcqSeed(sessionId: string, stableUid: string, attemptIndex: number): number {
  return parseInt(fnv1a32Hex(`${sessionId}|${stableUid}|${attemptIndex}`), 16) >>> 0;
}

/** Deterministic Fisher–Yates over a copy, driven by mulberry32(seed). Same seed → same order; the result is a
 *  permutation of items; items is never mutated. */
export function seededShuffle<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  const next = mulberry32(seed);
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    const tmp = out[i]; out[i] = out[j]; out[j] = tmp;
  }
  return out;
}

/** mcq.shuffle === false → [...mcq.options] (stored order); else seededShuffle(mcq.options, seed). Always a new array. */
export function shownOrderFor(mcq: McqExport, seed: number): McqOption[] {
  return mcq.shuffle === false ? [...mcq.options] : seededShuffle(mcq.options, seed);
}
