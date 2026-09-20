import { beforeEach, describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';

const store = new Map<string, string>();
const setItemCalls: string[] = [];
let throwOnGet: ((key: string) => boolean) | null = null;
let failSetItemFor: ((key: string) => boolean) | null = null;

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => {
      if (throwOnGet?.(key)) throw new Error(`storage read killed: ${key}`);
      return store.get(key) ?? null;
    }),
    setItem: vi.fn(async (key: string, value: string) => {
      setItemCalls.push(key);
      if (failSetItemFor?.(key)) throw new Error(`storage write killed: ${key}`);
      store.set(key, value);
    }),
    removeItem: vi.fn(async (key: string) => {
      store.delete(key);
    }),
    getAllKeys: vi.fn(async () => [...store.keys()]),
  },
}));

import { setActiveUserSubForStorage } from '../../src/review/storage';
import type { CardProgress, ReviewRating } from '../../src/review/model';
import { loadRewardWalletState } from '../../src/features/gacha/rewards/rewardWallet';
import { readNewCardLedger } from '../../src/features/gacha/rewards/newCardLedger';
import { settleRatingReward, ZERO_REWARD_STEP } from '../../src/features/gacha/rewards/sessionRewards';

const LEDGER_KEY = 'devcards:u:anon:recallsmith:newCardPullPaidUids:csharp';
const WALLET_KEY = 'devcards:u:anon:recallsmith:reward-wallet:v1';

function learned(uid: string): CardProgress {
  return { stableUid: uid, stage: 1, lastReviewedAt: 1_000, nextReviewAt: 2_000 };
}

describe('sessionRewards', () => {
  beforeEach(() => {
    store.clear();
    setItemCalls.length = 0;
    throwOnGet = null;
    failSetItemFor = null;
    setActiveUserSubForStorage(null);
  });

  it('never pays on again and pays exactly once on the first hard, good or easy', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.constantFrom<ReviewRating>('again', 'hard', 'good', 'easy')),
        async (ratings) => {
          store.clear();
          setActiveUserSubForStorage(null);

          const firstNonAgain = ratings.findIndex((r) => r !== 'again');
          let paidCount = 0;
          let paidIndex = -1;
          for (let i = 0; i < ratings.length; i += 1) {
            const step = await settleRatingReward({
              slug: 'csharp',
              stableUid: 'c1',
              rating: ratings[i],
              progressBefore: [],
              newCardEligible: true,
              dueBefore: 0,
              remainingDueCount: 0,
              now: new Date(2026, 0, 15, 12, 0, 0),
            });
            if (step.newCardPaid) {
              paidCount += 1;
              paidIndex = i;
            }
          }

          expect(paidCount).toBe(firstNonAgain === -1 ? 0 : 1);
          if (firstNonAgain !== -1) expect(paidIndex).toBe(firstNonAgain);
          expect((await loadRewardWalletState()).availablePulls).toBe(paidCount);
        },
      ),
    );
  });

  it('never pays for a card that was already learned when the ledger was first seeded', async () => {
    const step = await settleRatingReward({
      slug: 'csharp',
      stableUid: 'c1',
      rating: 'hard',
      progressBefore: [learned('c1')],
      newCardEligible: true,
      dueBefore: 0,
      remainingDueCount: 0,
      now: new Date(2026, 0, 15, 12, 0, 0),
    });

    expect(step.newCardPaid).toBe(false);
    expect(step.pulls).toBe(0);
    expect((await loadRewardWalletState()).availablePulls).toBe(0);
  });

  it('fires the due-clear pull once per local day and only on a due-to-zero transition', async () => {
    const day1 = new Date(2026, 0, 15, 9, 0, 0);
    const day1Later = new Date(2026, 0, 15, 22, 0, 0);
    const day2 = new Date(2026, 0, 16, 9, 0, 0);

    // Only R2 is under test here, so the new-card path is disabled.
    const run = (dueBefore: number, remainingDueCount: number, now: Date) =>
      settleRatingReward({
        slug: 'csharp',
        stableUid: 'c1',
        rating: 'good',
        progressBefore: [],
        newCardEligible: false,
        dueBefore,
        remainingDueCount,
        now,
      });

    expect((await run(2, 1, day1)).dueClearPaid).toBe(false); // still work left
    expect((await run(2, 0, day1)).dueClearPaid).toBe(true); // cleared, first today
    expect((await run(2, 0, day1Later)).dueClearPaid).toBe(false); // already paid today
    expect((await run(2, 0, day2)).dueClearPaid).toBe(true); // new day
    expect((await run(0, 0, day2)).dueClearPaid).toBe(false); // nothing was due
  });

  it('skips the new-card pull in sweep mode but still evaluates the due clear', async () => {
    const step = await settleRatingReward({
      slug: 'csharp',
      stableUid: 'c1',
      rating: 'hard',
      progressBefore: [],
      newCardEligible: false,
      dueBefore: 1,
      remainingDueCount: 0,
      now: new Date(2026, 0, 15, 12, 0, 0),
    });

    expect(step.newCardPaid).toBe(false);
    expect(step.dueClearPaid).toBe(true);
    expect(step.pulls).toBe(1);
  });

  it('writes the ledger before it touches the wallet', async () => {
    await settleRatingReward({
      slug: 'csharp',
      stableUid: 'c1',
      rating: 'good',
      progressBefore: [],
      newCardEligible: true,
      dueBefore: 0,
      remainingDueCount: 0,
      now: new Date(2026, 0, 15, 12, 0, 0),
    });

    expect(setItemCalls).toContain(WALLET_KEY);
    expect(setItemCalls).toContain(LEDGER_KEY);
    expect(setItemCalls.lastIndexOf(WALLET_KEY)).toBeGreaterThan(setItemCalls.lastIndexOf(LEDGER_KEY));
  });

  it('returns the zero step and leaves the wallet alone when storage fails', async () => {
    throwOnGet = () => true;
    const step = await settleRatingReward({
      slug: 'csharp',
      stableUid: 'c1',
      rating: 'good',
      progressBefore: [],
      newCardEligible: true,
      dueBefore: 0,
      remainingDueCount: 0,
      now: new Date(2026, 0, 15, 12, 0, 0),
    });

    expect(step).toEqual(ZERO_REWARD_STEP);
    expect(setItemCalls).not.toContain(WALLET_KEY);
  });

  it('reports pulls with a null wallet when the wallet write fails after the ledger', async () => {
    failSetItemFor = (key) => key === WALLET_KEY;
    const step = await settleRatingReward({
      slug: 'csharp',
      stableUid: 'c1',
      rating: 'good',
      progressBefore: [],
      newCardEligible: true,
      dueBefore: 0,
      remainingDueCount: 0,
      now: new Date(2026, 0, 15, 12, 0, 0),
    });

    expect(step.newCardPaid).toBe(true);
    expect(step.pulls).toBe(1);
    expect(step.walletAfter).toBeNull();
    // The ledger landed first, so the uid is banked; the crash only cost the grant.
    const { ledger } = await readNewCardLedger('csharp');
    expect('c1' in ledger).toBe(true);
  });

  it('never pays a new-card pull in sweep mode however the cards are rated, and pays the due clear at most once', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.constantFrom<ReviewRating>('again', 'hard', 'good', 'easy'), { minLength: 1, maxLength: 8 }),
        async (ratings) => {
          store.clear();
          setActiveUserSubForStorage(null);
          const now = new Date(2026, 0, 15, 12, 0, 0);

          for (const rating of ratings) {
            const step = await settleRatingReward({
              slug: 'csharp',
              stableUid: 'c1',
              rating,
              // c1 is new here (no learned entry), so the seed writes nothing for it.
              progressBefore: [],
              newCardEligible: false,
              dueBefore: 0,
              remainingDueCount: 0,
              now,
            });
            expect(step.newCardPaid).toBe(false);
            expect(step.pulls).toBe(0);
          }

          // R8 never stamps the uid, so R1 stays available to a later eligible run.
          expect((await readNewCardLedger('csharp')).ledger['c1']).toBeUndefined();

          const cleared = await settleRatingReward({
            slug: 'csharp',
            stableUid: 'c1',
            rating: 'good',
            progressBefore: [],
            newCardEligible: false,
            dueBefore: 2,
            remainingDueCount: 0,
            now,
          });
          expect(cleared.dueClearPaid).toBe(true);
          expect(cleared.pulls).toBe(1);

          const repeat = await settleRatingReward({
            slug: 'csharp',
            stableUid: 'c1',
            rating: 'good',
            progressBefore: [],
            newCardEligible: false,
            dueBefore: 2,
            remainingDueCount: 0,
            now,
          });
          expect(repeat.dueClearPaid).toBe(false);
        },
      ),
    );
  });
});
