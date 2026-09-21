import { create } from 'zustand';
import type { ReviewRating } from '../../../review/model';
import type { RoutePreviewNode } from '../contracts';
import { accumulateRewardOutcome, EMPTY_REWARD_OUTCOME, type RewardOutcome } from '../rewards/rewardResolver';
import type { RatingRewardStep } from '../rewards/sessionRewards';

type SessionRatingRecord = {
  stableUid: string;
  rating: ReviewRating;
};

type SessionStoreState = {
  sessionId: string | null;
  slug: string | null;
  route: RoutePreviewNode[];
  currentIndex: number;
  completedCount: number;
  streakEarned: boolean;
  sessionRatings: SessionRatingRecord[];
  startedAt: number | null;
  rewardOutcome: RewardOutcome;                                   // EMPTY_REWARD_OUTCOME in emptyState; reset by startSession and resetSession
  startSession: (params: {
    sessionId: string;
    slug: string;
    route: RoutePreviewNode[];
    startedAt: number;
  }) => void;
  recordRating: (record: SessionRatingRecord) => void;
  recordRewardStep: (step: RatingRewardStep, stableUid: string) => void;   // rewardOutcome = accumulateRewardOutcome(prev, step, stableUid)
  advanceSession: () => void;
  resetSession: () => void;
};

const emptyState = {
  sessionId: null,
  slug: null,
  route: [] as RoutePreviewNode[],
  currentIndex: 0,
  completedCount: 0,
  streakEarned: false,
  sessionRatings: [] as SessionRatingRecord[],
  startedAt: null as number | null,
  rewardOutcome: EMPTY_REWARD_OUTCOME,
};

export const useSessionStore = create<SessionStoreState>((set) => ({
  ...emptyState,
  startSession: ({ sessionId, slug, route, startedAt }) =>
    set({
      sessionId,
      slug,
      route,
      startedAt,
      currentIndex: 0,
      completedCount: 0,
      streakEarned: false,
      sessionRatings: [],
      rewardOutcome: EMPTY_REWARD_OUTCOME,
    }),
  recordRating: (record) =>
    set((state) => ({
      sessionRatings: [...state.sessionRatings, record],
      streakEarned: state.streakEarned || record.rating === 'hard' || record.rating === 'good' || record.rating === 'easy',
    })),
  recordRewardStep: (step, stableUid) =>
    set((state) => ({
      rewardOutcome: accumulateRewardOutcome(state.rewardOutcome, step, stableUid),
    })),
  advanceSession: () =>
    set((state) => ({
      currentIndex: state.currentIndex + 1,
      completedCount: state.completedCount + 1,
    })),
  resetSession: () => set(emptyState),
}));

export function resetSessionStore() {
  useSessionStore.getState().resetSession();
}
