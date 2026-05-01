import type { AppliedRewardWalletState, RewardWalletState } from './rewardWallet';
import { applyRewardToWallet, getRewardWalletMessage } from './rewardWallet';

export type ResolvedSessionReward = {
  rewardPulls: number;
  completedMinimumGoal: boolean;
  completedFullRun: boolean;
  walletAfter: AppliedRewardWalletState;
  rewardMessage: string;
};

export function resolveSessionReward(params: {
  sessionDone: number;
  sessionLimit: number;
  minimumGoal: number;
  wallet: RewardWalletState;
}): ResolvedSessionReward {
  const { sessionDone, sessionLimit, minimumGoal, wallet } = params;
  const completedMinimumGoal = sessionDone >= minimumGoal;
  const completedFullRun = sessionLimit > 0 && sessionDone >= sessionLimit;

  let rewardPulls = 0;
  if (completedFullRun) rewardPulls = 2;
  else if (completedMinimumGoal) rewardPulls = 1;

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
