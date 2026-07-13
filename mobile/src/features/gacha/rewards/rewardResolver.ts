import type { AppliedRewardWalletState, RewardWalletState } from './rewardWallet';
import { applyRewardToWallet, getRewardWalletMessage } from './rewardWallet';

export type ResolvedSessionReward = {
  rewardPulls: number;
  completedMinimumGoal: boolean;
  completedFullRun: boolean;
  walletAfter: AppliedRewardWalletState;
  rewardMessage: string;
};

// Reward formula calibrated for the v3 5-card session cap:
//   • Full clear (sessionDone >= sessionLimit) → +1 pull
//   • Below full clear → 0 pulls
// Was: full=+2, min=+1. The 5-card cap means every session is short
// enough that "finish the run" is the right unit of reward — partial
// credit dilutes the incentive. Streak preservation lives in a
// separate path (sessionStore.streakEarned via minimumGoal).
export function computeSessionRewardPulls(params: {
  sessionDone: number;
  sessionLimit: number;
  minimumGoal: number;
}): number {
  const sessionDone = Math.max(0, Math.floor(params.sessionDone));
  const sessionLimit = Math.max(0, Math.floor(params.sessionLimit));

  if (sessionLimit > 0 && sessionDone >= sessionLimit) return 1;
  return 0;
}

export function resolveSessionReward(params: {
  sessionDone: number;
  sessionLimit: number;
  minimumGoal: number;
  wallet: RewardWalletState;
}): ResolvedSessionReward {
  const { sessionDone, sessionLimit, minimumGoal, wallet } = params;
  const safeSessionDone = Math.max(0, Math.floor(sessionDone));
  const safeSessionLimit = Math.max(0, Math.floor(sessionLimit));
  const safeMinimumGoal = Math.max(1, Math.floor(minimumGoal));
  const completedMinimumGoal = safeSessionDone >= safeMinimumGoal;
  const completedFullRun = safeSessionLimit > 0 && safeSessionDone >= safeSessionLimit;
  const rewardPulls = computeSessionRewardPulls({ sessionDone, sessionLimit, minimumGoal });

  const walletAfter = applyRewardToWallet(wallet, rewardPulls);
  const rewardMessage =
    rewardPulls > 0
      ? `+${rewardPulls} free pull${rewardPulls === 1 ? '' : 's'} · ${getRewardWalletMessage(walletAfter)}`
      : `Progress saved · ${getRewardWalletMessage(walletAfter)}`;

  return {
    rewardPulls,
    completedMinimumGoal,
    completedFullRun,
    walletAfter,
    rewardMessage,
  };
}
