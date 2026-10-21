import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();
const writes: string[] = [];
let beforeRead: ((key: string) => Promise<void>) | undefined;

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => {
      await beforeRead?.(key);
      return store.get(key) ?? null;
    }),
    setItem: vi.fn(async (key: string, value: string) => {
      writes.push(key);
      store.set(key, value);
    }),
    removeItem: vi.fn(async (key: string) => { store.delete(key); }),
    getAllKeys: vi.fn(async () => [...store.keys()]),
  },
}));
vi.mock('../../src/features/gacha/starter/starterGate', () => ({
  isStarterLessonCard: vi.fn(async () => false),
  isStarterLessonOpen: vi.fn(async () => false),
}));

import { setActiveUserSubForStorage } from '../../src/review/storage';
import { settleRatingReward } from '../../src/features/gacha/rewards/sessionRewards';
import { DECK_WALLETS_KEY, grantDeckPulls, updateDeckWallet } from '../../src/features/gacha/rewards/deckWallet';
import { DUE_CLEAR_MARKER_KEY, NEW_CARD_LEDGER_PREFIX, NEW_CARD_LEDGER_SEEDED_PREFIX } from '../../src/features/gacha/rewards/newCardLedger';
import { MISTAKE_BOOK_KEY, recordMistakeOutcome, withMistakeBookLock } from '../../src/features/gacha/mistakes/mistakeBook';

const prefix = (sub: string) => `devcards:u:${sub}:`;
const key = (sub: string, base: string) => `${prefix(sub)}${base}`;
const now = new Date(2026, 9, 22, 12);

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('rating side effects retain the initiating account', () => {
  beforeEach(() => {
    store.clear();
    writes.length = 0;
    beforeRead = undefined;
    setActiveUserSubForStorage('user-a');
  });

  it.each([undefined, 'user-a'])('keeps ledger, due marker and wallet on A after a mid-reward switch (scope %s)', async (userSub) => {
    const cacheA = key('user-a', 'sync:remoteCache:v1:csharp');
    store.set(cacheA, '{}');
    store.set(key('user-a', 'deck-progress:csharp'), JSON.stringify([
      { stableUid: 'already-a', stage: 1, lastReviewedAt: 1_000, nextReviewAt: 2_000 },
    ]));
    store.set(key('user-b', 'deck-progress:csharp'), JSON.stringify([
      { stableUid: 'already-b', stage: 1, lastReviewedAt: 1_000, nextReviewAt: 2_000 },
    ]));
    store.set(key('user-b', `${NEW_CARD_LEDGER_PREFIX}csharp`), JSON.stringify({ untouched: 123 }));
    store.set(key('user-b', `${NEW_CARD_LEDGER_SEEDED_PREFIX}csharp`), '{}');
    store.set(key('user-b', `${DUE_CLEAR_MARKER_KEY}:csharp`), '2026-10-21');
    store.set(key('user-b', DECK_WALLETS_KEY), JSON.stringify({
      migratedAtMs: null, decks: { csharp: { availablePulls: 7, reservePulls: 0 } }, bootstrappedAtMs: {},
    }));
    const beforeB = [...store.entries()].filter(([k]) => k.startsWith(prefix('user-b')));
    const entered = deferred();
    const release = deferred();
    let paused = false;
    beforeRead = async (k) => {
      if (k === cacheA && !paused) {
        paused = true;
        entered.resolve();
        await release.promise;
      }
    };

    const pending = settleRatingReward({
      userSub, slug: 'csharp', stableUid: 'new-a', rating: 'good', progressBefore: [],
      newCardEligible: true, dueBefore: 1, remainingDueCount: 0, now,
    });
    await entered.promise;
    setActiveUserSubForStorage('user-b');
    release.resolve();
    const result = await pending;

    expect(result.pulls).toBe(2);
    expect(JSON.parse(store.get(key('user-a', `${NEW_CARD_LEDGER_PREFIX}csharp`))!)).toEqual({
      'already-a': 0, 'new-a': now.getTime(),
    });
    expect(store.has(key('user-a', `${NEW_CARD_LEDGER_SEEDED_PREFIX}csharp`))).toBe(true);
    expect(store.has(key('user-a', `${DUE_CLEAR_MARKER_KEY}:csharp`))).toBe(true);
    expect(JSON.parse(store.get(key('user-a', DECK_WALLETS_KEY))!).decks.csharp.availablePulls).toBe(2);
    expect([...store.entries()].filter(([k]) => k.startsWith(prefix('user-b')))).toEqual(beforeB);
    expect(writes.some((k) => k.startsWith(prefix('user-b')))).toBe(false);
  });

  it('pins a queued default wallet grant before waiting on another wallet mutation', async () => {
    const entered = deferred();
    const release = deferred();
    const first = updateDeckWallet('csharp', async () => {
      entered.resolve();
      await release.promise;
      return { availablePulls: 1, reservePulls: 0 };
    }, 'user-a');
    await entered.promise;
    const queued = grantDeckPulls('csharp', 2);
    setActiveUserSubForStorage('user-b');
    release.resolve();
    await Promise.all([first, queued]);

    expect(JSON.parse(store.get(key('user-a', DECK_WALLETS_KEY))!).decks.csharp.availablePulls).toBe(3);
    expect(store.has(key('user-b', DECK_WALLETS_KEY))).toBe(false);
  });

  it('uses an explicit earlier intent account when B is already active at settlement', async () => {
    setActiveUserSubForStorage('user-b');
    store.set(key('user-a', 'sync:remoteCache:v1:csharp'), '{}');
    const result = await settleRatingReward({
      userSub: 'user-a', slug: 'csharp', stableUid: 'resumed-a', rating: 'good', progressBefore: [],
      newCardEligible: true, dueBefore: 0, remainingDueCount: 0, now,
    });
    await updateDeckWallet('csharp', (wallet) => ({ ...wallet, availablePulls: wallet.availablePulls + 2 }), 'user-a');
    await recordMistakeOutcome({
      deckSlug: 'csharp', stableUid: 'resumed-wrong-a', topic: 'linq', rating: 'again', mcqVerdict: null, at: now.getTime(),
    }, 'user-a');

    expect(result.pulls).toBe(1);
    expect(JSON.parse(store.get(key('user-a', DECK_WALLETS_KEY))!).decks.csharp.availablePulls).toBe(3);
    expect(JSON.parse(store.get(key('user-a', `${NEW_CARD_LEDGER_PREFIX}csharp`))!)).toEqual({ 'resumed-a': now.getTime() });
    expect(JSON.parse(store.get(key('user-a', MISTAKE_BOOK_KEY))!).entries['csharp::resumed-wrong-a'].wrongCount).toBe(1);
    expect(writes.some((k) => k.startsWith(prefix('user-b')))).toBe(false);
  });

  it.each([undefined, 'user-a'])('pins a mistake queued across an account switch (scope %s)', async (userSub) => {
    const entered = deferred();
    const release = deferred();
    const blocker = withMistakeBookLock(async () => {
      entered.resolve();
      await release.promise;
    });
    await entered.promise;
    const pending = recordMistakeOutcome({
      deckSlug: 'csharp', stableUid: 'wrong-a', topic: 'linq', rating: 'again', mcqVerdict: null, at: now.getTime(),
    }, userSub);
    setActiveUserSubForStorage('user-b');
    release.resolve();
    await Promise.all([blocker, pending]);

    expect(JSON.parse(store.get(key('user-a', MISTAKE_BOOK_KEY))!).entries['csharp::wrong-a'].wrongCount).toBe(1);
    expect(store.has(key('user-b', MISTAKE_BOOK_KEY))).toBe(false);
    expect(writes.some((k) => k.startsWith(prefix('user-b')))).toBe(false);
  });
});
