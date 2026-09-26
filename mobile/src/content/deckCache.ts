// Non-frozen wrapper around the frozen deckRepository read/install paths.
//
// resolveDeckBySlug re-reads and JSON.parses the whole installed deck file
// (~0.6 MB for the AWS and Claude decks) on every call, with no memo: Home
// resolves each deck on every refresh, and Library, CardDetail, SessionCard
// and Draw each pay the same read+parse again. This module memoizes the parsed
// deck per user scope + slug, de-duplicates concurrent reads, expires entries
// after a TTL and keeps the map bounded. deckRepository stays untouched; every
// install still flows through it via installDeckAndInvalidate, which clears the
// cache so the next read sees the freshly written file.
//
// Deliberately does NOT statically import ../auth/authStore or
// ../review/progressScope: many screen tests do not mock auth/amplify, and a
// static edge here would drag that whole stack into their module graph. The
// scope is read through a guarded dynamic import that falls back to 'anon'.

import { installDeckFromUrl, resolveDeckBySlug, type DeckContent } from './deckRepository';

export const DECK_CACHE_TTL_MS = 10 * 60 * 1000;
export const DECK_CACHE_MAX_ENTRIES = 4;

type CacheEntry = {
  promise: Promise<DeckContent | null>;
  createdAtMs: number;
};

// Module-level, so the memo outlives the screens that read through it (they
// unmount and remount across the tab bar). Insertion order is the eviction
// order — a Map preserves it, so the oldest key is always the first one.
const cache = new Map<string, CacheEntry>();

// Guarded dynamic import: suites without auth/amplify mocks still load this
// module and simply fall back to the 'anon' scope.
async function readCacheScope(): Promise<string> {
  try {
    const mod = await import('../review/progressScope');
    return mod.getProgressScopeKey();
  } catch {
    return 'anon';
  }
}

export async function getCachedDeck(slug: string): Promise<DeckContent | null> {
  const safeSlug = String(slug ?? '').trim();
  // An empty slug never keys the cache: resolveDeckBySlug already returns null
  // for it, and caching that answer would collide across scopes.
  if (!safeSlug) return resolveDeckBySlug(slug);

  const scope = await readCacheScope();
  const key = `${scope}::${safeSlug}`;

  const existing = cache.get(key);
  if (existing && Date.now() - existing.createdAtMs < DECK_CACHE_TTL_MS) {
    // Concurrent callers share the one in-flight (or settled) read.
    return existing.promise;
  }
  // Drop a stale entry so a rejection below deletes the right thing.
  if (existing) cache.delete(key);

  const promise = resolveDeckBySlug(safeSlug);
  const entry: CacheEntry = { promise, createdAtMs: Date.now() };
  cache.set(key, entry);

  // Never cache a missing deck or a failed read: on null-or-reject, evict the
  // key, but only if the map still holds THIS entry (a later install may have
  // already invalidated and replaced it). Rejections propagate to the caller.
  promise
    .then((deck) => {
      if (deck === null && cache.get(key) === entry) cache.delete(key);
    })
    .catch(() => {
      if (cache.get(key) === entry) cache.delete(key);
    });

  // Bound the map: evict oldest (insertion order) until within the cap.
  while (cache.size > DECK_CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }

  return promise;
}

export function invalidateDeckCache(slug?: string): void {
  if (slug === undefined) {
    cache.clear();
    return;
  }
  const suffix = `::${slug.trim()}`;
  for (const key of [...cache.keys()]) {
    if (key.endsWith(suffix)) cache.delete(key);
  }
}

export async function installDeckAndInvalidate(
  slug: string,
  url: string,
  remoteVersion: string | null,
  remoteSha256: string | null,
): Promise<boolean> {
  try {
    return await installDeckFromUrl(slug, url, remoteVersion, remoteSha256);
  } finally {
    // Always invalidate, even on a failed/rejected install: a partial write or
    // a retry must never be served from a stale memo.
    invalidateDeckCache(slug);
  }
}
