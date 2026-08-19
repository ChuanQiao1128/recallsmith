import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The floor's predicate and its storage contract, isolated from Home.
 *
 * The integration fixture (tests/integration/economy-floor.spec.tsx) proves
 * the rule against the real load chain; this file pins the two things that
 * chain cannot reach: what an *absent* count means, and what the module does
 * when storage misbehaves.
 */

const store = new Map<string, string>();
let failSetItemFor: ((key: string) => boolean) | null = null;
let failGetItem = false;
const setItemCalls: string[] = [];

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => {
      await Promise.resolve();
      if (failGetItem) throw new Error('storage read killed');
      return store.get(key) ?? null;
    }),
    setItem: vi.fn(async (key: string, value: string) => {
      setItemCalls.push(key);
      await Promise.resolve();
      if (failSetItemFor?.(key)) throw new Error(`storage write killed: ${key}`);
      store.set(key, value);
    }),
  },
}));

import {
  ECONOMY_FLOOR_GRANT,
  applyEconomyFloorIfStarved,
  isEconomyStarved,
} from '../../src/features/gacha/rewards/economyFloor';
import { loadRewardWalletState } from '../../src/features/gacha/rewards/rewardWallet';

// Nobody is signed in here, so the real scope helper resolves to "anon".
const MARKER_KEY = 'devcards:u:anon:recallsmith:economy-floor:v1';
const WALLET_KEY = 'devcards:u:anon:recallsmith:reward-wallet:v1';

const EMPTY = { availablePulls: 0, reservePulls: 0 };
const TODAY = new Date(2026, 7, 19, 9, 0, 0);

describe('isEconomyStarved', () => {
  it('is true only when all three inputs are zero', () => {
    expect(isEconomyStarved({ ownedNewCount: 0, dueCount: 0, wallet: EMPTY })).toBe(true);
    expect(isEconomyStarved({ ownedNewCount: 1, dueCount: 0, wallet: EMPTY })).toBe(false);
    expect(isEconomyStarved({ ownedNewCount: 0, dueCount: 1, wallet: EMPTY })).toBe(false);
    expect(
      isEconomyStarved({ ownedNewCount: 0, dueCount: 0, wallet: { availablePulls: 1, reservePulls: 0 } }),
    ).toBe(false);
    expect(
      isEconomyStarved({ ownedNewCount: 0, dueCount: 0, wallet: { availablePulls: 0, reservePulls: 1 } }),
    ).toBe(false);
  });

  it('treats a missing count as "not starved", never as zero', () => {
    // The two are opposite claims. Zero is evidence the user has no work;
    // undefined is the absence of evidence, and a floor that pays out on
    // absence pays out exactly when a caller forgot to count -- which is how
    // a caller that mocks the Home summary (and returns no totals) would
    // silently start minting pulls.
    expect(isEconomyStarved({ ownedNewCount: undefined, dueCount: 0, wallet: EMPTY })).toBe(false);
    expect(isEconomyStarved({ ownedNewCount: 0, dueCount: undefined, wallet: EMPTY })).toBe(false);
    expect(isEconomyStarved({ ownedNewCount: null, dueCount: null, wallet: EMPTY })).toBe(false);
    expect(isEconomyStarved({ ownedNewCount: NaN, dueCount: 0, wallet: EMPTY })).toBe(false);
  });

  it('reads a missing wallet as empty', () => {
    // Opposite default from the counts, and deliberately so: an unreadable
    // wallet already resolves to {0,0} everywhere else in the economy
    // (loadRewardWalletState swallows its own failures), so treating absence
    // as "has pulls" here would contradict the balance the rest of the app
    // is showing.
    expect(isEconomyStarved({ ownedNewCount: 0, dueCount: 0, wallet: null })).toBe(true);
    expect(isEconomyStarved({ ownedNewCount: 0, dueCount: 0, wallet: undefined })).toBe(true);
  });
});

describe('applyEconomyFloorIfStarved', () => {
  beforeEach(() => {
    store.clear();
    setItemCalls.length = 0;
    failSetItemFor = null;
    failGetItem = false;
  });

  it('grants exactly one pull and stamps the day', async () => {
    const outcome = await applyEconomyFloorIfStarved({
      ownedNewCount: 0,
      dueCount: 0,
      wallet: EMPTY,
      now: TODAY,
    });

    expect(ECONOMY_FLOOR_GRANT).toBe(1);
    expect(outcome).toEqual({
      wallet: { availablePulls: 1, reservePulls: 0 },
      granted: 1,
      reason: 'granted',
    });
    expect(store.get(MARKER_KEY)).toBe('2026-08-19');
  });

  it('touches no storage at all when the account is not starved', async () => {
    const outcome = await applyEconomyFloorIfStarved({
      ownedNewCount: 3,
      dueCount: 0,
      wallet: EMPTY,
      now: TODAY,
    });

    expect(outcome.granted).toBe(0);
    expect(outcome.reason).toBe('not-starved');
    // The predicate short-circuits before the key is even resolved, which is
    // what keeps a per-focus Home refresh from paying for a storage round-trip
    // on every load of every non-starved account.
    expect(setItemCalls).toEqual([]);
  });

  it('refuses to grant on top of a wallet that filled up since the caller read it', async () => {
    // Home reads the wallet in parallel with the deck summaries, so a
    // settlement can land between that read and this call. The caller's
    // snapshot says empty; storage says otherwise, and storage wins.
    store.set(WALLET_KEY, JSON.stringify({ availablePulls: 2, reservePulls: 0 }));

    const outcome = await applyEconomyFloorIfStarved({
      ownedNewCount: 0,
      dueCount: 0,
      wallet: EMPTY,
      now: TODAY,
    });

    expect(outcome.granted).toBe(0);
    expect(outcome.wallet).toEqual({ availablePulls: 2, reservePulls: 0 });
    expect(store.has(MARKER_KEY)).toBe(false);
  });

  it('under-grants rather than double-grants when the wallet write is killed', async () => {
    failSetItemFor = (key) => key === WALLET_KEY;

    await expect(
      applyEconomyFloorIfStarved({ ownedNewCount: 0, dueCount: 0, wallet: EMPTY, now: TODAY }),
    ).resolves.toEqual({ wallet: EMPTY, granted: 0, reason: 'unavailable' });

    // The marker landed first, so the crash cost the user today's floor pull
    // instead of arming a second grant on the next Home load. Same direction
    // rewardWallet's session dedupe chose, for the same reason.
    expect(store.get(MARKER_KEY)).toBe('2026-08-19');

    failSetItemFor = null;
    const retry = await applyEconomyFloorIfStarved({
      ownedNewCount: 0,
      dueCount: 0,
      wallet: EMPTY,
      now: TODAY,
    });
    expect(retry.granted).toBe(0);
    expect(await loadRewardWalletState()).toEqual(EMPTY);
  });

  it('leaves Home standing when storage is unreadable', async () => {
    failGetItem = true;

    const outcome = await applyEconomyFloorIfStarved({
      ownedNewCount: 0,
      dueCount: 0,
      wallet: EMPTY,
      now: TODAY,
    });

    expect(outcome).toEqual({ wallet: EMPTY, granted: 0, reason: 'unavailable' });
  });
});
