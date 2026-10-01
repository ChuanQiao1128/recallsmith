import AsyncStorage from '@react-native-async-storage/async-storage';

import { formatDateKey } from '../../../review/model';
import { getUserScopedKey } from '../../../review/storage';
import type { DeckSummary } from '../contracts';
import { ownedCountOf } from '../selectors/homeSelectors';
import { applyRewardToWallet, type RewardWalletState } from './rewardWallet';
import {
  ensureDeckBootstrap,
  loadDeckWallets,
  migrateLegacyWalletIfNeeded,
  updateDeckWallet,
} from './deckWallet';
import { isStarterLessonOpen } from '../starter/starterGate';

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
  /** Cards this pack holds and has not studied. */
  ownedNewCount: number | null | undefined;
  /** Cards of this pack due today. */
  dueCount: number | null | undefined;
  /** This pack's wallet. */
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
  input: EconomyFloorInputs & { slug: string; now?: Date },
): Promise<EconomyFloorOutcome> {
  const wallet = toWallet(input.wallet);
  if (!isEconomyStarved(input)) {
    return { wallet, granted: 0, reason: 'not-starved' };
  }

  const dayKey = formatDateKey(input.now ?? new Date());

  try {
    // Per pack (option A): the marker is scoped to the slug, so a starved pack
    // gets its own daily floor pull independent of the others.
    const key = await getUserScopedKey(`${ECONOMY_FLOOR_KEY}:${input.slug}`);
    const marker = await AsyncStorage.getItem(key);
    if (marker === dayKey) {
      return { wallet, granted: 0, reason: 'already-granted-today' };
    }

    // Grant through updateDeckWallet so the write is serialized against every
    // other pack-wallet mutation and re-reads the fresh pack wallet. Home reads
    // the wallets in parallel with the deck summaries, so by the time we get
    // here a settlement could have landed pulls the snapshot predates; a stale
    // copy would erase them. The day marker is written INSIDE the updater,
    // before the new wallet is returned (and so before updateDeckWallet's own
    // write), so a crash under-grants (loses one floor pull) rather than arming
    // a second grant on the next Home load.
    let granted = 0;
    const { after } = await updateDeckWallet(input.slug, async (current) => {
      if (current.availablePulls + current.reservePulls !== 0) {
        // No longer empty on the fresh read: nothing to write.
        return null;
      }
      const applied = applyRewardToWallet(current, ECONOMY_FLOOR_GRANT);
      await AsyncStorage.setItem(key, dayKey);
      granted = ECONOMY_FLOOR_GRANT;
      return { availablePulls: applied.availablePulls, reservePulls: applied.reservePulls };
    });

    if (granted === 0) {
      // The fresh pack wallet was not empty; report it unchanged.
      return { wallet: after, granted: 0, reason: 'not-starved' };
    }

    return { wallet: after, granted: ECONOMY_FLOOR_GRANT, reason: 'granted' };
  } catch {
    // Storage trouble must not take Home down with it. Returning the caller's
    // wallet unchanged leaves the user where they were; the next load retries.
    return { wallet, granted: 0, reason: 'unavailable' };
  }
}

/**
 * Home's per-pack wallet preparation. In order: (1) migrate/sweep the legacy
 * global wallet into packs; (2) first-visit bootstrap for every studiable pack;
 * (3) read every pack wallet; (4) apply the daily floor to each studiable pack
 * whose collection is not complete; (5) return the wallets.
 *
 * Bootstrap runs BEFORE the floor so a never-drawn pack gets its 3 pulls, not a
 * single floor pull. Never throws: on any error it returns whatever
 * loadDeckWallets() gives.
 *
 * While the starter lesson is open (R22 §4) steps (2) and (4) are skipped:
 * the lesson's cards are the learner's work, and a floor pull granted now
 * would both let them draw before learning and spoil the pack's 3-pull
 * bootstrap (it only pays an empty wallet). Finishing the lesson grants it.
 */
export async function prepareHomeDeckWallets(params: {
  deckSummaries: DeckSummary[];
  now: Date;
}): Promise<Record<string, RewardWalletState>> {
  const { deckSummaries, now } = params;
  try {
    // (1) One-time split of the legacy balance, plus a sweep of any that reappears.
    await migrateLegacyWalletIfNeeded();

    const starterOpen = await isStarterLessonOpen();

    // (2) Bootstrap every studiable pack (each is a no-op unless the pack has
    //     never been drawn from and holds nothing).
    for (const summary of starterOpen ? [] : deckSummaries) {
      if (summary.canStudy === true) {
        await ensureDeckBootstrap(summary.slug);
      }
    }

    // (3) Read the wallets after bootstrap.
    const wallets = await loadDeckWallets();

    // (4) Floor each studiable pack whose collection is not complete.
    for (const summary of starterOpen ? [] : deckSummaries) {
      if (summary.canStudy !== true) continue;
      // Skip a complete collection: nothing left to draw, so no floor is owed.
      if (summary.totalCards > 0 && ownedCountOf(summary) >= summary.totalCards) continue;
      const outcome = await applyEconomyFloorIfStarved({
        slug: summary.slug,
        ownedNewCount: summary.newToday,
        dueCount: summary.dueToday,
        wallet: wallets[summary.slug],
        now,
      });
      wallets[summary.slug] = outcome.wallet;
    }

    // (5) Return the prepared wallets.
    return wallets;
  } catch {
    return loadDeckWallets();
  }
}
