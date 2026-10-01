import { completeOnboarding } from '../onboarding/onboardingPrefs';
import { ensureDeckBootstrap } from '../rewards/deckWallet';
import type { RewardWalletState } from '../rewards/rewardWallet';
import { markPermissionPromptPending } from './permissionPromptGate';
import { clearStarterLesson, isStarterLessonOpen } from './starterGate';

export type StarterLessonCompletion = {
  /** False when the lesson was already closed (a second call, or an existing user): nothing changed. */
  completed: boolean;
  /** Bootstrap pulls granted on the lesson's deck (DECK_BOOTSTRAP_GRANT the first time, else 0). */
  granted: number;
  wallet: RewardWalletState | null;
};

/**
 * Finishing the starter lesson (R22 §4), in this order:
 *  1. the onboarding stage goes to 'done' -- the owned gate stops unioning the lesson's cards (they stay
 *     studiable as learned cards) and ensureDeckBootstrap stops refusing;
 *  2. the existing first-visit bootstrap (3 pulls) is granted on the lesson's deck -- the first pack is
 *     the reward. The lesson's cards were never written into drawState.owned, so the pack still reads
 *     as never drawn and the bootstrap pays exactly as it did for a new learner before R22;
 *  3. the notification prompt is armed; it shows after the first DrawResult "Done".
 * The stage moves first so a crash after it under-grants nothing: the next Home load bootstraps the
 * never-drawn pack on its own (prepareHomeDeckWallets). Never throws.
 */
export async function completeStarterLesson(slug: string): Promise<StarterLessonCompletion> {
  if (!(await isStarterLessonOpen())) return { completed: false, granted: 0, wallet: null };
  try {
    await completeOnboarding();
  } catch {
    return { completed: false, granted: 0, wallet: null };
  }
  await clearStarterLesson();
  const { granted, wallet } = await ensureDeckBootstrap(slug);
  await markPermissionPromptPending();
  return { completed: true, granted, wallet };
}
