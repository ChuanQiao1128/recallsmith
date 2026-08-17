import { describe, expect, it, vi, beforeEach } from 'vitest';

const store = new Map<string, string>();

// The wallet key is user-scoped now; with no signed-in user the real
// helper resolves to the "anon" partition, which is what these tests
// poke at directly.
const WALLET_KEY = 'devcards:u:anon:recallsmith:reward-wallet:v1';

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => store.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
  },
}));

import {
  applyRewardToWallet,
  applySessionRewardToWallet,
  canAcceptMorePulls,
  loadRewardWalletState,
  seedStarterPullsIfNeeded,
  STARTER_PULL_GRANT,
} from '../../src/features/gacha/rewards/rewardWallet';
import { computeSessionRewardPulls, resolveSessionReward } from '../../src/features/gacha/rewards/rewardResolver';

describe('reward wallet', () => {
  beforeEach(() => {
    store.clear();
  });

  it('fills available pulls first, then reserve, then drops overflow', () => {
    const wallet = applyRewardToWallet({ availablePulls: 29, reservePulls: 4 }, 3);

    expect(wallet).toMatchObject({
      availablePulls: 30,
      reservePulls: 5,
      appliedToAvailable: 1,
      appliedToReserve: 1,
      dropped: 1,
    });
  });

  it('drops rewards when both available and reserve are already full', () => {
    const wallet = applyRewardToWallet({ availablePulls: 30, reservePulls: 5 }, 2);

    expect(wallet.availablePulls).toBe(30);
    expect(wallet.reservePulls).toBe(5);
    expect(wallet.dropped).toBe(2);
  });

  it('builds a neutral progress summary when no pull reward is earned', () => {
    const reward = resolveSessionReward({
      sessionDone: 0,
      sessionLimit: 4,
      minimumGoal: 1,
      wallet: { availablePulls: 3, reservePulls: 0 },
    });

    expect(reward.rewardPulls).toBe(0);
    expect(reward.rewardMessage).toMatch(/progress saved/i);
  });

  // v3 reward calibration: only full clear earns pulls (was tiered
  // formula with 1 pull for min, 2 for full). With 5-card sessions the
  // run is short enough that completion is the right unit of reward.
  it('computes no pulls when the session is empty', () => {
    expect(computeSessionRewardPulls({ sessionDone: 0, sessionLimit: 5, minimumGoal: 1 })).toBe(0);
  });

  it('computes no pulls for a partial run (below full clear)', () => {
    expect(computeSessionRewardPulls({ sessionDone: 3, sessionLimit: 5, minimumGoal: 1 })).toBe(0);
    expect(computeSessionRewardPulls({ sessionDone: 4, sessionLimit: 5, minimumGoal: 1 })).toBe(0);
  });

  it('computes one pull for a full clear', () => {
    expect(computeSessionRewardPulls({ sessionDone: 5, sessionLimit: 5, minimumGoal: 1 })).toBe(1);
  });

  it('reports whether the wallet can still accept more pulls', () => {
    expect(canAcceptMorePulls({ availablePulls: 0, reservePulls: 0 })).toBe(true);
    expect(canAcceptMorePulls({ availablePulls: 30, reservePulls: 4 })).toBe(true);
    expect(canAcceptMorePulls({ availablePulls: 30, reservePulls: 5 })).toBe(false);
  });

  // Brand-new-user starter grant — seeds 3 pulls on first boot so a
  // user can experience their first ceremony without first having to
  // study 5 cards. Idempotent (flag-guarded), and skipped when the
  // wallet is already non-empty (pre-existing users).
  describe('starter pull seeding', () => {
    it('grants 3 starter pulls to a brand-new (empty) wallet on first boot', async () => {
      const result = await seedStarterPullsIfNeeded();
      expect(result.seeded).toBe(true);
      expect(result.wallet.availablePulls).toBe(STARTER_PULL_GRANT);
      expect(result.wallet.reservePulls).toBe(0);
      const persisted = await loadRewardWalletState();
      expect(persisted.availablePulls).toBe(STARTER_PULL_GRANT);
    });

    it('does not re-seed once the seeded flag is set, even if user spent down to 0', async () => {
      await seedStarterPullsIfNeeded(); // first boot — grants 3
      // Simulate user spending all pulls — write directly to mock store.
      store.set(WALLET_KEY, JSON.stringify({ availablePulls: 0, reservePulls: 0 }));
      const second = await seedStarterPullsIfNeeded();
      expect(second.seeded).toBe(false);
      expect(second.wallet.availablePulls).toBe(0);
    });

    it('does not grant pulls to a pre-existing wallet that already has reward pulls', async () => {
      // Pre-existing user — wallet already populated before starter feature shipped.
      store.set(WALLET_KEY, JSON.stringify({ availablePulls: 5, reservePulls: 0 }));
      const result = await seedStarterPullsIfNeeded();
      expect(result.seeded).toBe(false);
      expect(result.wallet.availablePulls).toBe(5);
    });

    it('marks the wallet as seeded after a no-op skip so future boots also skip', async () => {
      store.set(WALLET_KEY, JSON.stringify({ availablePulls: 5, reservePulls: 0 }));
      await seedStarterPullsIfNeeded(); // skipped — but flag should be set
      // Now simulate that pre-existing wallet draining to 0.
      store.set(WALLET_KEY, JSON.stringify({ availablePulls: 0, reservePulls: 0 }));
      const second = await seedStarterPullsIfNeeded();
      expect(second.seeded).toBe(false); // flag prevents re-seed
      expect(second.wallet.availablePulls).toBe(0);
    });
  });

  it('persists and deduplicates a session reward application', async () => {
    const first = await applySessionRewardToWallet('session-1', 3);
    const second = await applySessionRewardToWallet('session-1', 3);
    const wallet = await loadRewardWalletState();

    expect(first.applied.rewardPulls).toBe(3);
    expect(first.alreadyApplied).toBe(false);
    expect(first.walletBefore.availablePulls).toBe(0);
    expect(first.walletAfter.availablePulls).toBe(3);
    expect(second.alreadyApplied).toBe(true);
    expect(second.walletAfter.availablePulls).toBe(3);
    expect(wallet.availablePulls).toBe(3);
    expect(wallet.reservePulls).toBe(0);
  });
});
