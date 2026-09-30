import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();
// Crash hooks: when set, the matching storage call throws so a test can prove the book never
// surfaces a storage failure.
let throwOnGet = false;
let throwOnSet = false;

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => {
      if (throwOnGet) throw new Error(`storage read killed: ${key}`);
      return store.get(key) ?? null;
    }),
    setItem: vi.fn(async (key: string, value: string) => {
      if (throwOnSet) throw new Error(`storage write killed: ${key}`);
      store.set(key, value);
    }),
    removeItem: vi.fn(async (key: string) => {
      store.delete(key);
    }),
    getAllKeys: vi.fn(async () => [...store.keys()]),
  },
}));

// The real scope helper is under test (the key is pinned to the anon partition), so
// review/storage is NOT mocked.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { setActiveUserSubForStorage } from '../../src/review/storage';
import {
  activeMistakes,
  adoptAnonMistakeBook,
  applyOutcome,
  isMistake,
  loadMistakeBook,
  localDaysBetween,
  mergeMistakeBooks,
  MISTAKE_BOOK_KEY,
  MISTAKE_BOOK_MAX_ENTRIES,
  MISTAKE_WINDOW_DAYS,
  recordMistakeOutcome,
  resolveActiveMistakeRows,
  type MistakeBookState,
  type MistakeEntry,
  type MistakeOutcome,
} from '../../src/features/gacha/mistakes/mistakeBook';

const ANON_KEY = 'devcards:u:anon:devcards:mistakes:v1';
const DAY_MS = 86_400_000;
const T0 = Date.UTC(2026, 8, 27, 9, 0, 0);

const EMPTY: MistakeBookState = { v: 1, entries: {} };

function outcome(overrides: Partial<MistakeOutcome> = {}): MistakeOutcome {
  return { deckSlug: 'csharp', stableUid: 'c1', topic: 'linq', rating: 'again', mcqVerdict: null, at: T0, ...overrides };
}

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

function stored(): MistakeBookState | null {
  const raw = store.get(ANON_KEY);
  return raw ? (JSON.parse(raw) as MistakeBookState) : null;
}

describe('mistakeBook', () => {
  beforeEach(() => {
    store.clear();
    throwOnGet = false;
    throwOnSet = false;
    vi.clearAllMocks();
    setActiveUserSubForStorage(null);
  });

  it('records an again rating as a new mistake', async () => {
    expect(isMistake(outcome())).toBe(true);
    const next = applyOutcome(EMPTY, outcome());
    expect(next).not.toBe(EMPTY);
    expect(EMPTY.entries).toEqual({});
    expect(next.entries['csharp::c1']).toEqual(entry());

    await recordMistakeOutcome(outcome());
    expect(stored()).toEqual({ v: 1, entries: { 'csharp::c1': entry() } });
    expect(await loadMistakeBook()).toEqual({ v: 1, entries: { 'csharp::c1': entry() } });
  });

  it('records MCQ wrong and partial verdicts as mistakes', () => {
    const wrong = outcome({ rating: 'again', mcqVerdict: 'wrong' });
    // A partial verdict can map to a hard rating: still a mistake.
    const partial = outcome({ stableUid: 'c2', rating: 'hard', mcqVerdict: 'partial', at: T0 + 1 });
    expect(isMistake(wrong)).toBe(true);
    expect(isMistake(partial)).toBe(true);
    expect(isMistake(outcome({ rating: 'good', mcqVerdict: 'correct' }))).toBe(false);
    expect(isMistake(outcome({ rating: 'hard' }))).toBe(false);

    const s = applyOutcome(applyOutcome(EMPTY, wrong), partial);
    expect(s.entries['csharp::c1']).toMatchObject({ lastOutcome: 'mcq-wrong', wrongCount: 1 });
    expect(s.entries['csharp::c2']).toMatchObject({ lastOutcome: 'mcq-partial', wrongCount: 1, lastWrongAt: T0 + 1 });
  });

  it('resolves an entry after two good or easy ratings in a row', () => {
    const s0 = bookWith(entry());
    const s1 = applyOutcome(s0, outcome({ rating: 'good', at: T0 + DAY_MS }));
    expect(s1.entries['csharp::c1']).toMatchObject({ correctStreak: 1, resolvedAt: null });
    expect(s0.entries['csharp::c1'].correctStreak).toBe(0);

    const s2 = applyOutcome(s1, outcome({ rating: 'easy', at: T0 + 2 * DAY_MS }));
    expect(s2.entries['csharp::c1']).toMatchObject({ correctStreak: 2, resolvedAt: T0 + 2 * DAY_MS, wrongCount: 1 });

    // Further correct answers on a resolved entry change nothing.
    expect(applyOutcome(s2, outcome({ rating: 'good', at: T0 + 3 * DAY_MS }))).toBe(s2);
  });

  it('two corrects in the same session do not resolve', () => {
    const s0 = bookWith(entry());
    const s1 = applyOutcome(s0, outcome({ rating: 'good', at: T0 + 60_000 }));
    expect(s1.entries['csharp::c1']).toMatchObject({ correctStreak: 1, resolvedAt: null, lastCorrectAt: T0 + 60_000 });

    // A second focus run a minute later: same local day, so it does not count and nothing changes.
    expect(applyOutcome(s1, outcome({ rating: 'good', at: T0 + 120_000 }))).toBe(s1);
    expect(applyOutcome(s1, outcome({ rating: 'easy', at: T0 + 180_000 }))).toBe(s1);

    // The next local day it counts and resolves.
    const s2 = applyOutcome(s1, outcome({ rating: 'good', at: T0 + DAY_MS }));
    expect(s2.entries['csharp::c1']).toMatchObject({ correctStreak: 2, resolvedAt: T0 + DAY_MS, lastCorrectAt: T0 + DAY_MS });
  });

  it('spaces correct answers by local calendar day, not by elapsed hours', () => {
    // Local wall-clock times, so the check holds in any time zone the suite runs in.
    const lateEvening = new Date(2026, 8, 27, 23, 0).getTime();
    const nextMorning = new Date(2026, 8, 28, 1, 0).getTime();
    const earlyMorning = new Date(2026, 8, 27, 0, 30).getTime();
    const wrongAt = new Date(2026, 8, 26, 12, 0).getTime();
    const base = bookWith(entry({ firstWrongAt: wrongAt, lastWrongAt: wrongAt }));

    // Two hours apart across midnight: different days, so the entry resolves.
    const crossed = applyOutcome(applyOutcome(base, outcome({ rating: 'good', at: lateEvening })), outcome({ rating: 'good', at: nextMorning }));
    expect(crossed.entries['csharp::c1']).toMatchObject({ correctStreak: 2, resolvedAt: nextMorning });

    // 22.5 hours apart on the same day: the second does not count.
    const first = applyOutcome(base, outcome({ rating: 'good', at: earlyMorning }));
    expect(applyOutcome(first, outcome({ rating: 'good', at: lateEvening }))).toBe(first);
  });

  it('a new mistake clears the last correct answer', () => {
    const s1 = applyOutcome(bookWith(entry()), outcome({ rating: 'good', at: T0 + 60_000 }));
    const s2 = applyOutcome(s1, outcome({ rating: 'again', at: T0 + 120_000 }));
    expect(s2.entries['csharp::c1'].lastCorrectAt).toBeUndefined();
    expect(s2.entries['csharp::c1']).toMatchObject({ correctStreak: 0, wrongCount: 2 });
    // So a correct answer right after the new mistake counts again, even on the same day.
    const s3 = applyOutcome(s2, outcome({ rating: 'good', at: T0 + 180_000 }));
    expect(s3.entries['csharp::c1']).toMatchObject({ correctStreak: 1, lastCorrectAt: T0 + 180_000, resolvedAt: null });
  });

  it('keeps the correct streak unchanged on a hard rating', () => {
    const s1 = bookWith(entry({ correctStreak: 1 }));
    const s2 = applyOutcome(s1, outcome({ rating: 'hard', at: T0 + DAY_MS }));
    expect(s2).toBe(s1);
    const s3 = applyOutcome(s2, outcome({ rating: 'good', at: T0 + 2 * DAY_MS }));
    expect(s3.entries['csharp::c1']).toMatchObject({ correctStreak: 2, resolvedAt: T0 + 2 * DAY_MS });
  });

  it('a new mistake resets the streak and reopens a resolved entry', () => {
    const streaking = bookWith(entry({ correctStreak: 1 }));
    const reset = applyOutcome(streaking, outcome({ at: T0 + DAY_MS, topic: 'async' }));
    expect(reset.entries['csharp::c1']).toMatchObject({
      correctStreak: 0,
      wrongCount: 2,
      firstWrongAt: T0,
      lastWrongAt: T0 + DAY_MS,
      topic: 'async',
    });

    const resolved = bookWith(entry({ correctStreak: 2, resolvedAt: T0 + DAY_MS }));
    const reopened = applyOutcome(resolved, outcome({ mcqVerdict: 'wrong', at: T0 + 5 * DAY_MS }));
    expect(reopened.entries['csharp::c1']).toMatchObject({
      resolvedAt: null,
      correctStreak: 0,
      wrongCount: 2,
      lastOutcome: 'mcq-wrong',
      lastWrongAt: T0 + 5 * DAY_MS,
    });
    expect(resolved.entries['csharp::c1'].resolvedAt).toBe(T0 + DAY_MS);
  });

  it('ignores a non-mistake for a card without an entry', async () => {
    const s = bookWith(entry());
    for (const rating of ['hard', 'good', 'easy'] as const) {
      expect(applyOutcome(s, outcome({ stableUid: 'other', rating }))).toBe(s);
      expect(applyOutcome(EMPTY, outcome({ rating }))).toBe(EMPTY);
    }
    expect(applyOutcome(EMPTY, outcome({ rating: 'good', mcqVerdict: 'correct' }))).toBe(EMPTY);

    await recordMistakeOutcome(outcome({ rating: 'good' }));
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
    expect(store.has(ANON_KEY)).toBe(false);
  });

  it('caps the book at 500 entries by dropping the oldest lastWrongAt', () => {
    expect(MISTAKE_BOOK_MAX_ENTRIES).toBe(500);
    let s: MistakeBookState = EMPTY;
    // Two entries share the oldest timestamp: the larger key is dropped first.
    s = applyOutcome(s, outcome({ stableUid: 'tie-a', at: T0 }));
    s = applyOutcome(s, outcome({ stableUid: 'tie-b', at: T0 }));
    for (let i = 0; i < MISTAKE_BOOK_MAX_ENTRIES - 2; i += 1) {
      s = applyOutcome(s, outcome({ stableUid: `c${i}`, at: T0 + 1 + i }));
    }
    expect(Object.keys(s.entries)).toHaveLength(500);

    const s501 = applyOutcome(s, outcome({ stableUid: 'newest', at: T0 + 10_000 }));
    expect(Object.keys(s501.entries)).toHaveLength(500);
    expect(s501.entries['csharp::tie-b']).toBeUndefined();
    expect(s501.entries['csharp::tie-a']).toBeDefined();
    expect(s501.entries['csharp::newest']).toBeDefined();
    expect(Object.keys(s.entries)).toHaveLength(500);

    const s502 = applyOutcome(s501, outcome({ stableUid: 'newer', at: T0 + 10_001 }));
    expect(Object.keys(s502.entries)).toHaveLength(500);
    expect(s502.entries['csharp::tie-a']).toBeUndefined();
    expect(s502.entries['csharp::c0']).toBeDefined();

    // Updating an existing entry never evicts.
    const bumped = applyOutcome(s502, outcome({ stableUid: 'c0', at: T0 + 10_002 }));
    expect(Object.keys(bumped.entries)).toHaveLength(500);
    expect(bumped.entries['csharp::c1']).toBeDefined();
  });

  it('lists only unresolved mistakes inside the 30-day window, newest first', () => {
    expect(MISTAKE_WINDOW_DAYS).toBe(30);
    const now = T0 + 40 * DAY_MS;
    const s = bookWith(
      entry({ stableUid: 'old', lastWrongAt: now - 31 * DAY_MS }),
      entry({ stableUid: 'edge', lastWrongAt: now - 30 * DAY_MS }),
      entry({ stableUid: 'recent-b', lastWrongAt: now - DAY_MS }),
      entry({ stableUid: 'recent-a', lastWrongAt: now - DAY_MS }),
      entry({ stableUid: 'newest', lastWrongAt: now - 1 }),
      entry({ stableUid: 'resolved', lastWrongAt: now - 2, resolvedAt: now - 1, correctStreak: 2 }),
      entry({ deckSlug: 'aws', stableUid: 'other-deck', lastWrongAt: now - 3 }),
    );

    expect(activeMistakes(s, { now }).map((e) => `${e.deckSlug}::${e.stableUid}`)).toEqual([
      'csharp::newest',
      'aws::other-deck',
      'csharp::recent-a',
      'csharp::recent-b',
      'csharp::edge',
    ]);
    expect(activeMistakes(s, { now, deckSlug: 'csharp' }).map((e) => e.stableUid)).toEqual([
      'newest',
      'recent-a',
      'recent-b',
      'edge',
    ]);
    expect(activeMistakes(s, { now, windowDays: 2 }).map((e) => e.stableUid)).toEqual([
      'newest',
      'other-deck',
      'recent-a',
      'recent-b',
    ]);
    expect(activeMistakes(EMPTY, { now })).toEqual([]);
  });

  // Y08 mobile-13: the one helper the Library pill and the Mistake Book both count with.
  it('resolves only the active mistakes whose card is still in the deck', () => {
    const now = T0 + DAY_MS;
    const deck = {
      Slug: 'csharp',
      Title: 'C#',
      Locale: 'en-US',
      Version: '2',
      DeckType: 1,
      TotalCards: 2,
      Cards: [
        { StableUid: 'c1', OrderInDeck: 1, Difficulty: 1, Question: 'Q1' },
        { StableUid: 'c2', OrderInDeck: 2, Difficulty: 1, Question: 'Q2' },
      ],
    } as any;
    const s = bookWith(
      entry({ stableUid: 'c1', lastWrongAt: now - 2 }),
      // Removed by a content update: stored, active, but it can never be served.
      entry({ stableUid: 'removed', lastWrongAt: now - 1 }),
      entry({ stableUid: 'c2', lastWrongAt: now - 3, resolvedAt: now - 1, correctStreak: 2 }),
      entry({ deckSlug: 'aws', stableUid: 'c2', lastWrongAt: now - 1 }),
    );

    expect(activeMistakes(s, { now, deckSlug: 'csharp' })).toHaveLength(2);
    const rows = resolveActiveMistakeRows(s, deck, now);
    expect(rows.map((row) => [row.entry.stableUid, row.card.Question])).toEqual([['c1', 'Q1']]);
    expect(resolveActiveMistakeRows(s, { ...deck, Cards: undefined }, now)).toEqual([]);
  });

  it('counts local calendar days between two instants', () => {
    const at = (day: number, hour: number) => new Date(2026, 8, day, hour, 0, 0).getTime();
    expect(localDaysBetween(at(26, 23), at(27, 8))).toBe(1);
    expect(localDaysBetween(at(27, 0), at(27, 23))).toBe(0);
    expect(localDaysBetween(at(20, 12), at(27, 8))).toBe(7);
    // Never negative, whatever the clock does.
    expect(localDaysBetween(at(28, 8), at(27, 8))).toBe(0);
  });

  it('reads corrupt or absent storage as an empty book', async () => {
    expect(await loadMistakeBook()).toEqual(EMPTY);

    for (const raw of ['not json', 'null', '[]', '42', '{"v":2,"entries":{}}', '{"v":1}', '{"v":1,"entries":[]}']) {
      store.set(ANON_KEY, raw);
      expect(await loadMistakeBook()).toEqual(EMPTY);
    }

    const good = entry();
    store.set(
      ANON_KEY,
      JSON.stringify({
        v: 1,
        entries: {
          'csharp::c1': good,
          'csharp::bad-count': entry({ stableUid: 'bad-count', wrongCount: -1 }),
          'csharp::bad-outcome': { ...entry({ stableUid: 'bad-outcome' }), lastOutcome: 'nope' },
          'csharp::bad-topic': { ...entry({ stableUid: 'bad-topic' }), topic: 7 },
          'csharp::bad-resolved': { ...entry({ stableUid: 'bad-resolved' }), resolvedAt: 'yesterday' },
          'csharp::missing-uid': { ...entry(), stableUid: undefined },
          'csharp::wrong-key': entry({ stableUid: 'another' }),
          'csharp::not-object': 'x',
        },
      }),
    );
    expect(await loadMistakeBook()).toEqual({ v: 1, entries: { 'csharp::c1': good } });

    // lastCorrectAt is optional and read leniently: kept when valid, dropped alone when malformed.
    store.set(
      ANON_KEY,
      JSON.stringify({
        v: 1,
        entries: {
          'csharp::c1': entry({ correctStreak: 1, lastCorrectAt: T0 + 5 }),
          'csharp::c2': { ...entry({ stableUid: 'c2', correctStreak: 1 }), lastCorrectAt: 'soon' },
        },
      }),
    );
    expect(await loadMistakeBook()).toEqual({
      v: 1,
      entries: {
        'csharp::c1': entry({ correctStreak: 1, lastCorrectAt: T0 + 5 }),
        'csharp::c2': entry({ stableUid: 'c2', correctStreak: 1 }),
      },
    });

    throwOnGet = true;
    expect(await loadMistakeBook()).toEqual(EMPTY);
  });

  it('recordMistakeOutcome never throws when storage fails', async () => {
    throwOnSet = true;
    await expect(recordMistakeOutcome(outcome())).resolves.toBeUndefined();
    expect(store.has(ANON_KEY)).toBe(false);

    throwOnSet = false;
    await recordMistakeOutcome(outcome());
    expect(stored()?.entries['csharp::c1']).toMatchObject({ wrongCount: 1 });

    // A failed read never overwrites the stored book with a rebuilt one.
    throwOnGet = true;
    await expect(recordMistakeOutcome(outcome({ stableUid: 'c2' }))).resolves.toBeUndefined();
    expect(Object.keys(stored()?.entries ?? {})).toEqual(['csharp::c1']);

    // The chain survives failures: the next call still records.
    throwOnGet = false;
    await recordMistakeOutcome(outcome());
    expect(stored()?.entries['csharp::c1']).toMatchObject({ wrongCount: 2 });
  });

  it('serialises concurrent recordings so none is lost', async () => {
    await Promise.all([
      recordMistakeOutcome(outcome({ stableUid: 'a', at: T0 })),
      recordMistakeOutcome(outcome({ stableUid: 'b', at: T0 + 1 })),
      recordMistakeOutcome(outcome({ stableUid: 'a', at: T0 + 2 })),
      recordMistakeOutcome(outcome({ stableUid: 'a', rating: 'good', at: T0 + 3 })),
    ]);
    const s = stored();
    expect(Object.keys(s?.entries ?? {}).sort()).toEqual(['csharp::a', 'csharp::b']);
    expect(s?.entries['csharp::a']).toMatchObject({ wrongCount: 2, lastWrongAt: T0 + 2, correctStreak: 1 });
    expect(s?.entries['csharp::b']).toMatchObject({ wrongCount: 1 });
  });

  it('stores the book under the user-scoped key', async () => {
    expect(MISTAKE_BOOK_KEY).toBe('devcards:mistakes:v1');
    await recordMistakeOutcome(outcome());
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(ANON_KEY, expect.any(String));
    expect(stored()?.entries['csharp::c1']).toBeDefined();

    setActiveUserSubForStorage('user-a');
    try {
      expect(await loadMistakeBook()).toEqual(EMPTY);
      await recordMistakeOutcome(outcome({ stableUid: 'u1' }));
      const userBook = JSON.parse(store.get('devcards:u:user-a:devcards:mistakes:v1') ?? 'null');
      expect(Object.keys(userBook.entries)).toEqual(['csharp::u1']);
      expect(Object.keys(stored()?.entries ?? {})).toEqual(['csharp::c1']);
    } finally {
      setActiveUserSubForStorage(null);
    }
  });

  describe('anonymous book adoption (Z07 mobile-17)', () => {
    const USER_KEY = 'devcards:u:user-a:devcards:mistakes:v1';
    const userStored = (): MistakeBookState | null => {
      const raw = store.get(USER_KEY);
      return raw ? (JSON.parse(raw) as MistakeBookState) : null;
    };

    it('merges two books per key, summing counts, then applies the LRU cap', () => {
      const user = bookWith(
        entry({ stableUid: 'both-user-newer', lastWrongAt: T0 + 5, wrongCount: 3 }),
        entry({ stableUid: 'both-anon-newer', lastWrongAt: T0 + 1, wrongCount: 1 }),
        entry({ stableUid: 'tie', lastWrongAt: T0, wrongCount: 7 }),
        entry({ stableUid: 'user-only' }),
      );
      const anon = bookWith(
        entry({ stableUid: 'both-user-newer', lastWrongAt: T0 + 2, wrongCount: 1 }),
        entry({ stableUid: 'both-anon-newer', lastWrongAt: T0 + 9, wrongCount: 2, correctStreak: 1, lastCorrectAt: T0 + 3 }),
        entry({ stableUid: 'tie', lastWrongAt: T0, wrongCount: 1 }),
        entry({ stableUid: 'anon-only', lastWrongAt: T0 + 4 }),
      );
      const userSnapshot = structuredClone(user);
      const anonSnapshot = structuredClone(anon);

      const merged = mergeMistakeBooks(user, anon);

      expect(Object.keys(merged.entries).sort()).toEqual(
        ['csharp::anon-only', 'csharp::both-anon-newer', 'csharp::both-user-newer', 'csharp::tie', 'csharp::user-only'],
      );
      // Both unresolved: counts sum, the newer lastWrongAt side supplies lastOutcome and the resolution.
      expect(merged.entries['csharp::both-user-newer']).toEqual(
        entry({ stableUid: 'both-user-newer', wrongCount: 4, firstWrongAt: T0, lastWrongAt: T0 + 5 }),
      );
      expect(merged.entries['csharp::both-anon-newer']).toEqual(
        entry({ stableUid: 'both-anon-newer', wrongCount: 3, firstWrongAt: T0, lastWrongAt: T0 + 9, correctStreak: 1, lastCorrectAt: T0 + 3 }),
      );
      expect(merged.entries['csharp::both-anon-newer'].lastOutcome).toBe(anon.entries['csharp::both-anon-newer'].lastOutcome);
      // Tie: the account wins, counts still sum.
      expect(merged.entries['csharp::tie']).toEqual(entry({ stableUid: 'tie', wrongCount: 8, lastWrongAt: T0 }));
      expect(merged.entries['csharp::user-only']).toEqual(user.entries['csharp::user-only']);
      expect(merged.entries['csharp::anon-only']).toEqual(anon.entries['csharp::anon-only']);
      expect(user).toEqual(userSnapshot);
      expect(anon).toEqual(anonSnapshot);

      // Cap: 400 user + 200 anon entries keep the 500 with the newest lastWrongAt.
      const big = (prefix: string, n: number, start: number) =>
        bookWith(...Array.from({ length: n }, (_, i) => entry({ stableUid: `${prefix}${i}`, lastWrongAt: start + i })));
      const capped = mergeMistakeBooks(big('u', 400, T0), big('a', 200, T0 + 1000));
      expect(Object.keys(capped.entries)).toHaveLength(MISTAKE_BOOK_MAX_ENTRIES);
      expect(capped.entries['csharp::a0']).toBeDefined();
      expect(capped.entries['csharp::u99']).toBeUndefined();
      expect(capped.entries['csharp::u100']).toBeDefined();
    });

    it('adopts the signed-out book into the account at sign-in and removes the anon key', async () => {
      await recordMistakeOutcome(outcome({ stableUid: 'anon1', at: T0 }));
      await recordMistakeOutcome(outcome({ stableUid: 'shared', at: T0 + 10 }));
      setActiveUserSubForStorage('user-a');
      try {
        store.set(USER_KEY, JSON.stringify(bookWith(entry({ stableUid: 'mine' }), entry({ stableUid: 'shared', lastWrongAt: T0 }))));

        expect(await adoptAnonMistakeBook()).toEqual({ mistakesAdopted: 2 });

        expect(store.has(ANON_KEY)).toBe(false);
        const book = userStored();
        expect(Object.keys(book?.entries ?? {}).sort()).toEqual(['csharp::anon1', 'csharp::mine', 'csharp::shared']);
        expect(book?.entries['csharp::shared'].lastWrongAt).toBe(T0 + 10);
        // Idempotent: a second run finds nothing.
        expect(await adoptAnonMistakeBook()).toEqual({ mistakesAdopted: 0 });
        expect(userStored()).toEqual(book);
      } finally {
        setActiveUserSubForStorage(null);
      }
      // A later sign-out does not bring the stale anonymous book back.
      expect(await loadMistakeBook()).toEqual(EMPTY);
    });

    it('does nothing while signed out', async () => {
      await recordMistakeOutcome(outcome());
      expect(await adoptAnonMistakeBook()).toEqual({ mistakesAdopted: 0 });
      expect(stored()?.entries['csharp::c1']).toBeDefined();
    });

    it('keeps the anon book when the account book cannot be read, and never throws', async () => {
      await recordMistakeOutcome(outcome());
      setActiveUserSubForStorage('user-a');
      try {
        throwOnGet = true;
        expect(await adoptAnonMistakeBook()).toEqual({ mistakesAdopted: 0 });
        throwOnGet = false;
        expect(store.has(ANON_KEY)).toBe(true);
        expect(await adoptAnonMistakeBook()).toEqual({ mistakesAdopted: 1 });
      } finally {
        throwOnGet = false;
        setActiveUserSubForStorage(null);
      }
    });

    it('runs on the same chain as recordMistakeOutcome, so a rating racing sign-in is not lost', async () => {
      await recordMistakeOutcome(outcome({ stableUid: 'anon1', at: T0 }));
      setActiveUserSubForStorage('user-a');
      try {
        await Promise.all([
          recordMistakeOutcome(outcome({ stableUid: 'user1', at: T0 + 1 })),
          adoptAnonMistakeBook(),
          recordMistakeOutcome(outcome({ stableUid: 'user2', at: T0 + 2 })),
        ]);
        expect(Object.keys(userStored()?.entries ?? {}).sort()).toEqual(['csharp::anon1', 'csharp::user1', 'csharp::user2']);
      } finally {
        setActiveUserSubForStorage(null);
      }
    });
  });
});
