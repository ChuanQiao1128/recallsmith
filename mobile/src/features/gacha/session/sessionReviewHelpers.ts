import type { CardExport } from '../../../types/deckExport';
import type { CardProgress, ReviewRating } from '../../../review/model';
import { scheduleWithFsrs } from '../../../review/fsrsScheduler';
import { countDueToday, pickNextCard } from '../planner/sessionPlanner';
import { scheduleFocusReview } from '../mistakes/focusSession';
import { capNextReviewToExam } from '../../goal/studyGoal';
import type { OwnedGate } from '../contracts';
import type { McqKindHint } from '../mcq/mcqRotation';

export type CurrentCardLike = {
  card: CardExport;
  progress: CardProgress;
};

export type SessionProgressVM = {
  title: string;
  subtitle: string;
  progressText: string;
  hint: string;
  percent: number;
  currentRoleLabel?: string | null;
};

export function modeLabel(mode: string) {
  if (mode === 'review-due') return 'Review Due';
  if (mode === 'learn-new') return 'Learn';
  if (mode === 'sweep') return 'Review all';
  return 'Mixed';
}

export function buildSessionProgressVM(params: {
  sessionDone: number;
  sessionLimit: number;
  dueTodayCount: number;
  /** Kept for callers; the subtitle no longer names the mode (R22 §5). */
  mode: string;
  currentRoleLabel?: string | null;
}): SessionProgressVM {
  const { sessionDone, sessionLimit, dueTodayCount, currentRoleLabel = null } = params;
  const percent = sessionLimit > 0 ? Math.min(sessionDone / sessionLimit, 1) : 0;
  // R22 §5: the card on screen, 1-based, never past the last one; no mode label.
  const cardNumber = sessionLimit > 0 ? Math.min(sessionDone + 1, sessionLimit) : sessionDone + 1;

  return {
    title: 'Session progress',
    subtitle: sessionLimit > 0 ? `Card ${cardNumber} of ${sessionLimit}` : `Card ${cardNumber}`,
    progressText: `${sessionDone} / ${sessionLimit || '∞'}`,
    hint: `${dueTodayCount} card${dueTodayCount === 1 ? '' : 's'} still count as due in this deck today.`,
    percent,
    currentRoleLabel,
  };
}

export function buildRatedSessionState(params: {
  current: CurrentCardLike;
  progress: CardProgress[];
  rating: ReviewRating;
  mode: 'review-due' | 'learn-new' | 'mixed' | 'sweep';
  sessionDone: number;
  sessionLimit: number;
  now: Date;
  cardIndex: { cards: CardExport[]; cardMap: Map<string, CardExport> } | null;
  ownedSet?: OwnedGate;
  kindHint?: McqKindHint | null;
  /** A Mistake Book focus run: a card that is not due gets no scheduler credit (scheduleFocusReview). */
  focusRun?: boolean;
  /** Cards studied this session (R22 §6): their recall check is dealt by the screen, never by the planner. */
  excludeUids?: ReadonlySet<string> | null;
  /** The study goal's exam date (R22 §7): no review is scheduled after the start of the day before it. */
  examDate?: string | null;
  /** The recall check of a card studied this session (R22 §6): a pass is scheduled as FSRS initState(hard), due tomorrow. */
  learningCheck?: boolean;
}): {
  updatedProgress: CardProgress[];
  updatedOne: CardProgress;
  nextDone: number;
  nextCurrent: CurrentCardLike | null;
  prevLearnedCount: number;
  remainingDueCount: number;
} {
  const { current, progress, rating, mode, sessionDone, sessionLimit, now, cardIndex, ownedSet = null, kindHint = null, focusRun = false, excludeUids = null, examDate = null, learningCheck = false } = params;

  // R24 §4.3: FSRS behind features.fsrs.enabled (scheduleWithFsrs falls back to the ladder when it is off).
  // Only a passed check is the learning-check schedule; a Forgot keeps the 10 minute relearn step.
  const scheduled = focusRun
    ? scheduleFocusReview(current.progress, rating, now)
    : scheduleWithFsrs(current.progress, rating, now.getTime(), { learningCheck: learningCheck && rating !== 'again' });
  const updatedOne: CardProgress = {
    ...capNextReviewToExam(scheduled, examDate, now.getTime()),
    lastSeenRevision: typeof current.card.Revision === 'number' && current.card.Revision > 0 ? current.card.Revision : 1,
  };

  const prevLearnedCount = progress.filter((item) => typeof item.lastReviewedAt === 'number' && item.lastReviewedAt > 0).length;
  const updatedProgress = progress.map((item) => (item.stableUid === updatedOne.stableUid ? updatedOne : item));
  const nextDone = sessionDone + 1;
  const remaining = sessionLimit > 0 ? Math.max(sessionLimit - nextDone, 0) : Infinity;
  // Both pass-throughs take the same gate. The card just rated stays in
  // updatedProgress either way: rating a card never changes whether you own it,
  // and the full array is what the caller saves back.
  const nextCurrent =
    remaining > 0
      ? pickNextCard({
          progress: updatedProgress,
          now: new Date(now.getTime()),
          mode,
          avoidUid: updatedOne.stableUid,
          index: cardIndex,
          ownedSet,
          kindHint,
          excludeUids,
        })
      : null;
  const remainingDueCount = countDueToday(updatedProgress, new Date(now.getTime()), ownedSet);

  return {
    updatedProgress,
    updatedOne,
    nextDone,
    nextCurrent,
    prevLearnedCount,
    remainingDueCount,
  };
}
