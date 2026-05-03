import type { CardProgress } from '../../../review/model';
import { formatDateKey } from '../../../review/model';
import { MASTERY_STAGE_THRESHOLD } from '../constants';
import type { CalendarDay } from '../contracts';

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

export function buildUpcoming(progress: CardProgress[], now: Date, days: number): CalendarDay[] {
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
    if (!isScheduledProgress(p)) continue;

    const next = new Date(p.nextReviewAt);
    const effective = next.getTime() < today0.getTime() ? today0 : next;
    const key = formatDateKey(effective);
    const idx = index.get(key);
    if (idx !== undefined) out[idx].count += 1;
  }

  return out;
}
