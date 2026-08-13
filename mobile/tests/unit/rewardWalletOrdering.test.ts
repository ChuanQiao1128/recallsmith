import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();
// Crash injection hook: returns true for the key whose write should be
// killed, so a test can stop the process exactly between the dedupe
// write and the wallet write.
let failSetItemFor: ((key: string) => boolean) | null = null;
const setItemCalls: string[] = [];

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => {
      // Yield a microtask on every read so two concurrent settlements
      // genuinely interleave instead of running to completion in order.
      await Promise.resolve();
      return store.get(key) ?? null;
    }),
    setItem: vi.fn(async (key: string, value: string) => {
      setItemCalls.push(key);
      await Promise.resolve();
      if (failSetItemFor?.(key)) {
        throw new Error(`storage write killed: ${key}`);
      }
      store.set(key, value);
    }),
  },
}));

import {
  applySessionRewardToWallet,
  loadRewardWalletState,
} from '../../src/features/gacha/rewards/rewardWallet';

const WALLET_KEY = 'recallsmith:reward-wallet:v1';
const DEDUPE_KEY = 'recallsmith:reward-session:session-42';

describe('session reward idempotency ordering', () => {
  beforeEach(() => {
    store.clear();
    setItemCalls.length = 0;
    failSetItemFor = null;
  });

  it('writes the dedupe record before it touches the wallet', async () => {
    await applySessionRewardToWallet('session-42', 3);

    // The order is the guarantee. Issuing both writes together (or the
    // wallet first) leaves a window where the payout is durable and the
    // record of it is not, which is exactly how a grant gets repeated.
    expect(setItemCalls).toEqual([DEDUPE_KEY, WALLET_KEY]);
  });

  it('under-grants rather than double-grants when the wallet write is killed', async () => {
    failSetItemFor = (key) => key === WALLET_KEY;

    await expect(applySessionRewardToWallet('session-42', 3)).rejects.toThrow(
      /storage write killed/,
    );

    // The dedupe record landed first, so the crash cost the user one
    // reward instead of arming a second payout on retry. That is the
    // side we chose: support can re-grant pulls, it cannot un-grant them.
    expect(store.has(DEDUPE_KEY)).toBe(true);
    expect(await loadRewardWalletState()).toEqual({ availablePulls: 0, reservePulls: 0 });

    failSetItemFor = null;
    const retry = await applySessionRewardToWallet('session-42', 3);

    expect(retry.alreadyApplied).toBe(true);
    expect(await loadRewardWalletState()).toEqual({ availablePulls: 0, reservePulls: 0 });
  });

  it('grants a concurrently settled session exactly once', async () => {
    const [first, second] = await Promise.all([
      applySessionRewardToWallet('session-42', 3),
      applySessionRewardToWallet('session-42', 3),
    ]);

    expect(first.walletAfter).toEqual({ availablePulls: 3, reservePulls: 0 });
    expect(second.walletAfter).toEqual({ availablePulls: 3, reservePulls: 0 });
    expect(await loadRewardWalletState()).toEqual({ availablePulls: 3, reservePulls: 0 });
  });

  it('still grants once when the second settle starts after the first finished', async () => {
    await applySessionRewardToWallet('session-42', 3);
    const second = await applySessionRewardToWallet('session-42', 3);

    expect(second.alreadyApplied).toBe(true);
    expect(second.applied.rewardPulls).toBe(3);
    expect(await loadRewardWalletState()).toEqual({ availablePulls: 3, reservePulls: 0 });
  });
});
