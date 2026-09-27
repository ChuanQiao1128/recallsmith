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

const apiJson = vi.fn();
vi.mock('../../src/api/apiClient', () => ({
  apiJson: (...args: any[]) => apiJson(...args),
}));

import { setActiveUserSubForStorage } from '../../src/review/storage';
import { setActiveDeckSlug } from '../../src/content/activeDeck';
import { invalidateDrawStateCache } from '../../src/features/gacha/draw/drawStateCache';
import { saveDrawState } from '../../src/features/gacha/draw/drawStateStore';
import {
  consumeDeckPulls,
  grantDeckPulls,
  loadDeckWallet,
} from '../../src/features/gacha/rewards/deckWallet';
import { loadRewardWalletState, saveRewardWalletState } from '../../src/features/gacha/rewards/rewardWallet';
import { syncDrawStateNow } from '../../src/sync/drawStateSync';

const TOKEN = 'access-token';

function okResponse(data: any) {
  return { success: true, data, error: null, traceId: 't', version: '1' };
}
function requestBody(callIndex = 0): any {
  return apiJson.mock.calls[callIndex]?.[1]?.body;
}
function deckIn(body: any, slug: string): any {
  return (body.decks as any[]).find((d) => d.deckSlug === slug);
}
const progressKey = (slug: string) => `devcards:u:user-a:deck-progress:${slug}`;

describe('per-pack pulls cloud sync', () => {
  beforeEach(async () => {
    store.clear();
    invalidateDrawStateCache();
    apiJson.mockReset();
    setActiveUserSubForStorage('user-a');
    await setActiveDeckSlug(null);
  });

  it('pushes pulls for every pack, including packs with no cards or pity', async () => {
    await saveDrawState('aws', { owned: ['c1'], pity: null });
    await grantDeckPulls('aws', 5);
    // csharp has a pull pool but no owned cards and no pity.
    await grantDeckPulls('csharp', 2);

    apiJson.mockResolvedValueOnce(okResponse({ serverTimeMs: 1, decks: [], wallet: null }));
    await syncDrawStateNow(TOKEN);

    const body = requestBody();
    expect(deckIn(body, 'aws')).toMatchObject({
      owned: ['c1'],
      pulls: { availablePulls: 5, reservePulls: 0, updatedAtMs: 0 },
    });
    const csharp = deckIn(body, 'csharp');
    expect(csharp.owned).toEqual([]);
    expect(csharp.pulls).toEqual({ availablePulls: 2, reservePulls: 0, updatedAtMs: 0 });
  });

  it('adopts server pack pulls when the local pack did not move during the request', async () => {
    await grantDeckPulls('aws', 5);

    apiJson.mockResolvedValueOnce(
      okResponse({
        serverTimeMs: 1,
        decks: [{ deckSlug: 'aws', owned: [], pity: null, pulls: { availablePulls: 9, reservePulls: 1, updatedAtMs: 500 } }],
        wallet: null,
      }),
    );

    const result = await syncDrawStateNow(TOKEN);
    expect(result.appliedDeckPulls).toBe(1);
    expect(await loadDeckWallet('aws')).toEqual({ availablePulls: 9, reservePulls: 1 });
  });

  it('keeps a pack spend made while the request was in flight', async () => {
    await grantDeckPulls('aws', 5);

    apiJson.mockImplementationOnce(async () => {
      // The user opens a pack mid-request: the pool this device pushed is gone.
      await consumeDeckPulls('aws', 2);
      return okResponse({
        serverTimeMs: 1,
        decks: [{ deckSlug: 'aws', owned: [], pity: null, pulls: { availablePulls: 9, reservePulls: 0, updatedAtMs: 700 } }],
        wallet: null,
      });
    });

    await syncDrawStateNow(TOKEN);
    // The server answered a question about a pool that no longer exists; the
    // local spend is kept and the next run pushes it.
    expect(await loadDeckWallet('aws')).toEqual({ availablePulls: 3, reservePulls: 0 });
  });

  it('never writes zero when the server answer has no pulls for a pack', async () => {
    await grantDeckPulls('aws', 5);

    apiJson.mockResolvedValueOnce(
      okResponse({
        serverTimeMs: 1,
        // The server knows this deck's collection but nothing about its pool.
        decks: [{ deckSlug: 'aws', owned: ['c1'], pity: null }],
        wallet: null,
      }),
    );

    const result = await syncDrawStateNow(TOKEN);
    expect(result.appliedDeckPulls).toBe(0);
    expect(await loadDeckWallet('aws')).toEqual({ availablePulls: 5, reservePulls: 0 });
  });

  it('sweeps a legacy balance adopted from the server into a pack and pushes zero next run', async () => {
    // aws is the most recently studied pack, so a swept balance lands there.
    store.set(progressKey('aws'), JSON.stringify([{ stableUid: 'a1', lastReviewedAt: 999999 }]));

    // Run 1: the server hands down a legacy wallet earned on a 1.6.1 device.
    apiJson.mockResolvedValueOnce(
      okResponse({ serverTimeMs: 1, decks: [], wallet: { availablePulls: 8, reservePulls: 0, updatedAtMs: 900 } }),
    );
    await syncDrawStateNow(TOKEN);

    // The adopted legacy balance was swept into the pack and the legacy wallet zeroed.
    expect(await loadDeckWallet('aws')).toEqual({ availablePulls: 8, reservePulls: 0 });
    expect(await loadRewardWalletState()).toEqual({ availablePulls: 0, reservePulls: 0 });

    // Run 2: the next push carries the zeroed legacy wallet and the pack's pulls.
    apiJson.mockResolvedValueOnce(okResponse({ serverTimeMs: 2, decks: [], wallet: null }));
    await syncDrawStateNow(TOKEN);

    const body = requestBody(1);
    expect(body.wallet.availablePulls).toBe(0);
    expect(body.wallet.reservePulls).toBe(0);
    expect(deckIn(body, 'aws').pulls.availablePulls).toBe(8);
  });
});
