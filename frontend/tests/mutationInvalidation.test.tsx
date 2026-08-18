// @vitest-environment jsdom
//
// Every write says what it changed.
//
// This is the assertion the console did not have, and its absence is what
// forced the read hooks to be pinned at staleTime 0: a card created on one page
// could not tell the list on another that it was out of date, so the only safe
// cache was no cache. Six mutations now invalidate the keys they affect, which
// is what makes raising a staleTime a decision somebody may make rather than a
// regression waiting for a volunteer.
//
// WHAT IS ASSERTED, and why it is the queryClient and not the screen: the
// invalidation has no visible effect today, precisely because the defaults are
// still conservative — invalidating a key nothing is observing is a no-op, and
// the next mount would have refetched anyway. A screen-level test would
// therefore pass with every invalidateQueries call deleted. The call itself is
// the contract here, so the call is what is watched.
//
// The negative half matters just as much. mutationFn deliberately does not
// throw on a refusal (see useDeleteCard), which means onSuccess runs for
// refusals too — so "invalidate on success" and "invalidate whenever the
// request completes" are two different implementations that both look right,
// and only the second one throws away a good cache because the server said no.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import type { Card } from '../src/types/card';
import type { Deck } from '../src/types/deck';
import { makeTestQueryClient } from './support/queryTestClient';
import { ok, refused } from './support/apiResult';
import { signInAsSuperAdmin, signOut } from './support/consoleSession';

const api = vi.hoisted(() => ({
  createCard: vi.fn(),
  updateCard: vi.fn(),
  deleteCard: vi.fn(),
  createDeck: vi.fn(),
  updateDeck: vi.fn(),
  deleteDeck: vi.fn(),
  publishDeck: vi.fn(),
}));

vi.mock('../src/api/authoring', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/api/authoring')>();
  return { ...actual, ...api };
});

const hooks = await import('../src/hooks');
const { queryClient: appQueryClient, useAppQueryClient } = await import('../src/api/queryClient');

const DECK_ID = 7;
const CARD_ID = 101;

const DECK_LIST_KEY = ['decks'];
const DECK_ROW_KEY = ['decks', DECK_ID];
const CARDS_KEY = ['cards', DECK_ID];

const card = { id: CARD_ID, deckId: DECK_ID, question: 'q' } as Card;
const deck = { id: DECK_ID, slug: 'csharp-fundamentals', title: 'C#' } as Deck;

let client: QueryClient;
let invalidate: ReturnType<typeof vi.spyOn>;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/** The queryKeys handed to invalidateQueries during this test, in call order. */
function invalidatedKeys(): unknown[] {
  // Annotated because vi.spyOn types the recorded arguments as `any`, and this
  // project compiles tests/ under noImplicitAny.
  return invalidate.mock.calls.map((call: unknown[]) => (call[0] as { queryKey?: unknown }).queryKey);
}

beforeEach(() => {
  signOut();
  signInAsSuperAdmin();
  client = makeTestQueryClient();
  invalidate = vi.spyOn(client, 'invalidateQueries');
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  signOut();
});

describe('a card that was written', () => {
  it('invalidates the list it belongs to when it is created', async () => {
    api.createCard.mockResolvedValue(ok(card));

    const { result } = renderHook(() => hooks.useCreateCard(), { wrapper });
    await result.current.mutateAsync({ deckId: DECK_ID, question: 'q' });

    await waitFor(() => expect(invalidatedKeys()).toEqual([CARDS_KEY]));
  });

  it('invalidates it when it is updated', async () => {
    api.updateCard.mockResolvedValue(ok(card));

    const { result } = renderHook(() => hooks.useUpdateCard(), { wrapper });
    await result.current.mutateAsync({ id: CARD_ID, deckId: DECK_ID, question: 'q2' });

    await waitFor(() => expect(invalidatedKeys()).toEqual([CARDS_KEY]));
  });

  it('is removed from the cached list by name when it is deleted, without a refetch', async () => {
    // The one write that does not invalidate, and the asymmetry is the point: a
    // delete is the only one whose result the client can compute exactly, so
    // refetching would spend a request to confirm something already confirmed
    // and would flash the deleted row back onto the screen while it was in
    // flight.
    api.deleteCard.mockResolvedValue(ok(null));
    client.setQueryData<Card[]>(CARDS_KEY, [card]);

    const { result } = renderHook(() => hooks.useDeleteCard(), { wrapper });
    await result.current.mutateAsync({ cardId: CARD_ID, deckId: DECK_ID });

    await waitFor(() => expect(client.getQueryData<Card[]>(CARDS_KEY)).toEqual([]));
    expect(invalidatedKeys()).toEqual([]);
  });
});

describe('a deck that was written', () => {
  it('invalidates the collection when one is created', async () => {
    api.createDeck.mockResolvedValue(ok(deck));

    const { result } = renderHook(() => hooks.useCreateDeck(), { wrapper });
    await result.current.mutateAsync({ title: 'C#' });

    await waitFor(() => expect(invalidatedKeys()).toEqual([DECK_LIST_KEY]));
  });

  it('invalidates the row and the collection when one is updated', async () => {
    api.updateDeck.mockResolvedValue(ok(deck));

    const { result } = renderHook(() => hooks.useUpdateDeck(), { wrapper });
    await result.current.mutateAsync({ id: DECK_ID, params: { title: 'C# 2' } });

    // Both, and in this order: the row is what the editor was looking at, the
    // collection is what everything else reads.
    await waitFor(() => expect(invalidatedKeys()).toEqual([DECK_ROW_KEY, DECK_LIST_KEY]));
  });

  it('invalidates both when one is deleted', async () => {
    api.deleteDeck.mockResolvedValue(ok(null));

    const { result } = renderHook(() => hooks.useDeleteDeck(), { wrapper });
    await result.current.mutateAsync({ id: DECK_ID });

    await waitFor(() => expect(invalidatedKeys()).toEqual([DECK_ROW_KEY, DECK_LIST_KEY]));
  });

  it('invalidates the collection when one is published', async () => {
    api.publishDeck.mockResolvedValue(ok({ mode: 'async', jobId: 'job-1' }));

    const { result } = renderHook(() => hooks.usePublishDeck(), { wrapper });
    await result.current.mutateAsync({ id: DECK_ID });

    await waitFor(() => expect(invalidatedKeys()).toEqual([DECK_LIST_KEY]));
  });

  it('publishes with the id alone, so the note stays a thing nobody sends', async () => {
    // publishDeck's second parameter is optional and no console screen collects
    // one. Forwarding `undefined` would turn publishDeck(11) into
    // publishDeck(11, undefined) — the same request and a different call, which
    // is exactly the difference three existing assertions are written against.
    api.publishDeck.mockResolvedValue(ok({ mode: 'async', jobId: 'job-1' }));

    const { result } = renderHook(() => hooks.usePublishDeck(), { wrapper });
    await result.current.mutateAsync({ id: DECK_ID });

    expect(api.publishDeck).toHaveBeenCalledWith(DECK_ID);
  });
});

describe('a write the server refused', () => {
  // mutationFn returns the ApiResult rather than throwing, so react-query calls
  // this a success and onSuccess runs. Every one of these would invalidate if
  // the success check were dropped, which is the mutation this block exists for.
  it('invalidates nothing after a refused create', async () => {
    api.createCard.mockResolvedValue(refused<Card>('DUPLICATE_UID', 'That uid is taken.'));

    const { result } = renderHook(() => hooks.useCreateCard(), { wrapper });
    await result.current.mutateAsync({ deckId: DECK_ID, question: 'q' });

    expect(invalidatedKeys()).toEqual([]);
  });

  it('invalidates nothing after a refused deck update', async () => {
    api.updateDeck.mockResolvedValue(refused<Deck>('CONFLICT', 'Someone else saved first.'));

    const { result } = renderHook(() => hooks.useUpdateDeck(), { wrapper });
    await result.current.mutateAsync({ id: DECK_ID, params: { title: 'C# 2' } });

    expect(invalidatedKeys()).toEqual([]);
  });

  it('leaves the cached card list alone after a refused delete', async () => {
    api.deleteCard.mockResolvedValue(refused<null>('FORBIDDEN', 'Not allowed.'));
    client.setQueryData<Card[]>(CARDS_KEY, [card]);

    const { result } = renderHook(() => hooks.useDeleteCard(), { wrapper });
    await result.current.mutateAsync({ cardId: CARD_ID, deckId: DECK_ID });

    expect(client.getQueryData<Card[]>(CARDS_KEY)).toEqual([card]);
  });
});

describe('which QueryClient a mutation writes to', () => {
  it('is the one the provider supplies, when there is a provider', async () => {
    const { result } = renderHook(() => useAppQueryClient(), { wrapper });
    expect(result.current).toBe(client);
    expect(result.current).not.toBe(appQueryClient);
  });

  it('is the application singleton when a component is mounted bare', () => {
    // This is what lets a page that grew a mutation keep rendering inside test
    // files that predate the data layer and mount it under nothing but a
    // router — tests/deckListPagePolling.test.tsx above all, which is the
    // untouched baseline for the publish-jobs timer. Without it the first
    // mutation added to DeckListPage would have thrown "No QueryClient set"
    // there, and the only cheap way out would have been editing the baseline.
    //
    // It is not a second cache: src/main.tsx wraps the running application in a
    // provider carrying this very object, so in the browser the two branches
    // return the same client.
    const { result } = renderHook(() => useAppQueryClient());
    expect(result.current).toBe(appQueryClient);
  });
});
