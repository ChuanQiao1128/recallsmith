import AsyncStorage from '@react-native-async-storage/async-storage';

import { isProgressSettled } from '../gacha/rewards/progressSettled';
import { getUserScopedKey } from '../../review/storage';
import { examPaceDayKey } from './examPace';

/**
 * U5: where Home's daily target starts each day (examPace.ts, `learnedAtDayStart`).
 *
 * One small record per progress partition: the local day, the goal deck, the exam date and how many
 * of that deck's cards were learned on Home's first look that day. A count, no identifiers. The base
 * key is resolved with getUserScopedKey (`devcards:u:{sub|anon}:recallsmith:exam-pace-anchor:v2`),
 * the same partition the learned count itself is read from (review/storage.ts), so progress that
 * arrives by signing in or switching account is measured against that account's own record and is
 * never counted as today's work. A new day, another goal deck or another exam date starts a new
 * record, so the target is recalculated once per day and whenever the goal changes.
 *
 * A signed-in partition gets no record until its remote progress has landed on this device
 * (progressSettled.ts, the gate the R1 ledger seed uses): before that, the learned count is only
 * what this device happens to know, and the pull that lands later would read as cards learned
 * today. Until then the target is the live estimate (nothing counted as done today).
 */
export const EXAM_PACE_ANCHOR_KEY = 'recallsmith:exam-pace-anchor:v2';

type Anchor = { dayKey: string; deckSlug: string; examDate: string; learned: number };

function parseAnchor(raw: string | null): Anchor | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    if (!v || typeof v !== 'object') return null;
    const { dayKey, deckSlug, examDate, learned } = v;
    if (typeof dayKey !== 'string' || typeof deckSlug !== 'string' || typeof examDate !== 'string') return null;
    if (typeof learned !== 'number' || !Number.isInteger(learned) || learned < 0) return null;
    return { dayKey, deckSlug, examDate, learned };
  } catch {
    return null;
  }
}

/**
 * Cards of the goal deck that were learned at the start of today, in the current progress
 * partition. Returns the stored count when this partition has a record for this day, deck and exam
 * date that is not above `learned`. Otherwise it records `learned` as today's start (only once the
 * partition's progress has settled) and returns it. Never throws: on a storage error it returns
 * `learned`, which makes the target the live estimate.
 */
export async function resolveDayStartLearned(input: {
  deckSlug: string;
  examDate: string;
  learned: number;
  nowMs: number;
}): Promise<number> {
  const { deckSlug, examDate, nowMs } = input;
  const learned = Math.max(0, Math.floor(input.learned));
  const dayKey = examPaceDayKey(nowMs);
  try {
    const key = await getUserScopedKey(EXAM_PACE_ANCHOR_KEY);
    const stored = parseAnchor(await AsyncStorage.getItem(key));
    if (
      stored &&
      stored.dayKey === dayKey &&
      stored.deckSlug === deckSlug &&
      stored.examDate === examDate &&
      stored.learned <= learned
    ) {
      return stored.learned;
    }
    if (!(await isProgressSettled(deckSlug))) return learned;
    const next: Anchor = { dayKey, deckSlug, examDate, learned };
    await AsyncStorage.setItem(key, JSON.stringify(next));
  } catch {
    // Storage is a nicety here: without it the target is the live estimate.
  }
  return learned;
}
