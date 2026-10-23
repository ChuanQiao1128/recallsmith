import { formatDateKey, type ReviewRating, type CardProgress } from '../../../review/model';
import type { AppliedRewardWalletState, RewardWalletState } from './rewardWallet';
import { settleDeckRatingReward } from './deckWallet';
import {
  countPaidOnDay,
  readDueClearMarker,
  projectRatingReward,
  readNewCardLedger,
  seedNewCardLedgerIfAbsent,
  type NewCardLedger,
} from './newCardLedger';
import { readProgressSettled } from './progressSettled';
import { readStorageFreshLearned } from './storageFreshLearned';
import { isStarterLessonCard } from '../starter/starterGate';
import { getUserScopedKey } from '../../../review/storage';

export type RatingRewardInput = {
  /** Partition captured by the rating intent; never follow a later account switch. */
  userSub?: string;
  /** Durable review fact identity, retained by the existing pending-rating journal. */
  eventId?: string;
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
  dueClearPaid: boolean;       // R2 fired (dueBefore > 0 && remainingDueCount === 0 && first time today for this pack)
  pulls: number;               // Number(newCardPaid) + Number(dueClearPaid), 0..2
  walletBefore: RewardWalletState | null;   // this pack's wallet before the grant; null when pulls === 0
  walletAfter: RewardWalletState | null;    // this pack's wallet after the grant
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

/** Prepared under the wallet lock, then committed with the balance before ledger projections.
 * The original timestamp/day survive restart and a later account or local-day change. */
export type RatingRewardPlan = {
  stableUid: string;
  stampAtMs?: number;
  dueClearDay?: string;
  newCardPaid: boolean;
  dueClearPaid: boolean;
  newCardsLearnedToday: number;
  skipped?: RatingRewardSkipReason;
};

/** The wallet lock serializes eligibility, atomic balance/receipt persistence and ledger projection.
 * A failed write rejects so the caller keeps its rating journal. Replays finish any pending
 * projections first and return the original event's committed result without crediting again. */
export async function settleRatingReward(input: RatingRewardInput): Promise<RatingRewardStep> {
  const { slug, stableUid, rating, progressBefore, newCardEligible, dueBefore, remainingDueCount, now } = input;
  // Capture the canonical storage partition once for compatibility callers too.
  // Storage owns key construction; this extracts the sub from its returned prefix.
  const userSub = input.userSub ?? (await getUserScopedKey('')).slice('devcards:u:'.length, -1);

  const prepare = async (): Promise<RatingRewardPlan> => {
    // (0) The seed only knows what this device knows. Until the account's remote progress has
    // landed here, a seed would miss every card learned elsewhere and R1 would pay them all on
    // their next hard+ (review finding B). Unsettled → no seed, no R1; R2 is unaffected.
    const settledState = await readProgressSettled(slug, userSub);
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
          const fresh = await readStorageFreshLearned(slug, userSub);
          fresh.storedProgress.delete(stableUid);
          return new Set([...fresh.storedProgress, ...fresh.remoteCache]);
        }, userSub);
      } catch {
        return { stableUid, newCardPaid: false, dueClearPaid: false, newCardsLearnedToday: 0, skipped: 'storage-error' };
      }
    } else {
      if (settledState.reason === 'storage-error') {
        return { stableUid, newCardPaid: false, dueClearPaid: false, newCardsLearnedToday: 0, skipped: 'storage-error' };
      }
      skipped = 'progress-unsettled';
      // The ledger may already hold adopted anon stamps from today; count them for R7 but
      // never seed or write. A read failure only costs the count.
      try {
        ledger = (await readNewCardLedger(slug, userSub)).ledger;
      } catch {
        ledger = {};
      }
    }

    let newCardPaid = false;
    let stampAtMs: number | undefined;
    if (settledState.settled && newCardEligible) {
      const starterCard = await isStarterLessonCard(slug, stableUid);
      if ((starterCard || rating !== 'again') && !Object.prototype.hasOwnProperty.call(ledger, stableUid)) {
        stampAtMs = now.getTime();
        newCardPaid = !starterCard;
        ledger = { ...ledger, [stableUid]: stampAtMs };
      }
    }

    const previousDueClear = dueBefore > 0 && remainingDueCount === 0 ? await readDueClearMarker(slug, userSub) : null;
    const dueClearDay = dueBefore > 0 && remainingDueCount === 0 &&
      (previousDueClear == null || previousDueClear < formatDateKey(now)) ? formatDateKey(now) : undefined;
    return {
      stableUid,
      ...(stampAtMs != null ? { stampAtMs } : {}),
      ...(dueClearDay ? { dueClearDay } : {}),
      newCardPaid,
      dueClearPaid: dueClearDay != null,
      newCardsLearnedToday: countPaidOnDay(ledger, now),
      ...(skipped ? { skipped } : {}),
    };
  };
  return settleDeckRatingReward(slug, input.eventId, JSON.stringify([stableUid, now.getTime(), rating]),
    prepare, (pendingSlug, plan) => projectRatingReward(pendingSlug, plan, userSub), userSub);
}
