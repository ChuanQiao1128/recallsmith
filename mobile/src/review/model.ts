// mobile/src/review/model.ts
export type ReviewRating = 'again' | 'hard' | 'good' | 'easy';

export interface CardProgress {
  stableUid: string;
  stage: number; // interval bucket
  lastReviewedAt?: number; // ms epoch; absent => never learned
  nextReviewAt: number; // ms epoch; 0 => unscheduled/unlearned

  // Phase 0: user confirmed content revision
  lastSeenRevision?: number;

  /** How many times this card has been failed outright. Never decreases. */
  lapses?: number;

  /** Consecutive `hard` ratings since the last non-hard answer. */
  hardStreak?: number;

  /**
   * When a deck revision last pulled this card back to due.
   *
   * Written by the revision check in storage.ts, not by the scheduler, and read
   * by the sync merge so a remote row carrying the old future due date cannot
   * undo the demotion. Absent means no pending revision demotion.
   */
  revisionDemotedAt?: number;
}

/**
 * How many consecutive `hard` answers demote a card one rung.
 *
 * Same threshold as levelFlow.ts:63, which has computed a per-card hard streak
 * since the session UI was written but never let it reach the scheduler.
 */
const HARD_STREAK_TO_DEMOTE = 3;

const DAY_MS = 24 * 60 * 60 * 1000;
const INTERVALS_DAYS = [1, 2, 4, 8, 15, 30, 60];

/**
 * The furthest ahead any review may schedule the next one.
 *
 * Deliberately far above the top rung of INTERVALS_DAYS (60 days) instead of
 * equal to it: this bound describes a physically impossible due date, not the
 * current ladder's range, so it keeps working when the ladder is retuned. Its
 * job is to catch a broken clock or a unit mix-up, never a legitimate schedule.
 *
 * Same constant as MaxNextReviewHorizonMs in
 * src_C/Vpc/Runtime/ProgressEvents.cs, where the ingest clamps it, and as the
 * 90 days repaired once by migration 015. The client clamps it again on the way
 * in (mergeRemoteIntoLocalProgress) because a device may be talking to a server
 * that has not shipped the clamp yet, and a card past this horizon is gone for
 * good: it is never due, so no later review can ever correct it.
 */
export const MAX_NEXT_REVIEW_HORIZON_MS = 90 * DAY_MS;

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

/**
 * The ladder has negative feedback: `again` and a sustained `hard` streak move
 * a card DOWN.
 *
 * It used to be a ratchet (both failure ratings did `Math.max(0, currentStage)`,
 * which is the current stage), so the interval a card had earned survived any
 * number of failures: a card at stage 6 answered `hard` forever came back every
 * 42 days. That inverts the whole point of spaced repetition, because the cards
 * the user knows least well end up with the LOWEST review frequency.
 *
 * `again` drops two rungs instead of resetting to 0 because one slip on a
 * well-known card is not the same evidence as never having learned it, and
 * stages 0-2 saturate at 0 anyway, so a genuinely unknown card still ends up at
 * the bottom after two failures.
 */
export function scheduleNextReview(p: CardProgress, rating: ReviewRating, now: Date): CardProgress {
  const nowMs = now.getTime();

  const currentStage = clampStage(p.stage ?? 0);
  const currentLapses = Math.max(0, Math.floor(normalizeCount(p.lapses)));
  const currentHardStreak = Math.max(0, Math.floor(normalizeCount(p.hardStreak)));

  let nextStage = currentStage;
  let nextAt = nowMs + DAY_MS;
  let nextLapses = currentLapses;
  // Any answer other than `hard` ends the streak: the counter measures a run of
  // struggling, not a lifetime total, which lapses already is.
  let nextHardStreak = 0;

  if (rating === 'again') {
    nextStage = Math.max(0, currentStage - 2);
    nextLapses = currentLapses + 1;
    nextAt = nowMs + 10 * 60 * 1000; // 10 min
  } else if (rating === 'hard') {
    const streak = currentHardStreak + 1;
    if (streak >= HARD_STREAK_TO_DEMOTE) {
      // Demote once, then start counting again, so a long run of `hard` steps
      // down one rung every three answers rather than collapsing at once.
      nextStage = Math.max(0, currentStage - 1);
      nextHardStreak = 0;
    } else {
      nextStage = currentStage;
      nextHardStreak = streak;
    }
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
    lapses: nextLapses,
    hardStreak: nextHardStreak,
    // A real review is exactly what the revision demotion was holding the
    // schedule open for, so clearing it here (rather than in the storage or
    // sync layers) is the smallest place that cannot be forgotten: every rating
    // in the app goes through this function. While the mark is set, the sync
    // merge refuses remote due dates produced before the content changed; once
    // the user has actually seen the new content, that protection has done its
    // job and must stop, or the card would stay pinned to due forever.
    revisionDemotedAt: undefined,
  };
}

/** Persisted counters can arrive as anything JSON can hold. */
function normalizeCount(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
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
 * Scope, as of migration 013: this is now the FALLBACK, not the mechanism.
 * stage is carried over the wire (progressAfter.stage) and persisted in
 * user_progress.srs_stage, and a pull that brings back a non-null srsStage
 * adopts it directly, so no device has to guess. What still reaches this
 * function is rows merged before the server stored stage, where srsStage comes
 * back null: for those the lossy floor above is all the information there is,
 * which is why it keeps erring downward.
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