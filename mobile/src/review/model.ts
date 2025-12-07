// mobile/src/review/model.ts

export const INTERVALS_DAYS = [1, 3, 7, 14, 30];
const AGAIN_DELAY_MINUTES = 10;

export type ReviewRating = 'again' | 'hard' | 'good' | 'easy';

export type CardProgress = {
  stableUid: string;
  stage: number; // 0..INTERVALS_DAYS.length-1
  nextReviewAt: number; // epoch ms; 0 means "not scheduled yet" (new card)
  lastReviewedAt?: number; // epoch ms; undefined means "never learned"
};

export function formatDateKey(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export function isLearned(p: CardProgress): boolean {
  return typeof p.lastReviewedAt === 'number' && Number.isFinite(p.lastReviewedAt) && p.lastReviewedAt > 0;
}

/**
 * "Due" is day-based (not minute-based) AND only for learned cards.
 * - New cards (never reviewed) are NOT due.
 * - Anything scheduled earlier than today is also considered due today.
 */
export function isDue(p: CardProgress, now: Date): boolean {
  if (!isLearned(p)) return false;
  if (typeof p.nextReviewAt !== 'number' || !Number.isFinite(p.nextReviewAt) || p.nextReviewAt <= 0) {
    return false;
  }

  const dueKey = formatDateKey(new Date(p.nextReviewAt));
  const todayKey = formatDateKey(now);
  return dueKey <= todayKey;
}

export function scheduleNextReview(
  p: CardProgress,
  rating: ReviewRating,
  now: Date,
): CardProgress {
  const nowMs = now.getTime();
  const maxStage = INTERVALS_DAYS.length - 1;

  const currentStage = clamp(p.stage ?? 0, 0, maxStage);
  const baseDays = INTERVALS_DAYS[currentStage];

  let nextStage = currentStage;
  let nextAt = nowMs;

  switch (rating) {
    case 'again': {
      nextStage = Math.max(currentStage - 1, 0);
      nextAt = nowMs + AGAIN_DELAY_MINUTES * 60_000;
      break;
    }
    case 'hard': {
      const hardDays = Math.max(1, Math.floor(baseDays * 0.5));
      nextStage = currentStage;
      nextAt = nowMs + hardDays * 86_400_000;
      break;
    }
    case 'good': {
      nextStage = Math.min(currentStage + 1, maxStage);
      nextAt = nowMs + baseDays * 86_400_000;
      break;
    }
    case 'easy': {
      const intervalStage = Math.min(currentStage + 1, maxStage);
      const easyDays = INTERVALS_DAYS[intervalStage];
      nextStage = Math.min(currentStage + 2, maxStage);
      nextAt = nowMs + easyDays * 86_400_000;
      break;
    }
  }

  return {
    ...p,
    stage: nextStage,
    nextReviewAt: nextAt,
    lastReviewedAt: nowMs, // mark as learned
  };
}