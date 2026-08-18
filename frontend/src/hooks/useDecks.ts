import { useMutation, useQuery } from '@tanstack/react-query';
import {
  createDeck,
  deleteDeck,
  fetchDeckById,
  publishDeck,
  updateDeck,
} from '../api/authoring';
import { apiFailure, ApiFailureError, NOT_FOUND } from '../api/errors';
import { QueryKeys, useAppQueryClient } from '../api/queryClient';
import { clearSessionCaches } from '../lib/sessionCache';
import type { Deck } from '../types/deck';

// The read options this hook still states for itself are down to one, and that
// is the point of the change that emptied the rest: the shared client's
// defaults in src/api/queryClient.ts now describe the conservative behaviour
// these hooks used to have to override line by line. Repeating staleTime 0,
// gcTime 0, retry false and refetchOnWindowFocus false here would restate the
// default and, worse, would keep the tests that check them
// (tests/cardListPageQueryWiring.test.tsx, "fetching still behaves the way it
// did before react-query") green against a regression in the default -- an
// override is invisible to a test if the thing it overrides is already right.
//
// networkMode stays written out because the plan for this step named it as
// load-bearing, and because it is the one setting whose absence produces a
// spinner rather than a wrong number: see the comment on the default.
export function useDeck(id: number) {
  return useQuery({
    queryKey: QueryKeys.deck(id),
    queryFn: async (): Promise<Deck> => {
      const res = await fetchDeckById(id);

      // The fallback wording follows the page. With !success and no server
      // message the page already shows 'Deck not found.', so throwing any other
      // string would give one kind of failure two different sentences.
      if (!res.success) throw apiFailure(res, 'Deck not found.');

      // A 200 carrying no deck is a deck that is not there, and it is thrown
      // rather than returned as null.
      //
      // Returning null was the older shape, and it forced the page to work out
      // "not found" by elimination: data === null after a query that did not
      // error. That reads as a missing-value check, so it survives every
      // refactor that tightens the type, and it cannot carry a code or a trace
      // id because a null has nowhere to put them. Throwing puts both kinds of
      // absence -- the server said no, and the server said yes but sent
      // nothing -- into one channel the page can branch on.
      if (!res.data) {
        throw new ApiFailureError('Deck not found.', NOT_FOUND, res.traceId ?? '');
      }

      return res.data;
    },
    // The predicate is CardListPage's parseDeckId rule: only 0 and NaN skip the
    // request. Negatives and fractions still go out, because they went out
    // before the migration -- deckId=-5 gets the server's 404 wording today,
    // and tightening this to id > 0 would turn that into a spinner that never
    // stops. Kept here as well as in the caller: this is a public hook and the
    // next caller may not have parsed anything.
    enabled: !Number.isNaN(id) && id !== 0,
    networkMode: 'always',
  });
}

// ---------------------------------------------------------------------------
// Writes.
//
// Every mutation below follows the shape useDeleteCard established, and the
// reason it is worth copying is in the comment there: mutationFn returns the
// ApiResult and does NOT throw on !success, so "the server understood this and
// refused it" and "the request never came back" stay two different things all
// the way to the page, which owes them opposite advice. onSuccess therefore
// runs for refusals too, and each one re-checks `success` before touching the
// cache.
//
// The invalidations are the point of routing these writes through react-query
// at all. Until now a card created on one page could not tell the deck list on
// another that it was out of date, which is precisely why the read hooks had to
// be pinned to staleTime 0 -- the console was one page's write away from
// showing a stale list with no way to notice. Wiring the invalidation is what
// makes raising a staleTime a decision somebody may now make, rather than a
// regression waiting for a volunteer.
// ---------------------------------------------------------------------------

type CreateDeckParams = Parameters<typeof createDeck>[0];
type UpdateDeckParams = Parameters<typeof updateDeck>[1];

export function useCreateDeck() {
  const queryClient = useAppQueryClient();

  return useMutation(
    {
      mutationFn: async (params: CreateDeckParams) => createDeck(params),
      onSuccess: result => {
        if (!result.success) return;
        // The collection gained a member. ['decks'] is a prefix of every
        // ['decks', id], so this reaches the row queries too.
        void queryClient.invalidateQueries({ queryKey: QueryKeys.decks() });
        clearSessionCaches();
      },
    },
    queryClient,
  );
}

export function useUpdateDeck() {
  const queryClient = useAppQueryClient();

  return useMutation(
    {
      mutationFn: async ({ id, params }: { id: number; params: UpdateDeckParams }) => {
        const result = await updateDeck(id, params);
        return { result, id };
      },
      onSuccess: ({ result, id }) => {
        if (!result.success) return;
        void queryClient.invalidateQueries({ queryKey: QueryKeys.deck(id) });
        void queryClient.invalidateQueries({ queryKey: QueryKeys.decks() });
        clearSessionCaches();
      },
    },
    queryClient,
  );
}

export function useDeleteDeck() {
  const queryClient = useAppQueryClient();

  return useMutation(
    {
      mutationFn: async ({ id }: { id: number }) => {
        const result = await deleteDeck(id);
        return { result, id };
      },
      onSuccess: ({ result, id }) => {
        if (!result.success) return;
        void queryClient.invalidateQueries({ queryKey: QueryKeys.deck(id) });
        void queryClient.invalidateQueries({ queryKey: QueryKeys.decks() });
        // The hand-rolled localStorage list is the copy that would otherwise
        // keep showing the deleted deck for five minutes, on the one path
        // (legacy, non-superadmin) that reads it.
        clearSessionCaches();
      },
    },
    queryClient,
  );
}

export function usePublishDeck() {
  const queryClient = useAppQueryClient();

  return useMutation(
    {
      // publishDeck also takes an optional note, and this deliberately does not
      // forward one: nothing in the console collects a note, so a `note`
      // variable here would be a parameter no caller can fill. It would also
      // change the call from publishDeck(id) to publishDeck(id, undefined),
      // which is a different call as far as every assertion about this
      // function's arguments is concerned.
      mutationFn: async ({ id }: { id: number }) => publishDeck(id),
      onSuccess: result => {
        if (!result.success) return;
        void queryClient.invalidateQueries({ queryKey: QueryKeys.decks() });
        clearSessionCaches();
      },
    },
    queryClient,
  );
}
