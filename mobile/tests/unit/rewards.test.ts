import { describe, expect, it, vi, beforeEach } from 'vitest';

const store = new Map<string, string>();

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

  it('computes no pulls below the minimum goal', () => {
    expect(computeSessionRewardPulls({ sessionDone: 0, sessionLimit: 4, minimumGoal: 1 })).toBe(0);
  });

  it('computes one pull at the minimum goal', () => {
    expect(computeSessionRewardPulls({ sessionDone: 1, sessionLimit: 4, minimumGoal: 1 })).toBe(1);
  });

  it('computes two pulls for a full clear', () => {
    expect(computeSessionRewardPulls({ sessionDone: 4, sessionLimit: 4, minimumGoal: 1 })).toBe(2);
  });

  it('reports whether the wallet can still accept more pulls', () => {
    expect(canAcceptMorePulls({ availablePulls: 0, reservePulls: 0 })).toBe(true);
    expect(canAcceptMorePulls({ availablePulls: 30, reservePulls: 4 })).toBe(true);
    expect(canAcceptMorePulls({ availablePulls: 30, reservePulls: 5 })).toBe(false);
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
