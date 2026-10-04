import AsyncStorage from '@react-native-async-storage/async-storage';

import { examPaceDayKey } from './examPace';

/**
 * U5: where Home's daily target starts each day (examPace.ts, `remainingAtDayStart`).
 *
 * One small record next to the study goal it belongs to (STUDY_GOAL_KEY is device-local too): the
 * local day, the goal deck, the exam date and how many of that deck's cards were left on Home's
 * first look that day. A count, no identifiers. A new day, another goal deck or another exam date
 * starts a new record, so the target is recalculated once per day and whenever the goal changes.
 */
export const EXAM_PACE_ANCHOR_KEY = 'recallsmith:exam-pace-anchor:v1';

type Anchor = { dayKey: string; deckSlug: string; examDate: string; remaining: number };

function parseAnchor(raw: string | null): Anchor | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    if (!v || typeof v !== 'object') return null;
    const { dayKey, deckSlug, examDate, remaining } = v;
    if (typeof dayKey !== 'string' || typeof deckSlug !== 'string' || typeof examDate !== 'string') return null;
    if (typeof remaining !== 'number' || !Number.isInteger(remaining) || remaining < 0) return null;
    return { dayKey, deckSlug, examDate, remaining };
  } catch {
    return null;
  }
}

/**
 * Cards that were left at the start of today for this goal. Records `remaining` as today's start
 * when there is no record for this day, deck and exam date yet (or when `remaining` is larger, i.e.
 * the record no longer describes today). Never throws: on a storage error it returns `remaining`,
 * which is the live estimate.
 */
export async function resolveDayStartRemaining(input: {
  deckSlug: string;
  examDate: string;
  remaining: number;
  nowMs: number;
}): Promise<number> {
  const { deckSlug, examDate, nowMs } = input;
  const remaining = Math.max(0, Math.floor(input.remaining));
  const dayKey = examPaceDayKey(nowMs);
  try {
    const stored = parseAnchor(await AsyncStorage.getItem(EXAM_PACE_ANCHOR_KEY));
    if (
      stored &&
      stored.dayKey === dayKey &&
      stored.deckSlug === deckSlug &&
      stored.examDate === examDate &&
      stored.remaining >= remaining
    ) {
      return stored.remaining;
    }
    const next: Anchor = { dayKey, deckSlug, examDate, remaining };
    await AsyncStorage.setItem(EXAM_PACE_ANCHOR_KEY, JSON.stringify(next));
  } catch {
    // Storage is a nicety here: without it the target is the live estimate.
  }
  return remaining;
}
