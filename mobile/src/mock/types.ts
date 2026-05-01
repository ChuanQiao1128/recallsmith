export type MockHomeState = 'new-user' | 'active' | 'clear-day' | 'reward-ready' | 'backlog' | 'dormant' | 'churned' | 'paused';

export type MockDailyDoseCard = {
  stableUid: string;
  question: string;
  difficulty: number;
  role: 'warmup' | 'normal' | 'elite' | 'boss';
};

export type MockPoolOverview = {
  id: string;
  title: string;
  ownedCount: number;
  dueToday: number;
  masteredCount: number;
  streakLabel: string;
};
