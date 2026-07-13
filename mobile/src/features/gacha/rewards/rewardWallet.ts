import AsyncStorage from '@react-native-async-storage/async-storage';
import { FREE_PULL_CAP, FREE_PULL_OVERFLOW_CAP } from '../constants';

const REWARD_WALLET_KEY = 'recallsmith:reward-wallet:v1';
const APPLIED_SESSION_PREFIX = 'recallsmith:reward-session:';
// Marks that we've already considered (and possibly granted) the
// brand-new-user starter pulls. Set the flag once per device; from
// then on we never re-grant, even if the user spends down to 0.
const WALLET_SEEDED_KEY = 'recallsmith:wallet-seeded:v1';

// Brand-new users get a small starter wallet so the *first* gacha
// experience can happen in seconds — they don't have to study 5
// cards before discovering what a pull even feels like. Seeded once,
// then the regular earn-pulls-by-clearing-sessions loop takes over.
export const STARTER_PULL_GRANT = 3;

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

/**
 * One-shot starter grant for brand-new wallets.
 *
 * Idempotent — guarded by a separate "seeded" flag in AsyncStorage so:
 *   • A user who's already played and spent all their pulls never gets
 *     another silent top-up.
 *   • A user who pre-existed before this feature shipped (wallet may
 *     already have pulls in it) doesn't get an extra 3 — we just mark
 *     them seeded and move on.
 *
 * Returns the wallet state the caller should treat as current. Callers
 * that already loaded the wallet should re-load it (or use the returned
 * value) to pick up the seeded pulls. Safe to call on every app boot.
 */
export async function seedStarterPullsIfNeeded(): Promise<{
  wallet: RewardWalletState;
  seeded: boolean;
}> {
  try {
    const alreadySeeded = await AsyncStorage.getItem(WALLET_SEEDED_KEY);
    if (alreadySeeded) {
      return { wallet: await loadRewardWalletState(), seeded: false };
    }

    const current = await loadRewardWalletState();
    // Only grant if the wallet is genuinely empty — pre-existing users
    // who already have pulls (or reserve) shouldn't get a free top-up
    // just because we shipped this feature.
    const isEmpty = current.availablePulls === 0 && current.reservePulls === 0;
    if (!isEmpty) {
      await AsyncStorage.setItem(WALLET_SEEDED_KEY, '1');
      return { wallet: current, seeded: false };
    }

    const seededWallet: RewardWalletState = {
      availablePulls: STARTER_PULL_GRANT,
      reservePulls: 0,
    };
    await Promise.all([
      saveRewardWalletState(seededWallet),
      AsyncStorage.setItem(WALLET_SEEDED_KEY, '1'),
    ]);
    return { wallet: seededWallet, seeded: true };
  } catch {
    // Storage failure: don't crash boot — fall back to whatever the
    // regular load gives us. The next successful boot will retry.
    return { wallet: await loadRewardWalletState(), seeded: false };
  }
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
