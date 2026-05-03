export type RouteNodeRole = 'warmup' | 'normal' | 'elite' | 'boss';

export type CalendarDay = {
  dateKey: string;
  count: number;
};

export type DeckSummary = {
  slug: string;
  title: string;
  locale: string;
  version: string;
  deckType: number;
  totalCards: number;
  localCards: number;
  studyCards: number;
  canStudy: boolean;
  tier?: string | null;
  availability?: string | null;
  eta?: string | null;
  downloadMode?: string | null;
  order?: number;
  dueToday: number;
  plannedToday: number;
  newToday: number;
  masteredApprox: number;
  percent: number;
};

export type TodayCounts = {
  totalDueAllDecks: number;
  selectedDue: number;
  selectedNew: number;
  selectedMastered: number;
  normalCount: number;
  eliteCount: number;
  bossCount: number;
};

export type RoutePreviewNode = {
  id: string;
  role: RouteNodeRole;
  title: string;
  subtitle: string;
};

export type HomeHeroVM = {
  eyebrow: string;
  title: string;
  subtitle: string;
  helper: string;
  ctaLabel: string;
  ctaAction: 'challenge' | 'deck' | 'none';
  ctaDisabled: boolean;
};

export type HomeVM = {
  hero: HomeHeroVM;
  counts: TodayCounts;
  routePreview: RoutePreviewNode[];
  selectedDeckTitle: string | null;
  drawStatusLabel: string;
};

export type ChallengeRoute = {
  slug: string;
  deckTitle: string;
  mode: 'mixed' | 'review-due' | 'learn-new';
  limit: number;
  minimumGoal: number;
  dueCount: number;
  newCount: number;
  nodes: RoutePreviewNode[];
  summary: string;
};

export type LibraryStatusCounts = {
  newCount: number;
  learningCount: number;
  masteredCount: number;
  dueTodayCount: number;
  updatedCount: number;
};

export type LibraryVM = {
  title: string;
  subtitle: string;
  drawStatusLabel: string;
  counts: LibraryStatusCounts;
};
