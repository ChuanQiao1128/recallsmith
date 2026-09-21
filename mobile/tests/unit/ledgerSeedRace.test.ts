import { beforeEach, describe, expect, it, vi } from 'vitest';

// Promoted from the 2026-09-21 review repro. Before the seeded marker and the settled gate,
// the three scenarios below paid 99, 0 and 99 pulls for cards the account had already learned
// (review findings A and B). Every one of them must now pay 0 for those cards, while the one
// genuinely new card in each still pays exactly once.

const store = new Map<string, string>();

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => store.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    removeItem: vi.fn(async (key: string) => {
      store.delete(key);
    }),
    getAllKeys: vi.fn(async () => [...store.keys()]),
  },
}));

import { loadDeckProgress, setActiveUserSubForStorage } from '../../src/review/storage';
import type { CardProgress } from '../../src/review/model';
import { loadRewardWalletState } from '../../src/features/gacha/rewards/rewardWallet';
import { adoptAnonNewCardLedger, readNewCardLedger, readNewCardLedgerSeed } from '../../src/features/gacha/rewards/newCardLedger';
import { settleRatingReward } from '../../src/features/gacha/rewards/sessionRewards';

const SLUG = 'aws-saa-c03';
const USER_LEDGER_KEY = `devcards:u:user-a:recallsmith:newCardPullPaidUids:${SLUG}`;
const USER_SEEDED_KEY = `devcards:u:user-a:recallsmith:newCardPullSeeded:${SLUG}`;
const ANON_LEDGER_KEY = `devcards:u:anon:recallsmith:newCardPullPaidUids:${SLUG}`;
// Written by the frozen progressSync.ts only once a pull page for this deck has been cached.
const USER_REMOTE_CACHE_KEY = `devcards:u:user-a:sync:remoteCache:v1:${SLUG}`;

function learned(uid: string): CardProgress {
  return { stableUid: uid, stage: 2, lastReviewedAt: 1_000, nextReviewAt: 2_000 };
}

const deck: any = {
  Slug: SLUG,
  Title: 'AWS SAA-C03',
  Locale: 'en-US',
  Version: '1',
  DeckType: 1,
  TotalCards: 100,
  Cards: Array.from({ length: 100 }, (_, i) => ({ StableUid: `c${i}`, OrderInDeck: i + 1, Difficulty: 1, Revision: 1, Question: `Q${i}` })),
};

function pullLands() {
  store.set(USER_REMOTE_CACHE_KEY, JSON.stringify({}));
}

describe('ledger seed vs. first pull ordering', () => {
  beforeEach(() => {
    store.clear();
    setActiveUserSubForStorage('user-a');
  });

  it('race: a rating before the pull lands neither seeds nor pays; the synced-learned cards never pay afterwards', async () => {
    // Fresh sign-in, pull not landed: loadDeckProgress returns the initial (all-new) progress.
    const initial = await loadDeckProgress(deck);
    expect(initial.every((p) => !((p.lastReviewedAt ?? 0) > 0))).toBe(true);

    // First rating on c0 while unsettled: no seed, no pay, reason reported.
    const step0 = await settleRatingReward({
      slug: SLUG, stableUid: 'c0', rating: 'good', progressBefore: initial,
      newCardEligible: true, dueBefore: 0, remainingDueCount: 0, now: new Date(2026, 8, 21, 10),
    });
    expect(step0.newCardPaid).toBe(false);
    expect(step0.skipped).toBe('progress-unsettled');
    expect(store.has(USER_LEDGER_KEY)).toBe(false);
    expect(store.has(USER_SEEDED_KEY)).toBe(false);

    // The pull lands: c0 (this device's own push) and 99 other cards are learned on the account.
    pullLands();
    const synced: CardProgress[] = deck.Cards.map((c: any) => learned(c.StableUid));

    // Next session: the first settled rating seeds from the synced progress, so nothing pays.
    let paid = 0;
    for (let i = 0; i < 100; i += 1) {
      const step = await settleRatingReward({
        slug: SLUG, stableUid: `c${i}`, rating: 'hard', progressBefore: synced,
        newCardEligible: true, dueBefore: 100, remainingDueCount: 99 - i, now: new Date(2026, 8, 22, 10 + (i % 8)),
      });
      expect(step.skipped).toBeUndefined();
      if (step.newCardPaid) paid += 1;
    }
    expect(paid).toBe(0);
    expect(await readNewCardLedgerSeed(SLUG)).toEqual({ seededAtMs: new Date(2026, 8, 22, 10).getTime(), backfilled: 100 });
    const wallet = await loadRewardWalletState();
    // R2 fired once (dueBefore 100 → remaining 0 on the last card); R1 paid nothing.
    expect(wallet.availablePulls + wallet.reservePulls).toBe(1);

    // A card the account never learned still pays, once.
    const first = await settleRatingReward({
      slug: SLUG, stableUid: 'c100', rating: 'good', progressBefore: synced,
      newCardEligible: true, dueBefore: 0, remainingDueCount: 0, now: new Date(2026, 8, 23, 10),
    });
    const second = await settleRatingReward({
      slug: SLUG, stableUid: 'c100', rating: 'good', progressBefore: [...synced, learned('c100')],
      newCardEligible: true, dueBefore: 0, remainingDueCount: 0, now: new Date(2026, 8, 24, 10),
    });
    expect(first.newCardPaid).toBe(true);
    expect(second.newCardPaid).toBe(false);
  });

  it('control: seeded AFTER the pull landed, no synced-learned card pays', async () => {
    pullLands();
    const synced: CardProgress[] = deck.Cards.map((c: any) => learned(c.StableUid));
    let paid = 0;
    for (let i = 0; i < 100; i += 1) {
      const step = await settleRatingReward({
        slug: SLUG, stableUid: `c${i}`, rating: 'hard', progressBefore: synced,
        newCardEligible: true, dueBefore: 100, remainingDueCount: 99 - i, now: new Date(2026, 8, 22, 10),
      });
      if (step.newCardPaid) paid += 1;
    }
    expect(paid).toBe(0);
  });

  it('an adopted anon ledger does not count as a seed: the user partition still backfills once the pull lands', async () => {
    // Anonymous: user rated one card of this deck post-OTA before signing in.
    setActiveUserSubForStorage(null);
    const initial = await loadDeckProgress(deck);
    const anonStep = await settleRatingReward({
      slug: SLUG, stableUid: 'c0', rating: 'good', progressBefore: initial,
      newCardEligible: true, dueBefore: 0, remainingDueCount: 0, now: new Date(2026, 8, 21, 10),
    });
    expect(anonStep.newCardPaid).toBe(true);
    expect(store.has(ANON_LEDGER_KEY)).toBe(true);

    // Sign in: authStore.applySessionToState → setActiveUserSub → adoptAnonGachaState (before setSyncAccessToken / pull).
    setActiveUserSubForStorage('user-a');
    await adoptAnonNewCardLedger();
    expect((await readNewCardLedger(SLUG)).present).toBe(true);
    expect(await readNewCardLedgerSeed(SLUG)).toBeNull();

    // Pull lands afterwards: 99 account-learned cards. The first signed-in rating seeds from them.
    pullLands();
    const synced: CardProgress[] = deck.Cards.map((c: any, i: number) => (i === 0 ? initial[0] : learned(c.StableUid)));
    let paid = 0;
    for (let i = 1; i < 100; i += 1) {
      const step = await settleRatingReward({
        slug: SLUG, stableUid: `c${i}`, rating: 'good', progressBefore: synced,
        newCardEligible: true, dueBefore: 99, remainingDueCount: 99 - i, now: new Date(2026, 8, 22, 10),
      });
      if (step.newCardPaid) paid += 1;
    }
    expect(paid).toBe(0);
    // c0 keeps the stamp it earned on the anon partition and does not pay again.
    expect((await readNewCardLedger(SLUG)).ledger.c0).toBe(new Date(2026, 8, 21, 10).getTime());
    const again = await settleRatingReward({
      slug: SLUG, stableUid: 'c0', rating: 'good', progressBefore: synced,
      newCardEligible: true, dueBefore: 0, remainingDueCount: 0, now: new Date(2026, 8, 23, 10),
    });
    expect(again.newCardPaid).toBe(false);
  });
});
