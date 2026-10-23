import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();
let fault: ((key: string, value: string) => 'before' | 'after' | undefined) | undefined;
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => { await Promise.resolve(); return store.get(key) ?? null; }),
    setItem: vi.fn(async (key: string, value: string) => {
      const failure = fault?.(key, value);
      if (failure === 'before') throw new Error('injected before persistence');
      store.set(key, value);
      if (failure === 'after') throw new Error('injected after persistence');
    }),
    removeItem: vi.fn(async (key: string) => { store.delete(key); }),
    getAllKeys: vi.fn(async () => [...store.keys()]),
  },
}));
vi.mock('../../src/features/gacha/starter/starterGate', () => ({
  isStarterLessonCard: vi.fn(async () => false),
  isStarterLessonOpen: vi.fn(async () => false),
}));

const key = (sub: string, base: string) => `devcards:u:${sub}:${base}`;
const walletKey = (sub = 'user-a') => key(sub, 'recallsmith:deck-wallets:v1');
const ledgerKey = key('user-a', 'recallsmith:newCardPullPaidUids:csharp');
const dueKey = key('user-a', 'recallsmith:due-clear:v1:csharp');
const now = new Date(2026, 9, 22, 12);
const input = {
  userSub: 'user-a', eventId: 'rating-a', slug: 'csharp', stableUid: 'new-a', rating: 'good' as const,
  progressBefore: [], newCardEligible: true, dueBefore: 1, remainingDueCount: 0, now,
};
async function runtime(sub = 'user-a') {
  const storage = await import('../../src/review/storage');
  storage.setActiveUserSubForStorage(sub);
  return {
    ...await import('../../src/features/gacha/rewards/sessionRewards'),
    ...await import('../../src/features/gacha/rewards/deckWallet'),
    ...await import('../../src/features/gacha/rewards/newCardLedger'),
    ...await import('../../src/review/pendingRating'),
  };
}
async function restart(sub = 'user-a') {
  fault = undefined;
  vi.resetModules();
  return runtime(sub);
}
function wallet(sub = 'user-a') {
  return JSON.parse(store.get(walletKey(sub)) ?? '{"decks":{}}').decks.csharp ?? { availablePulls: 0, reservePulls: 0 };
}
function failOnce(match: (key: string, value: string) => boolean, phase: 'before' | 'after') {
  let failed = false;
  fault = (k, value) => {
    if (!failed && match(k, value)) { failed = true; return phase; }
  };
}

describe('rating reward durability with actual wallet and ledger persistence', () => {
  beforeEach(async () => {
    store.clear(); fault = undefined;
    vi.resetModules();
    store.set(key('user-a', 'sync:remoteCache:v1:csharp'), '{}');
    await runtime();
  });

  it.each(['before', 'after'] as const)('recovers the same event after failure %s the wallet commit', async (phase) => {
    const first = await runtime();
    await first.writePendingRating('csharp', { ...input, sub: input.userSub, uid: input.stableUid });
    failOnce(k => k === walletKey(), phase);
    await expect(first.settleRatingReward(input)).rejects.toThrow('injected');
    expect(await first.readPendingRating('user-a', 'csharp', 'new-a')).not.toBeNull();
    if (phase === 'before') {
      expect(JSON.parse(store.get(ledgerKey)!)).not.toHaveProperty('new-a');
      expect(store.has(dueKey)).toBe(false);
    }
    const reloaded = await restart();
    const journal = await reloaded.readPendingRating<any>('user-a', 'csharp', 'new-a');
    const paid = await reloaded.settleRatingReward(journal);
    expect(paid).toMatchObject({ newCardPaid: true, dueClearPaid: true, pulls: 2, walletAfter: { availablePulls: 2, reservePulls: 0 } });
    expect(await reloaded.settleRatingReward(journal)).toEqual(paid);
    expect(wallet()).toEqual({ availablePulls: 2, reservePulls: 0 });
    expect(JSON.parse(store.get(ledgerKey)!)).toEqual({ 'new-a': now.getTime() });
    expect(store.get(dueKey)).toBe('2026-10-22');
  });

  it.each((['ledger', 'due-marker', 'receipt-completion'] as const).flatMap(target =>
    (['before', 'after'] as const).map(phase => [target, phase] as const)))(
    'reconciles %s failure %s persistence before accepting a different event', async (target, phase) => {
    const first = await runtime();
    failOnce((k, value) => target === 'ledger' ? k === ledgerKey && value.includes('new-a')
      : target === 'due-marker' ? k === dueKey
      : k === walletKey() && value.includes('"pendingProjection":false'), phase);
    await expect(first.settleRatingReward(input)).rejects.toThrow('injected');
    const reloaded = await restart();
    const other = await reloaded.settleRatingReward({ ...input, eventId: 'another-event' });
    expect(other.pulls).toBe(0);
    const original = await reloaded.settleRatingReward(input);
    expect(original.pulls).toBe(2);
    expect(wallet()).toEqual({ availablePulls: 2, reservePulls: 0 });
    expect(JSON.parse(store.get(ledgerKey)!)).toEqual({ 'new-a': now.getTime() });
    expect(store.get(dueKey)).toBe('2026-10-22');
  });

  it.each(['recallsmith:newCardPullPaidUids:csharp', 'recallsmith:newCardPullSeeded:csharp'].flatMap(base =>
    (['before', 'after'] as const).map(phase => [base, phase] as const)))(
    'retries a failed seed %s %s persistence without an unpaid claim', async (base, phase) => {
    const app = await runtime();
    failOnce(k => k === key('user-a', base), phase);
    expect(await app.settleRatingReward(input)).toMatchObject({ pulls: 0, skipped: 'storage-error' });
    expect(store.has(walletKey())).toBe(false);
    const reloaded = await restart();
    expect((await reloaded.settleRatingReward(input)).pulls).toBe(2);
    expect(wallet()).toEqual({ availablePulls: 2, reservePulls: 0 });
  });

  it('recovers a due-clear-only reward once and allows the following local day', async () => {
    const app = await runtime();
    const dueOnly = { ...input, newCardEligible: false };
    failOnce(k => k === walletKey(), 'after');
    await expect(app.settleRatingReward(dueOnly)).rejects.toThrow('injected');
    const reloaded = await restart();
    expect(await reloaded.settleRatingReward(dueOnly)).toMatchObject({ newCardPaid: false, dueClearPaid: true, pulls: 1 });
    expect((await reloaded.settleRatingReward({ ...dueOnly, eventId: 'same-day' })).pulls).toBe(0);
    expect((await reloaded.settleRatingReward({ ...dueOnly, eventId: 'next-day', now: new Date(2026, 9, 23, 12) })).pulls).toBe(1);
    expect((await reloaded.settleRatingReward(dueOnly)).pulls).toBe(1);
    expect(store.get(dueKey)).toBe('2026-10-23');
    expect(wallet()).toEqual({ availablePulls: 2, reservePulls: 0 });
  });

  it('preserves caps and never refills a spent reward on replay', async () => {
    const app = await runtime();
    await app.saveDeckWallet('csharp', { availablePulls: 59, reservePulls: 5 }, 'user-a');
    const paid = await app.settleRatingReward(input);
    expect(paid.applied).toMatchObject({ appliedToAvailable: 1, appliedToReserve: 0, dropped: 1 });
    await app.consumeDeckPulls('csharp', 3);
    expect(wallet()).toEqual({ availablePulls: 60, reservePulls: 2 });
    const reloaded = await restart();
    expect(await reloaded.settleRatingReward(input)).toEqual(paid);
    expect(wallet()).toEqual({ availablePulls: 60, reservePulls: 2 });
  });

  it('keeps delayed recovery on A while B is active and gives B its own event receipt', async () => {
    const app = await runtime();
    failOnce(k => k === dueKey, 'before');
    await expect(app.settleRatingReward(input)).rejects.toThrow('injected');
    const reloaded = await restart('user-b');
    store.set(key('user-b', 'sync:remoteCache:v1:csharp'), '{}');
    await reloaded.settleRatingReward(input);
    expect(store.has(walletKey('user-b'))).toBe(false);
    const b = await reloaded.settleRatingReward({ ...input, userSub: 'user-b' });
    expect(b.pulls).toBe(2);
    expect(wallet('user-a')).toEqual({ availablePulls: 2, reservePulls: 0 });
    expect(wallet('user-b')).toEqual({ availablePulls: 2, reservePulls: 0 });
  });

  it('serializes competing events and retains receipts through ordinary wallet saves', async () => {
    const app = await runtime();
    const steps = await Promise.all([app.settleRatingReward(input), app.settleRatingReward({ ...input, eventId: 'competing' })]);
    expect(steps.map(step => step.pulls).sort()).toEqual([0, 2]);
    await app.saveDeckWallet('csharp', { availablePulls: 8, reservePulls: 0 }, 'user-a');
    const reloaded = await restart();
    expect((await reloaded.settleRatingReward(input)).pulls).toBe(2);
    expect(wallet()).toEqual({ availablePulls: 8, reservePulls: 0 });
  });

  it('keeps anonymous receipts in their original partition when its credited wallet is adopted', async () => {
    const anon = await runtime('anon');
    const anonInput = { ...input, userSub: 'anon', newCardEligible: false };
    failOnce(k => k === key('anon', 'recallsmith:due-clear:v1:csharp'), 'before');
    await expect(anon.settleRatingReward(anonInput)).rejects.toThrow('injected');
    const account = await restart();
    await account.adoptAnonDeckWallets();
    expect(wallet()).toEqual({ availablePulls: 1, reservePulls: 0 });
    expect(wallet('anon')).toEqual({ availablePulls: 0, reservePulls: 0 });
    expect(JSON.parse(store.get(walletKey())!)).not.toHaveProperty('ratingRewards');
    expect(JSON.parse(store.get(walletKey('anon'))!).ratingRewards).toBeDefined();
    expect((await account.settleRatingReward(anonInput)).pulls).toBe(1);
    expect(wallet()).toEqual({ availablePulls: 1, reservePulls: 0 });
    expect(wallet('anon')).toEqual({ availablePulls: 0, reservePulls: 0 });
  });

  it('projects an anonymous R1 before the normal ledger-then-wallet adoption and never pays it again on the account', async () => {
    const anon = await runtime('anon');
    const anonInput = { ...input, userSub: 'anon', eventId: 'anon-rating', dueBefore: 0 };
    const anonLedgerKey = key('anon', 'recallsmith:newCardPullPaidUids:csharp');
    failOnce((k, value) => k === anonLedgerKey && value.includes('new-a'), 'before');
    await expect(anon.settleRatingReward(anonInput)).rejects.toThrow('injected');
    expect(wallet('anon').availablePulls).toBe(1);
    expect(JSON.parse(store.get(anonLedgerKey)!)).toEqual({});

    const account = await restart();
    // The returning account is already remote-settled; use normal drawStateSync adoption order.
    await account.adoptAnonNewCardLedger();
    await account.adoptAnonDeckWallets();
    expect(JSON.parse(store.get(ledgerKey)!)).toEqual({ 'new-a': now.getTime() });
    expect(wallet().availablePulls).toBe(1);
    expect((await account.settleRatingReward({ ...input, eventId: 'account-rating', dueBefore: 0 })).newCardPaid).toBe(false);
    expect(wallet().availablePulls).toBe(1);
    expect(JSON.parse(store.get(walletKey())!)).not.toHaveProperty('ratingRewards');
    expect(JSON.parse(store.get(walletKey('anon'))!).ratingRewards).toBeDefined();
  });

  it('copies a captured anonymous rating queued between the two public adoption calls before draining its credit', async () => {
    const anon = await runtime('anon');
    await anon.settleRatingReward({ ...input, userSub: 'anon', eventId: 'anon-first', dueBefore: 0 });
    const account = await runtime();
    await account.adoptAnonNewCardLedger();
    const late = account.settleRatingReward({ ...input, userSub: 'anon', eventId: 'anon-late', stableUid: 'late-card', dueBefore: 0 });
    await Promise.all([late, account.adoptAnonDeckWallets()]);
    expect(JSON.parse(store.get(ledgerKey)!)).toEqual({ 'new-a': now.getTime(), 'late-card': now.getTime() });
    expect(wallet().availablePulls).toBe(2);
    expect((await account.settleRatingReward({ ...input, eventId: 'account-late', stableUid: 'late-card', dueBefore: 0 })).newCardPaid).toBe(false);
    expect(wallet().availablePulls).toBe(2);
  });

  it('retains anonymous credit when its ledger cannot be copied and adopts it on a later retry', async () => {
    const anon = await runtime('anon');
    await anon.settleRatingReward({ ...input, userSub: 'anon', eventId: 'anon-first', dueBefore: 0 });
    const account = await runtime();
    fault = (k) => k === ledgerKey ? 'before' : undefined;
    await account.adoptAnonNewCardLedger();
    await account.adoptAnonDeckWallets();
    expect(wallet().availablePulls).toBe(0);
    expect(wallet('anon').availablePulls).toBe(1);
    fault = undefined;
    await account.adoptAnonNewCardLedger();
    await account.adoptAnonDeckWallets();
    expect(JSON.parse(store.get(ledgerKey)!)).toEqual({ 'new-a': now.getTime() });
    expect(wallet().availablePulls).toBe(1);
    expect(wallet('anon').availablePulls).toBe(0);
  });
});
