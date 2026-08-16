// @vitest-environment jsdom
//
// A characterization test for the one invariant that a data-layer migration is
// most likely to drop silently: an abandoned request must not repaint the page.
//
// Written and made green against the pre-migration CardListPage, which defends
// this by hand in two places — a `cancelled` flag captured by the fetch effect,
// and a `state.deckId !== deckId` comparison that keeps the loading screen up
// until the state belongs to the deck currently in the URL. Both disappear when
// the page reads through useQuery, and the guarantee moves into the query key.
//
// If this had been written after the migration, a green run would only have
// proved the new code agrees with itself. Written first, it proves the two
// implementations agree with each other.
//
// The mutations it is built to fail against, both in the pre-migration page:
//
//   1. dropping the `cancelled` guard, so the slow deck-7 response overwrites
//      the deck-8 view the user is already looking at.
//   2. dropping the `state.deckId !== deckId` comparison, so the page shows
//      deck 7's rows under deck 8's URL.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useNavigate } from 'react-router-dom';

import type { Card } from '../src/types/card';
import type { Deck } from '../src/types/deck';
import type { ApiResult } from '../src/types/api';
import { renderWithQuery } from './support/queryTestClient';
import { signOut } from './support/consoleSession';

const api = vi.hoisted(() => ({
  fetchDeckById: vi.fn(),
  fetchCardsByDeck: vi.fn(),
  deleteCard: vi.fn(),
}));

vi.mock('../src/api/authoring', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/api/authoring')>();
  return { ...actual, ...api };
});

const { CardListPage } = await import('../src/pages/CardListPage');

const DECK_SLOW = 7;
const DECK_FAST = 8;
const QUESTION_SLOW = 'Which deck did the user navigate away from?';
const QUESTION_FAST = 'Which deck is in the address bar right now?';

function makeDeck(id: number, slug: string): Deck {
  return {
    id,
    slug,
    title: `Deck ${id}`,
    author: 'console-tests',
    locale: 'en',
    deckType: 1,
    version: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
  };
}

function makeCard(id: number, deckId: number, question: string): Card {
  return {
    id,
    deckId,
    stableUid: `card-${id}`,
    question,
    difficulty: 2,
    orderInDeck: 1,
    version: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
  };
}

function ok<T>(data: T): ApiResult<T> {
  return { success: true, data, error: null, traceId: 'trace-ok' };
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

/**
 * A promise this test resolves by hand. Real timing control, not fake timers:
 * the ordering under test is "which response comes back second", which has
 * nothing to do with the clock and everything to do with the network.
 */
function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>(res => {
    resolve = res;
  });
  return { promise, resolve };
}

/** Lets the test change the deckId in the URL the way a link would. */
function Harness() {
  const navigate = useNavigate();
  return (
    <>
      <button type="button" onClick={() => navigate(`/decks/cards?deckId=${DECK_FAST}`)}>
        open the other deck
      </button>
      <CardListPage />
    </>
  );
}

/** Let every already-resolved promise and its follow-on renders settle. */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  signOut();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  signOut();
});

describe('a response for a deck the user already left', () => {
  it('does not replace the deck that is actually in the URL', async () => {
    const slowDeck = deferred<ApiResult<Deck>>();
    const slowCards = deferred<ApiResult<Card[]>>();
    const fastDeck = deferred<ApiResult<Deck>>();
    const fastCards = deferred<ApiResult<Card[]>>();

    api.fetchDeckById.mockImplementation((id: number) =>
      id === DECK_SLOW ? slowDeck.promise : fastDeck.promise,
    );
    api.fetchCardsByDeck.mockImplementation((id: number) =>
      id === DECK_SLOW ? slowCards.promise : fastCards.promise,
    );

    renderWithQuery(<Harness />, [`/decks/cards?deckId=${DECK_SLOW}`]);

    // Deck 7's two requests are in flight and neither has answered.
    await waitFor(() => expect(api.fetchDeckById).toHaveBeenCalledWith(DECK_SLOW));
    expect(api.fetchCardsByDeck).toHaveBeenCalledWith(DECK_SLOW);
    expect(screen.queryByText('Loading cards...')).not.toBeNull();

    // The user moves on before deck 7 answers.
    await userEvent.click(screen.getByRole('button', { name: 'open the other deck' }));
    await waitFor(() => expect(api.fetchDeckById).toHaveBeenCalledWith(DECK_FAST));

    // Deck 8 answers first, so deck 8 is what the user is reading.
    await act(async () => {
      fastDeck.resolve(ok(makeDeck(DECK_FAST, 'deck-fast')));
      fastCards.resolve(ok([makeCard(802, DECK_FAST, QUESTION_FAST)]));
    });
    await screen.findByText(QUESTION_FAST);

    // Only now does the abandoned deck-7 request come back.
    await act(async () => {
      slowDeck.resolve(ok(makeDeck(DECK_SLOW, 'deck-slow')));
      slowCards.resolve(ok([makeCard(701, DECK_SLOW, QUESTION_SLOW)]));
    });
    await settle();

    // The stale answer changed nothing: not the rows, not the header, and not
    // back into a loading screen either. A page that flips to "Loading cards..."
    // here has lost the race in the less obvious direction.
    expect(screen.queryByText(QUESTION_SLOW)).toBeNull();
    expect(screen.queryByText('deck-slow')).toBeNull();
    expect(screen.queryByText(QUESTION_FAST)).not.toBeNull();
    expect(screen.queryByText('deck-fast')).not.toBeNull();
    expect(screen.queryByText('Loading cards...')).toBeNull();
  });
});

describe('the rows on screen always belong to the deck in the URL', () => {
  it('shows the loading screen, not the old deck, while the new one loads', async () => {
    const fastDeck = deferred<ApiResult<Deck>>();
    const fastCards = deferred<ApiResult<Card[]>>();

    api.fetchDeckById.mockImplementation((id: number) =>
      id === DECK_SLOW
        ? Promise.resolve(ok(makeDeck(DECK_SLOW, 'deck-slow')))
        : fastDeck.promise,
    );
    api.fetchCardsByDeck.mockImplementation((id: number) =>
      id === DECK_SLOW
        ? Promise.resolve(ok([makeCard(701, DECK_SLOW, QUESTION_SLOW)]))
        : fastCards.promise,
    );

    renderWithQuery(<Harness />, [`/decks/cards?deckId=${DECK_SLOW}`]);

    // Deck 7 is fully loaded and on screen.
    await screen.findByText(QUESTION_SLOW);

    // Now the URL says deck 8, and deck 8 has not answered yet.
    await userEvent.click(screen.getByRole('button', { name: 'open the other deck' }));
    await waitFor(() => expect(api.fetchDeckById).toHaveBeenCalledWith(DECK_FAST));
    await settle();

    // Deck 7's rows under deck 8's URL is the wrong answer confidently
    // presented: everything on screen — the header, the count, the Edit links —
    // now points at a deck the user is no longer looking at.
    expect(screen.queryByText(QUESTION_SLOW)).toBeNull();
    expect(screen.queryByText('deck-slow')).toBeNull();
    expect(screen.queryByText('Loading cards...')).not.toBeNull();

    // Drain the deck-8 request so the test leaves nothing pending behind it.
    await act(async () => {
      fastDeck.resolve(ok(makeDeck(DECK_FAST, 'deck-fast')));
      fastCards.resolve(ok([makeCard(802, DECK_FAST, QUESTION_FAST)]));
    });
    await screen.findByText(QUESTION_FAST);
  });
});
