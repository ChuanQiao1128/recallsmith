// mobile/src/review/fsrsScheduler.ts
//
// FSRS scheduling for one rating (contract R24-00 §4.2). The memory model is
// fsrs.ts; this adapter decides which memory state a progress row stands for,
// keeps the 10 minute relearn step for `again`, and keeps the ladder fields
// (stage, lapses, hardStreak) that old clients, the server and mastery still
// read. Behind the features.fsrs.enabled kill switch: off means
// scheduleNextReview, exactly as before FSRS.

import { isFsrsEnabled } from '../config/featureFlags';
import { initState, nextState, type FsrsGrade, type FsrsMemoryState, type FsrsState } from './fsrs';
import {
  MAX_NEXT_REVIEW_HORIZON_MS,
  clampStage,
  inferStageFromIntervalMs,
  scheduleNextReview,
  type CardProgress,
  type ReviewRating,
} from './model';

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const AGAIN_RELEARN_MS = 10 * MINUTE_MS;

/** Same ladder as model.ts INTERVALS_DAYS; used only to derive a stability for a pre-FSRS row. */
const LADDER_DAYS = [1, 2, 4, 8, 15, 30, 60];

/** Same threshold as model.ts HARD_STREAK_TO_DEMOTE: the counter resets on the third hard. */
const HARD_STREAK_TO_DEMOTE = 3;

const GRADE: Record<ReviewRating, FsrsGrade> = { again: 1, hard: 2, good: 3, easy: 4 };

export interface ScheduleWithFsrsOptions {
  /** R22 §6 learning check: state from initState(hard), due tomorrow. */
  learningCheck?: boolean;
}

function finite(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function count(v: unknown): number {
  return finite(v) ? Math.max(0, Math.floor(v)) : 0;
}

function hasReview(p: CardProgress): p is CardProgress & { lastReviewedAt: number } {
  return finite(p.lastReviewedAt) && p.lastReviewedAt > 0;
}

/**
 * The memory state this row stands for. The stored state is trusted only while
 * its anchor equals lastReviewedAt; otherwise someone else (another device, or
 * the ladder with the flag off) reviewed the card since, and the state is
 * rebuilt from what every client writes: the scheduled interval and the
 * failure counters.
 */
function currentMemoryState(p: CardProgress & { lastReviewedAt: number }): FsrsMemoryState {
  if (
    finite(p.fsrsStability)
    && p.fsrsStability > 0
    && finite(p.fsrsDifficulty)
    && p.fsrsAnchorAt === p.lastReviewedAt
  ) {
    return { stability: p.fsrsStability, difficulty: Math.min(10, Math.max(1, p.fsrsDifficulty)) };
  }

  const stability =
    finite(p.nextReviewAt) && p.nextReviewAt > 0
      ? Math.max(0.5, (p.nextReviewAt - p.lastReviewedAt) / DAY_MS)
      : LADDER_DAYS[clampStage(p.stage ?? 0)];
  const difficulty = Math.min(10, Math.max(1, 5 + 0.5 * count(p.lapses) + 0.3 * count(p.hardStreak)));
  return { stability, difficulty };
}

/**
 * Schedule the next review of `progress` after `rating` at `nowMs`.
 *
 * nextReviewAt: again -> now + 10 minutes; learning check -> now + 1 day;
 * otherwise now + the FSRS interval, never beyond MAX_NEXT_REVIEW_HORIZON_MS.
 * stage is the largest ladder rung not above that interval (again: two rungs
 * down, as the ladder does), lapses and hardStreak move exactly as in
 * scheduleNextReview, and revisionDemotedAt is cleared because a real review
 * is what the demotion was waiting for.
 */
export function scheduleWithFsrs(
  progress: CardProgress,
  rating: ReviewRating,
  nowMs: number,
  opts?: ScheduleWithFsrsOptions,
): CardProgress {
  if (!isFsrsEnabled()) return scheduleNextReview(progress, rating, new Date(nowMs));

  const learningCheck = opts?.learningCheck === true;
  const grade = GRADE[rating];

  let state: FsrsState;
  if (learningCheck) {
    state = initState(GRADE.hard);
  } else if (hasReview(progress)) {
    const elapsedDays = Math.max(0, (nowMs - progress.lastReviewedAt) / DAY_MS);
    state = nextState(currentMemoryState(progress), grade, elapsedDays);
  } else {
    state = initState(grade);
  }

  const currentStage = clampStage(progress.stage ?? 0);
  const currentLapses = count(progress.lapses);
  const currentHardStreak = count(progress.hardStreak);

  let nextAt: number;
  let nextStage: number;
  if (rating === 'again' && !learningCheck) {
    nextAt = nowMs + AGAIN_RELEARN_MS;
    nextStage = Math.max(0, currentStage - 2);
  } else {
    const days = learningCheck ? 1 : state.days;
    nextAt = nowMs + days * DAY_MS;
    nextStage = clampStage(inferStageFromIntervalMs(days * DAY_MS) ?? 0);
  }
  nextAt = Math.min(nextAt, nowMs + MAX_NEXT_REVIEW_HORIZON_MS);

  let nextLapses = currentLapses;
  let nextHardStreak = 0;
  if (rating === 'again') {
    nextLapses = currentLapses + 1;
  } else if (rating === 'hard') {
    const streak = currentHardStreak + 1;
    nextHardStreak = streak >= HARD_STREAK_TO_DEMOTE ? 0 : streak;
  }

  return {
    ...progress,
    stage: nextStage,
    lastReviewedAt: nowMs,
    nextReviewAt: nextAt,
    lapses: nextLapses,
    hardStreak: nextHardStreak,
    revisionDemotedAt: undefined,
    fsrsStability: state.stability,
    fsrsDifficulty: state.difficulty,
    fsrsAnchorAt: nowMs,
  };
}
