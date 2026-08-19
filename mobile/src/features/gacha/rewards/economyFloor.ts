import AsyncStorage from '@react-native-async-storage/async-storage';

import { formatDateKey } from '../../../review/model';
import { getUserScopedKey } from '../../../review/storage';
import {
  applyRewardToWallet,
  loadRewardWalletState,
  saveRewardWalletState,
  type RewardWalletState,
} from './rewardWallet';

/**
 * Exactly one. The floor is a throttle, not a faucet: it exists so the
 * ownership gate can never be a dead end, and one pull is the smallest
 * amount that reopens the loop (draw -> own a card -> study it -> earn
 * pulls the normal way). Granting more would make starvation the cheapest
 * way to farm pulls, which is the failure mode on the other side.
 */
export const ECONOMY_FLOOR_GRANT = 1;

// Scoped through getUserScopedKey like every other economy key, so the
// resolved key starts with `devcards:u:{sub}:` -- which also means the debug
// reset's `devcards:u:` sweep already clears it, and no second copy of the
// partition rule can drift from review/storage's.
const ECONOMY_FLOOR_KEY = 'recallsmith:economy-floor:v1';

export type EconomyFloorInputs = {
  /** Cards this account holds and has not studied, summed over all decks. */
  ownedNewCount: number | null | undefined;
  /** Cards due today, summed over all decks. */
  dueCount: number | null | undefined;
  wallet: RewardWalletState | null | undefined;
};

export type EconomyFloorOutcome = {
  /** The wallet the caller should render: post-grant when one happened. */
  wallet: RewardWalletState;
  granted: number;
  reason: 'not-starved' | 'already-granted-today' | 'granted' | 'unavailable';
};

function toWallet(wallet: RewardWalletState | null | undefined): RewardWalletState {
  return {
    availablePulls: Math.max(0, Number(wallet?.availablePulls ?? 0) || 0),
    reservePulls: Math.max(0, Number(wallet?.reservePulls ?? 0) || 0),
  };
}

/**
 * The three conditions, and nothing else.
 *
 * A count that is not a finite number is treated as "not starved", never as
 * zero. The distinction matters because the two are opposite claims: zero is
 * evidence the user has no work, `undefined` is the absence of evidence, and
 * a floor that grants on absence would pay out every time a caller forgot to
 * count -- exactly when it is least entitled to.
 *
 * Wallet emptiness is the *total*, available plus reserve. Only availablePulls
 * can be spent on a draw today, so "available === 0" would look like the
 * tighter reading, but reserve promotes into available on the next spend, so a
 * user with reserve is holding pulls, not starving for them.
 *
 * Three conditions, and no fourth. An account with no deck installed satisfies
 * all three vacuously and is granted anyway. Adding "must have a studiable
 * deck" would read as tidier and would withhold the pull from precisely the
 * user whose next act is to install a deck and want one; the per-day cap
 * bounds the cost of being wrong in this direction.
 */
export function isEconomyStarved(input: EconomyFloorInputs): boolean {
  // typeof, not Number(): the coercion answers 0 for null and for '', which
  // are the very values that mean "no count was supplied". Reading them as
  // zero would invert this rule at exactly the inputs it exists to reject.
  const { ownedNewCount, dueCount } = input;
  if (typeof ownedNewCount !== 'number' || !Number.isFinite(ownedNewCount)) return false;
  if (typeof dueCount !== 'number' || !Number.isFinite(dueCount)) return false;
  if (Math.max(0, Math.floor(ownedNewCount)) !== 0) return false;
  if (Math.max(0, Math.floor(dueCount)) !== 0) return false;

  const wallet = toWallet(input.wallet);
  return wallet.availablePulls + wallet.reservePulls === 0;
}

/**
 * Grants the floor pull when the account is starved, at most once per day.
 *
 * Idempotency is a single key holding the day it last paid out, and the read
 * is an equality test against today. `applySessionRewardToWallet` stores a
 * JSON record instead because its reader has to reconstruct the reward for
 * display; nobody reads this one for anything but "was it today", and a bare
 * string cannot be corrupt in a way that matters -- a JSON record that failed
 * to parse would leave us choosing between a permanent block and a permanent
 * re-grant, and neither is a choice worth having.
 *
 * Write order follows rewardWallet's: the day marker lands *before* the
 * wallet. Two writes with no transaction have two failure directions and
 * refusing to pick one hands you the bad one by default; we pick
 * under-granting, so a crash between them costs the user one floor pull
 * instead of arming a second grant on the next Home load.
 *
 * Clock note, accepted: the marker is a local day key, so moving the device
 * clock backwards makes the stored day differ from "today" and permits one
 * more grant. The abuse ceiling is one pull per clock change, which is
 * strictly worse for the user than just studying, so it is not worth a
 * server round-trip to close.
 */
export async function applyEconomyFloorIfStarved(
  input: EconomyFloorInputs & { now?: Date },
): Promise<EconomyFloorOutcome> {
  const wallet = toWallet(input.wallet);
  if (!isEconomyStarved(input)) {
    return { wallet, granted: 0, reason: 'not-starved' };
  }

  const dayKey = formatDateKey(input.now ?? new Date());

  try {
    const key = await getUserScopedKey(ECONOMY_FLOOR_KEY);
    const marker = await AsyncStorage.getItem(key);
    if (marker === dayKey) {
      return { wallet, granted: 0, reason: 'already-granted-today' };
    }

    // Re-read rather than write on top of the caller's snapshot. Home reads
    // the wallet in parallel with the deck summaries, so by the time we get
    // here a settlement could have landed pulls that the snapshot predates;
    // computing the new balance from a stale copy would erase them. Confirming
    // starvation against the fresh read as well keeps the grant honest in the
    // same window.
    const current = await loadRewardWalletState();
    if (current.availablePulls + current.reservePulls !== 0) {
      return { wallet: current, granted: 0, reason: 'not-starved' };
    }

    const applied = applyRewardToWallet(current, ECONOMY_FLOOR_GRANT);
    const next: RewardWalletState = {
      availablePulls: applied.availablePulls,
      reservePulls: applied.reservePulls,
    };

    await AsyncStorage.setItem(key, dayKey);
    await saveRewardWalletState(next);

    return { wallet: next, granted: ECONOMY_FLOOR_GRANT, reason: 'granted' };
  } catch {
    // Storage trouble must not take Home down with it. Returning the caller's
    // wallet unchanged leaves the user where they were; the next load retries.
    return { wallet, granted: 0, reason: 'unavailable' };
  }
}
