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
import { adoptAnonNewCardLedger, readNewCardLedger, readNewCardLedgerSeed } from '../../src/features/gacha/rewards/newCardLedger';
import { readProgressSettled } from '../../src/features/gacha/rewards/progressSettled';
import { settleRatingReward, ZERO_REWARD_STEP } from '../../src/features/gacha/rewards/sessionRewards';

const LEDGER_KEY = 'devcards:u:anon:recallsmith:newCardPullPaidUids:csharp';
const SEEDED_KEY = 'devcards:u:anon:recallsmith:newCardPullSeeded:csharp';
const WALLET_KEY = 'devcards:u:anon:recallsmith:reward-wallet:v1';
const USER_LEDGER_KEY = 'devcards:u:user-a:recallsmith:newCardPullPaidUids:csharp';
const USER_SEEDED_KEY = 'devcards:u:user-a:recallsmith:newCardPullSeeded:csharp';
const USER_WALLET_KEY = 'devcards:u:user-a:recallsmith:reward-wallet:v1';
// The frozen progressSync.ts writes these only after a pull page came back and was applied
// (progressSettled.ts); their names are part of the gate's contract.
const USER_REMOTE_CACHE_KEY = 'devcards:u:user-a:sync:remoteCache:v1:csharp';
const USER_CURSOR_MS_KEY = 'devcards:u:user-a:sync:cursorMs:v1';
const USER_CURSOR_TOKEN_KEY = 'devcards:u:user-a:sync:cursor:v2';

function learned(uid: string): CardProgress {
  return { stableUid: uid, stage: 1, lastReviewedAt: 1_000, nextReviewAt: 2_000 };
}
function totalPulls(wallet: { availablePulls: number; reservePulls: number }): number {
  return wallet.availablePulls + wallet.reservePulls;
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

    expect(step).toEqual({ ...ZERO_REWARD_STEP, skipped: 'storage-error' });
    expect(setItemCalls).not.toContain(WALLET_KEY);
  });

  it('writes the seeded marker on the first settled rating and never again', async () => {
    const now = new Date(2026, 0, 15, 12, 0, 0);
    await settleRatingReward({
      slug: 'csharp',
      stableUid: 'c1',
      rating: 'good',
      progressBefore: [learned('old')],
      newCardEligible: true,
      dueBefore: 0,
      remainingDueCount: 0,
      now,
    });
    expect(JSON.parse(store.get(SEEDED_KEY)!)).toEqual({ seededAtMs: now.getTime(), backfilled: 1 });
    expect(JSON.parse(store.get(LEDGER_KEY)!)).toEqual({ old: 0, c1: now.getTime() });

    // Later ratings with richer progress never re-seed: the marker keeps its first stamp.
    await settleRatingReward({
      slug: 'csharp',
      stableUid: 'c2',
      rating: 'good',
      progressBefore: [learned('old'), learned('c1'), learned('c3')],
      newCardEligible: true,
      dueBefore: 0,
      remainingDueCount: 0,
      now: new Date(2026, 0, 16, 12, 0, 0),
    });
    expect(JSON.parse(store.get(SEEDED_KEY)!)).toEqual({ seededAtMs: now.getTime(), backfilled: 1 });
    // c3 was NOT backfilled (the seed already ran), so it pays when it is first rated hard+.
    const c3 = await settleRatingReward({
      slug: 'csharp',
      stableUid: 'c3',
      rating: 'hard',
      progressBefore: [learned('old'), learned('c1'), learned('c3')],
      newCardEligible: true,
      dueBefore: 0,
      remainingDueCount: 0,
      now: new Date(2026, 0, 16, 12, 0, 0),
    });
    expect(c3.newCardPaid).toBe(true);
  });

  describe('signed in: seeding and R1 wait for the first remote progress pull', () => {
    const day = new Date(2026, 0, 15, 12, 0, 0);
    const settle = (stableUid: string, progressBefore: CardProgress[], overrides: Partial<Parameters<typeof settleRatingReward>[0]> = {}) =>
      settleRatingReward({
        slug: 'csharp',
        stableUid,
        rating: 'good',
        progressBefore,
        newCardEligible: true,
        dueBefore: 0,
        remainingDueCount: 0,
        now: day,
        ...overrides,
      });

    beforeEach(() => {
      setActiveUserSubForStorage('user-a');
    });

    it('reports the partition state through the same keys the settle path reads', async () => {
      expect(await readProgressSettled('csharp')).toEqual({ settled: false, reason: 'no-pull-landed' });
      store.set(USER_CURSOR_TOKEN_KEY, 'abc');
      expect(await readProgressSettled('csharp')).toEqual({ settled: true, reason: 'remote-cursor' });
      store.delete(USER_CURSOR_TOKEN_KEY);
      store.set(USER_CURSOR_MS_KEY, '123');
      expect(await readProgressSettled('csharp')).toEqual({ settled: true, reason: 'remote-cursor' });
      store.delete(USER_CURSOR_MS_KEY);
      store.set(USER_REMOTE_CACHE_KEY, '{}');
      expect(await readProgressSettled('csharp')).toEqual({ settled: true, reason: 'remote-cache' });
      // A different deck's cache does not settle this one on its own ...
      store.delete(USER_REMOTE_CACHE_KEY);
      store.set('devcards:u:user-a:sync:remoteCache:v1:aws', '{}');
      expect(await readProgressSettled('csharp')).toEqual({ settled: false, reason: 'no-pull-landed' });
      // ... and a storage error reads as unsettled (fail closed).
      throwOnGet = () => true;
      expect(await readProgressSettled('csharp')).toEqual({ settled: false, reason: 'storage-error' });
      throwOnGet = null;
      setActiveUserSubForStorage(null);
      expect(await readProgressSettled('csharp')).toEqual({ settled: true, reason: 'anon' });
    });

    it('unsettled: no seed, no R1, R2 unaffected, and the reason is reported', async () => {
      const step = await settle('c1', [], { dueBefore: 2, remainingDueCount: 0 });
      expect(step.skipped).toBe('progress-unsettled');
      expect(step.newCardPaid).toBe(false);
      expect(step.dueClearPaid).toBe(true);
      expect(step.pulls).toBe(1);
      expect(step.walletAfter?.availablePulls).toBe(1);
      expect(store.has(USER_LEDGER_KEY)).toBe(false);
      expect(store.has(USER_SEEDED_KEY)).toBe(false);

      // Every further rating before the pull lands behaves the same, whatever the card.
      for (const uid of ['c1', 'c2', 'c3']) {
        const again = await settle(uid, [learned('c1')], { rating: 'hard' });
        expect(again.skipped).toBe('progress-unsettled');
        expect(again.newCardPaid).toBe(false);
        expect(again.pulls).toBe(0);
      }
      expect(store.has(USER_LEDGER_KEY)).toBe(false);
      expect(store.has(USER_SEEDED_KEY)).toBe(false);
      expect((await loadRewardWalletState()).availablePulls).toBe(1);
    });

    it('settled later: seeds with the backfill and only the genuinely new card pays, exactly once', async () => {
      // Two ratings before the pull: nothing is banked.
      expect((await settle('c1', [])).skipped).toBe('progress-unsettled');
      expect((await settle('c2', [learned('c1')])).skipped).toBe('progress-unsettled');

      // The pull lands: the account had learned c1 and c2 here plus c10..c19 elsewhere.
      store.set(USER_REMOTE_CACHE_KEY, '{}');
      const synced: CardProgress[] = [learned('c1'), learned('c2'), ...Array.from({ length: 10 }, (_, i) => learned(`c${10 + i}`))];

      // First settled rating, on the brand-new c3: seed backfills all 12, then c3 pays.
      const first = await settle('c3', synced);
      expect(first.skipped).toBeUndefined();
      expect(first.newCardPaid).toBe(true);
      expect(first.pulls).toBe(1);
      expect(await readNewCardLedgerSeed('csharp')).toEqual({ seededAtMs: day.getTime(), backfilled: 12 });
      const { ledger } = await readNewCardLedger('csharp');
      for (const p of synced) expect(ledger[p.stableUid]).toBe(0);
      expect(ledger.c3).toBe(day.getTime());

      // None of the synced cards pays, and c3 never pays again.
      let paid = 0;
      for (const p of [...synced, learned('c3')]) {
        const step = await settle(p.stableUid, [...synced, learned('c3')], { rating: 'hard' });
        expect(step.skipped).toBeUndefined();
        if (step.newCardPaid) paid += 1;
      }
      expect(paid).toBe(0);
      expect(totalPulls(await loadRewardWalletState())).toBe(1);
    });

    it('anon adoption before the pull neither seeds the user partition nor lets adopted stamps pay twice', async () => {
      // Signed out: one card paid on the anon partition.
      setActiveUserSubForStorage(null);
      const anon = await settle('c0', []);
      expect(anon.newCardPaid).toBe(true);

      // Sign in and adopt (authStore order: adoptAnonGachaState runs before the first pull).
      setActiveUserSubForStorage('user-a');
      expect(await adoptAnonNewCardLedger()).toEqual({ ledgerDecks: 1, uidsAdded: 1 });
      expect(store.has(USER_LEDGER_KEY)).toBe(true);
      expect(store.has(USER_SEEDED_KEY)).toBe(false);

      // Still unsettled: the adopted ledger's stamp counts for R7, but nothing seeds or pays.
      const before = await settle('c1', []);
      expect(before.skipped).toBe('progress-unsettled');
      expect(before.newCardsLearnedToday).toBe(1);
      expect(store.has(USER_SEEDED_KEY)).toBe(false);

      // Pull lands with 99 account-learned cards: the seed keeps c0's stamp and backfills the rest.
      store.set(USER_CURSOR_MS_KEY, '1000');
      const synced: CardProgress[] = Array.from({ length: 99 }, (_, i) => learned(`c${i + 1}`));
      let paid = 0;
      for (const p of synced) {
        const step = await settle(p.stableUid, [learned('c0'), ...synced], { rating: 'hard' });
        if (step.newCardPaid) paid += 1;
      }
      expect(paid).toBe(0);
      expect((await settle('c0', [learned('c0'), ...synced])).newCardPaid).toBe(false);
      const { ledger } = await readNewCardLedger('csharp');
      expect(ledger.c0).toBe(day.getTime());
      expect(store.has(USER_WALLET_KEY)).toBe(false);
    });
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
