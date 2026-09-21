import { beforeEach, describe, expect, it, vi } from 'vitest';

// Promoted from the 2026-09-21 adversarial probe of PR #105 (finding S8). The ledger seed
// took the caller's in-memory progress snapshot as the truth about "already learned".
// SessionCardScreen refreshes that snapshot only at load and after its own ratings, while a
// remote pull (app_foreground, an empty-outbox background sync) merges into storage behind
// its back. A seed from the stale snapshot backfilled only what the snapshot knew, the marker
// made that permanent, and every later-arriving learned card paid R1 on its next hard+: 99 of
// 99 account-learned cards in the construction below. The seed now unions the snapshot with
// the storage-fresh view (storageFreshLearned.ts) -- the stored progress key plus the remote
// cache the frozen progressSync.ts writes on every pull -- so all 99 are backfilled and 0 pay.

const store = new Map<string, string>();
let throwOnGet: ((key: string) => boolean) | null = null;
const getItemCalls: string[] = [];

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => {
      getItemCalls.push(key);
      if (throwOnGet?.(key)) throw new Error(`storage read killed: ${key}`);
      return store.get(key) ?? null;
    }),
    setItem: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    removeItem: vi.fn(async (key: string) => {
      store.delete(key);
    }),
    multiGet: vi.fn(async (keys: string[]) => keys.map((k) => [k, store.get(k) ?? null])),
    multiRemove: vi.fn(async (keys: string[]) => {
      for (const k of keys) store.delete(k);
    }),
    getAllKeys: vi.fn(async () => [...store.keys()]),
  },
}));

import { loadDeckProgress, saveDeckProgress, setActiveUserSubForStorage } from '../../src/review/storage';
import { scheduleNextReview } from '../../src/review/model';
import type { CardProgress, ReviewRating } from '../../src/review/model';
import { loadRewardWalletState } from '../../src/features/gacha/rewards/rewardWallet';
import { readNewCardLedger, readNewCardLedgerSeed } from '../../src/features/gacha/rewards/newCardLedger';
import { readProgressSettled } from '../../src/features/gacha/rewards/progressSettled';
import { settleRatingReward, ZERO_REWARD_STEP, type RatingRewardStep } from '../../src/features/gacha/rewards/sessionRewards';

const SLUG = 'aws-saa-c03';
const N = 100;
const USER = 'user-x';
const uKey = (base: string) => `devcards:u:${USER}:${base}`;
const USER_LEDGER = uKey(`recallsmith:newCardPullPaidUids:${SLUG}`);
const USER_SEEDED = uKey(`recallsmith:newCardPullSeeded:${SLUG}`);
const USER_PROGRESS = uKey(`deck-progress:${SLUG}`);
// Written by the frozen progressSync.ts only after a pull page for this deck was cached / applied.
const USER_REMOTE_CACHE = uKey(`sync:remoteCache:v1:${SLUG}`);
const USER_CURSOR_MS = uKey('sync:cursorMs:v1');
const ACTIVE_USER_SUB_KEY = 'devcards:auth:activeUserSub:v1';

const deck: any = {
  Slug: SLUG,
  Title: 'AWS SAA-C03',
  Locale: 'en-US',
  Version: '1',
  DeckType: 1,
  TotalCards: N + 10,
  Cards: Array.from({ length: N + 10 }, (_, i) => ({ StableUid: `c${i}`, OrderInDeck: i + 1, Difficulty: 1, Revision: 1, Question: `Q${i}` })),
};

function learned(uid: string, at = 1_000): CardProgress {
  return { stableUid: uid, stage: 2, lastReviewedAt: at, nextReviewAt: at + 86_400_000 };
}
function total(w: { availablePulls: number; reservePulls: number }) {
  return w.availablePulls + w.reservePulls;
}

/** One server row as the frozen progressSync.ts stores it verbatim in the remote cache (its
 *  ProgressItem, :75-92): lastReviewedAtMs is the field the merge reads (:1133-1135). */
function remoteRow(p: CardProgress) {
  return {
    deckSlug: SLUG,
    stableUid: p.stableUid,
    status: 1,
    reviewCount: 1,
    lastRating: 3,
    lastReviewedAtMs: p.lastReviewedAt,
    nextReviewAtMs: p.nextReviewAt,
    srsStage: p.stage,
    updatedAtMs: p.lastReviewedAt,
  };
}

/** What the frozen progressSync.ts leaves behind after a pull page for this deck was applied
 *  (pullProgressPageAndApply, :1318-1453): the rows cached under the per-deck remote cache
 *  (unioned into whatever is there), the cursor advanced, and the rows merged into the stored
 *  progress. The session screen's in-memory snapshot is NOT touched -- that is the point. */
async function pullLands(rows: CardProgress[]) {
  const cache = JSON.parse(store.get(USER_REMOTE_CACHE) ?? '{}');
  for (const r of rows) cache[r.stableUid] = remoteRow(r);
  store.set(USER_REMOTE_CACHE, JSON.stringify(cache));
  store.set(USER_CURSOR_MS, String(Math.max(...rows.map((r) => r.lastReviewedAt ?? 0), 1)));
  await mergeRowsIntoStoredProgress(rows);
}

async function mergeRowsIntoStoredProgress(rows: CardProgress[]) {
  const local = await loadDeckProgress(deck);
  const byUid = new Map(rows.map((r) => [r.stableUid, r]));
  const merged = local.map((p) => {
    const remote = byUid.get(p.stableUid);
    if (!remote) return p;
    if ((remote.lastReviewedAt ?? 0) > (p.lastReviewedAt ?? 0)) return remote;
    return p;
  });
  await saveDeckProgress(deck, merged);
}

/** Mirrors SessionCardScreen.handleRating (:451-452): saveDeckProgress with the whole in-memory
 *  array FIRST, then settle with the pre-rating snapshot, then advance the snapshot. */
type Session = { progress: CardProgress[]; paid: number; steps: RatingRewardStep[] };
async function rate(
  s: Session,
  uid: string,
  rating: ReviewRating,
  now: Date,
  extra: Partial<Parameters<typeof settleRatingReward>[0]> = {},
): Promise<RatingRewardStep> {
  const before = s.progress;
  const idx = before.findIndex((p) => p.stableUid === uid);
  const cur = idx >= 0 ? before[idx] : { stableUid: uid, stage: 0, nextReviewAt: 0 };
  const updated = scheduleNextReview(cur, rating, now);
  const after = idx >= 0 ? before.map((p, i) => (i === idx ? updated : p)) : [...before, updated];
  await saveDeckProgress(deck, after);
  const step = await settleRatingReward({
    slug: SLUG,
    stableUid: uid,
    rating,
    progressBefore: before,
    newCardEligible: true,
    dueBefore: 0,
    remainingDueCount: 0,
    now,
    ...extra,
  });
  s.progress = after;
  if (step.newCardPaid) s.paid += 1;
  s.steps.push(step);
  return step;
}

/** Mirrors the screen's load (:299-303): replay the remote cache into stored progress (what
 *  applyCachedRemoteProgress does), then loadDeckProgress. */
async function openSession(): Promise<Session> {
  const cache = JSON.parse(store.get(USER_REMOTE_CACHE) ?? '{}');
  const rows: CardProgress[] = Object.values(cache).map((r: any) => learned(r.stableUid, r.lastReviewedAtMs));
  if (rows.length) await mergeRowsIntoStoredProgress(rows);
  return { progress: await loadDeckProgress(deck), paid: 0, steps: [] };
}

/** storage.ts re-reads the active sub from this key once its 1.5s memory cache expires; a slow
 *  run must not silently flip the partition to anon mid-test. */
function signIn(sub: string | null) {
  if (sub) store.set(ACTIVE_USER_SUB_KEY, sub);
  else store.delete(ACTIVE_USER_SUB_KEY);
  setActiveUserSubForStorage(sub);
}

const T = (d: number, h = 10, m = 0) => new Date(2026, 8, d, h, m, 0);

describe('ledger seed vs. a stale in-memory snapshot (S8)', () => {
  beforeEach(() => {
    store.clear();
    getItemCalls.length = 0;
    throwOnGet = null;
    signIn(null);
  });

  it('session opens unsettled, the pull lands mid-session: the first settled rating backfills all 99 account-learned cards and 0 of them pay', async () => {
    // Sign-in while the first pull failed: the session opens unsettled with all-new local progress.
    signIn(USER);
    const s = await openSession();
    const pre = await rate(s, 'c0', 'good', T(20, 10));
    expect(pre.skipped).toBe('progress-unsettled');
    expect((await readProgressSettled(SLUG)).settled).toBe(false);

    // app_foreground / empty-outbox background sync lands the pull mid-session: the cache and the
    // stored progress now hold c1..c99 learned on the account; the session's `progress` does not.
    const accountLearned = Array.from({ length: N - 1 }, (_, i) => learned(`c${i + 1}`, 5_000 + i));
    await pullLands(accountLearned);
    expect(s.progress.filter((p) => (p.lastReviewedAt ?? 0) > 0).map((p) => p.stableUid)).toEqual(['c0']);

    // The session keeps rating from its stale snapshot. The first settled rating (c1, itself
    // account-learned) seeds: every card the account learned is backfilled as paid(0) -- including
    // c1, whose remote row predates this rating -- and c0, rated here before the pull (accepted
    // under-pay). Nothing pays.
    const first = await rate(s, 'c1', 'hard', T(20, 11));
    expect(first.skipped).toBeUndefined();
    expect(first.newCardPaid).toBe(false);
    expect(await readNewCardLedgerSeed(SLUG)).toMatchObject({ seededAtMs: T(20, 11).getTime(), backfilled: N });
    const { ledger } = await readNewCardLedger(SLUG);
    for (const p of accountLearned) expect(ledger[p.stableUid]).toBe(0);
    expect(ledger.c0).toBe(0);

    for (let i = 2; i < 20; i += 1) await rate(s, `c${i}`, 'hard', T(20, 11));
    expect(s.paid).toBe(0);

    // Later sessions reload merged progress; the marker is already there, so no re-seed -- and
    // none of the remaining account-learned cards pays either.
    const s2 = await openSession();
    for (let i = 20; i < N; i += 1) await rate(s2, `c${i}`, 'hard', T(21));
    expect(s2.paid).toBe(0);
    expect(await readNewCardLedgerSeed(SLUG)).toMatchObject({ backfilled: N });

    // A genuinely new card still pays exactly once.
    expect((await rate(s2, 'c105', 'good', T(21))).pulls).toBe(1);
    expect((await rate(s2, 'c105', 'good', T(22))).pulls).toBe(0);
    expect(total(await loadRewardWalletState())).toBe(1);
  });

  it('session opens settled but a second pull lands mid-session: the seed still sees it', async () => {
    // First pull before the session: c1..c50 learned on the account; the session loads them.
    signIn(USER);
    await pullLands(Array.from({ length: 50 }, (_, i) => learned(`c${i + 1}`, 5_000 + i)));
    const s = await openSession();
    expect(s.progress.filter((p) => (p.lastReviewedAt ?? 0) > 0)).toHaveLength(50);

    // Second pull mid-session: c51..c99, unknown to the snapshot. No rating has settled yet.
    await pullLands(Array.from({ length: 49 }, (_, i) => learned(`c${i + 51}`, 6_000 + i)));
    expect(store.has(USER_SEEDED)).toBe(false);

    // First settled rating on c60 -- in the stale snapshot a new card, on the account a learned one.
    const first = await rate(s, 'c60', 'hard', T(20));
    expect(first.newCardPaid).toBe(false);
    expect(await readNewCardLedgerSeed(SLUG)).toMatchObject({ backfilled: N - 1 });

    for (let i = 1; i < N; i += 1) await rate(s, `c${i}`, 'hard', T(20, 12));
    expect(s.paid).toBe(0);
    expect((await rate(s, 'c100', 'good', T(20, 13))).pulls).toBe(1);
    expect(total(await loadRewardWalletState())).toBe(1);
  });

  it('the card being rated is decided by the snapshot, not by the progress the screen just saved', async () => {
    // Settled partition, nothing learned anywhere. The screen saves the rating before it settles,
    // so the stored progress already calls c0 learned when the seed runs; c0 must still pay.
    signIn(USER);
    store.set(USER_CURSOR_MS, '1');
    const s = await openSession();
    const first = await rate(s, 'c0', 'good', T(20));
    expect(JSON.parse(store.get(USER_PROGRESS)!).find((p: any) => p.stableUid === 'c0').lastReviewedAt).toBe(T(20).getTime());
    expect(first.newCardPaid).toBe(true);
    expect(await readNewCardLedgerSeed(SLUG)).toMatchObject({ backfilled: 0 });
    expect((await readNewCardLedger(SLUG)).ledger.c0).toBe(T(20).getTime());

    // Cards learned mid-session in the stored progress (but not in the snapshot) are read on a
    // later partition's seed only; here the marker exists, so a card learned on this device and
    // rated again pays nothing, and a new one pays once.
    expect((await rate(s, 'c0', 'good', T(21))).pulls).toBe(0);
    expect((await rate(s, 'c1', 'good', T(21))).pulls).toBe(1);
    expect(total(await loadRewardWalletState())).toBe(2);
  });

  it('a storage error on the storage-fresh read is a seed-time storage error: zero step, nothing written', async () => {
    signIn(USER);
    await pullLands([learned('c1', 5_000)]);
    const s = await openSession();
    throwOnGet = (key) => key === USER_PROGRESS;
    const step = await rate(s, 'c2', 'good', T(20));
    expect(step).toEqual({ ...ZERO_REWARD_STEP, skipped: 'storage-error' });
    expect(store.has(USER_LEDGER)).toBe(false);
    expect(store.has(USER_SEEDED)).toBe(false);

    // Storage back: the next rating seeds normally. c1 (account) and c2 (rated during the
    // outage -- the screen advanced its snapshot regardless, so it is backfilled: the documented
    // under-pay of a storage error) read as paid(0); the genuinely new c3 pays once.
    throwOnGet = null;
    const next = await rate(s, 'c3', 'good', T(20, 11));
    expect(next.newCardPaid).toBe(true);
    const { ledger } = await readNewCardLedger(SLUG);
    expect(ledger.c1).toBe(0);
    expect(ledger.c2).toBe(0);
    expect((await rate(s, 'c2', 'good', T(20, 12))).pulls).toBe(0);
    expect(total(await loadRewardWalletState())).toBe(1);
  });

  it('never reads the storage-fresh keys once the partition is seeded', async () => {
    signIn(USER);
    await pullLands([learned('c1', 5_000)]);
    const s = await openSession();
    await rate(s, 'c2', 'good', T(20));
    expect(store.has(USER_SEEDED)).toBe(true);

    getItemCalls.length = 0;
    await rate(s, 'c3', 'good', T(20, 11));
    expect(getItemCalls).not.toContain(USER_PROGRESS);
    expect(getItemCalls.filter((k) => k === USER_REMOTE_CACHE)).toHaveLength(1); // the settled gate only
  });
});
