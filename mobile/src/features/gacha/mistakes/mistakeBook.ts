import AsyncStorage from '@react-native-async-storage/async-storage';

import type { ReviewRating } from '../../../review/model';
import { getUserScopedKey } from '../../../review/storage';
import { ANON_USER_SCOPE_PREFIX } from '../draw/drawStateStore';
import type { CardExport, DeckExport } from '../../../types/deckExport';
import type { McqVerdict } from '../mcq/mcqVerdict';

/** Base key; resolved key is getUserScopedKey(MISTAKE_BOOK_KEY) → `devcards:u:{sub}:devcards:mistakes:v1`.
 *  Local-only in 1.8.0: the book never syncs to the server. */
export const MISTAKE_BOOK_KEY = 'devcards:mistakes:v1';
/** LRU cap: past this, the entries with the oldest lastWrongAt are dropped. */
export const MISTAKE_BOOK_MAX_ENTRIES = 500;
/** activeMistakes() only lists entries whose last wrong answer falls inside this many days. */
export const MISTAKE_WINDOW_DAYS = 30;

const DAY_MS = 86_400_000;
/** Consecutive good/easy ratings, each on a different local calendar day, that resolve an entry. */
export const RESOLVE_STREAK = 2;

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
  /** When the last correct answer that counted toward correctStreak landed. Absent until the
   *  first one, and cleared by a new mistake. Optional so books written before it still parse. */
  lastCorrectAt?: number;
};

/** Entries are keyed `${deckSlug}::${stableUid}`. */
export type MistakeBookState = { v: 1; entries: Record<string, MistakeEntry> };

const LAST_OUTCOMES: ReadonlySet<string> = new Set(['again', 'mcq-wrong', 'mcq-partial']);

function entryKey(deckSlug: string, stableUid: string): string {
  return `${deckSlug}::${stableUid}`;
}

/** Same calendar day in the device's local time zone. */
export function isSameLocalDay(a: number, b: number): boolean {
  const da = new Date(a);
  const db = new Date(b);
  return da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth() && da.getDate() === db.getDate();
}

/** Local calendar days from `from` to `to` (0 on the same day, 1 for yesterday), never negative. */
export function localDaysBetween(from: number, to: number): number {
  const a = new Date(from);
  const b = new Date(to);
  const startA = new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime();
  const startB = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime();
  // Rounded: a local day across a DST change is 23 or 25 hours long.
  return Math.max(0, Math.round((startB - startA) / DAY_MS));
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

// Past the cap, the entries with the oldest lastWrongAt go.
function capEntries(entries: Record<string, MistakeEntry>): Record<string, MistakeEntry> {
  const all = Object.entries(entries);
  if (all.length <= MISTAKE_BOOK_MAX_ENTRIES) return entries;
  all.sort(compareForEviction);
  return Object.fromEntries(all.slice(all.length - MISTAKE_BOOK_MAX_ENTRIES));
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
    const entries: Record<string, MistakeEntry> = { ...s.entries, [key]: next };
    return { v: 1, entries: prev ? entries : capEntries(entries) };
  }

  if (!prev || prev.resolvedAt !== null) return s;
  if (o.rating !== 'good' && o.rating !== 'easy') return s;
  // Spaced, not crammed: a second correct answer on the same local day as the one before it does
  // not count, so back-to-back focus runs cannot clear the book.
  if (prev.lastCorrectAt !== undefined && isSameLocalDay(prev.lastCorrectAt, o.at)) return s;

  const correctStreak = prev.correctStreak + 1;
  const next: MistakeEntry = {
    ...prev,
    correctStreak,
    resolvedAt: correctStreak >= RESOLVE_STREAK ? o.at : null,
    lastCorrectAt: o.at,
  };
  return { v: 1, entries: { ...s.entries, [key]: next } };
}

/**
 * Pure merge of the signed-out book into the account's book. Where both hold a card, the entry
 * with the newer lastWrongAt wins (the account's on a tie), then the LRU cap applies. Never
 * mutates its inputs.
 */
export function mergeMistakeBooks(user: MistakeBookState, anon: MistakeBookState): MistakeBookState {
  const entries: Record<string, MistakeEntry> = { ...user.entries };
  for (const [key, entry] of Object.entries(anon.entries)) {
    const mine = getEntry(user, key);
    if (!mine || entry.lastWrongAt > mine.lastWrongAt) entries[key] = entry;
  }
  return { v: 1, entries: capEntries(entries) };
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

export type MistakeRow = { entry: MistakeEntry; card: CardExport };

/**
 * The deck's active mistakes that still resolve to one of its cards, newest first. An entry for a
 * card a content update removed can never be served, so every screen that lists or counts
 * mistakes goes through here and agrees on the number.
 */
export function resolveActiveMistakeRows(s: MistakeBookState, deck: DeckExport, now: number): MistakeRow[] {
  const cardMap = new Map((deck.Cards ?? []).map((card) => [card.StableUid, card]));
  const rows: MistakeRow[] = [];
  for (const entry of activeMistakes(s, { deckSlug: deck.Slug, now })) {
    const card = cardMap.get(entry.stableUid);
    if (card) rows.push({ entry, card });
  }
  return rows;
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
  // Lenient: a missing or malformed lastCorrectAt only drops that field, never the entry.
  const lastCorrectAt = isCount(e.lastCorrectAt) ? { lastCorrectAt: e.lastCorrectAt } : {};
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
    ...lastCorrectAt,
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

/** Runs fn after every earlier book write has settled, and before any later one starts. */
export function withMistakeBookLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = recordChain.then(fn);
  recordChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** Folds one rating into the stored book. Serialised, and never throws or rejects. */
export async function recordMistakeOutcome(o: MistakeOutcome): Promise<void> {
  await withMistakeBookLock(() => recordNow(o)).catch(() => undefined);
}

export type AnonMistakeBookAdoption = { mistakesAdopted: number };

async function adoptNow(): Promise<AnonMistakeBookAdoption> {
  const result: AnonMistakeBookAdoption = { mistakesAdopted: 0 };
  try {
    const userKey = await getUserScopedKey(MISTAKE_BOOK_KEY);
    // Signed out: the current partition IS the anon partition, nothing to adopt into.
    if (userKey.startsWith(ANON_USER_SCOPE_PREFIX)) return result;
    const anonKey = `${ANON_USER_SCOPE_PREFIX}${MISTAKE_BOOK_KEY}`;
    const anonRaw = await AsyncStorage.getItem(anonKey);
    if (anonRaw == null) return result;
    const anon = parseBook(anonRaw);
    // A read error throws out of here on purpose, before the anon key goes: merging into a book
    // rebuilt from an empty read would wipe the account's entries.
    const user = parseBook(await AsyncStorage.getItem(userKey));
    const adopted = Object.keys(anon.entries).length;
    // Copy, then clear: a kill between the two writes replays the merge next time, which is idempotent.
    if (adopted > 0) await AsyncStorage.setItem(userKey, JSON.stringify(mergeMistakeBooks(user, anon)));
    await AsyncStorage.removeItem(anonKey);
    result.mistakesAdopted = adopted;
  } catch {
    // Best-effort like every book write; the anon book stays for the next sign-in.
  }
  return result;
}

/**
 * Adopts the book kept while signed out into the account that just signed in, then removes the
 * anon key, so it neither vanishes at sign-in nor comes back after a later sign-out. Runs on the
 * same chain as recordMistakeOutcome. Idempotent, and never throws.
 */
export function adoptAnonMistakeBook(): Promise<AnonMistakeBookAdoption> {
  return withMistakeBookLock(adoptNow);
}
