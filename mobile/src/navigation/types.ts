// mobile/src/navigation/types.ts
export type StudyMode = 'learn-new' | 'review-due' | 'mixed' | 'sweep';

import type { MockHomeState } from '../mock/types';
import type { RewardOutcome } from '../features/gacha/rewards/rewardResolver';

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
        // One-shot notice surfaced as a toast on Home mount, then
        // cleared. Used by PermissionPrompt to acknowledge a deny.
        notice?: 'notifications-denied' | 'notifications-skipped';
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
  // highlightUids: the exact cards a caller wants lit up. scrollToNew is
  // the weaker request ("take me to the next unlearned card") kept for
  // callers that genuinely do not know a uid. A caller that knows must
  // pass uids: guessing from status is how a pull of card #37 used to
  // highlight card #1.
  Library: { focusSlug?: string; scrollToNew?: boolean; highlightUids?: string[] } | undefined;
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
  About: undefined;
  HelpFAQ: undefined;
  ErrorNetwork: undefined;
  ErrorGeneric: undefined;
  ToastHost: undefined;
  CoachOverlay: undefined;
  OfflineBanner: undefined;
  DebugMenu: undefined;
  CeremonyTuning: undefined;
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
        tag?: string;
        /** 1-based deck position (cardRank.ts). Optional: older callers and fixtures omit it. */
        rank?: number;
      }>;
      pityBefore: number;
      pityAfter: number;
      pityTriggered: boolean;
      highlightedRarity: 'RAR' | 'LEG' | null;
      seedLabel?: string;
    };
    deckTitle?: string;
    ownedAfter?: number;
    totalCards?: number;
    /** Test hook (design §3.3): forces tap-to-flip on/off; undefined → motionAvailable && cards.length > 0. */
    tapFlow?: boolean;
    pityThreshold?: number;
    /** Slot whose card the guarantee paid out on, null when it did not fire this pull. */
    pityCardIndex?: number | null;
    poolExhausted?: boolean;
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
        tag?: string;
        /** 1-based deck position (cardRank.ts). Optional: older callers and fixtures omit it. */
        rank?: number;
      }>;
      pityBefore: number;
      pityAfter: number;
      pityTriggered: boolean;
      highlightedRarity: 'RAR' | 'LEG' | null;
      seedLabel?: string;
    };
    deckTitle?: string;
    /** stableUids the player flipped on the table; absent = no reveal information (pre-table exits). */
    revealedUids?: string[];
    ceremonyEcho?: {
      rarity: 'COM' | 'RAR' | 'LEG';
      phaseCue: string;
      tableReached?: boolean;
    } | null;
    ownedAfter?: number;
    totalCards?: number;
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

  // No `Review` entry. ReviewScreen was a second, unreachable copy of
  // SessionCardScreen (no navigate('Review') anywhere, and the Review tab
  // routes to 'SessionCard'); it was deleted with issue #11. The param
  // list is removed with it on purpose -- leaving the route typed keeps
  // navigate('Review', ...) compiling against a screen that would not
  // mount, which is a worse failure than not compiling.

  // Slug / mode / limit are now optional — SessionCard falls back to
  // activeDeckSlug + sane defaults (mixed mode, limit 20). Lets the
  // Home daily-study path navigate with just `{ slug }` (or even
  // nothing) instead of needing to pre-plan the route.
  SessionCard: {
    slug?: string;
    mode?: StudyMode;
    limit?: number;
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
    reward?: RewardOutcome;
    /** R7 forecast line when the run ended on a milestone rating (SessionCardScreen would otherwise
     *  lose it to the replace). Rendered under the reward card, testID `session-summary-load-forecast`. */
    loadForecast?: string;
    /** D05: per-run MCQ pick tally, spread only when the run answered at least one MCQ card. */
    picks?: { landed: number; answered: number };
  };

  SignIn: { email?: string } | undefined;
  SignUp: undefined;
  ConfirmSignUp: { email: string };
};
