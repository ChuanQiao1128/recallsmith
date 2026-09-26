import type { RewardWalletState } from '../rewards/rewardWallet';

export type HomeState =
  | 'new-user'
  | 'active'
  | 'clear-day'
  | 'reward-ready'
  | 'backlog'
  | 'dormant'
  | 'churned'
  | 'paused';

export type HomeLifecycleState = 'new-user' | 'active' | 'dormant' | 'churned' | 'paused';

export function resolveHomeState(params: {
  dueCount: number;
  newCount: number;
  wallet: RewardWalletState;
  streakCount?: number;
  lifecycle?: HomeLifecycleState;
}): HomeState {
  const { dueCount, newCount, wallet, streakCount = 0, lifecycle = 'active' } = params;

  if (lifecycle === 'paused') return 'paused';
  if (lifecycle === 'churned') return 'churned';
  if (lifecycle === 'dormant') return 'dormant';
  if (wallet.availablePulls > 0 && dueCount === 0 && newCount === 0) return 'reward-ready';
  if (streakCount === 0 && dueCount === 0 && newCount === 0) return 'new-user';
  if (dueCount >= 20) return 'backlog';
  if (dueCount === 0 && newCount === 0) return 'clear-day';
  return 'active';
}
