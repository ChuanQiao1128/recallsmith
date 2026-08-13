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
 *
 * The stage -> interval map is many-to-one, so this decode is lossy by
 * construction and `decode(encode(stage)) === stage` is simply false. Property
 * tests (tests/unit/scheduler.properties.test.ts) shrank out two witnesses
 * against the previous nearest-neighbour matcher:
 *   1. hard at stage 1 schedules round(2 * 0.7) = 1 day, and at stage 4 it
 *      schedules round(15 * 0.7) = 11 days, whose nearest bucket is 8 (stage 3).
 *      Every hard rating above stage 0 lands in a lower bucket than it came from.
 *   2. again always schedules 10 minutes while keeping the stage, so the
 *      interval says stage 0 no matter what the card had reached.
 * Both are real: this function is what rebuilds stage on a device that only
 * received nextReviewAt, so a wrong answer silently changes a user's schedule.
 *
 * Since the loss cannot be removed here, we fix its *direction*: match the
 * highest bucket whose interval is <= the observed one (floor, not nearest).
 * Nearest can round 12 days up to the 15-day bucket and overstate the stage,
 * which means the card comes back later than earned and the user forgets it.
 * Underestimating only costs an extra review. Errors we cannot avoid should at
 * least always fall on the recoverable side.
 *
 * Followup: the actual fix is to carry stage over the wire and persist it
 * server-side, so no device ever has to guess. This stays as the fallback for
 * rows written before that exists.
 */
export function inferStageFromIntervalMs(intervalMs: number): number | null {
  if (!Number.isFinite(intervalMs)) return null;
  if (intervalMs <= 0) return null;

  const days = intervalMs / DAY_MS;

  // 超短间隔（again 10min）也落到 stage 0
  if (days < 0.5) return 0;

  let bestIdx = 0;
  for (let i = 0; i < INTERVALS_DAYS.length; i++) {
    if (INTERVALS_DAYS[i] <= days) bestIdx = i;
  }

  return clampStage(bestIdx);
}

/** One recorded rating. `at` is ms epoch: the log carries its own clock. */
export interface ReviewEvent {
  stableUid: string;
  rating: ReviewRating;
  at: number;
}

/**
 * Replay a review log into the projection CardProgress.
 *
 * `scheduleNextReview` is already `(State, Event) -> State`, so the app has
 * been event sourced all along; this is just the fold that was never written
 * down. Events are sorted by `at` because arrival order (sync, offline queue
 * flush) is not authoring order, and sort() is stable so same-ms events keep
 * their recorded sequence.
 */
export function foldProgress(initial: CardProgress, events: ReviewEvent[]): CardProgress {
  return events
    .filter((e) => e.stableUid === initial.stableUid)
    .slice()
    .sort((a, b) => a.at - b.at)
    .reduce((p, e) => scheduleNextReview(p, e.rating, new Date(e.at)), initial);
}

export function formatDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}