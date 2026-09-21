import type { CardExport } from '../../../types/deckExport';
import type { CardProgress, ReviewRating } from '../../../review/model';
import { scheduleNextReview } from '../../../review/model';
import { countDueToday, pickNextCard } from '../planner/sessionPlanner';
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
  mode: string;
  currentRoleLabel?: string | null;
}): SessionProgressVM {
  const { sessionDone, sessionLimit, dueTodayCount, mode, currentRoleLabel = null } = params;
  const percent = sessionLimit > 0 ? Math.min(sessionDone / sessionLimit, 1) : 0;

  return {
    title: 'Session progress',
    subtitle: `Run ${sessionDone}/${sessionLimit || '∞'} · ${modeLabel(mode)}`,
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
}): {
  updatedProgress: CardProgress[];
  updatedOne: CardProgress;
  nextDone: number;
  nextCurrent: CurrentCardLike | null;
  prevLearnedCount: number;
  remainingDueCount: number;
} {
  const { current, progress, rating, mode, sessionDone, sessionLimit, now, cardIndex, ownedSet = null, kindHint = null } = params;

  const updatedOne: CardProgress = {
    ...scheduleNextReview(current.progress, rating, now),
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
