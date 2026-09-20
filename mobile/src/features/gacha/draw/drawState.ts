import type { RewardWalletState } from '../rewards/rewardWallet';
import type { LibraryCardRow } from '../library/libraryMapper';
import { FREE_PULL_CAP } from '../constants';

export type DrawStateKind = 'locked' | 'available' | 'reward-pending' | 'wallet-full-with-reserve';

export type DrawStateVM = {
  state: DrawStateKind;
  title: string;
  helper: string;
  ctaLabel: string;
  canOpen: boolean;
};

export function pickDrawPreviewCards(rows: LibraryCardRow[], take: number = 3): LibraryCardRow[] {
  // 'missing' sorts ahead of everything: a draw preview is a picture of what a
  // pull could still give you, and once the gate is on, missing cards are the
  // only ones it can. Ungated no row ever carries that status, so this line
  // changes no existing ordering.
  const priority = { missing: 0, new: 1, learning: 2, mastered: 3 } as const;
  return [...rows]
    .sort((a, b) => {
      const pa = priority[a.status];
      const pb = priority[b.status];
      if (pa !== pb) return pa - pb;
      if (a.isUpdated !== b.isUpdated) return a.isUpdated ? -1 : 1;
      if (a.isDueToday !== b.isDueToday) return a.isDueToday ? -1 : 1;
      return a.orderInDeck - b.orderInDeck;
    })
    .slice(0, Math.max(1, take));
}

export function buildDrawState(params: {
  wallet: RewardWalletState;
  hasTodayWork: boolean;
  rewardPending?: boolean;
  hasActivePool?: boolean;
}): DrawStateVM {
  const { wallet, hasTodayWork, rewardPending = false, hasActivePool = true } = params;

  if (!hasActivePool) {
    return {
      state: 'locked',
      title: 'Draw locked for now',
      helper: 'No active draw pool is ready yet. Open Library to choose or install a pool first.',
      ctaLabel: 'View library',
      canOpen: false,
    };
  }

  if (rewardPending && wallet.availablePulls > 0) {
    return {
      state: 'reward-pending',
      title: 'Reward pulls ready',
      helper: `You just earned ${wallet.availablePulls} ready pull${wallet.availablePulls === 1 ? '' : 's'}. Open them after the run while the result is still fresh.`,
      ctaLabel: 'Open draw',
      canOpen: true,
    };
  }

  if (wallet.availablePulls >= FREE_PULL_CAP && wallet.reservePulls > 0) {
    return {
      state: 'wallet-full-with-reserve',
      title: 'Wallet full, reserve waiting',
      helper: `${wallet.availablePulls} pulls are ready and ${wallet.reservePulls} more are queued in reserve. Spend one to let reserve flow forward.`,
      ctaLabel: 'Open draw',
      canOpen: true,
    };
  }

  if (wallet.availablePulls > 0) {
    return {
      state: 'available',
      title: 'Draw available',
      helper: `${wallet.availablePulls} pull${wallet.availablePulls === 1 ? '' : 's'} ready. This is a follow-up reward, not today’s main task.`,
      ctaLabel: 'Open draw',
      canOpen: true,
    };
  }

  return {
    state: 'locked',
    title: 'Draw locked for now',
    helper: hasTodayWork
      ? 'Learn a new card or clear today’s due cards, then come back for new pulls.'
      : 'No reward pulls are waiting yet. Learn a new card to earn one.',
    ctaLabel: 'View library',
    canOpen: false,
  };
}

export { commitDraw, type DrawCommitResult, type DrawnCardVm } from './drawCommit';
