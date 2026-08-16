import type { ProgressEvent } from './progressSync';

/**
 * The in-memory copy of each user's pending sync queue.
 *
 * This lives in its own module for one reason: the import graph. progressSync
 * reaches expo-crypto for UUIDs, so anything that imports progressSync inherits
 * expo at module scope. The debug reset needs to invalidate this cache, and it
 * has no business pulling expo along to do it. A leaf module with no runtime
 * imports lets both sides share the state without sharing the dependency.
 * (The ProgressEvent import above is type-only, so it is erased at build time
 * and creates no runtime edge back to progressSync.)
 *
 * Why caching the queue is safe at all is documented on readQueue in
 * progressSync: readQueue and writeQueue are the only doors to the key, every
 * caller runs inside the single-writer promise chain, and the two paths that
 * delete keys directly call the invalidators below.
 */
const queueCache = new Map<string, ProgressEvent[]>();

export function getCachedQueue(userSub: string): ProgressEvent[] | undefined {
  return queueCache.get(userSub);
}

export function setCachedQueue(userSub: string, events: ProgressEvent[]): void {
  queueCache.set(userSub, events);
}

/**
 * Drop cached queues so the next read goes back to storage.
 *
 * Called from the paths that bypass writeQueue and delete the underlying keys
 * directly. Without this, a cache entry would outlive the data it describes and
 * the next write would resurrect deleted events from memory.
 *
 * Passing no argument drops every partition, which is what a user change wants:
 * cheap, and it cannot leave one stale partition behind by omission.
 */
export function invalidateProgressQueueCache(userSub?: string): void {
  if (userSub == null) queueCache.clear();
  else queueCache.delete(userSub);
}
