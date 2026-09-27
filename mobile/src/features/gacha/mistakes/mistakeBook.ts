import AsyncStorage from '@react-native-async-storage/async-storage';

import type { ReviewRating } from '../../../review/model';
import { getUserScopedKey } from '../../../review/storage';
import type { McqVerdict } from '../mcq/mcqVerdict';

/** Base key; resolved key is getUserScopedKey(MISTAKE_BOOK_KEY) → `devcards:u:{sub}:devcards:mistakes:v1`.
 *  Local-only in 1.8.0: the book never syncs to the server. */
export const MISTAKE_BOOK_KEY = 'devcards:mistakes:v1';
/** LRU cap: past this, the entries with the oldest lastWrongAt are dropped. */
export const MISTAKE_BOOK_MAX_ENTRIES = 500;
/** activeMistakes() only lists entries whose last wrong answer falls inside this many days. */
export const MISTAKE_WINDOW_DAYS = 30;

const DAY_MS = 86_400_000;
/** Consecutive good/easy ratings that resolve an entry. */
const RESOLVE_STREAK = 2;

export type MistakeOutcome = {
  deckSlug: string;
  stableUid: string;
  topic: string | null;
  rating: ReviewRating;
  mcqVerdict?: McqVerdict | null;
  at: number;
};

export type MistakeEntry = {
  deckSlug: string;
  stableUid: string;
  topic: string | null;
  wrongCount: number;
  firstWrongAt: number;
  lastWrongAt: number;
  lastOutcome: 'again' | 'mcq-wrong' | 'mcq-partial';
  correctStreak: number;
  resolvedAt: number | null;
};

/** Entries are keyed `${deckSlug}::${stableUid}`. */
export type MistakeBookState = { v: 1; entries: Record<string, MistakeEntry> };

const LAST_OUTCOMES: ReadonlySet<string> = new Set(['again', 'mcq-wrong', 'mcq-partial']);

function entryKey(deckSlug: string, stableUid: string): string {
  return `${deckSlug}::${stableUid}`;
}

function emptyBook(): MistakeBookState {
  return { v: 1, entries: {} };
}

// Own-key lookup: `key in entries` would also match inherited names like 'constructor'.
function getEntry(s: MistakeBookState, key: string): MistakeEntry | undefined {
  return Object.prototype.hasOwnProperty.call(s.entries, key) ? s.entries[key] : undefined;
}

/** A card counts as a mistake when rated Again, or when its MCQ settled as wrong or partial. */
export function isMistake(o: MistakeOutcome): boolean {
  return o.rating === 'again' || o.mcqVerdict === 'wrong' || o.mcqVerdict === 'partial';
}

// Ascending lastWrongAt; ties drop the larger key first, so the order is deterministic.
function compareForEviction(a: [string, MistakeEntry], b: [string, MistakeEntry]): number {
  if (a[1].lastWrongAt !== b[1].lastWrongAt) return a[1].lastWrongAt - b[1].lastWrongAt;
  return a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0;
}

/**
 * Pure reducer: folds one rating into the book. Returns the same object when nothing changes,
 * and never mutates its input.
 */
export function applyOutcome(s: MistakeBookState, o: MistakeOutcome): MistakeBookState {
  const key = entryKey(o.deckSlug, o.stableUid);
  const prev = getEntry(s, key);

  if (isMistake(o)) {
    const lastOutcome: MistakeEntry['lastOutcome'] =
      o.mcqVerdict === 'wrong' ? 'mcq-wrong' : o.mcqVerdict === 'partial' ? 'mcq-partial' : 'again';
    const next: MistakeEntry = {
      deckSlug: o.deckSlug,
      stableUid: o.stableUid,
      topic: o.topic,
      wrongCount: prev ? prev.wrongCount + 1 : 1,
      firstWrongAt: prev ? prev.firstWrongAt : o.at,
      lastWrongAt: o.at,
      lastOutcome,
      correctStreak: 0,
      resolvedAt: null,
    };
    let entries: Record<string, MistakeEntry> = { ...s.entries, [key]: next };
    if (!prev) {
      const all = Object.entries(entries);
      if (all.length > MISTAKE_BOOK_MAX_ENTRIES) {
        all.sort(compareForEviction);
        entries = Object.fromEntries(all.slice(all.length - MISTAKE_BOOK_MAX_ENTRIES));
      }
    }
    return { v: 1, entries };
  }

  if (!prev || prev.resolvedAt !== null) return s;
  if (o.rating !== 'good' && o.rating !== 'easy') return s;

  const correctStreak = prev.correctStreak + 1;
  const next: MistakeEntry = {
    ...prev,
    correctStreak,
    resolvedAt: correctStreak >= RESOLVE_STREAK ? o.at : null,
  };
  return { v: 1, entries: { ...s.entries, [key]: next } };
}

/** Unresolved entries inside the window, newest lastWrongAt first (ties by key ascending). */
export function activeMistakes(
  s: MistakeBookState,
  opts: { deckSlug?: string; now: number; windowDays?: number },
): MistakeEntry[] {
  const cutoff = opts.now - (opts.windowDays ?? MISTAKE_WINDOW_DAYS) * DAY_MS;
  return Object.entries(s.entries)
    .filter(
      ([, e]) =>
        e.resolvedAt === null &&
        e.lastWrongAt >= cutoff &&
        (opts.deckSlug === undefined || e.deckSlug === opts.deckSlug),
    )
    .sort((a, b) => {
      if (a[1].lastWrongAt !== b[1].lastWrongAt) return b[1].lastWrongAt - a[1].lastWrongAt;
      return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
    })
    .map(([, e]) => e);
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function parseEntry(key: string, raw: unknown): MistakeEntry | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const e = raw as Record<string, unknown>;
  if (typeof e.deckSlug !== 'string' || typeof e.stableUid !== 'string') return null;
  if (entryKey(e.deckSlug, e.stableUid) !== key) return null;
  if (e.topic !== null && typeof e.topic !== 'string') return null;
  if (!isCount(e.wrongCount) || !isCount(e.firstWrongAt) || !isCount(e.lastWrongAt) || !isCount(e.correctStreak)) {
    return null;
  }
  if (typeof e.lastOutcome !== 'string' || !LAST_OUTCOMES.has(e.lastOutcome)) return null;
  if (e.resolvedAt !== null && !isCount(e.resolvedAt)) return null;
  return {
    deckSlug: e.deckSlug,
    stableUid: e.stableUid,
    topic: e.topic,
    wrongCount: e.wrongCount,
    firstWrongAt: e.firstWrongAt,
    lastWrongAt: e.lastWrongAt,
    lastOutcome: e.lastOutcome as MistakeEntry['lastOutcome'],
    correctStreak: e.correctStreak,
    resolvedAt: e.resolvedAt,
  };
}

function parseBook(raw: string | null): MistakeBookState {
  if (!raw) return emptyBook();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return emptyBook();
    const obj = parsed as Record<string, unknown>;
    if (obj.v !== 1) return emptyBook();
    const rawEntries = obj.entries;
    if (!rawEntries || typeof rawEntries !== 'object' || Array.isArray(rawEntries)) return emptyBook();
    const entries: Record<string, MistakeEntry> = {};
    for (const [key, value] of Object.entries(rawEntries as Record<string, unknown>)) {
      const entry = parseEntry(key, value);
      if (entry) entries[key] = entry;
    }
    return { v: 1, entries };
  } catch {
    return emptyBook();
  }
}

/** Reads the current user's book. Absent, corrupt or unreadable storage reads as an empty book. Never throws. */
export async function loadMistakeBook(): Promise<MistakeBookState> {
  try {
    return parseBook(await AsyncStorage.getItem(await getUserScopedKey(MISTAKE_BOOK_KEY)));
  } catch {
    return emptyBook();
  }
}

async function recordNow(o: MistakeOutcome): Promise<void> {
  try {
    const key = await getUserScopedKey(MISTAKE_BOOK_KEY);
    // A storage read error throws out of here on purpose: writing a book rebuilt from an empty
    // read would wipe every stored entry. Corrupt data, by contrast, is replaced.
    const before = parseBook(await AsyncStorage.getItem(key));
    const after = applyOutcome(before, o);
    if (after === before) return;
    await AsyncStorage.setItem(key, JSON.stringify(after));
  } catch {
    // The book is best-effort; a failed read or write must never surface on the rating path.
  }
}

// One module-level chain serialises read-modify-write cycles, so two ratings in quick succession
// never read the same snapshot and drop each other's update.
let recordChain: Promise<void> = Promise.resolve();

/** Folds one rating into the stored book. Serialised, and never throws or rejects. */
export async function recordMistakeOutcome(o: MistakeOutcome): Promise<void> {
  const run = recordChain.then(() => recordNow(o)).catch(() => undefined);
  recordChain = run;
  await run;
}
