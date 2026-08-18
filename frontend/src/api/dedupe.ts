// src/api/dedupe.ts
// Request de-duplication: stops the same request going out twice in quick succession.

interface PendingRequest<T> {
  promise: Promise<T>;
  timestamp: number;
}

const pendingRequests = new Map<string, PendingRequest<unknown>>();
const DEFAULT_TTL = 100; // identical requests within 100ms share one promise

/**
 * De-duplicates an async request.
 * @param key unique identifier for the request
 * @param fetcher the function that actually performs it
 * @param ttl de-duplication window, in milliseconds
 */
export function dedupeRequest<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttl = DEFAULT_TTL
): Promise<T> {
  const now = Date.now();
  const pending = pendingRequests.get(key);

  // A request already in flight and still inside the TTL is returned as is.
  if (pending && now - pending.timestamp < ttl) {
    return pending.promise as Promise<T>;
  }

  // Otherwise start a new one.
  const promise = fetcher().finally(() => {
    // Cleared on a delay, so parallel callers still get to reuse it.
    setTimeout(() => {
      const current = pendingRequests.get(key);
      if (current?.promise === promise) {
        pendingRequests.delete(key);
      }
    }, ttl);
  });

  pendingRequests.set(key, { promise, timestamp: now });
  return promise;
}

/**
 * Clears the de-duplication entry for one key, or all of them.
 */
export function clearDedupe(key?: string) {
  if (key) {
    pendingRequests.delete(key);
  } else {
    pendingRequests.clear();
  }
}

// Key builders for the requests that use this.
export const DedupeKeys = {
  decks: () => 'decks:list',
  deck: (id: number) => `deck:${id}`,
  cards: (deckId: number) => `cards:deck:${deckId}`,
  manifest: () => 'manifest:admin',
  publishJobs: () => 'publish:jobs',
} as const;
