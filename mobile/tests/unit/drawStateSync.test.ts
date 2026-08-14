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

import { setActiveUserSubForStorage } from '../../src/review/storage';
import { loadDrawState, saveDrawState } from '../../src/features/gacha/draw/drawStateStore';
import {
  loadRewardWalletState,
  saveRewardWalletState,
} from '../../src/features/gacha/rewards/rewardWallet';
import { syncDrawStateNow, unionOwned } from '../../src/sync/drawStateSync';

const TOKEN = 'access-token';
const SLUG = 'csharp';

function lastRequestBody(): any {
  const call = apiJson.mock.calls[apiJson.mock.calls.length - 1];
  return call?.[1]?.body;
}

function okResponse(data: any) {
  return { success: true, data, error: null, traceId: 't', version: '1' };
}

describe('draw state cloud sync', () => {
  beforeEach(() => {
    store.clear();
    apiJson.mockReset();
    setActiveUserSubForStorage('user-a');
  });

  it('pushes local state and adopts the server verdict', async () => {
    await saveDrawState(SLUG, { owned: ['c1'], pity: { draws: 4, threshold: 10 } });
    await saveRewardWalletState({ availablePulls: 1, reservePulls: 0 });

    apiJson.mockResolvedValueOnce(
      okResponse({
        serverTimeMs: 1,
        decks: [
          { deckSlug: SLUG, owned: ['c1', 'c2'], pity: { draws: 7, threshold: 10, updatedAtMs: 500 } },
        ],
        wallet: { availablePulls: 6, reservePulls: 2, updatedAtMs: 500 },
      }),
    );

    const result = await syncDrawStateNow(TOKEN);

    expect(result.ran).toBe(true);
    expect(apiJson).toHaveBeenCalledTimes(1);

    const body = lastRequestBody();
    expect(body.decks).toEqual([
      { deckSlug: SLUG, owned: ['c1'], pity: { draws: 4, threshold: 10, updatedAtMs: 0 } },
    ]);

    const merged = await loadDrawState(SLUG);
    expect(merged.owned).toEqual(['c1', 'c2']);
    expect(merged.pity).toEqual({ draws: 7, threshold: 10 });
    expect(await loadRewardWalletState()).toEqual({ availablePulls: 6, reservePulls: 2 });
  });

  it('stamps a first sighting as unknown so the server keeps its own state', async () => {
    // The reinstall case: a device with only the starter grant must not be able
    // to outrank the balance the account actually has.
    await saveRewardWalletState({ availablePulls: 3, reservePulls: 0 });

    apiJson.mockResolvedValueOnce(
      okResponse({ serverTimeMs: 1, decks: [], wallet: { availablePulls: 11, reservePulls: 0, updatedAtMs: 900 } }),
    );

    await syncDrawStateNow(TOKEN);

    expect(lastRequestBody().wallet.updatedAtMs).toBe(0);
    expect(await loadRewardWalletState()).toEqual({ availablePulls: 11, reservePulls: 0 });
  });

  it('stamps a change it observed with a real time', async () => {
    await saveRewardWalletState({ availablePulls: 3, reservePulls: 0 });
    apiJson.mockResolvedValueOnce(
      okResponse({ serverTimeMs: 1, decks: [], wallet: { availablePulls: 3, reservePulls: 0, updatedAtMs: 10 } }),
    );
    await syncDrawStateNow(TOKEN);

    // The user spends a pull, then syncs again.
    await saveRewardWalletState({ availablePulls: 2, reservePulls: 0 });
    apiJson.mockResolvedValueOnce(
      okResponse({ serverTimeMs: 2, decks: [], wallet: { availablePulls: 2, reservePulls: 0, updatedAtMs: 20 } }),
    );
    await syncDrawStateNow(TOKEN);

    expect(lastRequestBody().wallet).toMatchObject({ availablePulls: 2, reservePulls: 0 });
    expect(lastRequestBody().wallet.updatedAtMs).toBeGreaterThan(0);
  });

  it('never shrinks the collection when the server answer is short', async () => {
    await saveDrawState(SLUG, { owned: ['c1', 'c2', 'c3'], pity: null });

    apiJson.mockResolvedValueOnce(
      okResponse({ serverTimeMs: 1, decks: [{ deckSlug: SLUG, owned: ['c1'], pity: null }], wallet: null }),
    );

    await syncDrawStateNow(TOKEN);

    expect((await loadDrawState(SLUG)).owned).toEqual(['c1', 'c2', 'c3']);
  });

  it('keeps a wallet change made while the request was in flight', async () => {
    await saveRewardWalletState({ availablePulls: 4, reservePulls: 0 });

    apiJson.mockImplementationOnce(async () => {
      // The user pulls mid-request: the server is answering a question about a
      // wallet that no longer exists.
      await saveRewardWalletState({ availablePulls: 3, reservePulls: 0 });
      return okResponse({
        serverTimeMs: 1,
        decks: [],
        wallet: { availablePulls: 4, reservePulls: 0, updatedAtMs: 700 },
      });
    });

    await syncDrawStateNow(TOKEN);

    expect(await loadRewardWalletState()).toEqual({ availablePulls: 3, reservePulls: 0 });
  });

  it('skips silently when the request fails', async () => {
    await saveDrawState(SLUG, { owned: ['c1'], pity: { draws: 2, threshold: 10 } });
    apiJson.mockRejectedValueOnce(new Error('offline'));

    const result = await syncDrawStateNow(TOKEN);

    expect(result.ran).toBe(false);
    const local = await loadDrawState(SLUG);
    expect(local.owned).toEqual(['c1']);
    expect(local.pity).toEqual({ draws: 2, threshold: 10 });
  });

  it('does not call the server again when nothing changed locally', async () => {
    await saveDrawState(SLUG, { owned: ['c1'], pity: null });
    apiJson.mockResolvedValueOnce(
      okResponse({ serverTimeMs: 1, decks: [{ deckSlug: SLUG, owned: ['c1'], pity: null }], wallet: null }),
    );

    await syncDrawStateNow(TOKEN);
    expect(apiJson).toHaveBeenCalledTimes(1);

    await syncDrawStateNow(TOKEN);
    expect(apiJson).toHaveBeenCalledTimes(1);

    // A new reveal is a change, so the throttle must not hold it back.
    await saveDrawState(SLUG, { owned: ['c1', 'c9'], pity: { draws: 1, threshold: 10 } });
    apiJson.mockResolvedValueOnce(
      okResponse({ serverTimeMs: 2, decks: [{ deckSlug: SLUG, owned: ['c1', 'c9'], pity: null }], wallet: null }),
    );
    await syncDrawStateNow(TOKEN);
    expect(apiJson).toHaveBeenCalledTimes(2);
  });

  it('does not let the idle throttle sit on a reveal that never moved pity', async () => {
    await saveDrawState(SLUG, { owned: ['c1'], pity: { draws: 2, threshold: 10 } });
    apiJson.mockResolvedValueOnce(
      okResponse({
        serverTimeMs: 1,
        decks: [{ deckSlug: SLUG, owned: ['c1'], pity: { draws: 2, threshold: 10, updatedAtMs: 5 } }],
        wallet: null,
      }),
    );
    await syncDrawStateNow(TOKEN);
    expect(apiJson).toHaveBeenCalledTimes(1);

    // markCardsOwned outside a draw: the collection grew, pity did not.
    await saveDrawState(SLUG, { owned: ['c1', 'c4'], pity: { draws: 2, threshold: 10 } });
    apiJson.mockResolvedValueOnce(
      okResponse({
        serverTimeMs: 2,
        decks: [{ deckSlug: SLUG, owned: ['c1', 'c4'], pity: { draws: 2, threshold: 10, updatedAtMs: 5 } }],
        wallet: null,
      }),
    );
    await syncDrawStateNow(TOKEN);

    expect(apiJson).toHaveBeenCalledTimes(2);
    expect(lastRequestBody().decks[0].owned).toEqual(['c1', 'c4']);
    // The pity stamp stays the server's: a reveal is not authorship of a pity
    // decision, so this device must not win the next merge with it.
    expect(lastRequestBody().decks[0].pity.updatedAtMs).toBe(5);
  });

  it('does nothing without a token', async () => {
    expect((await syncDrawStateNow(null)).ran).toBe(false);
    expect(apiJson).not.toHaveBeenCalled();
  });

  it('keeps one account out of another account sync', async () => {
    setActiveUserSubForStorage('user-a');
    await saveDrawState(SLUG, { owned: ['a1'], pity: null });

    setActiveUserSubForStorage('user-b');
    apiJson.mockResolvedValueOnce(okResponse({ serverTimeMs: 1, decks: [], wallet: null }));
    await syncDrawStateNow(TOKEN);

    expect(lastRequestBody().decks).toEqual([]);
    setActiveUserSubForStorage('user-a');
    expect((await loadDrawState(SLUG)).owned).toEqual(['a1']);
  });
});

describe('unionOwned', () => {
  it('is order preserving, deduping and never lossy', () => {
    expect(unionOwned(['a', 'b'], ['b', 'c'])).toEqual(['a', 'b', 'c']);
    expect(unionOwned([], ['x'])).toEqual(['x']);
    expect(unionOwned(['x'], [])).toEqual(['x']);
  });
});
