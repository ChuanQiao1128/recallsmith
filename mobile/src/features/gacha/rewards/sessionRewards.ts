import type { ReviewRating, CardProgress } from '../../../review/model';
import type { AppliedRewardWalletState, RewardWalletState } from './rewardWallet';
import { grantPullsToStoredWallet } from './rewardWallet';
import {
  countPaidOnDay,
  markDueClearedIfFirstToday,
  payNewCardIfUnpaid,
  seedNewCardLedgerIfAbsent,
  type NewCardLedger,
} from './newCardLedger';

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

export type RatingRewardStep = {
  newCardPaid: boolean;        // R1 fired for this uid
  dueClearPaid: boolean;       // R2 fired (dueBefore > 0 && remainingDueCount === 0 && first time today)
  pulls: number;               // Number(newCardPaid) + Number(dueClearPaid), 0..2
  walletBefore: RewardWalletState | null;   // null when pulls === 0
  walletAfter: RewardWalletState | null;
  applied: AppliedRewardWalletState | null;
  /** countPaidOnDay(ledger, now) for this slug AFTER the step (feeds R7 / C02). */
  newCardsLearnedToday: number;
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

/** Order: (1) seedNewCardLedgerIfAbsent(slug, progressBefore); (2) R1: newCardEligible && rating !== 'again'
 *  → payNewCardIfUnpaid; (3) R2: dueBefore > 0 && remainingDueCount === 0 → markDueClearedIfFirstToday;
 *  (4) pulls > 0 → grantPullsToStoredWallet(pulls). Ledger and marker land before the wallet. Never throws:
 *  a storage failure at (1) returns the zero step (no pay); at (4) the ledger/marker are already written and
 *  the step reports pulls with walletAfter === null (under-grant, never double-grant). */
export async function settleRatingReward(input: RatingRewardInput): Promise<RatingRewardStep> {
  const { slug, stableUid, rating, progressBefore, newCardEligible, dueBefore, remainingDueCount, now } = input;

  // (1) Seed the per-partition ledger the first time this deck is settled. A storage
  // failure here means we cannot know whether the card was pre-learned, so we pay
  // nothing rather than risk paying a card that was already learned.
  let ledger: NewCardLedger;
  try {
    ledger = await seedNewCardLedgerIfAbsent(slug, progressBefore);
  } catch {
    return { ...ZERO_REWARD_STEP };
  }

  // (2) R1: the first hard/good/easy on a not-yet-paid card pays one pull. R9 falls
  // out of this -- `again` only defers; it never decides whether a card ever pays.
  let newCardPaid = false;
  if (newCardEligible && rating !== 'again') {
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
  };
}
