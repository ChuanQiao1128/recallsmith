import type { CardProgress } from '../../../review/model';
import { formatDateKey } from '../../../review/model';
import { MASTERY_STAGE_THRESHOLD } from '../constants';
import type { CalendarDay, OwnedGate } from '../contracts';

export function clamp01(v: number) {
  return Math.max(0, Math.min(1, v));
}

export function startOfToday(now: Date) {
  const d = new Date(now.getTime());
  d.setHours(0, 0, 0, 0);
  return d;
}

export function isLearnedProgress(progress: CardProgress): boolean {
  return typeof progress.lastReviewedAt === 'number' && progress.lastReviewedAt > 0;
}

export function isScheduledProgress(progress: CardProgress): boolean {
  return isLearnedProgress(progress) && typeof progress.nextReviewAt === 'number' && progress.nextReviewAt > 0;
}

export function isNewProgress(progress: CardProgress): boolean {
  return !isLearnedProgress(progress);
}

export function isMasteredProgress(progress: CardProgress): boolean {
  return isLearnedProgress(progress) && (progress.stage ?? 0) >= MASTERY_STAGE_THRESHOLD;
}

/**
 * The gate here cannot change an answer today, and it is still threaded on
 * purpose.
 *
 * isScheduledProgress implies isLearnedProgress, and resolveEffectiveOwned
 * grandfathers every studied card -- so every card this loop can count is
 * already in the set, whatever set the caller passes. The reason to take the
 * parameter anyway is that Home derives its `dueToday` from `upcoming[0]`
 * rather than from countDueToday: leaving this one ungated would mean Home's
 * due number and the session's due number are computed under two different
 * rules that happen to agree, and "happen to agree" is not a property anyone
 * can rely on while editing either side. With the gate threaded, the day the
 * union stops covering every studied card (cards that expire, a deck the user
 * loses access to), the calendar follows without a second edit.
 */
export function buildUpcoming(
  progress: CardProgress[],
  now: Date,
  days: number,
  ownedSet: OwnedGate = null,
): CalendarDay[] {
  const out: CalendarDay[] = [];
  const index = new Map<string, number>();
  const today0 = startOfToday(now);

  for (let i = 0; i < days; i++) {
    const d = new Date(today0.getTime());
    d.setDate(d.getDate() + i);
    const key = formatDateKey(d);
    index.set(key, i);
    out.push({ dateKey: key, count: 0 });
  }

  for (const p of progress) {
    if (ownedSet && !ownedSet.has(p.stableUid)) continue;
    if (!isScheduledProgress(p)) continue;

    const next = new Date(p.nextReviewAt);
    const effective = next.getTime() < today0.getTime() ? today0 : next;
    const key = formatDateKey(effective);
    const idx = index.get(key);
    if (idx !== undefined) out[idx].count += 1;
  }

  return out;
}
