import type { RewardWalletState } from './rewardWallet';

// The single source of truth for "pulls you can spend right now", shared by the
// Draw badge/Open buttons and the DrawResult "N pulls left" CTA so the two
// screens can never disagree at the 60-pull cap (MGACHA-21).
//
// Reserve pulls are deliberately excluded: reservePulls only promote into
// availablePulls on the *next* spend (see consumePullsFromWallet). The number we
// show is what the Draw screen can actually open at this moment, not a future
// total — counting reserve made DrawResult promise 65 while Draw showed 60.
//
// Imports only the type from rewardWallet.ts (never its runtime), so the partial
// mocks screen tests use for that module cannot break this selector.
export function spendablePullsNow(wallet: Partial<RewardWalletState> | null | undefined): number {
  return Math.max(0, Math.floor(Number(wallet?.availablePulls ?? 0) || 0));
}
