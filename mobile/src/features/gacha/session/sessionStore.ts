import { create } from 'zustand';
import type { ReviewRating } from '../../../review/model';
import type { RoutePreviewNode } from '../contracts';

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
  startSession: (params: {
    sessionId: string;
    slug: string;
    route: RoutePreviewNode[];
    startedAt: number;
  }) => void;
  recordRating: (record: SessionRatingRecord) => void;
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
    }),
  recordRating: (record) =>
    set((state) => ({
      sessionRatings: [...state.sessionRatings, record],
      streakEarned: state.streakEarned || record.rating === 'hard' || record.rating === 'good' || record.rating === 'easy',
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
