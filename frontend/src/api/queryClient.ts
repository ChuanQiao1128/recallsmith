// src/api/queryClient.ts
import { useContext } from 'react';
import { QueryClient, QueryClientContext } from '@tanstack/react-query';

/**
 * The application's one QueryClient.
 *
 * THE PRINCIPLE THESE DEFAULTS FOLLOW: a global default may cache for as long as
 * every write that could invalidate it says so. The console reached that point.
 * Each write now invalidates exactly what it changed:
 *
 *   card create / update / delete   invalidate ['cards', deckId] (delete removes
 *                                   the row in place instead; update also
 *                                   invalidates ['card', id]).
 *   deck create / update / delete   invalidate ['decks'] and the affected
 *                                   ['decks', id].
 *   deck publish                    invalidates ['decks'].
 *   import run                      invalidates ['cards', deckId] and
 *                                   ['decks', id] in DeckImportPage's finally.
 *
 * With that in place a short cache is safe rather than a trap, so the defaults
 * are no longer pinned to zero:
 *
 *   staleTime 30_000       A read served in the last 30 s is reused without a
 *                          request, so List -> Edit -> back no longer downloads
 *                          the whole deck three times. A write invalidates its
 *                          keys the moment it lands, so what this window can
 *                          serve stale is only a change made outside this
 *                          console (the importer, another tab), and only until
 *                          the next mount past the window.
 *   gcTime 300_000         An unobserved query is kept for five minutes before
 *                          it is dropped, so re-entering a page inside that
 *                          window paints from cache while it revalidates rather
 *                          than showing a spinner.
 *   retry false            A refusal is an answer. Retrying it sends a request
 *                          the server already declined and delays the message
 *                          by a backoff.
 *   refetchOnWindowFocus   Alt-tabbing back into the tab is not a request to
 *   refetchOnReconnect     reload, and neither is a wifi blip. Both are ambient
 *                          refetches this console has never had; turning them
 *                          on by default would be a behaviour change disguised
 *                          as configuration.
 *   networkMode 'always'   The one option with no counterpart in the hand-
 *                          written fetches this layer replaced. The library
 *                          default 'online' does not call queryFn while the
 *                          browser reports itself offline: the query parks at
 *                          fetchStatus 'paused' with status still 'pending',
 *                          and a page reading isPending renders a spinner with
 *                          nothing on the way to end it. The same applies to
 *                          mutations, where a paused mutate() is a Save button
 *                          that goes quiet -- which is why it is set on both.
 *
 * The retryDelay that used to sit here is gone. It spelled out react-query's
 * own default (exponential, capped at 30s) and, under retry: false, could never
 * run. A line that is both a copy of the library's behaviour and unreachable is
 * not a setting, it is a decoration that reads like one.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 300_000,
      retry: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      networkMode: 'always',
    },
    mutations: {
      // A failed mutation is never retried automatically: a write that may
      // already have landed must not be replayed by the client on its own.
      retry: false,
      networkMode: 'always',
    },
  },
});

/**
 * The QueryClient this component tree should use.
 *
 * Context first, and the module singleton only when there is no provider above.
 * In the running application the two are the SAME OBJECT -- src/main.tsx mounts
 * `QueryClientProvider client={queryClient}` around everything -- so the
 * fallback cannot introduce a second cache in production; there is exactly one
 * client either way.
 *
 * What it buys is that a component may be mounted bare. Several test files
 * render a page under nothing but a MemoryRouter, on purpose: they predate the
 * data layer and are the control group for it, and
 * tests/deckListPagePolling.test.tsx in particular is the untouched baseline
 * that proves the publish-jobs timer still behaves. Under a strict
 * useQueryClient() the first mutation hook added to that page would have
 * crashed every one of those files with "No QueryClient set" -- a failure that
 * says nothing about the page and would have been silenced by editing the
 * baseline, which is the one edit that would have made it worthless.
 *
 * Where a test DOES supply a client (tests/support/queryTestClient.tsx), the
 * context wins, so per-test cache isolation is unaffected.
 */
export function useAppQueryClient(): QueryClient {
  return useContext(QueryClientContext) ?? queryClient;
}

// The single source of cache keys. `as const` is not styling here: it lifts
// QueryKeys' members into the type, so deleting a key someone still uses is a
// TS2339 under tsc. noUnusedLocals cannot see object members, and this is the
// only mechanism standing between here and cascading dead code.
//
// `decks()` is the list, `deck(id)` one row of it, and the first is a PREFIX of
// the second by construction: invalidating ['decks'] reaches ['decks', 7] too,
// which is what a write that changes the collection needs and is why the two
// are not spelled with unrelated roots.
export const QueryKeys = {
  decks: () => ['decks'] as const,
  deck: (id: number) => ['decks', id] as const,
  cards: (deckId: number) => ['cards', deckId] as const,
  // A single card read by id, distinct from the ['cards', deckId] list: the edit
  // page reads one row through ?id= and the update writes it back here, so a save
  // invalidates both this key and the list the card belongs to.
  card: (id: number) => ['card', id] as const,
} as const;
