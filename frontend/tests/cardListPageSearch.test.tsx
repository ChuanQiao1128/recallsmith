// @vitest-environment jsdom
//
// Wiring tests for the CardListPage filter bar. The rules themselves are covered
// by cardListFilter.test.ts; what these prove is that the page feeds its state
// through filterAndSortCards, deferring the query, and renders the result — the
// table, the "Showing N of M" line, the no-match row and the Clear button.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { Card } from '../src/types/card';
import type { Deck } from '../src/types/deck';
import type { ApiResult } from '../src/types/api';
import { renderWithQuery } from './support/queryTestClient';
import { signInAsSuperAdmin, signOut } from './support/consoleSession';

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

const VOLATILE_QUESTION = 'What does the volatile keyword guarantee?';
const GC_QUESTION = 'When does the garbage collector run?';

const cards: Card[] = [
  {
    id: 101,
    deckId: DECK_ID,
    stableUid: 'cs-q-01',
    question: VOLATILE_QUESTION,
    difficulty: 2,
    orderInDeck: 1,
    version: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
  },
  {
    id: 102,
    deckId: DECK_ID,
    stableUid: 'cs-q-02',
    question: GC_QUESTION,
    difficulty: 3,
    orderInDeck: 2,
    version: 1,
    createdAt: '2026-01-03T00:00:00.000Z',
    updatedAt: '2026-01-04T00:00:00.000Z',
  },
];

function ok<T>(data: T): ApiResult<T> {
  return { success: true, data, error: null, traceId: 'trace-ok' };
}

function mount() {
  return renderWithQuery(<CardListPage />, [`/decks/cards?deckId=${DECK_ID}`]);
}

beforeEach(() => {
  signOut();
  signInAsSuperAdmin();
  api.fetchDeckById.mockResolvedValue(ok(deck));
  api.fetchCardsByDeck.mockResolvedValue(ok(cards));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  signOut();
});

describe('the filter bar narrows the card list', () => {
  it('narrows the table to cards matching the search box', async () => {
    mount();
    await screen.findByText(VOLATILE_QUESTION);
    expect(screen.queryByText(GC_QUESTION)).not.toBeNull();

    await userEvent.type(screen.getByLabelText('Search cards'), 'volatile');

    // The value is deferred, so the non-matching row leaves on a later render.
    await waitFor(() => expect(screen.queryByText(GC_QUESTION)).toBeNull());
    expect(screen.queryByText(VOLATILE_QUESTION)).not.toBeNull();
  });

  it('shows how many cards are visible out of the deck total while filtering', async () => {
    mount();
    await screen.findByText(VOLATILE_QUESTION);

    // No count line before a filter is active.
    expect(screen.queryByTestId('card-list-visible-count')).toBeNull();

    await userEvent.type(screen.getByLabelText('Search cards'), 'volatile');

    await waitFor(() =>
      expect(screen.getByTestId('card-list-visible-count').textContent).toBe(
        'Showing 1 of 2 cards',
      ),
    );
  });

  it('says no cards match instead of claiming the deck is empty', async () => {
    mount();
    await screen.findByText(VOLATILE_QUESTION);

    await userEvent.type(screen.getByLabelText('Search cards'), 'nothingmatchesthis');

    await waitFor(() => expect(screen.queryByText('No cards match these filters.')).not.toBeNull());
    // The empty-deck sentence must not appear for a deck that does have cards.
    expect(
      screen.queryByText('No cards yet. Click "New Card" to add the first one.'),
    ).toBeNull();
  });

  it('clears every filter with one button', async () => {
    mount();
    await screen.findByText(VOLATILE_QUESTION);

    await userEvent.type(screen.getByLabelText('Search cards'), 'volatile');
    await waitFor(() => expect(screen.queryByText(GC_QUESTION)).toBeNull());

    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }));

    await waitFor(() => expect(screen.queryByText(GC_QUESTION)).not.toBeNull());
    expect((screen.getByLabelText('Search cards') as HTMLInputElement).value).toBe('');
    expect(screen.queryByTestId('card-list-visible-count')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull();
  });
});
