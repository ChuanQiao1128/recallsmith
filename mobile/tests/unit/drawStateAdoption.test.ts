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
  },
}));

const apiJson = vi.fn();
vi.mock('../../src/api/apiClient', () => ({
  apiJson: (...args: any[]) => apiJson(...args),
}));

// The real scope helper is under test (change 5 pins ANON_USER_SCOPE_PREFIX to
// it), so review/storage is NOT mocked. Anon fixtures are written the honest
// way: switch the storage scope to null, save through the real writers, switch
// back to the signed-in account.
import { getUserScopedKey, setActiveUserSubForStorage } from '../../src/review/storage';
import {
  ANON_USER_SCOPE_PREFIX,
  adoptAnonDrawState,
  loadDrawState,
  saveDrawState,
} from '../../src/features/gacha/draw/drawStateStore';
// store.clear() below wipes the keys behind the store's back the same way the
// debug reset does in production; the in-memory read model has to be told or
// one test's collection leaks into the next.
import { invalidateDrawStateCache } from '../../src/features/gacha/draw/drawStateCache';
import {
  loadRewardWalletState,
  saveRewardWalletState,
} from '../../src/features/gacha/rewards/rewardWallet';
import { adoptAnonGachaState, syncDrawStateNow } from '../../src/sync/drawStateSync';

const SLUG = 'csharp';
const ANON_STATE_KEY = `${ANON_USER_SCOPE_PREFIX}devcards:draw-state:${SLUG}`;
const ANON_WALLET_KEY = `${ANON_USER_SCOPE_PREFIX}recallsmith:reward-wallet:v1`;
const ANON_SEEDED_KEY = `${ANON_USER_SCOPE_PREFIX}recallsmith:wallet-seeded:v1`;
const USER_SEEDED_KEY = 'devcards:u:user-a:recallsmith:wallet-seeded:v1';

function okResponse(data: any) {
  return { success: true, data, error: null, traceId: 't', version: '1' };
}

const ZERO = { decks: 0, ownedAdded: 0, pityRaised: 0, addedPulls: 0, dropped: 0 };

describe('anon gacha state adoption', () => {
  beforeEach(() => {
    store.clear();
    invalidateDrawStateCache();
    apiJson.mockReset();
    setActiveUserSubForStorage('user-a');
  });

  it('unions anon owned, keeps the higher pity, and clears the anon key', async () => {
    setActiveUserSubForStorage(null);
    await saveDrawState(SLUG, { owned: ['c1', 'c2'], pity: { draws: 7, threshold: 10 } });
    setActiveUserSubForStorage('user-a');
    await saveDrawState(SLUG, { owned: ['c2', 'c3'], pity: { draws: 3, threshold: 10 } });

    const result = await adoptAnonGachaState();

    const merged = await loadDrawState(SLUG);
    expect(merged.owned).toEqual(['c2', 'c3', 'c1']);
    expect(merged.pity).toEqual({ draws: 7, threshold: 10 });
    expect(store.has(ANON_STATE_KEY)).toBe(false);
    expect(result.decks).toBe(1);
    expect(result.ownedAdded).toBe(1);
    expect(result.pityRaised).toBe(1);
  });

  it('adopts the anon record wholesale when the account has no draw state', async () => {
    setActiveUserSubForStorage(null);
    await saveDrawState(SLUG, { owned: ['c1'], pity: { draws: 5, threshold: 10 } });
    setActiveUserSubForStorage('user-a');

    await adoptAnonDrawState();

    const merged = await loadDrawState(SLUG);
    expect(merged.owned).toEqual(['c1']);
    expect(merged.pity).toEqual({ draws: 5, threshold: 10 });
  });

  it('adds anon wallet pulls under the caps and carries the seeded flag', async () => {
    setActiveUserSubForStorage(null);
    await saveRewardWalletState({ availablePulls: 10, reservePulls: 0 });
    store.set(ANON_SEEDED_KEY, '1');
    setActiveUserSubForStorage('user-a');
    await saveRewardWalletState({ availablePulls: 28, reservePulls: 0 });

    const result = await adoptAnonGachaState();

    expect(await loadRewardWalletState()).toEqual({ availablePulls: 30, reservePulls: 5 });
    expect(result.addedPulls).toBe(7);
    expect(result.dropped).toBe(3);
    expect(store.has(ANON_WALLET_KEY)).toBe(false);
    // The starter grant is carried forward but the anon flag stays put, so a
    // later signed-out session is not re-granted.
    expect(store.get(USER_SEEDED_KEY)).toBe('1');
    expect(store.has(ANON_SEEDED_KEY)).toBe(true);
  });

  it('is a no-op on a second run', async () => {
    setActiveUserSubForStorage(null);
    await saveDrawState(SLUG, { owned: ['c1', 'c2'], pity: { draws: 7, threshold: 10 } });
    await saveRewardWalletState({ availablePulls: 10, reservePulls: 0 });
    setActiveUserSubForStorage('user-a');
    await saveDrawState(SLUG, { owned: ['c2', 'c3'], pity: { draws: 3, threshold: 10 } });
    await saveRewardWalletState({ availablePulls: 28, reservePulls: 0 });

    await adoptAnonGachaState();
    const drawAfterFirst = await loadDrawState(SLUG);
    const walletAfterFirst = await loadRewardWalletState();

    const second = await adoptAnonGachaState();
    expect(second).toEqual(ZERO);
    expect(await loadDrawState(SLUG)).toEqual(drawAfterFirst);
    expect(await loadRewardWalletState()).toEqual(walletAfterFirst);
  });

  it('coalesces concurrent calls so the wallet add lands exactly once', async () => {
    setActiveUserSubForStorage(null);
    await saveRewardWalletState({ availablePulls: 3, reservePulls: 0 });
    setActiveUserSubForStorage('user-a');
    // user wallet is {0, 0} (never written)

    await Promise.all([adoptAnonGachaState(), adoptAnonGachaState()]);

    expect(await loadRewardWalletState()).toEqual({ availablePulls: 3, reservePulls: 0 });
  });

  it('does nothing while signed out', async () => {
    setActiveUserSubForStorage(null);
    await saveDrawState(SLUG, { owned: ['c1'], pity: { draws: 2, threshold: 10 } });
    await saveRewardWalletState({ availablePulls: 3, reservePulls: 0 });
    // still signed out when adoption runs

    const result = await adoptAnonGachaState();

    expect(result).toEqual(ZERO);
    expect(store.has(ANON_STATE_KEY)).toBe(true);
    expect(store.has(ANON_WALLET_KEY)).toBe(true);
  });

  it('invalidates the anon cache so a later signed-out read is empty', async () => {
    setActiveUserSubForStorage(null);
    await saveDrawState(SLUG, { owned: ['c1'], pity: { draws: 2, threshold: 10 } });
    // Prime the anon partition cache while signed out.
    expect((await loadDrawState(SLUG)).owned).toEqual(['c1']);

    setActiveUserSubForStorage('user-a');
    await adoptAnonGachaState();

    setActiveUserSubForStorage(null);
    expect((await loadDrawState(SLUG)).owned).toEqual([]);
  });

  it('pushes the adopted deck in the first sync', async () => {
    setActiveUserSubForStorage(null);
    await saveDrawState(SLUG, { owned: ['c1'], pity: null });
    setActiveUserSubForStorage('user-a');
    // user partition empty; adoption inside syncDrawStateNow moves the card over

    apiJson.mockResolvedValueOnce(okResponse({ serverTimeMs: 1, decks: [], wallet: null }));

    await syncDrawStateNow('token');

    expect(apiJson).toHaveBeenCalledTimes(1);
    const body = apiJson.mock.calls[0][1].body;
    expect(body.decks[0]).toEqual({ deckSlug: SLUG, owned: ['c1'] });
  });

  it('pins ANON_USER_SCOPE_PREFIX to the anon scope getUserScopedKey builds', async () => {
    setActiveUserSubForStorage(null);
    expect(await getUserScopedKey('x')).toBe(`${ANON_USER_SCOPE_PREFIX}x`);
  });
});
