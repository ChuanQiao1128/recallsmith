import { beforeEach, describe, expect, it, vi } from 'vitest';

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
    multiGet: vi.fn(async (keys: string[]) => keys.map((k) => [k, store.get(k) ?? null] as [string, string | null])),
  },
}));

import { setActiveUserSubForStorage } from '../../src/review/storage';
import { setActiveDeckSlug } from '../../src/content/activeDeck';
import { invalidateDrawStateCache } from '../../src/features/gacha/draw/drawStateCache';
import { saveDrawState } from '../../src/features/gacha/draw/drawStateStore';
import type { DeckSummary } from '../../src/features/gacha/contracts';
import { loadRewardWalletState } from '../../src/features/gacha/rewards/rewardWallet';
import { loadDeckWallet } from '../../src/features/gacha/rewards/deckWallet';
import { settleRatingReward } from '../../src/features/gacha/rewards/sessionRewards';
import { applyEconomyFloorIfStarved, prepareHomeDeckWallets } from '../../src/features/gacha/rewards/economyFloor';

const EMPTY = { availablePulls: 0, reservePulls: 0 };

function deckSummary(over: Partial<DeckSummary> & { slug: string }): DeckSummary {
  return {
    slug: over.slug,
    title: over.title ?? over.slug,
    locale: 'en',
    version: '1',
    deckType: 0,
    totalCards: over.totalCards ?? 0,
    localCards: over.localCards ?? 0,
    studyCards: over.studyCards ?? 0,
    canStudy: over.canStudy ?? true,
    dueToday: over.dueToday ?? 0,
    plannedToday: over.plannedToday ?? 0,
    newToday: over.newToday ?? 0,
    masteredApprox: over.masteredApprox ?? 0,
    percent: over.percent ?? 0,
    ownedCount: over.ownedCount,
  };
}

function settle(slug: string, over: Partial<Parameters<typeof settleRatingReward>[0]> = {}) {
  return settleRatingReward({
    slug,
    stableUid: 'c1',
    rating: 'good',
    progressBefore: [],
    newCardEligible: true,
    dueBefore: 0,
    remainingDueCount: 0,
    now: new Date(2026, 0, 15, 12, 0, 0),
    ...over,
  });
}

describe('per-pack economy rewards', () => {
  beforeEach(async () => {
    store.clear();
    invalidateDrawStateCache();
    // Signed out: readProgressSettled is settled for the anon partition, so R1/R2
    // fire without a remote-progress cursor.
    setActiveUserSubForStorage(null);
    await setActiveDeckSlug(null);
  });

  it('pays the new-card pull into the pack that was studied and never into the legacy wallet', async () => {
    const step = await settle('csharp', { stableUid: 'x1' });
    expect(step.newCardPaid).toBe(true);
    expect(step.pulls).toBe(1);

    expect(await loadDeckWallet('csharp')).toEqual({ availablePulls: 1, reservePulls: 0 });
    // The other pack and the legacy global wallet are untouched.
    expect(await loadDeckWallet('aws')).toEqual(EMPTY);
    expect(await loadRewardWalletState()).toEqual(EMPTY);
  });

  it('pays the due-clear pull once per pack per local day', async () => {
    const now = new Date(2026, 0, 15, 12, 0, 0);
    const r2 = (slug: string) =>
      settle(slug, { newCardEligible: false, dueBefore: 2, remainingDueCount: 0, now });

    expect((await r2('csharp')).dueClearPaid).toBe(true);
    expect((await r2('aws')).dueClearPaid).toBe(true); // a different pack still pays
    expect((await r2('csharp')).dueClearPaid).toBe(false); // csharp already paid today

    expect(await loadDeckWallet('csharp')).toEqual({ availablePulls: 1, reservePulls: 0 });
    expect(await loadDeckWallet('aws')).toEqual({ availablePulls: 1, reservePulls: 0 });
  });

  it('grants the daily floor pull to each starved pack once per day', async () => {
    const now = new Date(2026, 0, 15, 9, 0, 0);
    const floor = (slug: string) =>
      applyEconomyFloorIfStarved({ slug, ownedNewCount: 0, dueCount: 0, wallet: EMPTY, now });

    expect((await floor('csharp')).granted).toBe(1);
    expect((await floor('aws')).granted).toBe(1);
    // Same day, csharp again: no second floor pull.
    const repeat = await floor('csharp');
    expect(repeat.granted).toBe(0);
    expect(repeat.reason).toBe('already-granted-today');

    expect(await loadDeckWallet('csharp')).toEqual({ availablePulls: 1, reservePulls: 0 });
    expect(await loadDeckWallet('aws')).toEqual({ availablePulls: 1, reservePulls: 0 });
  });

  it('never floors a pack that has pulls, work to study or a complete collection', async () => {
    const now = new Date(2026, 0, 15, 9, 0, 0);

    // Has pulls: not starved.
    const withPulls = await applyEconomyFloorIfStarved({
      slug: 'has-pulls',
      ownedNewCount: 0,
      dueCount: 0,
      wallet: { availablePulls: 2, reservePulls: 0 },
      now,
    });
    expect(withPulls.granted).toBe(0);

    // Work to study (a new card owned): not starved.
    const withWork = await applyEconomyFloorIfStarved({
      slug: 'has-work',
      ownedNewCount: 1,
      dueCount: 0,
      wallet: EMPTY,
      now,
    });
    expect(withWork.granted).toBe(0);

    // Complete collection: prepareHomeDeckWallets skips the floor entirely. Seed
    // owned draw state so bootstrap is skipped too, isolating the floor decision.
    await saveDrawState('complete', { owned: ['a', 'b'], pity: null });
    const wallets = await prepareHomeDeckWallets({
      deckSummaries: [deckSummary({ slug: 'complete', totalCards: 2, ownedCount: 2, newToday: 0, dueToday: 0 })],
      now,
    });
    expect(wallets.complete ?? EMPTY).toEqual(EMPTY);
  });

  it('prepares Home wallets: migrate, bootstrap, then floor', async () => {
    const now = new Date(2026, 0, 15, 9, 0, 0);
    // A never-drawn installed pack: no legacy balance to migrate, no owned cards,
    // no pulls. Bootstrap runs before the floor, so it ends with 3 -- not 1 (a
    // lone floor pull) and not 4 (bootstrap + floor).
    const wallets = await prepareHomeDeckWallets({
      deckSummaries: [deckSummary({ slug: 'fresh', totalCards: 50, ownedCount: 0, newToday: 0, dueToday: 0 })],
      now,
    });
    expect(wallets.fresh).toEqual({ availablePulls: 3, reservePulls: 0 });
    expect(await loadDeckWallet('fresh')).toEqual({ availablePulls: 3, reservePulls: 0 });
  });

  it('prepares Home wallets with no bootstrap and no floor while the starter lesson is open (R22 §4)', async () => {
    const now = new Date(2026, 0, 15, 9, 0, 0);
    store.set('recallsmith:onboarding:stage:v1', 'starter');
    const summaries = [
      deckSummary({ slug: 'fresh', totalCards: 50, ownedCount: 5, newToday: 5, dueToday: 0 }),
      deckSummary({ slug: 'other', totalCards: 50, ownedCount: 0, newToday: 0, dueToday: 0 }),
    ];
    const during = await prepareHomeDeckWallets({ deckSummaries: summaries, now });
    expect(during.fresh ?? EMPTY).toEqual(EMPTY);
    expect(during.other ?? EMPTY).toEqual(EMPTY);

    // The lesson completes: the next Home load bootstraps every never-drawn pack as before.
    store.set('recallsmith:onboarding:stage:v1', 'done');
    const after = await prepareHomeDeckWallets({ deckSummaries: summaries, now });
    expect(after.fresh).toEqual({ availablePulls: 3, reservePulls: 0 });
    expect(after.other).toEqual({ availablePulls: 3, reservePulls: 0 });
  });
});

