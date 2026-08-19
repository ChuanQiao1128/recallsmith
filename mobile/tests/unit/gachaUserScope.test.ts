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
  },
}));

// The real scope helper is under test here, so review/storage is NOT
// mocked. Switching accounts goes through the same call the auth layer
// makes, which is the only way a test can prove the switch takes effect
// without waiting out the sub cache TTL.
import { setActiveUserSubForStorage } from '../../src/review/storage';
import {
  loadDrawState,
  loadDrawHistory,
  appendDrawHistory,
  saveDrawState,
} from '../../src/features/gacha/draw/drawStateStore';
// store.clear() below wipes the keys behind the store's back, the same way the
// debug reset does in production -- and, like production, the in-memory read
// model has to be told or one account's collection leaks into the next test.
import { invalidateDrawStateCache } from '../../src/features/gacha/draw/drawStateCache';
import {
  applySessionRewardToWallet,
  loadRewardWalletState,
  saveRewardWalletState,
  seedStarterPullsIfNeeded,
  STARTER_PULL_GRANT,
} from '../../src/features/gacha/rewards/rewardWallet';

const SLUG = 'csharp';

// Was ownedStore.markCardsOwned / loadOwnedSet, a module with no callers
// in src/ that was deleted with issue #11. Reproduced here rather than
// swapped for a bare saveDrawState, because the read-modify-write shape
// is load-bearing for what these tests check: the write has to resolve
// the *active* scope's key at call time, and a blind overwrite would
// still pass a broken-scoping build in the additive cases below.
async function markCardsOwned(slug: string, stableUids: string[]): Promise<void> {
  const state = await loadDrawState(slug);
  const owned = new Set(state.owned);
  for (const uid of stableUids) owned.add(uid);
  await saveDrawState(slug, { owned: [...owned], pity: state.pity });
}

async function loadOwnedSet(slug: string): Promise<Set<string>> {
  return new Set((await loadDrawState(slug)).owned);
}

const GLOBAL_DRAW_STATE_KEY = `devcards:draw-state:${SLUG}`;
const GLOBAL_DRAW_HISTORY_KEY = `devcards:draw-history:${SLUG}`;
const GLOBAL_WALLET_KEY = 'recallsmith:reward-wallet:v1';
const GLOBAL_SEEDED_KEY = 'recallsmith:wallet-seeded:v1';

function historyEntry(drawId: string) {
  return {
    drawId,
    slug: SLUG,
    seed: 1,
    drawCount: 1 as const,
    ownedBefore: [],
    pityBefore: { draws: 0, threshold: 10 },
    drawnUids: ['c1'],
    ts: 1,
  };
}

describe('gacha state is partitioned by user', () => {
  beforeEach(() => {
    store.clear();
    invalidateDrawStateCache();
    setActiveUserSubForStorage(null);
  });

  it('keeps one account out of another account collection', async () => {
    setActiveUserSubForStorage('user-a');
    await markCardsOwned(SLUG, ['c1', 'c2']);

    setActiveUserSubForStorage('user-b');
    expect((await loadOwnedSet(SLUG)).size).toBe(0);
    await markCardsOwned(SLUG, ['c9']);

    setActiveUserSubForStorage('user-a');
    expect([...(await loadOwnedSet(SLUG))].sort()).toEqual(['c1', 'c2']);

    setActiveUserSubForStorage('user-b');
    expect([...(await loadOwnedSet(SLUG))]).toEqual(['c9']);
  });

  it('keeps pity counters per account', async () => {
    setActiveUserSubForStorage('user-a');
    const { savePityState, loadPityState } = await import('../../src/features/gacha/draw/pity');
    await savePityState(SLUG, { draws: 8, threshold: 10 });

    setActiveUserSubForStorage('user-b');
    const fresh = await loadDrawState(SLUG);
    expect(fresh.pity).toBeNull();

    setActiveUserSubForStorage('user-a');
    expect(await loadPityState(SLUG)).toEqual({ draws: 8, threshold: 10 });
  });

  it('keeps draw history per account', async () => {
    setActiveUserSubForStorage('user-a');
    await appendDrawHistory(SLUG, historyEntry('a-1'));

    setActiveUserSubForStorage('user-b');
    expect(await loadDrawHistory(SLUG)).toEqual([]);

    setActiveUserSubForStorage('user-a');
    expect((await loadDrawHistory(SLUG)).map((e) => e.drawId)).toEqual(['a-1']);
  });

  it('keeps wallets per account', async () => {
    setActiveUserSubForStorage('user-a');
    await saveRewardWalletState({ availablePulls: 4, reservePulls: 1 });

    setActiveUserSubForStorage('user-b');
    expect(await loadRewardWalletState()).toEqual({ availablePulls: 0, reservePulls: 0 });

    setActiveUserSubForStorage('user-a');
    expect(await loadRewardWalletState()).toEqual({ availablePulls: 4, reservePulls: 1 });
  });
});

describe('pre-partition gacha keys are claimed once', () => {
  beforeEach(() => {
    store.clear();
    invalidateDrawStateCache();
    setActiveUserSubForStorage(null);
  });

  it('hands a leftover collection to the first account that looks, and to no other', async () => {
    store.set(
      GLOBAL_DRAW_STATE_KEY,
      JSON.stringify({ owned: ['legacy-1', 'legacy-2'], pity: { draws: 5, threshold: 10 } }),
    );

    setActiveUserSubForStorage('user-a');
    const claimed = await loadDrawState(SLUG);
    expect(claimed.owned.sort()).toEqual(['legacy-1', 'legacy-2']);
    expect(claimed.pity).toEqual({ draws: 5, threshold: 10 });
    // Claimed means removed: leaving it behind is what let the next
    // account inherit the previous one's collection.
    expect(store.has(GLOBAL_DRAW_STATE_KEY)).toBe(false);

    setActiveUserSubForStorage('user-b');
    expect((await loadDrawState(SLUG)).owned).toEqual([]);
  });

  it('claims the pre-merge two-key layout as well', async () => {
    store.set(`devcards:draw-owned:${SLUG}`, JSON.stringify(['old-1']));
    store.set(`devcards:draw-pity:${SLUG}`, JSON.stringify({ draws: 2, threshold: 12 }));

    setActiveUserSubForStorage('user-a');
    const claimed = await loadDrawState(SLUG);
    expect(claimed.owned).toEqual(['old-1']);
    expect(claimed.pity).toEqual({ draws: 2, threshold: 12 });
    expect(store.has(`devcards:draw-owned:${SLUG}`)).toBe(false);
    expect(store.has(`devcards:draw-pity:${SLUG}`)).toBe(false);

    setActiveUserSubForStorage('user-b');
    expect((await loadDrawState(SLUG)).owned).toEqual([]);
  });

  it('claims a leftover history once', async () => {
    store.set(GLOBAL_DRAW_HISTORY_KEY, JSON.stringify([historyEntry('legacy-draw')]));

    setActiveUserSubForStorage('user-a');
    expect((await loadDrawHistory(SLUG)).map((e) => e.drawId)).toEqual(['legacy-draw']);
    expect(store.has(GLOBAL_DRAW_HISTORY_KEY)).toBe(false);

    setActiveUserSubForStorage('user-b');
    expect(await loadDrawHistory(SLUG)).toEqual([]);
  });

  it('hands a leftover wallet to the first account that looks, and to no other', async () => {
    store.set(GLOBAL_WALLET_KEY, JSON.stringify({ availablePulls: 7, reservePulls: 2 }));

    setActiveUserSubForStorage('user-a');
    expect(await loadRewardWalletState()).toEqual({ availablePulls: 7, reservePulls: 2 });
    expect(store.has(GLOBAL_WALLET_KEY)).toBe(false);

    setActiveUserSubForStorage('user-b');
    expect(await loadRewardWalletState()).toEqual({ availablePulls: 0, reservePulls: 0 });
  });

  it('adopts the starter-grant flag for the current account and lets the next account earn its own', async () => {
    store.set(GLOBAL_SEEDED_KEY, '1');

    setActiveUserSubForStorage('user-a');
    const first = await seedStarterPullsIfNeeded();
    // Adopted, not re-granted: the same person does not collect twice.
    expect(first.seeded).toBe(false);
    expect(first.wallet.availablePulls).toBe(0);
    expect(store.has(GLOBAL_SEEDED_KEY)).toBe(false);
    expect(store.get('devcards:u:user-a:recallsmith:wallet-seeded:v1')).toBe('1');

    // A different person on the same handset is a different player, and
    // the starter grant exists per player.
    setActiveUserSubForStorage('user-b');
    const second = await seedStarterPullsIfNeeded();
    expect(second.seeded).toBe(true);
    expect(second.wallet.availablePulls).toBe(STARTER_PULL_GRANT);

    const third = await seedStarterPullsIfNeeded();
    expect(third.seeded).toBe(false);
    expect(third.wallet.availablePulls).toBe(STARTER_PULL_GRANT);
  });
});

describe('session settlement receipts never fall back across partitions', () => {
  beforeEach(() => {
    store.clear();
    invalidateDrawStateCache();
    setActiveUserSubForStorage(null);
  });

  it('pays a second account for its own session even when the id collides', async () => {
    setActiveUserSubForStorage('user-a');
    const a = await applySessionRewardToWallet('session-7', 2);
    expect(a.alreadyApplied).toBe(false);
    expect(a.walletAfter.availablePulls).toBe(2);

    // A receipt means "already paid". Reading account A's receipt for
    // account B would swallow B's payout silently and forever, so the
    // lookup is scoped with no fallback.
    setActiveUserSubForStorage('user-b');
    const b = await applySessionRewardToWallet('session-7', 2);
    expect(b.alreadyApplied).toBe(false);
    expect(b.walletAfter.availablePulls).toBe(2);

    // Within one account the receipt still does its job.
    setActiveUserSubForStorage('user-a');
    const again = await applySessionRewardToWallet('session-7', 2);
    expect(again.alreadyApplied).toBe(true);
    expect(again.walletAfter.availablePulls).toBe(2);
  });

  it('ignores a leftover unscoped receipt instead of treating it as payment', async () => {
    store.set(
      'recallsmith:reward-session:session-9',
      JSON.stringify({ rewardPulls: 3, walletBefore: { availablePulls: 0, reservePulls: 0 } }),
    );

    setActiveUserSubForStorage('user-a');
    const result = await applySessionRewardToWallet('session-9', 3);

    expect(result.alreadyApplied).toBe(false);
    expect(result.walletAfter.availablePulls).toBe(3);
    // Left in place, unread: the unscoped receipts are inert from here
    // on and the debug reset sweeps them by prefix.
    expect(store.has('recallsmith:reward-session:session-9')).toBe(true);
  });
});
