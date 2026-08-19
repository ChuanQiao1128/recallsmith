import AsyncStorage from '@react-native-async-storage/async-storage';
import { getUserScopedKey } from '../../../review/storage';
import { FREE_PULL_CAP, FREE_PULL_OVERFLOW_CAP } from '../constants';

// All three bases below are now built through getUserScopedKey(): a
// wallet, a settlement receipt and a starter grant all belong to a
// person, not to a handset. What differs is what each does about the
// unscoped keys older builds wrote, and the three answers are not the
// same. See the comments at each use.
//
// Timing caveat, accepted for now: App.tsx fires the boot seed without
// waiting for auth to resolve, so the very first read after upgrading
// can land in the "anon" partition and claim the leftover unscoped
// wallet or flag there. The cost is bounded and points the safe way (a
// signed-in user can be granted their 3 starter pulls a second time,
// never fewer). Sequencing the boot seed behind auth is a call-site
// change, not a key-layout one.
const REWARD_WALLET_KEY = 'recallsmith:reward-wallet:v1';
const APPLIED_SESSION_PREFIX = 'recallsmith:reward-session:';
// Marks that we've already considered (and possibly granted) the
// brand-new-user starter pulls. Set the flag once per account; from
// then on we never re-grant, even if the user spends down to 0.
const WALLET_SEEDED_KEY = 'recallsmith:wallet-seeded:v1';

function walletKey(): Promise<string> {
  return getUserScopedKey(REWARD_WALLET_KEY);
}

function seededKey(): Promise<string> {
  return getUserScopedKey(WALLET_SEEDED_KEY);
}

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

function parseWallet(raw: string): RewardWalletState {
  const parsed = JSON.parse(raw);
  return {
    availablePulls: Math.max(0, Number(parsed?.availablePulls ?? 0) || 0),
    reservePulls: Math.max(0, Number(parsed?.reservePulls ?? 0) || 0),
  };
}

export async function loadRewardWalletState(): Promise<RewardWalletState> {
  try {
    const raw = await AsyncStorage.getItem(await walletKey());
    if (raw) return parseWallet(raw);

    // Pre-partition wallet: claim it for whoever is signed in now, then
    // remove it. A permanent read-only fallback would keep handing the
    // same balance to every account that ever signs in on this device.
    const globalRaw = await AsyncStorage.getItem(REWARD_WALLET_KEY);
    if (!globalRaw) return { availablePulls: 0, reservePulls: 0 };

    const migrated = parseWallet(globalRaw);
    try {
      await saveRewardWalletState(migrated);
      await AsyncStorage.removeItem(REWARD_WALLET_KEY);
    } catch {
      // The value read is still correct for this call; retry next load.
    }
    return migrated;
  } catch {
    return { availablePulls: 0, reservePulls: 0 };
  }
}

export async function saveRewardWalletState(state: RewardWalletState): Promise<void> {
  await AsyncStorage.setItem(await walletKey(), JSON.stringify(state));
}

/**
 * Reads the scoped starter-grant flag, adopting the unscoped one if
 * this device still carries it.
 *
 * The unscoped flag means "someone on this handset already took the
 * starter grant". It is handed to the account signed in right now, so
 * the same person cannot collect twice, and then deleted so the next
 * account on this device gets its own grant. That is the per-user
 * reading of the flag, and it is the correct one: the grant exists to
 * let a new *player* feel a pull within seconds, not to ration pulls
 * per piece of hardware.
 */
async function hasSeededFlag(): Promise<boolean> {
  const scoped = await AsyncStorage.getItem(await seededKey());
  if (scoped) return true;

  const global = await AsyncStorage.getItem(WALLET_SEEDED_KEY);
  if (!global) return false;

  try {
    await AsyncStorage.setItem(await seededKey(), '1');
    await AsyncStorage.removeItem(WALLET_SEEDED_KEY);
  } catch {
    // Worst case the adoption runs again next boot, which is idempotent.
  }
  return true;
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
    const alreadySeeded = await hasSeededFlag();
    if (alreadySeeded) {
      return { wallet: await loadRewardWalletState(), seeded: false };
    }

    const current = await loadRewardWalletState();
    // Only grant if the wallet is genuinely empty — pre-existing users
    // who already have pulls (or reserve) shouldn't get a free top-up
    // just because we shipped this feature.
    const isEmpty = current.availablePulls === 0 && current.reservePulls === 0;
    if (!isEmpty) {
      await AsyncStorage.setItem(await seededKey(), '1');
      return { wallet: current, seeded: false };
    }

    const seededWallet: RewardWalletState = {
      availablePulls: STARTER_PULL_GRANT,
      reservePulls: 0,
    };
    await Promise.all([
      saveRewardWalletState(seededWallet),
      seededKey().then((key) => AsyncStorage.setItem(key, '1')),
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

/**
 * Gives `count` pulls back to whatever the wallet holds *now*.
 *
 * The caller that needed this used to undo a spend by writing back a
 * snapshot taken before it. That is not an undo, it is a rollback of the
 * whole key: any pull granted between the snapshot and the failure -- a
 * settlement landing, a streak milestone -- is silently erased, and the
 * user's evidence for it (a toast they already saw) is gone.
 *
 * Reading first and adding on top is the difference between "restore the
 * balance I remember" and "return what I took". It routes through
 * applyRewardToWallet so a refund obeys the same caps as a grant; the
 * overflow that implies is the honest one, because a refund arriving at a
 * full wallet is indistinguishable from a reward arriving at a full wallet.
 */
export async function refundPullsToStoredWallet(count: number): Promise<RewardWalletState> {
  const safeCount = Math.max(0, Math.floor(count));
  const current = await loadRewardWalletState();
  if (safeCount === 0) return current;

  const applied = applyRewardToWallet(current, safeCount);
  const next: RewardWalletState = {
    availablePulls: applied.availablePulls,
    reservePulls: applied.reservePulls,
  };
  await saveRewardWalletState(next);
  return next;
}

export async function applySessionRewardToWallet(sessionId: string, rewardPulls: number): Promise<{
  walletBefore: RewardWalletState;
  walletAfter: RewardWalletState;
  applied: AppliedRewardWalletState & { rewardPulls: number };
  alreadyApplied: boolean;
}> {
  // Scoped, and deliberately with no fallback to the unscoped key that
  // older builds wrote. Every other key here migrates; this one must
  // not, because of what a hit on it means: "this session was already
  // paid for". A fallback would let one account's leftover receipts
  // answer for another account's sessions, and the answer it gives is
  // "already settled", so account B's reward is swallowed silently and
  // permanently. The cost of refusing the fallback is bounded and
  // recoverable in the other direction: a session settled immediately
  // before this upgrade, and re-opened after it, can pay out a second
  // time. One extra grant at one upgrade boundary for one user against
  // a class of invisible losses is not a close call. The leftover
  // unscoped receipts are inert from here on (the debug reset sweeps
  // them by prefix).
  const dedupeKey = await getUserScopedKey(`${APPLIED_SESSION_PREFIX}${sessionId}`);
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
  // Order matters, and it is the whole idempotency guarantee. These two
  // writes used to go out together in one Promise.all, which means the
  // mechanism meant to make the grant exactly-once was itself not
  // ordered: a kill could land the wallet write and lose the dedupe key,
  // and the next settle of the same session would pay out again.
  //
  // The dedupe record now lands first, and the wallet second. Between
  // two writes with no transaction there are only two failure
  // directions, and refusing to pick one is how you get the bad one by
  // default. We pick under-granting: a crash between the two writes
  // loses one reward instead of double-granting; rewards can be
  // re-granted by support, trust cannot.
  await AsyncStorage.setItem(
    dedupeKey,
    JSON.stringify({
      rewardPulls,
      walletBefore: wallet,
    }),
  );
  await saveRewardWalletState(walletAfter);

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
