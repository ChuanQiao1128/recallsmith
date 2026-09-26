// mobile/src/navigation/types.ts
export type StudyMode = 'learn-new' | 'review-due' | 'mixed' | 'sweep';

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
        // One-shot notice surfaced as a toast on Home mount, then
        // cleared. Used by PermissionPrompt to acknowledge a deny.
        notice?: 'notifications-denied' | 'notifications-skipped';
      }
    | undefined;
  Settings: undefined;
  // highlightUids: the exact cards a caller wants lit up. scrollToNew is
  // the weaker request ("take me to the next unlearned card") kept for
  // callers that genuinely do not know a uid. A caller that knows must
  // pass uids: guessing from status is how a pull of card #37 used to
  // highlight card #1.
  Library: { focusSlug?: string; scrollToNew?: boolean; highlightUids?: string[] } | undefined;
  CardDetail: { cardId: string };
  More: undefined;
  Profile: undefined;
  HelpFAQ: undefined;
  DebugMenu: undefined;
  CeremonyTuning: undefined;
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
        /** D06 MCQ face mark. Absent on Q/A cards and under the kill switch; never any option text. */
        kind?: 'mcq';
        requiredCount?: number;
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
        /** D06 MCQ face mark. Absent on Q/A cards and under the kill switch; never any option text. */
        kind?: 'mcq';
        requiredCount?: number;
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
  ForgotPassword: { email?: string } | undefined;
};
