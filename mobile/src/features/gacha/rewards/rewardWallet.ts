import AsyncStorage from '@react-native-async-storage/async-storage';
import { FREE_PULL_CAP, FREE_PULL_OVERFLOW_CAP } from '../constants';

const REWARD_WALLET_KEY = 'recallsmith:reward-wallet:v1';
const APPLIED_SESSION_PREFIX = 'recallsmith:reward-session:';

export type RewardWalletState = {
  availablePulls: number;
  reservePulls: number;
};

export type AppliedRewardWalletState = RewardWalletState & {
  appliedToAvailable: number;
  appliedToReserve: number;
  dropped: number;
};

export function applyRewardToWallet(current: RewardWalletState, rewardPulls: number): AppliedRewardWalletState {
  const safeReward = Math.max(0, Math.floor(rewardPulls));
  const availableRoom = Math.max(0, FREE_PULL_CAP - current.availablePulls);
  const appliedToAvailable = Math.min(availableRoom, safeReward);
  const leftAfterAvailable = safeReward - appliedToAvailable;
  const reserveRoom = Math.max(0, FREE_PULL_OVERFLOW_CAP - current.reservePulls);
  const appliedToReserve = Math.min(reserveRoom, leftAfterAvailable);
  const dropped = Math.max(0, leftAfterAvailable - appliedToReserve);

  return {
    availablePulls: current.availablePulls + appliedToAvailable,
    reservePulls: current.reservePulls + appliedToReserve,
    appliedToAvailable,
    appliedToReserve,
    dropped,
  };
}

export function getRewardWalletMessage(state: AppliedRewardWalletState): string {
  if (state.appliedToReserve > 0) {
    return `${state.availablePulls} ready · ${state.reservePulls} pending in reserve`;
  }

  if (state.dropped > 0) {
    return `${state.availablePulls} ready · reserve full for now`;
  }

  return `${state.availablePulls} ready to use`;
}

export function canAcceptMorePulls(state: RewardWalletState): boolean {
  return state.availablePulls < FREE_PULL_CAP || state.reservePulls < FREE_PULL_OVERFLOW_CAP;
}

export async function loadRewardWalletState(): Promise<RewardWalletState> {
  try {
    const raw = await AsyncStorage.getItem(REWARD_WALLET_KEY);
    if (!raw) return { availablePulls: 0, reservePulls: 0 };
    const parsed = JSON.parse(raw);
    return {
      availablePulls: Math.max(0, Number(parsed?.availablePulls ?? 0) || 0),
      reservePulls: Math.max(0, Number(parsed?.reservePulls ?? 0) || 0),
    };
  } catch {
    return { availablePulls: 0, reservePulls: 0 };
  }
}

export async function saveRewardWalletState(state: RewardWalletState): Promise<void> {
  await AsyncStorage.setItem(REWARD_WALLET_KEY, JSON.stringify(state));
}

export function consumePullsFromWallet(current: RewardWalletState, count: number): {
  wallet: RewardWalletState;
  spent: number;
  promotedFromReserve: number;
} {
  const requested = Math.max(0, Math.floor(count));
  const spent = Math.min(requested, current.availablePulls);
  const nextAvailable = current.availablePulls - spent;
  const promotedFromReserve = Math.min(FREE_PULL_CAP - nextAvailable, current.reservePulls);

  return {
    wallet: {
      availablePulls: nextAvailable + promotedFromReserve,
      reservePulls: current.reservePulls - promotedFromReserve,
    },
    spent,
    promotedFromReserve,
  };
}

export async function consumePullsFromStoredWallet(count: number): Promise<{
  wallet: RewardWalletState;
  spent: number;
  promotedFromReserve: number;
}> {
  const current = await loadRewardWalletState();
  const result = consumePullsFromWallet(current, count);
  await saveRewardWalletState(result.wallet);
  return result;
}

export async function applySessionRewardToWallet(sessionId: string, rewardPulls: number): Promise<{
  walletBefore: RewardWalletState;
  walletAfter: RewardWalletState;
  applied: AppliedRewardWalletState & { rewardPulls: number };
  alreadyApplied: boolean;
}> {
  const dedupeKey = `${APPLIED_SESSION_PREFIX}${sessionId}`;
  const [wallet, alreadyApplied] = await Promise.all([
    loadRewardWalletState(),
    AsyncStorage.getItem(dedupeKey),
  ]);

  if (alreadyApplied) {
    let storedRewardPulls = 0;
    let walletBefore = wallet;
    try {
      const parsed = JSON.parse(alreadyApplied);
      storedRewardPulls = Math.max(0, Number(parsed?.rewardPulls ?? 0) || 0);
      walletBefore = {
        availablePulls: Math.max(0, Number(parsed?.walletBefore?.availablePulls ?? wallet.availablePulls) || 0),
        reservePulls: Math.max(0, Number(parsed?.walletBefore?.reservePulls ?? wallet.reservePulls) || 0),
      };
    } catch {}

    return {
      walletBefore,
      walletAfter: wallet,
      applied: {
        ...applyRewardToWallet(walletBefore, storedRewardPulls),
        rewardPulls: storedRewardPulls,
      },
      alreadyApplied: true,
    };
  }

  const applied = applyRewardToWallet(wallet, rewardPulls);
  const walletAfter = {
    availablePulls: applied.availablePulls,
    reservePulls: applied.reservePulls,
  };
  await Promise.all([
    saveRewardWalletState(walletAfter),
    AsyncStorage.setItem(
      dedupeKey,
      JSON.stringify({
        rewardPulls,
        walletBefore: wallet,
      }),
    ),
  ]);

  return {
    walletBefore: wallet,
    walletAfter,
    applied: {
      ...applied,
      rewardPulls,
    },
    alreadyApplied: false,
  };
}
