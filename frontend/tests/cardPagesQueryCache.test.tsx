// @vitest-environment jsdom
//
// The point of moving these four pages onto useDeck/useCards/useCard: the deck
// and the card list are fetched once and then shared, so List -> Edit -> back
// stops downloading the whole deck three times. These cases mount two pages in
// turn against ONE client carrying the application's real defaults (staleTime
// 30s / gcTime 300s), and count the calls that reach the api layer.
//
// One makeAppDefaultsQueryClient() spans both mounts on purpose: a fresh client
// per mount would prove nothing, because the second page could only ever miss a
// cache it does not share.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { Card } from '../src/types/card';
import type { Deck } from '../src/types/deck';
import { makeAppDefaultsQueryClient, renderWithClient } from './support/queryTestClient';
import { ok } from './support/apiResult';
import { signInAsSuperAdmin, signOut } from './support/consoleSession';

const api = vi.hoisted(() => ({
  fetchDeckById: vi.fn(),
  fetchCardsByDeck: vi.fn(),
  fetchCardById: vi.fn(),
  updateCard: vi.fn(),
}));

vi.mock('../src/api/authoring', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/api/authoring')>();
  return { ...actual, ...api };
});

const { CardListPage } = await import('../src/pages/CardListPage');
const { EditCardPage } = await import('../src/pages/EditCardPage');
const { DeckEditPage } = await import('../src/pages/DeckEditPage');

const DECK_ID = 7;
const CARD_ID = 101;
const CARD_QUESTION = 'What does the volatile keyword guarantee?';

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

function card(version: number): Card {
  return {
    id: CARD_ID,
    deckId: DECK_ID,
    stableUid: 'card-volatile',
    question: CARD_QUESTION,
    explanation: 'Visibility, not atomicity.',
    difficulty: 2,
    orderInDeck: 10,
    revision: 1,
    version,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
  } as Card;
}

const listUrl = `/decks/cards?deckId=${DECK_ID}`;
const editUrl = `/decks/cards/edit?deckId=${DECK_ID}&cardId=${CARD_ID}`;
const deckEditUrl = `/decks/edit?deckId=${DECK_ID}`;

beforeEach(() => {
  signOut();
  signInAsSuperAdmin();
  api.fetchDeckById.mockResolvedValue(ok(deck));
  api.fetchCardsByDeck.mockResolvedValue(ok([card(1)]));
  api.fetchCardById.mockResolvedValue(ok(card(1)));
  api.updateCard.mockResolvedValue(ok(card(2)));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  signOut();
});

describe('the card and deck pages share one cache', () => {
  it('does not download the deck again when the edit page opens after the card list', async () => {
    const client = makeAppDefaultsQueryClient();

    renderWithClient(client, <CardListPage />, [listUrl]);
    await screen.findByText(CARD_QUESTION);
    cleanup();

    renderWithClient(client, <EditCardPage />, [editUrl]);
    await screen.findByRole('button', { name: /save changes/i });

    // The deck came from cache the second time, the list was read once by the
    // list page, and the edit page read its single card by id.
    expect(api.fetchDeckById).toHaveBeenCalledTimes(1);
    expect(api.fetchCardsByDeck).toHaveBeenCalledTimes(1);
    expect(api.fetchCardById).toHaveBeenCalledTimes(1);
  });

  it('reads a single card by id on the edit page', async () => {
    const client = makeAppDefaultsQueryClient();

    renderWithClient(client, <EditCardPage />, [editUrl]);
    await screen.findByRole('button', { name: /save changes/i });

    // The edit page reads one card through ?id=, not the whole deck list.
    expect(api.fetchCardById).toHaveBeenCalledWith(CARD_ID);
    expect(api.fetchCardsByDeck).not.toHaveBeenCalled();
  });

  it('counts cards on the deck edit page from the shared cards cache', async () => {
    const client = makeAppDefaultsQueryClient();

    renderWithClient(client, <CardListPage />, [listUrl]);
    await screen.findByText(CARD_QUESTION);
    cleanup();

    renderWithClient(client, <DeckEditPage />, [deckEditUrl]);
    await screen.findByRole('button', { name: 'Save' });

    // The count is the cached list's length, and no second cards request went out.
    await waitFor(() => expect(document.body.textContent).toContain('count = 1'));
    expect(api.fetchCardsByDeck).toHaveBeenCalledTimes(1);
  });

  it('reads the card again after it was saved', async () => {
    const client = makeAppDefaultsQueryClient();

    renderWithClient(client, <EditCardPage />, [editUrl]);
    await screen.findByRole('button', { name: /save changes/i });
    expect(api.fetchCardById).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole('button', { name: /save changes/i }));
    await waitFor(() => expect(api.updateCard).toHaveBeenCalledTimes(1));
    cleanup();

    // The save invalidated ['card', 101], so the next visit re-reads it rather
    // than serving the pre-save copy from the 30s window.
    renderWithClient(client, <EditCardPage />, [editUrl]);
    await screen.findByRole('button', { name: /save changes/i });

    await waitFor(() => expect(api.fetchCardById).toHaveBeenCalledTimes(2));
  });
});
