// src/lib/sessionCache.ts
//
// The localStorage cache DeckListPage reads on its legacy path, with the three
// holes closed that made it a cache of "whatever the last person to use this
// browser saw".
//
// WHAT WAS WRONG, all three at once and all three invisible:
//
//   1. The keys were `recallsmith_decks_cache` and `recallsmith_manifest_cache`
//      -- one pair for the browser, not one per user. Sign out, sign in as
//      somebody with different deck permissions, and the first paint is the
//      previous account's deck list, complete with decks this account is not
//      allowed to see. It is a permissions leak that no request could produce,
//      because no request is made: the page renders the cache and only then
//      refreshes behind it.
//   2. Signing out did not clear it. The console's own sign-out drops the
//      tokens and redirects to Cognito, and the rows stayed on disk.
//   3. Deleting or publishing a deck did not invalidate it. The list you were
//      shown for the next five minutes still had the deleted deck in it.
//
// The fix for (1) is to put the owner in the key. Not to encrypt or obfuscate
// anything -- localStorage is readable either way -- but so that a lookup for
// this session cannot RESOLVE to another session's entry. (2) and (3) are then
// a clear on sign-out and a clear on the two writes that change the collection.
//
// NO IDENTITY, NO CACHE. Both accessors take the owner's `sub` and do nothing
// at all when it is null. A shared "anonymous" bucket would put hole (1) back
// for exactly the sessions least able to notice it.
//
// This module deliberately imports NOTHING. src/auth/tokenStore.ts clears these
// entries when it clears the session, and tokenStore is imported by
// src/auth/sessionUser.ts, which is where a `sub` comes from -- so importing
// the identity helpers here would close an import cycle through the module that
// every page's auth check runs on.

/**
 * Namespaced, and versioned so a shape change is a new key rather than a parse
 * failure. The old unscoped keys are simply abandoned: they are five-minute
 * caches, so the stale copies expire on their own, and no migration can invent
 * the owner they were missing.
 */
const PREFIX = 'recallsmith/v1/';

/**
 * How long a cached answer may be shown before the page waits for a fresh one.
 *
 * This is the console's only remaining hand-rolled cache window;
 * tests/cacheDuplicationCensus.test.ts is the ratchet that keeps it the only
 * one.
 */
export const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export type SessionCacheName = 'decks' | 'manifest';

interface CacheItem<T> {
  data: T;
  timestamp: number;
}

function keyFor(name: SessionCacheName, ownerSub: string): string {
  return `${PREFIX}${ownerSub}/${name}`;
}

/** The cached value for this owner, or null when there is not a live one. */
export function readSessionCache<T>(
  name: SessionCacheName,
  ownerSub: string | null,
): T | null {
  if (!ownerSub) return null;

  try {
    const item = localStorage.getItem(keyFor(name, ownerSub));
    if (!item) return null;

    const parsed = JSON.parse(item) as CacheItem<T>;
    if (Date.now() - parsed.timestamp > CACHE_TTL) {
      localStorage.removeItem(keyFor(name, ownerSub));
      return null;
    }
    return parsed.data;
  } catch {
    return null;
  }
}

export function writeSessionCache<T>(
  name: SessionCacheName,
  ownerSub: string | null,
  data: T,
): void {
  if (!ownerSub) return;

  try {
    localStorage.setItem(
      keyFor(name, ownerSub),
      JSON.stringify({ data, timestamp: Date.now() }),
    );
  } catch {
    // Storage errors are ignored: a cache that cannot be written is a cache
    // miss, and a quota error must not take a page render down with it.
  }
}

/**
 * Forget every cached entry, for every owner in this browser.
 *
 * Called from two places, and both want the wide version rather than a targeted
 * one:
 *
 *   src/auth/tokenStore.ts on clearTokens() -- the session is over, including
 *   the paths that end it without a button (a refresh token that will not
 *   refresh, a 401). Scoping that to the departing user would need an identity
 *   read at the exact moment the identity is being destroyed.
 *
 *   the delete-deck and publish-deck mutations -- the collection changed, so
 *   every cached copy of it in this browser is now wrong, whoever it belongs
 *   to. The cost of over-clearing is one refetch.
 *
 * Iterating a snapshot of the key list rather than localStorage live: removing
 * during a `key(i)` walk renumbers the remaining entries and skips every second
 * match.
 */
export function clearSessionCaches(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key !== null && key.startsWith(PREFIX)) keys.push(key);
    }
    for (const key of keys) localStorage.removeItem(key);
  } catch {
    // Same reasoning as the write path: an unreadable store is an empty one.
  }
}
