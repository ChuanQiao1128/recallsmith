import { beforeEach, describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';

const store = new Map<string, string>();
// Crash hook: when set, getItem throws for keys it matches, so a test can prove
// the ledger fails closed on a storage error.
let throwOnGet: ((key: string) => boolean) | null = null;

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => {
      if (throwOnGet?.(key)) throw new Error(`storage read killed: ${key}`);
      return store.get(key) ?? null;
    }),
    setItem: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    removeItem: vi.fn(async (key: string) => {
      store.delete(key);
    }),
    getAllKeys: vi.fn(async () => [...store.keys()]),
  },
}));

// The real scope helper is under test (the key is pinned to the anon partition),
// so review/storage is NOT mocked. Anon fixtures are written directly into the
// backing store the same way the debug reset does.
import { setActiveUserSubForStorage } from '../../src/review/storage';
import type { CardProgress } from '../../src/review/model';
import {
  adoptAnonNewCardLedger,
  countPaidOnDay,
  markDueClearedIfFirstToday,
  payNewCardIfUnpaid,
  readNewCardLedger,
  readNewCardLedgerSeed,
  seedNewCardLedgerIfAbsent,
} from '../../src/features/gacha/rewards/newCardLedger';

const ANON_LEDGER_KEY = 'devcards:u:anon:recallsmith:newCardPullPaidUids:csharp';
const USER_LEDGER_KEY = 'devcards:u:user-a:recallsmith:newCardPullPaidUids:csharp';
const ANON_MARKER_KEY = 'devcards:u:anon:recallsmith:due-clear:v1';
// The per-partition "seeded" marker (review 2026-09-21, decision 1). Its presence -- not the
// ledger key's -- is what makes a partition seeded.
const ANON_SEEDED_KEY = 'devcards:u:anon:recallsmith:newCardPullSeeded:csharp';
const USER_SEEDED_KEY = 'devcards:u:user-a:recallsmith:newCardPullSeeded:csharp';

function learned(uid: string): CardProgress {
  return { stableUid: uid, stage: 1, lastReviewedAt: 1_000, nextReviewAt: 2_000 };
}
function unlearned(uid: string): CardProgress {
  return { stableUid: uid, stage: 0, lastReviewedAt: 0, nextReviewAt: 0 };
}

describe('newCardLedger', () => {
  beforeEach(() => {
    store.clear();
    throwOnGet = null;
    setActiveUserSubForStorage(null);
  });

  it('pins the ledger key to the anon partition', async () => {
    await payNewCardIfUnpaid('csharp', 'c1', 1000);
    expect([...store.keys()]).toEqual([ANON_LEDGER_KEY]);
    expect(JSON.parse(store.get(ANON_LEDGER_KEY)!)).toEqual({ c1: 1000 });
  });

  it('pays each uid at most once across any call sequence', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(fc.constantFrom('a', 'b', 'c', 'd')), async (uids) => {
        store.clear();
        setActiveUserSubForStorage(null);

        let paidCount = 0;
        for (const uid of uids) {
          const { paid } = await payNewCardIfUnpaid('csharp', uid, 1000);
          if (paid) paidCount += 1;
        }
        expect(paidCount).toBe(new Set(uids).size);

        // A second pass over the same uids pays nothing.
        for (const uid of uids) {
          const { paid } = await payNewCardIfUnpaid('csharp', uid, 2000);
          expect(paid).toBe(false);
        }
      }),
    );
  });

  it('seeds exactly the learned uids with 0 and never overwrites a present ledger', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.record({ uid: fc.string({ minLength: 1 }), isLearned: fc.boolean() })),
        async (rows) => {
          store.clear();
          setActiveUserSubForStorage(null);

          const seen = new Set<string>();
          const progress: CardProgress[] = [];
          const learnedUids = new Set<string>();
          for (const row of rows) {
            if (seen.has(row.uid)) continue;
            seen.add(row.uid);
            progress.push(row.isLearned ? learned(row.uid) : unlearned(row.uid));
            if (row.isLearned) learnedUids.add(row.uid);
          }

          const seeded = await seedNewCardLedgerIfAbsent('csharp', progress, 5_000);
          expect(new Set(Object.keys(seeded))).toEqual(learnedUids);
          for (const value of Object.values(seeded)) expect(value).toBe(0);
          expect(await readNewCardLedgerSeed('csharp')).toEqual({ seededAtMs: 5_000, backfilled: learnedUids.size });

          // A second seed with different progress never overwrites the first.
          const again = await seedNewCardLedgerIfAbsent('csharp', [learned('later')]);
          expect(new Set(Object.keys(again))).toEqual(learnedUids);
          expect(await readNewCardLedgerSeed('csharp')).toEqual({ seededAtMs: 5_000, backfilled: learnedUids.size });
        },
      ),
    );

    // A present-but-empty ledger WITH the marker is returned unchanged.
    store.clear();
    store.set(ANON_LEDGER_KEY, JSON.stringify({}));
    store.set(ANON_SEEDED_KEY, JSON.stringify({ seededAtMs: 1, backfilled: 0 }));
    expect(await seedNewCardLedgerIfAbsent('csharp', [learned('x')])).toEqual({});
  });

  it('is the marker, not the ledger key, that makes a partition seeded', async () => {
    // Ledger key present (as anon adoption leaves it), no marker: the first seed still
    // backfills, unioning into what is there without touching an existing stamp.
    store.set(ANON_LEDGER_KEY, JSON.stringify({ a: 1_000 }));
    expect(await readNewCardLedgerSeed('csharp')).toBeNull();

    const seeded = await seedNewCardLedgerIfAbsent('csharp', [learned('a'), learned('b'), unlearned('c')], 9_000);
    expect(seeded).toEqual({ a: 1_000, b: 0 });
    expect(JSON.parse(store.get(ANON_LEDGER_KEY)!)).toEqual({ a: 1_000, b: 0 });
    expect(JSON.parse(store.get(ANON_SEEDED_KEY)!)).toEqual({ seededAtMs: 9_000, backfilled: 1 });

    // Marker present: nothing is seeded again, whatever the progress says now.
    const again = await seedNewCardLedgerIfAbsent('csharp', [learned('a'), learned('b'), learned('c')], 10_000);
    expect(again).toEqual({ a: 1_000, b: 0 });
    expect(JSON.parse(store.get(ANON_SEEDED_KEY)!)).toEqual({ seededAtMs: 9_000, backfilled: 1 });

    // An unreadable marker still counts as seeded (a second seed is the one thing it must never cause).
    store.set(ANON_SEEDED_KEY, '{{{');
    expect(await readNewCardLedgerSeed('csharp')).toEqual({ seededAtMs: 0, backfilled: 0 });
    expect(await seedNewCardLedgerIfAbsent('csharp', [learned('z')])).toEqual({ a: 1_000, b: 0 });
  });

  it('never overwrites an existing paidAt when the seed unions the backfill in', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.dictionary(fc.string({ minLength: 1 }), fc.integer({ min: 0, max: 2_000_000 })),
        fc.array(fc.string({ minLength: 1 })),
        async (existing, learnedUids) => {
          store.clear();
          setActiveUserSubForStorage(null);
          store.set(ANON_LEDGER_KEY, JSON.stringify(existing));

          const seeded = await seedNewCardLedgerIfAbsent('csharp', learnedUids.map(learned));

          for (const [uid, paidAt] of Object.entries(existing)) expect(seeded[uid]).toBe(paidAt);
          for (const uid of learnedUids) expect(seeded[uid]).toBe(uid in existing ? existing[uid] : 0);
          expect(Object.keys(seeded).length).toBe(new Set([...Object.keys(existing), ...learnedUids]).size);
        },
      ),
    );
  });

  it('reads a corrupt ledger as present and empty', async () => {
    store.set(ANON_LEDGER_KEY, 'not json at all');
    expect(await readNewCardLedger('csharp')).toEqual({ ledger: {}, present: true });

    // Corrupt AND marked seeded: never re-seeded, the value is left alone.
    store.set(ANON_SEEDED_KEY, JSON.stringify({ seededAtMs: 1, backfilled: 0 }));
    const seeded = await seedNewCardLedgerIfAbsent('csharp', [learned('x')]);
    expect(seeded).toEqual({});
    expect(store.get(ANON_LEDGER_KEY)).toBe('not json at all');

    // Corrupt with no marker: the seed replaces it with the backfill (safe direction --
    // every learned card reads as already paid).
    store.delete(ANON_SEEDED_KEY);
    expect(await seedNewCardLedgerIfAbsent('csharp', [learned('x')])).toEqual({ x: 0 });
    expect(JSON.parse(store.get(ANON_LEDGER_KEY)!)).toEqual({ x: 0 });
  });

  it("counts only today's positive stamps", async () => {
    const now = new Date(2026, 0, 15, 12, 0, 0);
    const today = now.getTime();
    const yesterday = new Date(2026, 0, 14, 12, 0, 0).getTime();
    const tomorrow = new Date(2026, 0, 16, 12, 0, 0).getTime();
    const ledger = { a: 0, b: yesterday, c: today, d: tomorrow, e: new Date(2026, 0, 15, 23, 0, 0).getTime() };
    expect(countPaidOnDay(ledger, now)).toBe(2);
  });

  it('marks the due-clear day once per local day', async () => {
    const day1 = new Date(2026, 0, 15, 9, 0, 0);
    const day1Later = new Date(2026, 0, 15, 22, 0, 0);
    const day2 = new Date(2026, 0, 16, 9, 0, 0);

    expect(await markDueClearedIfFirstToday(day1)).toBe(true);
    expect(await markDueClearedIfFirstToday(day1Later)).toBe(false);
    expect(await markDueClearedIfFirstToday(day2)).toBe(true);

    // A storage error means "do not pay" rather than a throw into the settle path.
    throwOnGet = (key) => key === ANON_MARKER_KEY;
    expect(await markDueClearedIfFirstToday(day2)).toBe(false);
  });

  it('adopts the anon ledger into the user partition, unions and clears the anon key', async () => {
    store.set(ANON_LEDGER_KEY, JSON.stringify({ a: 1, b: 2 }));
    setActiveUserSubForStorage('user-a');
    store.set(USER_LEDGER_KEY, JSON.stringify({ b: 0, c: 3 }));

    const result = await adoptAnonNewCardLedger();

    expect(result).toEqual({ ledgerDecks: 1, uidsAdded: 1 });
    // User value wins on b; a is added; c untouched.
    expect(JSON.parse(store.get(USER_LEDGER_KEY)!)).toEqual({ b: 0, c: 3, a: 1 });
    expect(store.has(ANON_LEDGER_KEY)).toBe(false);
    // Adoption never marks the user partition seeded: that happens on its first settled rating.
    expect(store.has(USER_SEEDED_KEY)).toBe(false);
  });

  it('adoption then the first seed backfills every account-learned card (100 learned → 0 paid)', async () => {
    // Anonymous period: one card paid, partition seeded from an empty deck.
    await seedNewCardLedgerIfAbsent('csharp', [], 1_000);
    await payNewCardIfUnpaid('csharp', 'c0', 1_500);
    expect(store.has(ANON_SEEDED_KEY)).toBe(true);

    // Sign in: the anon ledger is unioned into the user partition, both anon keys go.
    setActiveUserSubForStorage('user-a');
    expect(await adoptAnonNewCardLedger()).toEqual({ ledgerDecks: 1, uidsAdded: 1 });
    expect(store.has(ANON_LEDGER_KEY)).toBe(false);
    expect(store.has(ANON_SEEDED_KEY)).toBe(false);
    expect((await readNewCardLedger('csharp')).present).toBe(true);
    expect(await readNewCardLedgerSeed('csharp')).toBeNull();

    // The pull lands: the account had already learned c1..c100. The user partition's first
    // seed unions them in as paid(0) and keeps c0's anon stamp.
    const synced: CardProgress[] = Array.from({ length: 100 }, (_, i) => learned(`c${i + 1}`));
    const seeded = await seedNewCardLedgerIfAbsent('csharp', [...synced, unlearned('c0')], 2_000);
    expect(seeded.c0).toBe(1_500);
    expect(Object.keys(seeded)).toHaveLength(101);
    expect(await readNewCardLedgerSeed('csharp')).toEqual({ seededAtMs: 2_000, backfilled: 100 });

    let paid = 0;
    for (let i = 1; i <= 100; i += 1) {
      if ((await payNewCardIfUnpaid('csharp', `c${i}`, 3_000 + i)).paid) paid += 1;
    }
    expect(paid).toBe(0);
    // c0 was paid on the anon partition; it does not pay again here either.
    expect((await payNewCardIfUnpaid('csharp', 'c0', 4_000)).paid).toBe(false);
    // A genuinely new card still pays exactly once.
    expect((await payNewCardIfUnpaid('csharp', 'c101', 4_000)).paid).toBe(true);
    expect((await payNewCardIfUnpaid('csharp', 'c101', 4_001)).paid).toBe(false);
  });

  it('clears a stranded anon seeded marker even when the anon ledger key is already gone', async () => {
    // A kill between the two anon removals leaves "marker, no ledger"; the next adoption
    // still sweeps it so a later signed-out period re-seeds from its own progress.
    store.set(ANON_SEEDED_KEY, JSON.stringify({ seededAtMs: 1, backfilled: 0 }));
    setActiveUserSubForStorage('user-a');
    expect(await adoptAnonNewCardLedger()).toEqual({ ledgerDecks: 1, uidsAdded: 0 });
    expect(store.has(ANON_SEEDED_KEY)).toBe(false);
    // No anon ledger existed, so nothing was written into the user partition.
    expect(store.has(USER_LEDGER_KEY)).toBe(false);
    expect(store.has(USER_SEEDED_KEY)).toBe(false);
  });

  it('is a no-op while signed out and on a second run', async () => {
    // Signed out: the current partition IS the anon partition, nothing to adopt.
    store.set(ANON_LEDGER_KEY, JSON.stringify({ a: 1 }));
    expect(await adoptAnonNewCardLedger()).toEqual({ ledgerDecks: 0, uidsAdded: 0 });
    expect(store.has(ANON_LEDGER_KEY)).toBe(true);

    // Signed in: the first run adopts, the second finds nothing.
    setActiveUserSubForStorage('user-a');
    expect(await adoptAnonNewCardLedger()).toEqual({ ledgerDecks: 1, uidsAdded: 1 });
    expect(await adoptAnonNewCardLedger()).toEqual({ ledgerDecks: 0, uidsAdded: 0 });
  });
});
