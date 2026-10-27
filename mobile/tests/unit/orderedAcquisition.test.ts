import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeckExport } from '../../src/types/deckExport';
const store = new Map<string, string>();
let onRead: ((key: string) => Promise<void>) | null = null;
let onWrite: ((key: string, after: boolean) => Promise<void>) | null = null;
const writes: string[] = [];
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {
  getItem: vi.fn(async (key: string) => { const raw = store.get(key) ?? null; await onRead?.(key); return raw; }),
  setItem: vi.fn(async (key: string, value: string) => { writes.push(key); await onWrite?.(key, false); store.set(key, value); await onWrite?.(key, true); }),
  removeItem: vi.fn(async (key: string) => { store.delete(key); }), getAllKeys: vi.fn(async () => [...store.keys()]),
  multiGet: vi.fn(async (keys: string[]) => keys.map(key => [key, store.get(key) ?? null])),
  multiRemove: vi.fn(async (keys: string[]) => keys.forEach(key => store.delete(key))),
} }));
const apiJson = vi.fn();
vi.mock('../../src/api/apiClient', () => ({ apiJson: (...args: unknown[]) => apiJson(...args) }));
vi.mock('../../src/content/deckCache', () => ({ getCachedDeck: vi.fn(async () => deck) }));
vi.mock('../../src/content/deckRepository', () => ({ resolveDeckBySlug: vi.fn(async () => deck) }));
import { acquireDraw } from '../../src/features/gacha/draw/acquireDraw';
import { commitDraw, flushDrawHistory, replayDraw } from '../../src/features/gacha/draw/drawCommit';
import { loadDrawHistory, loadDrawState, adoptAnonDrawState } from '../../src/features/gacha/draw/drawStateStore';
import { invalidateDrawStateCache } from '../../src/features/gacha/draw/drawStateCache';
import { loadDrawStatus } from '../../src/features/gacha/draw/drawPool';
import { loadDeckWallet } from '../../src/features/gacha/rewards/deckWallet';
import { setActiveUserSubForStorage, invalidateActiveUserSubCache, loadDeckProgress } from '../../src/review/storage';
import { syncDrawStateNow } from '../../src/sync/drawStateSync';
import { pickNextCard } from '../../src/features/gacha/planner/sessionPlanner';
import { selectDrawCards } from '../../src/features/gacha/draw/poolSelection';
import { orderedCards } from '../../src/features/gacha/draw/orderedAcquisition';
import { resetAllProgress } from '../../src/features/debug/resetProgress';
import { withDrawStateLock, invalidateDrawStateOperations } from '../../src/features/gacha/draw/drawStateLock';
import { buildRatedSessionState } from '../../src/features/gacha/session/sessionReviewHelpers';
import { grantDeckPulls, ensureDeckBootstrap } from '../../src/features/gacha/rewards/deckWallet';
import { savePityState } from '../../src/features/gacha/draw/pity';
const slug = 'aws-saa-fundamentals'; const scope = 'devcards:u:user-a:';
const stateKey = `${scope}devcards:draw-state:${slug}`; const walletKey = `${scope}recallsmith:deck-wallets:v1`;
const progressKey = `${scope}deck-progress:${slug}`; const historyKey = `${scope}devcards:draw-history:${slug}`;
const pity = { draws: 10, threshold: 10 }; let deck: DeckExport;
function seed(owned: string[] = [], pulls = 10) {
  store.set(stateKey, JSON.stringify({ owned, pity }));
  store.set(walletKey, JSON.stringify({ migratedAtMs: 1, decks: { [slug]: { availablePulls: pulls, reservePulls: 0 } }, bootstrappedAtMs: { [slug]: 1 } }));
  store.set('recallsmith:onboarding:stage:v1', 'done');
}
function barrier() {
  let entered!: () => void; let release!: () => void;
  const reached = new Promise<void>(resolve => { entered = resolve; }); const wait = new Promise<void>(resolve => { release = resolve; });
  return { reached, release, block: async () => { entered(); await wait; } };
}
const uids = (r: Awaited<ReturnType<typeof acquireDraw>>) => r.result?.cards.map(c => c.stableUid) ?? [];
const learned = (stableUid: string) => ({ stableUid, stage: 2, lastReviewedAt: 1700000000000, nextReviewAt: 1700086400000 });
const remote = (owned: string[]) => ({ success: true, data: { decks: [{ deckSlug: slug, owned }], wallet: null } });
beforeEach(async () => {
  await flushDrawHistory(); store.clear(); writes.length = 0; onRead = null; onWrite = null;
  invalidateDrawStateCache(); setActiveUserSubForStorage('user-a'); apiJson.mockReset();
  deck = { Slug: slug, Title: 'AWS', Locale: 'en', Version: 'course-1', DeckType: 1, IsFreeStarter: true, TotalCards: 12, FreeCardCount: 12,
    Cards: Array.from({ length: 12 }, (_, i) => ({ StableUid: `c${i + 1}`, OrderInDeck: i + 1, Question: `Q${i + 1}`, Difficulty: i === 11 ? 3 : 1, Revision: 1 })).reverse() };
  seed();
  store.set('devcards:content:manifest:v2', JSON.stringify({ decks: [{ slug, availability: 'live' }, { slug: 'other', availability: 'live' }] }));
  store.set(`devcards:content:deckmeta:v2:user-a:${slug}`, JSON.stringify({ buildId: deck.Version, fileUri: 'file:///aws.json' }));
});
describe('ordered-v1 selection and accounting', () => {
  it('new user gets earliest cards regardless of rarity or pity, leaving pity unchanged', async () => {
    const r = await acquireDraw(slug, 5, { deck }); expect(uids(r)).toEqual(['c1', 'c2', 'c3', 'c4', 'c5']);
    expect(r.spent).toBe(5); expect((await loadDrawState(slug)).pity).toEqual(pity); expect(r.result?.pityFiredFor).toBeNull();
    expect((await loadDrawStatus(slug, deck.Cards)).pityLabel).toBe('');
  });
  it('learned starter five are effective owned but not permanently granted', async () => {
    store.set(progressKey, JSON.stringify(['c1', 'c2', 'c3', 'c4', 'c5'].map(learned)));
    expect(uids(await acquireDraw(slug, 3, { deck }))).toEqual(['c6', 'c7', 'c8']); expect((await loadDrawState(slug)).owned).toEqual(['c6', 'c7', 'c8']);
  });
  it('temporary starter lesson cards are excluded', async () => {
    store.set('recallsmith:onboarding:stage:v1', 'starter'); store.set('recallsmith:starter-lesson:v1', JSON.stringify({ slug, uids: ['c1', 'c2', 'c3', 'c4', 'c5'] }));
    expect(uids(await acquireDraw(slug, 1, { deck }))).toEqual(['c6']);
  });
  it('fills old random gaps first', async () => {
    seed(['c1', 'c2', 'c3', 'c4', 'c5', 'c9', 'c10', 'c11', 'c12']); expect(uids(await acquireDraw(slug, 3, { deck }))).toEqual(['c6', 'c7', 'c8']);
  });
  it('five singles equal one batch of five', async () => {
    const singles: string[] = []; for (let i = 0; i < 5; i++) singles.push(...uids(await acquireDraw(slug, 1, { deck })));
    seed(); invalidateDrawStateCache(); expect(uids(await acquireDraw(slug, 5, { deck }))).toEqual(singles);
  });
  it('two remaining cost two, then empty costs zero', async () => {
    seed(Array.from({ length: 10 }, (_, i) => `c${i + 1}`), 5); const r = await acquireDraw(slug, 5, { deck });
    expect(uids(r)).toEqual(['c11', 'c12']); expect(r.spent).toBe(2); expect((await acquireDraw(slug, 5, { deck })).spent).toBe(0);
    expect((await loadDeckWallet(slug)).availablePulls).toBe(3);
  });
  it('fresh balance caps delivery; empty balance grants nothing', async () => {
    seed([], 2); expect(uids(await acquireDraw(slug, 5, { deck }))).toEqual(['c1', 'c2']); expect(uids(await acquireDraw(slug, 5, { deck }))).toEqual([]);
  });
  it('dedupes identities and rejects invalid/duplicate positions', () => {
    expect(orderedCards([deck.Cards[0], deck.Cards[0]])).toHaveLength(1);
    for (const order of [0, -1, 1.5, NaN]) expect(() => orderedCards([{ ...deck.Cards[0], OrderInDeck: order }])).toThrow();
    expect(() => orderedCards([{ ...deck.Cards[0], OrderInDeck: 1 }, { ...deck.Cards[1], OrderInDeck: 1 }])).toThrow();
  });
  it('insert/reorder/revision/retired membership derive gaps without changing FSRS', async () => {
    const progress = [learned('c1')]; store.set(progressKey, JSON.stringify(progress)); seed(['c3', 'retired']);
    deck.Cards = deck.Cards.filter(c => c.StableUid !== 'c4').map(c => ({ ...c, OrderInDeck: c.OrderInDeck * 10, Revision: 2 }));
    deck.Cards.push({ ...deck.Cards[0], StableUid: 'inserted', OrderInDeck: 15 });
    expect(uids(await acquireDraw(slug, 2, { deck }))).toEqual(['inserted', 'c2']); expect(JSON.parse(store.get(progressKey)!)).toEqual(progress);
    expect((await loadDrawState(slug)).owned).toContain('retired');
  });
});
describe('deterministic serialization', () => {
  it('two entrances serialize qualification through debit', async () => {
    seed([], 1); const g = barrier(); let once = true; onWrite = async (k, after) => { if (k === stateKey && !after && once) { once = false; await g.block(); } };
    const first = acquireDraw(slug, 1, { deck }); await g.reached; const second = acquireDraw(slug, 1, { deck }); g.release();
    expect((await Promise.all([first, second])).map(uids)).toEqual([['c1'], []]); expect((await loadDeckWallet(slug)).availablePulls).toBe(0);
  });
  it('sync snapshot/network wait -> draw -> sync apply retains both additions', async () => {
    const g = barrier(); apiJson.mockImplementation(async () => { await g.block(); return remote(['c3']); });
    const sync = syncDrawStateNow('token'); await g.reached; expect(uids(await acquireDraw(slug, 1, { deck }))).toEqual(['c1']);
    g.release(); expect((await sync).ran).toBe(true); expect(new Set((await loadDrawState(slug)).owned)).toEqual(new Set(['c1', 'c3']));
    expect(uids(await acquireDraw(slug, 1, { deck }))).toEqual(['c2']);
  });
  it('sync apply stale read held -> queued draw waits, then fills earliest gap', async () => {
    const g = barrier(); let applying = false; let once = true; apiJson.mockImplementation(async () => { applying = true; return remote(['c1', 'c3']); });
    onRead = async k => { if (k === stateKey && applying && once) { once = false; await g.block(); } };
    const sync = syncDrawStateNow('token'); await g.reached; const draw = acquireDraw(slug, 1, { deck });
    expect(writes.filter(k => k === stateKey)).toHaveLength(0); g.release(); expect((await sync).ran).toBe(true);
    expect(uids(await draw)).toEqual(['c2']); expect(new Set((await loadDrawState(slug)).owned)).toEqual(new Set(['c1', 'c2', 'c3']));
  });
  it('legacy claim cannot overwrite a queued draw', async () => {
    store.delete(stateKey); store.set(`devcards:draw-owned:${slug}`, '["c1"]'); const g = barrier(); let once = true;
    onWrite = async (k, after) => { if (k === stateKey && !after && once) { once = false; await g.block(); } };
    const migration = loadDrawState(slug); await g.reached; const draw = acquireDraw(slug, 1, { deck }); g.release(); await migration;
    expect(uids(await draw)).toEqual(['c2']); expect((await loadDrawState(slug)).owned).toEqual(['c1', 'c2']);
  });
  it('anon adoption cannot overwrite a queued draw', async () => {
    store.set(`devcards:u:anon:devcards:draw-state:${slug}`, JSON.stringify({ owned: ['c1', 'c3'], pity })); const g = barrier(); let once = true;
    onWrite = async (k, after) => { if (k === stateKey && !after && once) { once = false; await g.block(); } };
    const adoption = adoptAnonDrawState('user-a'); await g.reached; const draw = acquireDraw(slug, 1, { deck }); g.release(); await adoption;
    expect(uids(await draw)).toEqual(['c2']); expect(new Set((await loadDrawState(slug)).owned)).toEqual(new Set(['c1', 'c2', 'c3']));
  });
  it('pity update cannot erase a queued draw', async () => {
    const g = barrier(); let once = true; onWrite = async (k, after) => { if (k === stateKey && !after && once) { once = false; await g.block(); } };
    const update = savePityState(slug, { draws: 4, threshold: 10 }); await g.reached; const draw = acquireDraw(slug, 1, { deck }); g.release(); await update;
    expect(uids(await draw)).toEqual(['c1']); expect((await loadDrawState(slug)).pity?.draws).toBe(4);
  });
});
describe('lifecycle and account fences', () => {
  it('reset waits until grant and debit finish, then a queued open cannot resurrect state', async () => {
    const g = barrier(); let once = true;
    onWrite = async (k, after) => { if (k === stateKey && !after && once) { once = false; await g.block(); } };
    const first = acquireDraw(slug, 1, { deck }); await g.reached;
    const reset = resetAllProgress(); const queued = acquireDraw(slug, 1, { deck }); const rejected = expect(queued).rejects.toThrow();
    g.release(); expect(uids(await first)).toEqual(['c1']); await reset; await rejected;
    expect(store.has(stateKey)).toBe(false); expect(store.has(walletKey)).toBe(false);
  });
  it('sync network response captured before reset does not restore ownership or wallet', async () => {
    const g = barrier(); apiJson.mockImplementation(async () => { await g.block(); return remote(['c3']); });
    const sync = syncDrawStateNow('token'); await g.reached; await resetAllProgress(); g.release();
    expect((await sync).ran).toBe(false); expect(store.has(stateKey)).toBe(false); expect(store.has(walletKey)).toBe(false);
  });
  it('retirement invalidation cancels an already queued open', async () => {
    const g = barrier(); const sweep = withDrawStateLock(async () => { await g.block(); invalidateDrawStateOperations(); store.delete(stateKey); invalidateDrawStateCache(); });
    await g.reached; const queued = acquireDraw(slug, 1, { deck }); const rejected = expect(queued).rejects.toThrow();
    g.release(); await sweep; await rejected;
    expect(store.has(stateKey)).toBe(false); expect(JSON.parse(store.get(walletKey)!).decks[slug].availablePulls).toBe(10);
  });
  it('pity mutation keeps its initiating account while queued', async () => {
    const g = barrier(); const held = withDrawStateLock(g.block); await g.reached;
    const pending = savePityState(slug, { draws: 4, threshold: 10 });
    await Promise.resolve(); await Promise.resolve(); setActiveUserSubForStorage('user-b'); g.release(); await held; await pending;
    expect(JSON.parse(store.get(stateKey)!).pity.draws).toBe(4);
    expect(store.has(`devcards:u:user-b:devcards:draw-state:${slug}`)).toBe(false);
  });
  it('bootstrap keeps its initiating account while queued', async () => {
    store.delete(stateKey); store.delete(walletKey);
    const g = barrier(); const held = withDrawStateLock(g.block); await g.reached;
    const pending = ensureDeckBootstrap(slug); await Promise.resolve(); await Promise.resolve();
    setActiveUserSubForStorage('user-b'); g.release(); await held; await pending;
    expect(JSON.parse(store.get(walletKey)!).decks[slug].availablePulls).toBe(5);
    expect(store.has(`devcards:u:user-b:recallsmith:deck-wallets:v1`)).toBe(false);
  });
  it('account changes after grant retain the old account cards without charging either wallet', async () => {
    onWrite = async (k, after) => { if (k === stateKey && after) setActiveUserSubForStorage('user-b'); };
    await expect(acquireDraw(slug, 1, { deck })).rejects.toThrow(/Account changed/);
    expect(JSON.parse(store.get(stateKey)!).owned).toEqual(['c1']); expect(JSON.parse(store.get(walletKey)!).decks[slug].availablePulls).toBe(10);
    expect(store.has(`devcards:u:user-b:devcards:draw-state:${slug}`)).toBe(false);
  });
  it('identity read in flight cannot return the account that was replaced', async () => {
    invalidateActiveUserSubCache(); store.set('devcards:auth:activeUserSub:v1', 'user-a');
    const g = barrier(); let once = true; onRead = async k => { if (k === 'devcards:auth:activeUserSub:v1' && once) { once = false; await g.block(); } };
    const pending = acquireDraw(slug, 1, { deck }); await g.reached; setActiveUserSubForStorage('user-b'); g.release();
    await expect(pending).rejects.toThrow(); expect(writes).toEqual([]);
  });
  it('wallet reward queued during sync CAS is retained', async () => {
    const g = barrier(); let once = true; let applying = false;
    apiJson.mockImplementation(async () => { applying = true; return { success: true, data: { decks: [{ deckSlug: slug, owned: [], pulls: { availablePulls: 20, reservePulls: 0, updatedAtMs: 1 } }] } }; });
    onRead = async k => { if (applying && k === walletKey && once) { once = false; await g.block(); } };
    const sync = syncDrawStateNow('token'); await g.reached; const reward = grantDeckPulls(slug, 1); g.release();
    await sync; await reward; expect((await loadDeckWallet(slug)).availablePulls).toBe(21);
  });
});
describe('qualification failure and crash recovery', () => {
  it.each(['owned-read', 'progress-read', 'starter-read', 'owned-corrupt', 'progress-corrupt', 'progress-entry-corrupt', 'legacy-entry-corrupt', 'wallet-read', 'wallet-corrupt', 'pending-progress-migration', 'pending-owned-migration'])('%s pauses without debit', async mode => {
    if (mode.endsWith('-read')) onRead = async k => { if (k === (mode === 'owned-read' ? stateKey : mode === 'progress-read' ? progressKey : mode === 'wallet-read' ? walletKey : 'recallsmith:onboarding:stage:v1')) throw new Error('IO'); };
    if (mode === 'owned-corrupt') store.set(stateKey, '{'); if (mode === 'progress-corrupt') store.set(progressKey, '{'); if (mode === 'wallet-corrupt') store.set(walletKey, '{');
    if (mode === 'progress-entry-corrupt') store.set(progressKey, '[null]');
    if (mode === 'legacy-entry-corrupt') { store.delete(stateKey); store.set(`devcards:draw-owned:${slug}`, '[null]'); }
    if (mode === 'pending-progress-migration') store.set(`deck-progress:${slug}:old`, '[]');
    if (mode === 'pending-owned-migration') { store.delete(stateKey); store.set(`devcards:draw-owned:${slug}`, '["c1"]'); onWrite = async k => { if (k === stateKey) throw new Error('migration failed'); }; }
    await expect(acquireDraw(slug, 1, { deck })).rejects.toThrow(); expect(writes.filter(k => k === walletKey)).toEqual([]);
  });
  it('owned write failure leaves collection and wallet untouched', async () => {
    onWrite = async (k, after) => { if (k === stateKey && !after) throw new Error('owned failed'); };
    await expect(acquireDraw(slug, 1, { deck })).rejects.toThrow(); expect((await loadDeckWallet(slug)).availablePulls).toBe(10);
    onWrite = null; expect(uids(await acquireDraw(slug, 1, { deck }))).toEqual(['c1']);
  });
  it.each(['after-owned', 'before-debit', 'after-debit'])('%s retains cards; retry does not debit an uncertain old delivery', async mode => {
    let once = true; onWrite = async (k, after) => { if (once && ((mode === 'after-owned' && k === stateKey && after) || (mode === 'before-debit' && k === walletKey && !after) || (mode === 'after-debit' && k === walletKey && after))) { once = false; throw new Error('crash'); } };
    await expect(acquireDraw(slug, 1, { deck })).rejects.toThrow(); invalidateDrawStateCache(); onWrite = null;
    expect((await loadDrawState(slug)).owned).toEqual(['c1']); expect(uids(await acquireDraw(slug, 1, { deck }))).toEqual(['c2']);
    expect((await loadDeckWallet(slug)).availablePulls).toBe(mode === 'after-debit' ? 8 : 9);
  });
  it('history failure never undoes a paid grant', async () => {
    onWrite = async k => { if (k === historyKey) throw new Error('history failed'); };
    expect(uids(await acquireDraw(slug, 1, { deck }))).toEqual(['c1']); await flushDrawHistory(); expect((await loadDeckWallet(slug)).availablePulls).toBe(9);
  });
  it('account switch during qualification grants/debits neither partition', async () => {
    const g = barrier(); onRead = async k => { if (k === progressKey) await g.block(); };
    const draw = acquireDraw(slug, 1, { deck }); await g.reached; setActiveUserSubForStorage('user-b'); g.release();
    await expect(draw).rejects.toThrow(/Account changed/); expect(writes).toEqual([]);
  });
  it('account identity IO fails closed', async () => {
    invalidateActiveUserSubCache(); onRead = async k => { if (k === 'devcards:auth:activeUserSub:v1') throw new Error('identity IO'); };
    await expect(acquireDraw(slug, 1, { deck })).rejects.toThrow(); expect(writes).toEqual([]);
  });
});
describe('history and learning compatibility', () => {
  it('ordered replay requires its bound version and ordering', async () => {
    await acquireDraw(slug, 3, { deck }); await flushDrawHistory(); const [r] = await loadDrawHistory(slug);
    expect(r.selectionPolicy).toBe('ordered-v1'); expect(r.deckVersion).toBe(deck.Version); expect(replayDraw(r, deck.Cards, deck.Version).matches).toBe(true);
    expect(replayDraw(r, deck.Cards, 'other-version').matches).toBe(false);
    expect(replayDraw(r, deck.Cards.map(c => ({ ...c, OrderInDeck: c.OrderInDeck + 1 })), deck.Version).matches).toBe(false);
  });
  it('old AWS history without policy still uses random replay', () => {
    const drawnUids = selectDrawCards({ deckCards: deck.Cards, ownedSet: new Set(), drawCount: 3, pityState: pity, seed: 12 }).cards.map(c => c.StableUid);
    expect(replayDraw({ drawId: 'old', slug, seed: 12, drawCount: 3, ownedBefore: [], pityBefore: pity, drawnUids, ts: 1 }, deck.Cards).matches).toBe(true);
  });
  it('appending ordered history preserves old random entries and their pity replay', async () => {
    const drawnUids = selectDrawCards({ deckCards: deck.Cards, ownedSet: new Set(), drawCount: 3, pityState: pity, seed: 12 }).cards.map(c => c.StableUid);
    const old = { drawId: 'old', slug, seed: 12, drawCount: 3, ownedBefore: [], pityBefore: pity, drawnUids, ts: 1 };
    store.set(historyKey, JSON.stringify([old])); seed(drawnUids);
    await acquireDraw(slug, 1, { deck }); await flushDrawHistory(); const history = await loadDrawHistory(slug);
    expect(history[0]).toEqual(old); expect(replayDraw(history[0], deck.Cards).matches).toBe(true);
    expect(history[1].selectionPolicy).toBe('ordered-v1'); expect((await loadDrawState(slug)).pity).toEqual(pity);
  });
  it('rating uses the cached deck slug to keep earliest learn-new despite MCQ rotation', async () => {
    const cards = orderedCards(deck.Cards);
    cards[2].Mcq = { v: 1, qualifier: null, shuffle: false, options: [
      { key: 'a', text: 'A', correct: true, why: null }, { key: 'b', text: 'B', correct: false, why: 'B is wrong' },
      { key: 'c', text: 'C', correct: false, why: 'C is wrong' },
    ] };
    const randomIndex = { cards, cardMap: new Map(cards.map(c => [c.StableUid, c])), deckSlug: 'other' };
    const newProgress = cards.map(c => ({ stableUid: c.StableUid, stage: 0, nextReviewAt: 0 }));
    expect(pickNextCard({ index: randomIndex, progress: newProgress, now: new Date(), mode: 'learn-new',
      ownedSet: new Set(['c2', 'c3']), kindHint: { mcqAllowed: true, preferMcq: true } })?.card.StableUid).toBe('c3');
    const progress = await loadDeckProgress(deck); const index = { cards, cardMap: new Map(cards.map(c => [c.StableUid, c])), deckSlug: slug };
    const state = buildRatedSessionState({ current: { card: cards[0], progress: progress.find(p => p.stableUid === 'c1')! }, progress,
      rating: 'good', mode: 'learn-new', sessionDone: 0, sessionLimit: 5, now: new Date('2026-10-28T00:00:00Z'), cardIndex: index,
      ownedSet: new Set(['c1', 'c2', 'c3']), kindHint: { mcqAllowed: true, preferMcq: true } });
    expect(state.nextCurrent?.card.StableUid).toBe('c2'); expect(state.updatedProgress).toHaveLength(progress.length);
    const due = state.updatedProgress.map(p => p.stableUid === 'c3' ? { ...p, lastReviewedAt: 1, nextReviewAt: 1 } : p);
    expect(pickNextCard({ index, progress: due, now: new Date(), mode: 'review-due', ownedSet: new Set(['c3']) })?.card.StableUid).toBe('c3');
  });
  it('other decks retain random selection and pity', async () => {
    deck = { ...deck, Slug: 'other' }; const r = await commitDraw('other', 1, { deck }); expect(r).not.toBeNull(); expect(r?.pityAfter).not.toBe(pity.draws);
  });
  it('default/cached learn-new preserve course order and due review remains unchanged', async () => {
    const progress = await loadDeckProgress(deck); const cards = orderedCards(deck.Cards);
    const args = { deck, progress, now: new Date(), mode: 'learn-new' as const, ownedSet: new Set(['c2', 'c3']), kindHint: { mcqAllowed: true, preferMcq: true } };
    expect(pickNextCard(args)?.card.StableUid).toBe('c2'); expect(pickNextCard({ ...args, index: { cards, cardMap: new Map(cards.map(c => [c.StableUid, c])) } })?.card.StableUid).toBe('c2');
    expect(pickNextCard({ ...args, mode: 'review-due' })?.card).toBeUndefined();
  });
});
