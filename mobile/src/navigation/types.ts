// mobile/src/navigation/types.ts
export type StudyMode = 'learn-new' | 'review-due' | 'mixed';

import type { MockHomeState } from '../mock/types';

export type RootStackParamList = {
  Splash: undefined;
  Welcome: undefined;
  AudienceSurvey: undefined;
  PermissionPrompt: undefined;

  Paywall: undefined;

  Home:
    | {
        firstDrawCoach?: boolean;
        mockState?: MockHomeState;
      }
    | undefined;
  Settings: undefined;
  DailyDose: { slug?: string } | undefined;
  WeekSummary: undefined;
  MonthSummary: undefined;
  PoolLaunch: undefined;
  PoolPicker: { activePoolId?: string } | undefined;
  FreshStartLanding: undefined;
  PausedPool: undefined;
  Library: undefined;
  SortFilter: undefined;
  CardDetail: { cardId: string };
  PoolOverview: { poolId: string };
  TagExplorer: { poolId: string };
  AudienceFilter: undefined;
  PlanOverview: undefined;
  PlanToday: undefined;
  PlanWeek: undefined;
  PlanMonth: undefined;
  MilestoneHall: undefined;
  MilestoneDetail: { milestoneId: string };
  StreakMilestone: { days: 7 | 30 | 100 };
  WeekStreakMilestone: { weeks: number };
  FreePullGrant: { count: number; source: 'streak' | 'milestone' | 'daily' };
  FreePullInventory: undefined;
  DailyDigest: { fromPush: boolean };
  WeekPlannerPrompt: undefined;
  MonthRewind: undefined;
  BacklogWarning: undefined;
  BacklogBurst: undefined;
  FreshStartConfirm: undefined;
  DormantNudge: undefined;
  More: undefined;
  Profile: undefined;
  EditProfile: undefined;
  Achievements: undefined;
  SettingsMain: undefined;
  SettingsAudience: undefined;
  SettingsNotifications: undefined;
  SettingsPools: undefined;
  SettingsAppearance: undefined;
  SettingsAccount: undefined;
  DeleteAccountConfirm: undefined;
  About: undefined;
  HelpFAQ: undefined;
  ErrorNetwork: undefined;
  ErrorGeneric: undefined;
  ToastHost: undefined;
  CoachOverlay: undefined;
  OfflineBanner: undefined;
  DebugMenu: undefined;
  Level: {
    slug: string;
    source: 'daily-dose' | 'draw';
    cardIds?: string[];
  };
  DrawCeremony: {
    slug: string;
    drawResult?: {
      poolId: string;
      cards: Array<{
        stableUid: string;
        question: string;
        difficulty: number;
        rarity: 'COM' | 'RAR' | 'LEG';
      }>;
      pityBefore: number;
      pityAfter: number;
      pityTriggered: boolean;
      highlightedRarity: 'RAR' | 'LEG' | null;
      seedLabel?: string;
    };
  };
  DrawResult: {
    slug: string;
    drawResult?: {
      poolId: string;
      cards: Array<{
        stableUid: string;
        question: string;
        difficulty: number;
        rarity: 'COM' | 'RAR' | 'LEG';
      }>;
      pityBefore: number;
      pityAfter: number;
      pityTriggered: boolean;
      highlightedRarity: 'RAR' | 'LEG' | null;
      seedLabel?: string;
    };
  };
  Settlement: {
    slug: string;
    deckTitle: string;
    sessionDone: number;
    rewardPulls?: number;
    masteredCount?: number;
  };
  MasteredCelebration: {
    slug: string;
    deckTitle: string;
    masteredCount: number;
  };
  CollectionMilestone: {
    poolId: string;
    tier: 'bronze' | 'silver' | 'gold' | 'complete';
  };
  MasteryMilestone: {
    poolId: string;
    tier: 'junior' | 'journey' | 'senior' | 'diamond';
  };

  Challenge: { slug?: string } | undefined;

  Deck: { slug?: string } | undefined;

  Review: {
    slug: string;
    mode: StudyMode;
    limit: number;
    previewLimit?: number;
  };

  SessionCard: {
    slug: string;
    mode: StudyMode;
    limit: number;
    previewLimit?: number;
    completionRoute?: 'summary' | 'settlement';
  };

  Draw: {
    slug?: string;
    rewardPending?: boolean;
  } | undefined;

  SessionSummary: {
    sessionId?: string;
    slug: string;
    deckTitle: string;
    sessionDone: number;
    sessionLimit: number;
    minimumGoal: number;
    dueCount: number;
    streakEarned?: boolean;
  };

  SignIn: { email?: string } | undefined;
  SignUp: undefined;
  ConfirmSignUp: { email: string };
};