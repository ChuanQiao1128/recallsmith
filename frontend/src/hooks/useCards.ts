import { useMutation, useQuery } from '@tanstack/react-query';
import { createCard, deleteCard, fetchCardById, fetchCardsByDeck, updateCard } from '../api/authoring';
import { apiFailure } from '../api/errors';
import { QueryKeys, useAppQueryClient } from '../api/queryClient';
import type { Card } from '../types/card';

// The options match useDeck one for one; the reasoning is in the block above
// useDeck in useDecks.ts, and the reasoning for the ones that are no longer
// written out is in src/api/queryClient.ts.
//
// The second argument to useQuery is the app singleton, resolved the same way
// the mutation hooks resolve it: a page mounted bare (no provider) still reads
// and writes the one cache the writes invalidate, instead of a private one no
// mutation can reach.
export function useCards(deckId: number) {
  return useQuery(
    {
      queryKey: QueryKeys.cards(deckId),
      queryFn: async () => {
        const res = await fetchCardsByDeck(deckId);
        // 'Failed to load cards.' is the page's own wording today. This hook used
        // to throw 'Failed to fetch cards', which would have quietly changed the
        // sentence the user reads the moment it was wired in.
        if (!res.success) throw apiFailure(res, 'Failed to load cards.');
        return res.data ?? [];
      },
      enabled: !Number.isNaN(deckId) && deckId !== 0,
      // See useDeck: the default networkMode 'online' does not run the queryFn
      // while the browser reports itself offline, status parks at 'pending', and
      // the page spins forever.
      networkMode: 'always',
    },
    useAppQueryClient(),
  );
}

/**
 * One card, read by id through `?id=`.
 *
 * Keyed by QueryKeys.card so a save can invalidate it, and enabled only for a
 * usable id: 0, NaN and negatives never go out, because the id comes from a URL
 * and a missing one must not fire a request that the server would 404 anyway.
 */
export function useCard(cardId: number) {
  return useQuery(
    {
      queryKey: QueryKeys.card(cardId),
      queryFn: async () => {
        const res = await fetchCardById(cardId);
        if (!res.success) throw apiFailure(res, 'Card not found.');
        return res.data as Card;
      },
      enabled: Number.isFinite(cardId) && cardId > 0,
      networkMode: 'always',
    },
    useAppQueryClient(),
  );
}

type CreateCardParams = Parameters<typeof createCard>[0];
type UpdateCardParams = Parameters<typeof updateCard>[0];

export function useCreateCard() {
  const queryClient = useAppQueryClient();

  return useMutation(
    {
      // Deliberately does NOT throw on !success, for the reason spelled out on
      // useDeleteCard below.
      mutationFn: async (params: CreateCardParams) => {
        const result = await createCard(params);
        return { result, deckId: params.deckId };
      },
      onSuccess: ({ result, deckId }) => {
        if (!result.success) return;
        // The list this card belongs to is now short by one. Invalidated
        // rather than appended to: the server assigns the id, the timestamps
        // and possibly a different orderInDeck, so the authoritative row is the
        // one the next read returns, not the one this page composed.
        void queryClient.invalidateQueries({ queryKey: QueryKeys.cards(deckId) });
      },
    },
    queryClient,
  );
}

export function useUpdateCard() {
  const queryClient = useAppQueryClient();

  return useMutation(
    {
      mutationFn: async (params: UpdateCardParams) => {
        const result = await updateCard(params);
        return { result, deckId: params.deckId, id: params.id };
      },
      onSuccess: ({ result, deckId, id }) => {
        if (!result.success) return;
        void queryClient.invalidateQueries({ queryKey: QueryKeys.cards(deckId) });
        // The single-card cache the edit page reads is now stale too: its version
        // and content just changed. Invalidating it keeps a later ?id= read from
        // serving the pre-save row inside the staleTime window.
        void queryClient.invalidateQueries({ queryKey: QueryKeys.card(id) });
      },
    },
    queryClient,
  );
}

export function useDeleteCard() {
  const queryClient = useAppQueryClient();

  return useMutation(
    {
      // Deliberately does NOT throw on !success.
      //
      // Throwing would flatten "the server understood this request and refused it"
      // and "the request never came back" into one Error channel, and the advice
      // those two owe the user is opposite: the first is safe to retry because
      // nothing changed; the second needs a reload before touching anything,
      // because the write may already have landed. Returning the ApiResult
      // verbatim is the only shape that keeps the two apart. A network failure
      // still rejects on its own and lands in the caller's catch.
      mutationFn: async ({ cardId, deckId }: { cardId: number; deckId: number }) => {
        const result = await deleteCard(cardId);
        return { result, cardId, deckId };
      },
      onSuccess: ({ result, cardId, deckId }) => {
        // Since mutationFn no longer throws, onSuccess also runs when the server
        // refused the delete.
        if (!result.success) return;

        // Removed in place rather than by invalidateQueries. Invalidating refetches
        // the list immediately and puts the just-deleted row back on screen
        // according to the server's next answer. The page's semantics today are
        // cards.filter(c => c.id !== cardId); setQueryData matches that word for
        // word, and does not spend a request confirming something already
        // confirmed.
        //
        // This is the one write that does not invalidate, and the asymmetry is
        // deliberate: a delete is the only one of the four whose result the
        // client can compute exactly. A create gets its id from the server and
        // an update may be reshaped by it.
        queryClient.setQueryData<Card[]>(QueryKeys.cards(deckId), prev =>
          prev === undefined ? prev : prev.filter(c => c.id !== cardId),
        );

        // The single-card cache is a copy of a row that no longer exists, so it
        // is dropped rather than invalidated: there is nothing to refetch, and a
        // ?id= read of a deleted card is the server's 404 to give, not a stale
        // hit to serve.
        queryClient.removeQueries({ queryKey: QueryKeys.card(cardId) });
      },
    },
    queryClient,
  );
}
