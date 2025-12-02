// mobile/src/review/model.ts

export type ReviewRating = 'again' | 'good' | 'easy';

/**
 * 单张卡片的复习进度。
 * 我们不保存整张卡的内容，只保存和记忆相关的信息。
 */
export interface CardProgress {
  stableUid: string;   // 对应导出中的 StableUid
  stageIndex: number;  // 间隔阶段索引：0 ~ INTERVALS_DAYS.length-1
  nextReviewAt: string; // ISO 字符串
}

/**
 * 简单间隔数组（单位：天）
 * index = 0 -> 今天
 * index = 1 -> 1 天后
 * index = 2 -> 3 天后
 * ...
 */
export const INTERVALS_DAYS: number[] = [0, 1, 3, 7, 14, 30];

/**
 * 工具函数：往某个日期加 days 天。
 */
export function addDays(base: Date, days: number): Date {
  const d = new Date(base.getTime());
  d.setDate(d.getDate() + days);
  return d;
}

/**
 * 计算下一次复习时间。
 * 这里实现：
 *  - again  => 阶段重置为 0
 *  - good   => 阶段 +1
 *  - easy   => 阶段 +2
 * 都不超过 INTERVALS_DAYS 的最大索引。
 */
export function scheduleNextReview(
  progress: CardProgress,
  rating: ReviewRating,
  now: Date,
): CardProgress {
  let nextStage = progress.stageIndex;

  if (rating === 'again') {
    nextStage = 0;
  } else if (rating === 'good') {
    nextStage = nextStage + 1;
  } else {
    // easy
    nextStage = nextStage + 2;
  }

  if (nextStage >= INTERVALS_DAYS.length) {
    nextStage = INTERVALS_DAYS.length - 1;
  }

  const days = INTERVALS_DAYS[nextStage];
  const nextDate = addDays(now, days);

  return {
    ...progress,
    stageIndex: nextStage,
    nextReviewAt: nextDate.toISOString(),
  };
}

/**
 * 工具函数：判断是否到期（需要今天复习）。
 */
export function isDue(progress: CardProgress, now: Date): boolean {
  const next = new Date(progress.nextReviewAt);
  return next.getTime() <= now.getTime();
}

/**
 * 工具函数：把 Date 转成 yyyy-MM-dd，方便做日历分组。
 */
export function formatDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}