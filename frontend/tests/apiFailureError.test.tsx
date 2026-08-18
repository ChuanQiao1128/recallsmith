// @vitest-environment jsdom
//
// What a failed read carries, and what the page does with it.
//
// Before this, both read hooks threw `new Error(res.error?.message ?? '...')`.
// That is a lossy conversion of a three-field answer into one field, and the
// two fields it dropped are the two a caller can act on:
//
//   code     the only thing that separates "this deck does not exist" from
//            "something went wrong reading this deck". CardListPage needed that
//            distinction and, having no code, reconstructed it from the shape
//            of the success payload instead — `data === null` after a query
//            that did not error. That inference reads like a defensive null
//            check, so it survives every refactor that makes the type stricter,
//            and it cannot tell a missing deck from a hook that returned the
//            wrong thing.
//   traceId  the only string on the failure screen a server log can be searched
//            for.
//
// The two halves below are the unit (what apiFailure builds) and the page (what
// the user is shown as a result). The page half is where the code earns its
// keep: the retry button is offered for a failure that might come out
// differently and withheld for one that cannot.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ApiFailureError, apiFailure, NOT_FOUND, UNKNOWN_CODE } from '../src/api/errors';
import type { ApiResult } from '../src/types/api';
import type { Card } from '../src/types/card';
import type { Deck } from '../src/types/deck';
import { renderWithQuery } from './support/queryTestClient';
import { ok, refused } from './support/apiResult';
import { signInAsSuperAdmin, signOut } from './support/consoleSession';

const api = vi.hoisted(() => ({
  fetchDeckById: vi.fn(),
  fetchCardsByDeck: vi.fn(),
}));

vi.mock('../src/api/authoring', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/api/authoring')>();
  return { ...actual, ...api };
});

const { CardListPage } = await import('../src/pages/CardListPage');

const DECK_ID = 7;

const deck: Deck = {
  id: DECK_ID,
  slug: 'csharp-fundamentals',
  title: 'C# Fundamentals',
  author: 'console-tests',
  locale: 'en',
  deckType: 1,
  version: 3,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
};

function mount() {
  return renderWithQuery(<CardListPage />, [`/decks/cards?deckId=${DECK_ID}`]);
}

beforeEach(() => {
  signOut();
  signInAsSuperAdmin();
  api.fetchDeckById.mockResolvedValue(ok(deck));
  api.fetchCardsByDeck.mockResolvedValue(ok<Card[]>([]));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  signOut();
});

describe('the error a refused read turns into', () => {
  it('keeps all three fields the server sent', () => {
    const result: ApiResult<Deck> = {
      success: false,
      data: null,
      error: { code: 'DECK_ARCHIVED', message: 'Deck 7 has been archived.' },
      traceId: 'trace-archived',
    };

    const err = apiFailure(result, 'Deck not found.');

    expect(err).toBeInstanceOf(ApiFailureError);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('Deck 7 has been archived.');
    expect(err.code).toBe('DECK_ARCHIVED');
    expect(err.traceId).toBe('trace-archived');
  });

  it('falls back to the caller sentence, and says the code is unknown', () => {
    // A refusal with no error object at all. The fallback message belongs to the
    // caller because each read path already has the sentence its page shows; a
    // house string invented here would give one failure two wordings depending
    // on which layer noticed it.
    const err = apiFailure(
      { success: false, data: null, error: null, traceId: 't-1' },
      'Deck not found.',
    );

    expect(err.message).toBe('Deck not found.');
    expect(err.code).toBe(UNKNOWN_CODE);
    expect(err.traceId).toBe('t-1');
  });

  it('is identifiable by name once it has been logged or serialised', () => {
    const err = new ApiFailureError('nope', 'SOME_CODE', '');
    expect(err.name).toBe('ApiFailureError');
    expect(String(err)).toContain('ApiFailureError');
  });
});

describe('what the page shows for a failure it might recover from', () => {
  it('prints the trace id the server stamped on the request', async () => {
    api.fetchDeckById.mockResolvedValue({
      success: false,
      data: null,
      error: { code: 'DECK_ARCHIVED', message: 'Deck 7 has been archived.' },
      traceId: 'trace-archived',
    } satisfies ApiResult<Deck>);

    mount();

    expect(await screen.findByText('Deck 7 has been archived.')).not.toBeNull();
    // Not the message, and not a decoration: it is the one value on this screen
    // that connects what the user is looking at to a line in the server log.
    expect(screen.getByText('Trace trace-archived')).not.toBeNull();
  });

  it('offers a retry, and the retry actually re-asks', async () => {
    api.fetchDeckById.mockResolvedValue(
      refused<Deck>('UPSTREAM_TIMEOUT', 'The deck service did not answer.'),
    );

    mount();
    await screen.findByText('The deck service did not answer.');
    expect(api.fetchDeckById).toHaveBeenCalledTimes(1);

    api.fetchDeckById.mockResolvedValue(ok(deck));
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));

    // The proof is the second request plus the page recovering, not the button
    // existing: a button that renders and refetches nothing looks identical.
    await waitFor(() => expect(api.fetchDeckById).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('Card List')).not.toBeNull();
  });

  it('offers it for a cards failure too, since the deck was fine', async () => {
    api.fetchCardsByDeck.mockResolvedValue(
      refused<Card[]>('UPSTREAM_TIMEOUT', 'The card service did not answer.'),
    );

    mount();
    await screen.findByText('The card service did not answer.');
    expect(screen.getByRole('button', { name: 'Try again' })).not.toBeNull();
  });
});

describe('what the page shows for a deck that is not there', () => {
  it('withholds the retry when the server said NOT_FOUND', async () => {
    api.fetchDeckById.mockResolvedValue(
      refused<Deck>(NOT_FOUND, 'Deck 7 does not exist.'),
    );

    mount();

    expect(await screen.findByText('Deck 7 does not exist.')).not.toBeNull();
    // Pressing it would send the identical request and get the identical
    // answer. An offer that cannot change anything teaches people to press it
    // at every failure, including the ones where it would have helped.
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('withholds it for a 200 that carried no deck, which is the same situation', async () => {
    // This is the case that used to be inferred from `data === null`. The hook
    // now throws it as NOT_FOUND, so the page reaches the same conclusion by
    // reading a code rather than by reasoning about an absent value.
    api.fetchDeckById.mockResolvedValue(ok<Deck | null>(null));

    mount();

    expect(await screen.findByText('Deck not found.')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('says nothing about a trace when there is not one', async () => {
    // networkFailure's shape: the transport threw, so there is no server trace
    // to quote. Printing "Trace " with nothing after it would be worse than
    // silence.
    api.fetchDeckById.mockResolvedValue({
      success: false,
      data: null,
      error: { code: 'NETWORK_ERROR', message: 'Network error.' },
      traceId: '',
    } satisfies ApiResult<Deck>);

    mount();

    await screen.findByText('Network error.');
    expect(screen.queryByText(/^Trace/)).toBeNull();
  });
});
