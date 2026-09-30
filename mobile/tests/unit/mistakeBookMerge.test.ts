import { beforeEach, describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';

const store = new Map<string, string>();
// Crash hook: while above zero, removeItem throws and counts down, so a test can kill the adoption
// between its two storage writes.
let throwOnRemove = 0;

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => store.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    removeItem: vi.fn(async (key: string) => {
      if (throwOnRemove > 0) {
        throwOnRemove -= 1;
        throw new Error(`storage remove killed: ${key}`);
      }
      store.delete(key);
    }),
    getAllKeys: vi.fn(async () => [...store.keys()]),
  },
}));

// The real scope helper is under test (anon and account partitions), so review/storage is NOT mocked.
import { setActiveUserSubForStorage } from '../../src/review/storage';
import {
  adoptAnonMistakeBook,
  applyOutcome,
  loadMistakeBook,
  mergeMistakeBooks,
  MISTAKE_BOOK_MAX_ENTRIES,
  type MistakeBookState,
  type MistakeEntry,
  type MistakeOutcome,
} from '../../src/features/gacha/mistakes/mistakeBook';

const ANON_KEY = 'devcards:u:anon:devcards:mistakes:v1';
const USER_KEY = 'devcards:u:user-a:devcards:mistakes:v1';
const DAY_MS = 86_400_000;
const T0 = Date.UTC(2026, 8, 27, 9, 0, 0);
const KEY = 'csharp::c1';

const EMPTY: MistakeBookState = { v: 1, entries: {} };

function entry(overrides: Partial<MistakeEntry> = {}): MistakeEntry {
  return {
    deckSlug: 'csharp',
    stableUid: 'c1',
    topic: 'linq',
    wrongCount: 1,
    firstWrongAt: T0,
    lastWrongAt: T0,
    lastOutcome: 'again',
    correctStreak: 0,
    resolvedAt: null,
    ...overrides,
  };
}

function bookWith(...entries: MistakeEntry[]): MistakeBookState {
  return { v: 1, entries: Object.fromEntries(entries.map((e) => [`${e.deckSlug}::${e.stableUid}`, e])) };
}

function outcome(overrides: Partial<MistakeOutcome> = {}): MistakeOutcome {
  return { deckSlug: 'csharp', stableUid: 'c1', topic: 'linq', rating: 'again', mcqVerdict: null, at: T0, ...overrides };
}

function readJson(key: string): MistakeBookState | null {
  const raw = store.get(key);
  return raw ? (JSON.parse(raw) as MistakeBookState) : null;
}

beforeEach(() => {
  store.clear();
  throwOnRemove = 0;
  vi.clearAllMocks();
  setActiveUserSubForStorage(null);
});

describe('mergeMistakeBooks per-key rule (M00 §3.10)', () => {
  // Distinct values on each side, so every assertion names where a field came from.
  const U = { topic: 'user-topic', lastOutcome: 'mcq-wrong' as const, wrongCount: 3, firstWrongAt: T0 - 5 * DAY_MS };
  const A = { topic: 'anon-topic', lastOutcome: 'mcq-partial' as const, wrongCount: 2, firstWrongAt: T0 - 7 * DAY_MS };
  const R = 10_000; // resolvedAt offset used by the resolved rows

  type Row = { name: string; user?: MistakeEntry; anon?: MistakeEntry; expected: MistakeEntry };
  const rows: Row[] = [
    {
      name: 'key in the user book only',
      user: entry({ ...U, lastWrongAt: T0, correctStreak: 1, lastCorrectAt: T0 + 5 }),
      expected: entry({ ...U, lastWrongAt: T0, correctStreak: 1, lastCorrectAt: T0 + 5 }),
    },
    {
      name: 'key in the anon book only',
      anon: entry({ ...A, lastWrongAt: T0, resolvedAt: T0 + 9, correctStreak: 2, lastCorrectAt: T0 + 9 }),
      expected: entry({ ...A, lastWrongAt: T0, resolvedAt: T0 + 9, correctStreak: 2, lastCorrectAt: T0 + 9 }),
    },
    {
      name: 'both unresolved, user newer',
      user: entry({ ...U, lastWrongAt: T0 + 5, correctStreak: 1, lastCorrectAt: T0 + 6 }),
      anon: entry({ ...A, lastWrongAt: T0 + 2 }),
      expected: {
        deckSlug: 'csharp', stableUid: 'c1', topic: 'user-topic', wrongCount: 5, firstWrongAt: T0 - 7 * DAY_MS,
        lastWrongAt: T0 + 5, lastOutcome: 'mcq-wrong', correctStreak: 1, resolvedAt: null, lastCorrectAt: T0 + 6,
      },
    },
    {
      name: 'both unresolved, anon newer',
      user: entry({ ...U, lastWrongAt: T0 + 1, correctStreak: 1, lastCorrectAt: T0 + 2 }),
      anon: entry({ ...A, lastWrongAt: T0 + 9, correctStreak: 1, lastCorrectAt: T0 + 10 }),
      expected: {
        deckSlug: 'csharp', stableUid: 'c1', topic: 'anon-topic', wrongCount: 5, firstWrongAt: T0 - 7 * DAY_MS,
        lastWrongAt: T0 + 9, lastOutcome: 'mcq-partial', correctStreak: 1, resolvedAt: null, lastCorrectAt: T0 + 10,
      },
    },
    {
      name: 'both unresolved, tie: the user wins',
      user: entry({ ...U, lastWrongAt: T0 }),
      anon: entry({ ...A, lastWrongAt: T0, correctStreak: 1, lastCorrectAt: T0 + 1 }),
      expected: {
        deckSlug: 'csharp', stableUid: 'c1', topic: 'user-topic', wrongCount: 5, firstWrongAt: T0 - 7 * DAY_MS,
        lastWrongAt: T0, lastOutcome: 'mcq-wrong', correctStreak: 0, resolvedAt: null,
      },
    },
    {
      name: 'both resolved, user resolved later',
      user: entry({ ...U, lastWrongAt: T0 + 1, correctStreak: 2, resolvedAt: T0 + R + 5, lastCorrectAt: T0 + R + 5 }),
      anon: entry({ ...A, lastWrongAt: T0 + 3, correctStreak: 3, resolvedAt: T0 + R, lastCorrectAt: T0 + R }),
      expected: {
        deckSlug: 'csharp', stableUid: 'c1', topic: 'anon-topic', wrongCount: 5, firstWrongAt: T0 - 7 * DAY_MS,
        lastWrongAt: T0 + 3, lastOutcome: 'mcq-partial', correctStreak: 2, resolvedAt: T0 + R + 5, lastCorrectAt: T0 + R + 5,
      },
    },
    {
      name: 'both resolved, anon resolved later',
      user: entry({ ...U, lastWrongAt: T0 + 3, correctStreak: 2, resolvedAt: T0 + R, lastCorrectAt: T0 + R }),
      anon: entry({ ...A, lastWrongAt: T0 + 1, correctStreak: 3, resolvedAt: T0 + R + 5, lastCorrectAt: T0 + R + 5 }),
      expected: {
        deckSlug: 'csharp', stableUid: 'c1', topic: 'user-topic', wrongCount: 5, firstWrongAt: T0 - 7 * DAY_MS,
        lastWrongAt: T0 + 3, lastOutcome: 'mcq-wrong', correctStreak: 3, resolvedAt: T0 + R + 5, lastCorrectAt: T0 + R + 5,
      },
    },
    {
      name: 'both resolved at the same time: the user wins',
      user: entry({ ...U, lastWrongAt: T0, correctStreak: 2, resolvedAt: T0 + R, lastCorrectAt: T0 + R }),
      anon: entry({ ...A, lastWrongAt: T0 + 2, correctStreak: 4, resolvedAt: T0 + R }),
      expected: {
        deckSlug: 'csharp', stableUid: 'c1', topic: 'anon-topic', wrongCount: 5, firstWrongAt: T0 - 7 * DAY_MS,
        lastWrongAt: T0 + 2, lastOutcome: 'mcq-partial', correctStreak: 2, resolvedAt: T0 + R, lastCorrectAt: T0 + R,
      },
    },
    {
      name: 'user resolved, anon mistake before the resolution: resolved',
      user: entry({ ...U, lastWrongAt: T0, correctStreak: 2, resolvedAt: T0 + R, lastCorrectAt: T0 + R }),
      anon: entry({ ...A, lastWrongAt: T0 + R - 1 }),
      expected: {
        deckSlug: 'csharp', stableUid: 'c1', topic: 'anon-topic', wrongCount: 5, firstWrongAt: T0 - 7 * DAY_MS,
        lastWrongAt: T0 + R - 1, lastOutcome: 'mcq-partial', correctStreak: 2, resolvedAt: T0 + R, lastCorrectAt: T0 + R,
      },
    },
    {
      name: 'user resolved, anon mistake at the resolution: open',
      user: entry({ ...U, lastWrongAt: T0, correctStreak: 2, resolvedAt: T0 + R, lastCorrectAt: T0 + R }),
      anon: entry({ ...A, lastWrongAt: T0 + R }),
      expected: {
        deckSlug: 'csharp', stableUid: 'c1', topic: 'anon-topic', wrongCount: 5, firstWrongAt: T0 - 7 * DAY_MS,
        lastWrongAt: T0 + R, lastOutcome: 'mcq-partial', correctStreak: 0, resolvedAt: null,
      },
    },
    {
      name: 'user resolved, anon mistake after the resolution: open',
      user: entry({ ...U, lastWrongAt: T0, correctStreak: 2, resolvedAt: T0 + R, lastCorrectAt: T0 + R }),
      anon: entry({ ...A, lastWrongAt: T0 + R + 1, correctStreak: 1, lastCorrectAt: T0 + R + 2 }),
      expected: {
        deckSlug: 'csharp', stableUid: 'c1', topic: 'anon-topic', wrongCount: 5, firstWrongAt: T0 - 7 * DAY_MS,
        lastWrongAt: T0 + R + 1, lastOutcome: 'mcq-partial', correctStreak: 1, resolvedAt: null, lastCorrectAt: T0 + R + 2,
      },
    },
    {
      name: 'anon resolved, user mistake before the resolution: resolved',
      user: entry({ ...U, lastWrongAt: T0 + R - 1 }),
      anon: entry({ ...A, lastWrongAt: T0, correctStreak: 2, resolvedAt: T0 + R, lastCorrectAt: T0 + R }),
      expected: {
        deckSlug: 'csharp', stableUid: 'c1', topic: 'user-topic', wrongCount: 5, firstWrongAt: T0 - 7 * DAY_MS,
        lastWrongAt: T0 + R - 1, lastOutcome: 'mcq-wrong', correctStreak: 2, resolvedAt: T0 + R, lastCorrectAt: T0 + R,
      },
    },
    {
      name: 'anon resolved, user mistake at the resolution: open',
      user: entry({ ...U, lastWrongAt: T0 + R }),
      anon: entry({ ...A, lastWrongAt: T0, correctStreak: 2, resolvedAt: T0 + R, lastCorrectAt: T0 + R }),
      expected: {
        deckSlug: 'csharp', stableUid: 'c1', topic: 'user-topic', wrongCount: 5, firstWrongAt: T0 - 7 * DAY_MS,
        lastWrongAt: T0 + R, lastOutcome: 'mcq-wrong', correctStreak: 0, resolvedAt: null,
      },
    },
    {
      name: 'anon resolved, user mistake after the resolution: open',
      user: entry({ ...U, lastWrongAt: T0 + R + 1, correctStreak: 1, lastCorrectAt: T0 + R + 2 }),
      anon: entry({ ...A, lastWrongAt: T0, correctStreak: 2, resolvedAt: T0 + R, lastCorrectAt: T0 + R }),
      expected: {
        deckSlug: 'csharp', stableUid: 'c1', topic: 'user-topic', wrongCount: 5, firstWrongAt: T0 - 7 * DAY_MS,
        lastWrongAt: T0 + R + 1, lastOutcome: 'mcq-wrong', correctStreak: 1, resolvedAt: null, lastCorrectAt: T0 + R + 2,
      },
    },
    {
      name: 'resolution source without lastCorrectAt: the key is absent',
      user: entry({ ...U, lastWrongAt: T0 + 1, correctStreak: 1, lastCorrectAt: T0 + 2 }),
      anon: entry({ ...A, lastWrongAt: T0 + 4 }),
      expected: {
        deckSlug: 'csharp', stableUid: 'c1', topic: 'anon-topic', wrongCount: 5, firstWrongAt: T0 - 7 * DAY_MS,
        lastWrongAt: T0 + 4, lastOutcome: 'mcq-partial', correctStreak: 0, resolvedAt: null,
      },
    },
  ];

  it.each(rows)('$name', ({ user: u, anon: a, expected }) => {
    const user = u ? bookWith(u) : EMPTY;
    const anon = a ? bookWith(a) : EMPTY;
    const userSnapshot = structuredClone(user);
    const anonSnapshot = structuredClone(anon);

    const merged = mergeMistakeBooks(user, anon);

    expect(Object.keys(merged.entries)).toEqual([KEY]);
    // toStrictEqual also fails on a key present with the value undefined.
    expect(merged.entries[KEY]).toStrictEqual(expected);
    expect(Object.prototype.hasOwnProperty.call(merged.entries[KEY], 'lastCorrectAt')).toBe('lastCorrectAt' in expected);
    expect(merged.entries[KEY].resolvedAt === null || merged.entries[KEY].resolvedAt! >= merged.entries[KEY].lastWrongAt).toBe(true);
    expect(user).toEqual(userSnapshot);
    expect(anon).toEqual(anonSnapshot);
  });
});

// ---- fast-check: valid entries, shaped like the reducer produces them ----

const lastOutcomeArb = fc.constantFrom<MistakeEntry['lastOutcome']>('again', 'mcq-wrong', 'mcq-partial');

// Times live on a small grid so both books often share lastWrongAt/resolvedAt values (ties).
const entryFieldsArb = fc
  .record({
    topic: fc.option(fc.constantFrom('linq', 'async', 'di'), { nil: null }),
    wrongCount: fc.integer({ min: 1, max: 50 }),
    firstWrongAt: fc.integer({ min: 0, max: 40 }),
    span: fc.integer({ min: 0, max: 20 }),
    lastOutcome: lastOutcomeArb,
    resolution: fc.oneof(
      fc.record({ kind: fc.constant('open' as const), streak: fc.integer({ min: 0, max: 1 }), after: fc.integer({ min: 0, max: 10 }) }),
      fc.record({ kind: fc.constant('resolved' as const), streak: fc.integer({ min: 2, max: 4 }), after: fc.integer({ min: 0, max: 10 }) }),
    ),
  })
  .map(({ topic, wrongCount, firstWrongAt, span, lastOutcome, resolution }) => {
    const lastWrongAt = T0 + (firstWrongAt + span) * 1000;
    const base = { topic, wrongCount, firstWrongAt: T0 + firstWrongAt * 1000, lastWrongAt, lastOutcome };
    if (resolution.kind === 'resolved') {
      const resolvedAt = lastWrongAt + resolution.after * 1000;
      return { ...base, correctStreak: resolution.streak, resolvedAt, lastCorrectAt: resolvedAt };
    }
    // An open entry has a lastCorrectAt only once a correct answer counted after the last mistake.
    return resolution.streak === 0
      ? { ...base, correctStreak: 0, resolvedAt: null }
      : { ...base, correctStreak: 1, resolvedAt: null, lastCorrectAt: lastWrongAt + (resolution.after + 1) * 1000 };
  });

function bookArb(maxUid: number, maxLength: number): fc.Arbitrary<MistakeBookState> {
  return fc
    .uniqueArray(fc.tuple(fc.integer({ min: 0, max: maxUid }), entryFieldsArb), { selector: (t) => t[0], maxLength })
    .map((items) =>
      bookWith(...items.map(([uid, fields]) => ({ deckSlug: 'csharp', stableUid: `c${uid}`, ...fields }) as MistakeEntry)),
    );
}

describe('mergeMistakeBooks properties (fast-check)', () => {
  it('never mutates its inputs, keeps resolvedAt >= lastWrongAt, and sums wrongCount of shared keys', () => {
    fc.assert(
      fc.property(bookArb(30, 25), bookArb(30, 25), (user, anon) => {
        const userSnapshot = structuredClone(user);
        const anonSnapshot = structuredClone(anon);
        const merged = mergeMistakeBooks(user, anon);
        expect(user).toStrictEqual(userSnapshot);
        expect(anon).toStrictEqual(anonSnapshot);
        expect(merged.adoptedAnon).toBeUndefined();
        for (const [key, e] of Object.entries(merged.entries)) {
          expect(e.resolvedAt === null || e.resolvedAt >= e.lastWrongAt).toBe(true);
          const u = user.entries[key];
          const a = anon.entries[key];
          if (u && a) {
            expect(e.wrongCount).toBe(u.wrongCount + a.wrongCount);
            expect(e.firstWrongAt).toBe(Math.min(u.firstWrongAt, a.firstWrongAt));
            expect(e.lastWrongAt).toBe(Math.max(u.lastWrongAt, a.lastWrongAt));
          } else {
            expect(e).toStrictEqual(u ?? a);
          }
        }
        expect(Object.keys(merged.entries).sort()).toEqual(
          [...new Set([...Object.keys(user.entries), ...Object.keys(anon.entries)])].sort(),
        );
      }),
      { numRuns: 300 },
    );
  });

  it('treats an empty book as the identity on either side', () => {
    fc.assert(
      fc.property(bookArb(60, 40), (book) => {
        expect(mergeMistakeBooks(book, EMPTY)).toStrictEqual(book);
        expect(mergeMistakeBooks(EMPTY, book)).toStrictEqual(book);
      }),
      { numRuns: 200 },
    );
  });

  it('applies the LRU cap last: never above MISTAKE_BOOK_MAX_ENTRIES, keeping the newest merged lastWrongAt', () => {
    fc.assert(
      fc.property(bookArb(799, 450), bookArb(799, 450), (user, anon) => {
        const merged = mergeMistakeBooks(user, anon);
        // The uncapped per-key result: each key's lastWrongAt is the later of its two sides.
        const uncapped = new Map<string, number>();
        for (const book of [user, anon]) {
          for (const [key, e] of Object.entries(book.entries)) {
            uncapped.set(key, Math.max(uncapped.get(key) ?? -Infinity, e.lastWrongAt));
          }
        }
        const kept = Object.keys(merged.entries);
        expect(kept.length).toBe(Math.min(uncapped.size, MISTAKE_BOOK_MAX_ENTRIES));
        expect(kept.length).toBeLessThanOrEqual(MISTAKE_BOOK_MAX_ENTRIES);
        const keptSet = new Set(kept);
        let oldestKept = Infinity;
        for (const key of kept) {
          expect(merged.entries[key].lastWrongAt).toBe(uncapped.get(key));
          oldestKept = Math.min(oldestKept, merged.entries[key].lastWrongAt);
        }
        for (const [key, lastWrongAt] of uncapped) {
          if (!keptSet.has(key)) expect(lastWrongAt).toBeLessThanOrEqual(oldestKept);
        }
      }),
      { numRuns: 200 },
    );
  });
});

describe('adoptedAnon fingerprint', () => {
  const seedAnonScope = (value: unknown) =>
    store.set(ANON_KEY, JSON.stringify({ v: 1, entries: { [KEY]: entry() }, adoptedAnon: value }));

  it('survives a parse round trip only as 8 lowercase hex characters', async () => {
    seedAnonScope('0a1b2c3d');
    expect(await loadMistakeBook()).toStrictEqual({ v: 1, entries: { [KEY]: entry() }, adoptedAnon: '0a1b2c3d' });

    for (const bad of ['XYZ', '0123456789', 12345678, 'DEADBEEF', null]) {
      seedAnonScope(bad);
      const book = await loadMistakeBook();
      expect(book.entries[KEY]).toStrictEqual(entry());
      expect(Object.prototype.hasOwnProperty.call(book, 'adoptedAnon')).toBe(false);
    }
  });

  it('is kept by applyOutcome and by mergeMistakeBooks (from the user book only)', () => {
    const user: MistakeBookState = { ...bookWith(entry()), adoptedAnon: 'deadbeef' };

    const newMistake = applyOutcome(user, outcome({ stableUid: 'c2', at: T0 + 1 }));
    expect(newMistake.adoptedAnon).toBe('deadbeef');
    const repeatMistake = applyOutcome(user, outcome({ at: T0 + 2 }));
    expect(repeatMistake.adoptedAnon).toBe('deadbeef');
    expect(repeatMistake.entries[KEY].wrongCount).toBe(2);
    const correct = applyOutcome(user, outcome({ rating: 'good', at: T0 + DAY_MS }));
    expect(correct.adoptedAnon).toBe('deadbeef');
    expect(correct.entries[KEY].correctStreak).toBe(1);
    // Nothing changes: still the same object.
    expect(applyOutcome(user, outcome({ stableUid: 'unknown', rating: 'good' }))).toBe(user);

    expect(mergeMistakeBooks(user, bookWith(entry({ stableUid: 'c3' }))).adoptedAnon).toBe('deadbeef');
    const anonWithValue: MistakeBookState = { ...bookWith(entry({ stableUid: 'c3' })), adoptedAnon: '01234567' };
    expect(Object.prototype.hasOwnProperty.call(mergeMistakeBooks(bookWith(entry()), anonWithValue), 'adoptedAnon')).toBe(false);
  });
});

describe('adoptAnonMistakeBook replay safety (M00 §3.10)', () => {
  const userBook = bookWith(
    entry({ stableUid: 'shared-1', wrongCount: 3, lastWrongAt: T0 + 5 }),
    entry({ stableUid: 'shared-2', wrongCount: 1, lastWrongAt: T0 + 1, correctStreak: 1, lastCorrectAt: T0 + 2 }),
    entry({ stableUid: 'mine' }),
  );
  const anonBook = bookWith(
    entry({ stableUid: 'shared-1', wrongCount: 2, lastWrongAt: T0 + 3 }),
    entry({ stableUid: 'shared-2', wrongCount: 4, lastWrongAt: T0 + 9 }),
    entry({ stableUid: 'anon-only', wrongCount: 2 }),
  );

  it('a kill between the user write and the anon removal does not double the counts on replay', async () => {
    const single = mergeMistakeBooks(userBook, anonBook);
    setActiveUserSubForStorage('user-a');
    try {
      store.set(USER_KEY, JSON.stringify(userBook));
      store.set(ANON_KEY, JSON.stringify(anonBook));

      // First run: the user book is written, then removeItem is killed.
      throwOnRemove = 1;
      await adoptAnonMistakeBook();
      expect(store.has(ANON_KEY)).toBe(true);
      const afterKill = readJson(USER_KEY);
      expect(afterKill?.adoptedAnon).toMatch(/^[0-9a-f]{8}$/);
      expect(afterKill?.entries).toStrictEqual(single.entries);

      // Replay: the fingerprint matches, so no second merge; the anon key goes.
      expect(await adoptAnonMistakeBook()).toEqual({ mistakesAdopted: 0 });
      expect(store.has(ANON_KEY)).toBe(false);
      const afterReplay = readJson(USER_KEY);
      for (const [key, e] of Object.entries(single.entries)) {
        expect(afterReplay?.entries[key].wrongCount).toBe(e.wrongCount);
      }
      expect(afterReplay?.entries['csharp::shared-1'].wrongCount).toBe(5);
      expect(afterReplay?.entries['csharp::shared-2'].wrongCount).toBe(5);
      expect(afterReplay).toStrictEqual(afterKill);

      // Third run: nothing left to adopt, nothing changes.
      const before = new Map(store);
      expect(await adoptAnonMistakeBook()).toEqual({ mistakesAdopted: 0 });
      expect(new Map(store)).toEqual(before);
    } finally {
      setActiveUserSubForStorage(null);
    }
  });

  it('merges a different anon book adopted later', async () => {
    setActiveUserSubForStorage('user-a');
    try {
      store.set(USER_KEY, JSON.stringify(userBook));
      store.set(ANON_KEY, JSON.stringify(anonBook));
      expect(await adoptAnonMistakeBook()).toEqual({ mistakesAdopted: 3 });
      const first = readJson(USER_KEY)!;
      expect(store.has(ANON_KEY)).toBe(false);

      // Signed out again, one more mistake on a shared card: new raw JSON, new fingerprint.
      const laterAnon = bookWith(entry({ stableUid: 'shared-1', wrongCount: 1, lastWrongAt: T0 + DAY_MS }));
      store.set(ANON_KEY, JSON.stringify(laterAnon));
      expect(await adoptAnonMistakeBook()).toEqual({ mistakesAdopted: 1 });

      const second = readJson(USER_KEY)!;
      expect(second.entries['csharp::shared-1'].wrongCount).toBe(6);
      expect(second.entries['csharp::shared-1'].lastWrongAt).toBe(T0 + DAY_MS);
      expect(second.adoptedAnon).toMatch(/^[0-9a-f]{8}$/);
      expect(second.adoptedAnon).not.toBe(first.adoptedAnon);
      expect(store.has(ANON_KEY)).toBe(false);
    } finally {
      setActiveUserSubForStorage(null);
    }
  });
});
