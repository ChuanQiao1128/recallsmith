import type { ReviewRating, CardProgress } from '../../../review/model';
import type { AppliedRewardWalletState, RewardWalletState } from './rewardWallet';
import { grantPullsToStoredWallet } from './rewardWallet';
import {
  countPaidOnDay,
  markDueClearedIfFirstToday,
  payNewCardIfUnpaid,
  readNewCardLedger,
  seedNewCardLedgerIfAbsent,
  type NewCardLedger,
} from './newCardLedger';
import { readProgressSettled } from './progressSettled';
import { readStorageFreshLearned } from './storageFreshLearned';

export type RatingRewardInput = {
  slug: string;
  stableUid: string;
  rating: ReviewRating;
  /** The deck progress BEFORE this rating (seeds the ledger on first use, C00 §2.2). */
  progressBefore: CardProgress[];
  /** false in sweep mode (R8): R1 is skipped, R2 is still evaluated. C01's caller passes true; C04 passes mode !== 'sweep'. */
  newCardEligible: boolean;
  /** countDueToday over progressBefore. */
  dueBefore: number;
  /** remainingDueCount after the rating. */
  remainingDueCount: number;
  now: Date;
};

/** Why R1 was not evaluated on this step (additive, C00 §6 2026-09-21 addendum):
 *  - 'progress-unsettled': signed in, but no remote progress pull has landed on this device for this
 *    user yet (progressSettled.ts), so the ledger was neither seeded nor paid. R2 was still evaluated.
 *  - 'storage-error': the seed/ledger read threw; the whole step is the zero step (nothing paid). */
export type RatingRewardSkipReason = 'progress-unsettled' | 'storage-error';

export type RatingRewardStep = {
  newCardPaid: boolean;        // R1 fired for this uid
  dueClearPaid: boolean;       // R2 fired (dueBefore > 0 && remainingDueCount === 0 && first time today)
  pulls: number;               // Number(newCardPaid) + Number(dueClearPaid), 0..2
  walletBefore: RewardWalletState | null;   // null when pulls === 0
  walletAfter: RewardWalletState | null;
  applied: AppliedRewardWalletState | null;
  /** countPaidOnDay(ledger, now) for this slug AFTER the step (feeds R7 / C02). */
  newCardsLearnedToday: number;
  /** Present only when R1 was skipped for a reason other than the rating/eligibility rules. */
  skipped?: RatingRewardSkipReason;
};

export const ZERO_REWARD_STEP: RatingRewardStep = Object.freeze({
  newCardPaid: false,
  dueClearPaid: false,
  pulls: 0,
  walletBefore: null,
  walletAfter: null,
  applied: null,
  newCardsLearnedToday: 0,
});

/** Order: (0) readProgressSettled(slug) -- unsettled → skip (1) and (2), report skipped:'progress-unsettled';
 *  (1) seedNewCardLedgerIfAbsent(slug, progressBefore, now, storage-fresh source); (2) R1: newCardEligible
 *  && rating !== 'again' → payNewCardIfUnpaid; (3) R2: dueBefore > 0 && remainingDueCount === 0 →
 *  markDueClearedIfFirstToday; (4) pulls > 0 → grantPullsToStoredWallet(pulls). Ledger and marker land
 *  before the wallet. Never throws: a storage failure at (1) returns the zero step (no pay,
 *  skipped:'storage-error'); at (4) the ledger/marker are already written and the step reports pulls with
 *  walletAfter === null (under-grant, never double-grant).
 *
 *  The seed's backfill (SEED path only, i.e. the partition's first settled rating for this slug) is the
 *  UNION of two views of "already learned" (C00 §6, 2026-09-21 addendum, decision 4 -- review finding S8):
 *  - `progressBefore`, the caller's in-memory snapshot (SessionCardScreen.tsx passes its `progress` state,
 *    refreshed only at load and after its own ratings);
 *  - the storage-fresh view (storageFreshLearned.ts): the stored progress key plus the per-user remote
 *    cache the frozen progressSync.ts writes on every pull -- what a remote pull that landed mid-session
 *    merged behind the screen's back, which the snapshot cannot know.
 *  A card learned in EITHER view is backfilled as paid(0). The superset is the safe direction: a stale
 *  snapshot alone would seed too little, the marker would make it permanent, and every later-arriving
 *  learned card would pay. The CURRENT card is exempt from the stored-progress half of that view: the
 *  screen saves its rating to storage before it settles the reward (:451-452), so the progress key always
 *  calls the card being rated "learned", and trusting that would mean the first rating on a freshly
 *  seeded partition never pays. For that one uid the decision stays with `progressBefore`, as before,
 *  plus the remote-cache half, which this rating cannot have reached yet (it gets there only through a
 *  later push and pull): a cache row for it means the account learned it before this rating, and that is
 *  exactly what the backfill is for. The storage-fresh read happens only when the marker is absent; a
 *  marker-present rating never touches those keys. Its storage error is a seed-time storage error: zero
 *  step, skipped:'storage-error', nothing written. */
export async function settleRatingReward(input: RatingRewardInput): Promise<RatingRewardStep> {
  const { slug, stableUid, rating, progressBefore, newCardEligible, dueBefore, remainingDueCount, now } = input;

  // (0) The seed only knows what this device knows. Until the account's remote progress has
  // landed here, a seed would miss every card learned elsewhere and R1 would pay them all on
  // their next hard+ (review finding B). Unsettled → no seed, no R1; R2 is unaffected.
  const settledState = await readProgressSettled(slug);
  let skipped: RatingRewardSkipReason | undefined;
  let ledger: NewCardLedger;

  if (settledState.settled) {
    // (1) Seed the per-partition ledger the first time this deck is settled. A storage
    // failure here means we cannot know whether the card was pre-learned, so we pay
    // nothing rather than risk paying a card that was already learned.
    try {
      ledger = await seedNewCardLedgerIfAbsent(slug, progressBefore, now.getTime(), async () => {
        // Consulted only when the marker is absent. Everything storage says is learned,
        // except the card being rated in the stored-progress view: the screen already
        // saved this rating there, so for that one uid that view is not "before" and
        // progressBefore keeps the decision. The remote cache cannot hold this rating
        // yet, so its row for the current card (if any) is the account's earlier review.
        const fresh = await readStorageFreshLearned(slug);
        fresh.storedProgress.delete(stableUid);
        return new Set([...fresh.storedProgress, ...fresh.remoteCache]);
      });
    } catch {
      return { ...ZERO_REWARD_STEP, skipped: 'storage-error' };
    }
  } else {
    skipped = 'progress-unsettled';
    // The ledger may already hold adopted anon stamps from today; count them for R7 but
    // never seed or write. A read failure only costs the count.
    try {
      ledger = (await readNewCardLedger(slug)).ledger;
    } catch {
      ledger = {};
    }
  }

  // (2) R1: the first hard/good/easy on a not-yet-paid card pays one pull. R9 falls
  // out of this -- `again` only defers; it never decides whether a card ever pays.
  let newCardPaid = false;
  if (settledState.settled && newCardEligible && rating !== 'again') {
    const payResult = await payNewCardIfUnpaid(slug, stableUid, now.getTime());
    newCardPaid = payResult.paid;
    ledger = payResult.ledger;
  }

  const newCardsLearnedToday = countPaidOnDay(ledger, now);

  // (3) R2: clearing today's due cards pays one pull, at most once per local day.
  let dueClearPaid = false;
  if (dueBefore > 0 && remainingDueCount === 0) {
    dueClearPaid = await markDueClearedIfFirstToday(now);
  }

  const pulls = Number(newCardPaid) + Number(dueClearPaid);
  const skippedField = skipped ? { skipped } : {};

  // (4) The single wallet write. The ledger and marker are already on disk, so a throw
  // here reports the pulls with a null wallet -- under-grant, never double-grant.
  if (pulls > 0) {
    try {
      const grant = await grantPullsToStoredWallet(pulls);
      return {
        newCardPaid,
        dueClearPaid,
        pulls,
        walletBefore: grant.walletBefore,
        walletAfter: grant.walletAfter,
        applied: grant.applied,
        newCardsLearnedToday,
        ...skippedField,
      };
    } catch {
      return {
        newCardPaid,
        dueClearPaid,
        pulls,
        walletBefore: null,
        walletAfter: null,
        applied: null,
        newCardsLearnedToday,
        ...skippedField,
      };
    }
  }

  return {
    newCardPaid,
    dueClearPaid,
    pulls,
    walletBefore: null,
    walletAfter: null,
    applied: null,
    newCardsLearnedToday,
    ...skippedField,
  };
}
