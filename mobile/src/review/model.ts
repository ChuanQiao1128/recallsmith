// mobile/src/review/model.ts
export type ReviewRating = 'again' | 'hard' | 'good' | 'easy';

export interface CardProgress {
  stableUid: string;
  stage: number; // interval bucket
  lastReviewedAt?: number; // ms epoch; absent => never learned
  nextReviewAt: number; // ms epoch; 0 => unscheduled/unlearned

  // Phase 0: user confirmed content revision
  lastSeenRevision?: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const INTERVALS_DAYS = [1, 2, 4, 8, 15, 30, 60];

/** ✅ 给 storage.ts 用：统一 clamp */
export function clampStage(stage: number): number {
  const s = Number.isFinite(stage) ? stage : 0;
  return Math.max(0, Math.min(INTERVALS_DAYS.length - 1, Math.floor(s)));
}

/** due-now（不是“今天桶”）；未学过的不算 due */
export function isDue(p: CardProgress, now: Date): boolean {
  if (!(typeof p.lastReviewedAt === 'number' && p.lastReviewedAt > 0)) return false;
  if (!(typeof p.nextReviewAt === 'number' && p.nextReviewAt > 0)) return false;
  return p.nextReviewAt <= now.getTime();
}

export function scheduleNextReview(p: CardProgress, rating: ReviewRating, now: Date): CardProgress {
  const nowMs = now.getTime();

  const currentStage = clampStage(p.stage ?? 0);

  let nextStage = currentStage;
  let nextAt = nowMs + DAY_MS;

  if (rating === 'again') {
    nextStage = Math.max(0, currentStage);
    nextAt = nowMs + 10 * 60 * 1000; // 10 min
  } else if (rating === 'hard') {
    nextStage = Math.max(0, currentStage);
    const days = Math.max(1, Math.round(INTERVALS_DAYS[nextStage] * 0.7));
    nextAt = nowMs + days * DAY_MS;
  } else if (rating === 'good') {
    nextStage = clampStage(currentStage + 1);
    nextAt = nowMs + INTERVALS_DAYS[nextStage] * DAY_MS;
  } else {
    nextStage = clampStage(currentStage + 2);
    nextAt = nowMs + INTERVALS_DAYS[nextStage] * DAY_MS;
  }

  return {
    ...p,
    stage: nextStage,
    lastReviewedAt: nowMs,
    nextReviewAt: nextAt,
  };
}

/**
 * ✅ 给 storage.ts 用：从 interval 推断 stage（用于“新设备 stage 全是 0”的修复）
 * 说明：
 * - 只做近似推断
 * - interval 太小（<=0）返回 null
 */
export function inferStageFromIntervalMs(intervalMs: number): number | null {
  if (!Number.isFinite(intervalMs)) return null;
  if (intervalMs <= 0) return null;

  const days = intervalMs / DAY_MS;

  // 超短间隔（again 10min）也落到 stage 0
  if (days < 0.5) return 0;

  let bestIdx = 0;
  let bestDiff = Math.abs(INTERVALS_DAYS[0] - days);

  for (let i = 1; i < INTERVALS_DAYS.length; i++) {
    const diff = Math.abs(INTERVALS_DAYS[i] - days);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestIdx = i;
    }
  }

  return clampStage(bestIdx);
}

export function formatDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}