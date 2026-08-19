import type { DrawStateRecord } from './drawStateStore';

/**
 * The in-memory copy of each partition's draw state, keyed by the *resolved
 * storage key* rather than by slug.
 *
 * Keying by the full key is what makes account partitioning free: the key
 * already carries the `devcards:u:{sub}:` prefix getUserScopedKey built, so
 * anon and a signed-in account can never collide, and no code here has to
 * know that user scoping exists. A slug-keyed map would need its own copy of
 * the scope rule and would go stale the moment the two definitions drifted.
 *
 * This lives in its own module for the same reason progressQueueCache does:
 * the import graph. resetAllProgress has to invalidate this cache, and it has
 * no business pulling drawStateStore -- and through it AsyncStorage and
 * review/storage -- along to do it. A leaf module with no runtime imports lets
 * both sides share the state without sharing the dependency. (The
 * DrawStateRecord import above is type-only, so it is erased at build time and
 * creates no runtime edge back to the store.)
 *
 * Why caching is safe at all: saveDrawState is the only writer of these keys,
 * so it is the only place that can make an entry stale, and it writes through
 * below. Deletion is where that premise needed checking, and it turned up
 * three sweeps that remove these keys without a write: resetAllProgress (the
 * debug progress reset), resetProgressSyncState (whose `devcards:u:{sub}:`
 * prefix is wider than its name), and the deck-retire purge in
 * deckRepository. All three call the invalidator below.
 */
const stateCache = new Map<string, DrawStateRecord>();

/**
 * Copy in, copy out -- the cache never shares an array with a caller.
 *
 * Before the cache, every loadDrawState returned a freshly parsed record that
 * the caller could mutate freely; pity.ts hands the very array it got back to
 * saveDrawState. Handing out the stored object would silently turn that into
 * aliasing, where a caller's local edit rewrites what every other reader sees
 * without a write ever happening. One string-array copy per read is a few
 * microseconds against the JSON round trip this replaces, and it keeps the
 * old contract exactly.
 */
function snapshot(record: DrawStateRecord): DrawStateRecord {
  return {
    owned: [...record.owned],
    // PityState is a flat {draws, threshold} pair; a shallow copy is a full
    // one. Null stays null -- "never persisted" is a value the caller reads.
    pity: record.pity ? { ...record.pity } : null,
  };
}

export function getCachedDrawState(storageKey: string): DrawStateRecord | undefined {
  const cached = stateCache.get(storageKey);
  return cached ? snapshot(cached) : undefined;
}

export function setCachedDrawState(storageKey: string, record: DrawStateRecord): void {
  stateCache.set(storageKey, snapshot(record));
}

/**
 * Drop cached state so the next read goes back to storage.
 *
 * Called from the paths that delete these keys directly instead of writing
 * through saveDrawState -- all three work by key prefix. Without it a cache
 * entry outlives the data it describes, and the next draw's read-modify-write
 * would resurrect the wiped collection from memory.
 *
 * Passing no key drops every partition, which is what a wipe wants: cheap,
 * and it cannot leave one partition behind by omission.
 */
export function invalidateDrawStateCache(storageKey?: string): void {
  if (storageKey == null) stateCache.clear();
  else stateCache.delete(storageKey);
}
