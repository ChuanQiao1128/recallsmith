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
  seedNewCardLedgerIfAbsent,
} from '../../src/features/gacha/rewards/newCardLedger';

const ANON_LEDGER_KEY = 'devcards:u:anon:recallsmith:newCardPullPaidUids:csharp';
const USER_LEDGER_KEY = 'devcards:u:user-a:recallsmith:newCardPullPaidUids:csharp';
const ANON_MARKER_KEY = 'devcards:u:anon:recallsmith:due-clear:v1';

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

          const seeded = await seedNewCardLedgerIfAbsent('csharp', progress);
          expect(new Set(Object.keys(seeded))).toEqual(learnedUids);
          for (const value of Object.values(seeded)) expect(value).toBe(0);

          // A second seed with different progress never overwrites the first.
          const again = await seedNewCardLedgerIfAbsent('csharp', [learned('later')]);
          expect(new Set(Object.keys(again))).toEqual(learnedUids);
        },
      ),
    );

    // A present-but-empty ledger is returned unchanged (still marks the partition seeded).
    store.clear();
    store.set(ANON_LEDGER_KEY, JSON.stringify({}));
    expect(await seedNewCardLedgerIfAbsent('csharp', [learned('x')])).toEqual({});
  });

  it('reads a corrupt ledger as present and empty', async () => {
    store.set(ANON_LEDGER_KEY, 'not json at all');
    expect(await readNewCardLedger('csharp')).toEqual({ ledger: {}, present: true });

    // A corrupt value is present, so it is never re-seeded.
    const seeded = await seedNewCardLedgerIfAbsent('csharp', [learned('x')]);
    expect(seeded).toEqual({});
    expect(store.get(ANON_LEDGER_KEY)).toBe('not json at all');
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
