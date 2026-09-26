// @vitest-environment jsdom
//
// The other half of the cleared-field rule, driven through the real forms: a
// field a user empties must reach the api layer as '' (a present key), not as
// undefined (a key the api layer drops, which leaves the old value in the row).
// The pure rule is in authoringBodies.test.ts; here it is the page -> function
// wiring on the three surfaces an author actually clears a field from.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

import type { Deck } from '../src/types/deck';
import type { Card } from '../src/types/card';
import type { ApiResult } from '../src/types/api';
import { signInAsSuperAdmin, signOut } from './support/consoleSession';
import { renderAt } from './support/routerProbe';

const api = vi.hoisted(() => ({
  fetchDeckById: vi.fn(),
  fetchCardsByDeck: vi.fn(),
  updateCard: vi.fn(),
  updateDeck: vi.fn(),
}));

vi.mock('../src/api/authoring', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/api/authoring')>();
  return { ...actual, ...api };
});

const { EditCardPage } = await import('../src/pages/EditCardPage');
const { DeckEditPage } = await import('../src/pages/DeckEditPage');

const DECK_ID = 7;

function ok<T>(data: T): ApiResult<T> {
  return { success: true, data, error: null, traceId: 'trace-ok' };
}

const deck: Deck = {
  id: DECK_ID,
  slug: 'csharp-fundamentals',
  title: 'C# Fundamentals',
  author: 'console-tests',
  description: 'Interview prep',
  locale: 'en-US',
  deckType: 1,
  version: 3,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
};

function card(over: Partial<Card> = {}): Card {
  return {
    id: 101,
    deckId: DECK_ID,
    stableUid: 'cs-volatile-001',
    question: 'What does volatile guarantee?',
    explanation: 'Visibility, not atomicity.',
    realWorldUsage: 'A flag polled from another thread.',
    codeSnippet: 'let flag = false;',
    codeLanguage: 'js',
    difficulty: 2,
    orderInDeck: 10,
    version: 4,
    ...over,
  } as Card;
}

function mountEdit() {
  return render(
    <MemoryRouter initialEntries={[`/decks/cards/edit?deckId=${DECK_ID}&cardId=101`]}>
      <EditCardPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  signOut();
  signInAsSuperAdmin();
  api.fetchDeckById.mockResolvedValue(ok(deck));
  api.fetchCardsByDeck.mockResolvedValue(ok([card()]));
  api.updateCard.mockResolvedValue(ok(card()));
  api.updateDeck.mockResolvedValue(ok(deck));
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  signOut();
});

describe('a cleared field reaches the api as an empty string', () => {
  it('sends an empty string for a code snippet cleared on the edit page', async () => {
    const user = userEvent.setup();
    mountEdit();

    const snippet = await screen.findByLabelText('Code Snippet');
    await user.clear(snippet);
    await user.click(screen.getByRole('button', { name: /save|update/i }));

    await waitFor(() => expect(api.updateCard).toHaveBeenCalledTimes(1));
    const sent = api.updateCard.mock.calls[0][0] as Record<string, unknown>;
    expect(sent.codeSnippet).toBe('');
    expect(Object.hasOwn(sent, 'codeSnippet')).toBe(true);
  });

  it('sends an empty string for an explanation cleared on the edit page', async () => {
    const user = userEvent.setup();
    mountEdit();

    const explanation = await screen.findByLabelText('Explanation');
    await user.clear(explanation);
    await user.click(screen.getByRole('button', { name: /save|update/i }));

    await waitFor(() => expect(api.updateCard).toHaveBeenCalledTimes(1));
    const sent = api.updateCard.mock.calls[0][0] as Record<string, unknown>;
    expect(sent.explanation).toBe('');
    expect(Object.hasOwn(sent, 'explanation')).toBe(true);
  });

  it('sends an empty string for a description cleared on the deck edit page', async () => {
    const user = userEvent.setup();
    renderAt(<DeckEditPage />, [`/decks/edit?deckId=${DECK_ID}`]);
    await screen.findByRole('button', { name: 'Save' });

    await user.clear(screen.getByLabelText('Description'));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(api.updateDeck).toHaveBeenCalledTimes(1));
    const sent = api.updateDeck.mock.calls[0][1] as Record<string, unknown>;
    expect(sent.description).toBe('');
    expect(Object.hasOwn(sent, 'description')).toBe(true);
  });
});
