// mobile/src/review/model.ts

export const INTERVALS_DAYS = [1, 3, 7, 14, 30]; // 你也可以保留原数组，不必改
const AGAIN_DELAY_MINUTES = 10;

export type ReviewRating = 'again' | 'hard' | 'good' | 'easy';

export type CardProgress = {
  stableUid: string;
  stage: number;         // 0..INTERVALS_DAYS.length-1
  nextReviewAt: number;  // epoch ms
  lastReviewedAt?: number; // 可选：如果你已有就保留
};

export function formatDateKey(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function isDue(p: CardProgress, now: Date): boolean {
  return p.nextReviewAt <= now.getTime();
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
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
      // 失败：轻微降级 + 很快再见一次（同一天）
      nextStage = Math.max(currentStage - 1, 0);
      nextAt = nowMs + AGAIN_DELAY_MINUTES * 60_000;
      break;
    }
    case 'hard': {
      // 困难：不升级 stage，间隔更短（baseDays 的一半，至少 1 天）
      const hardDays = Math.max(1, Math.floor(baseDays * 0.5));
      nextStage = currentStage;
      nextAt = nowMs + hardDays * 86_400_000;
      break;
    }
    case 'good': {
      // 正常：按当前 stage 的间隔走，然后 stage +1
      nextStage = Math.min(currentStage + 1, maxStage);
      nextAt = nowMs + baseDays * 86_400_000;
      break;
    }
    case 'easy': {
      // 简单：用更长的间隔，并跳级（stage +2）
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
    lastReviewedAt: nowMs,
  };
}