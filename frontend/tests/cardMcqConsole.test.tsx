// @vitest-environment jsdom
//
// The console carries the MCQ blob end to end without ever editing it. C12
// splits the proof in two: the function -> wire half (an explicit `null` is
// forwarded, an absent key is left alone) lives in authoringRequestBody.test.ts;
// this file covers the page -> function half and the read-only surfaces:
//
//   - the MCQ badge in the card list's Rarity cell, present only when the card
//     carries a blob (null and absent both mean no badge);
//   - the read-only panel on the edit page, absent on a Q/A card and on the new
//     card page, containing no form control of any kind;
//   - saving from the edit page sends no `mcq` key, so the server's blob is left
//     exactly as it stands (an absent key is "leave alone", C00 §2.11).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

import type { Card } from '../src/types/card';
import type { Deck } from '../src/types/deck';
import type { McqBlob } from '../src/types/mcq';
import { signInAsSuperAdmin, signOut } from './support/consoleSession';
import { renderWithQuery } from './support/queryTestClient';
import { ConfirmDialogProvider } from '../src/components/ui/ConfirmDialog';
import { ok } from './support/apiResult';
import { queryClient } from '../src/api/queryClient';

const api = vi.hoisted(() => ({
  fetchDeckById: vi.fn(),
  fetchCardsByDeck: vi.fn(),
  fetchCardById: vi.fn(),
  createCard: vi.fn(),
  updateCard: vi.fn(),
}));

vi.mock('../src/api/authoring', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/api/authoring')>();
  return { ...actual, ...api };
});

const { CardListPage } = await import('../src/pages/CardListPage');
const { EditCardPage } = await import('../src/pages/EditCardPage');
const { NewCardPage } = await import('../src/pages/NewCardPage');

const DECK_ID = 7;
const MCQ_QUESTION = 'Which storage option has the LEAST operational overhead?';
const OTHER_QUESTION = 'What does the volatile keyword guarantee?';

const MCQ: McqBlob = {
  v: 1,
  qualifier: 'LEAST operational overhead',
  shuffle: true,
  options: [
    { key: 'a', text: 'First option', why: 'Why the first option is wrong.', correct: false },
    { key: 'b', text: 'Second option', why: null, correct: true },
    { key: 'c', text: 'Third option', why: 'Why the third option is wrong.', correct: false },
  ],
};

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

function card(over: Partial<Card> = {}): Card {
  return {
    id: 101,
    deckId: DECK_ID,
    stableUid: 'cs-volatile-001',
    question: OTHER_QUESTION,
    explanation: 'Visibility, not atomicity.',
    realWorldUsage: 'A flag polled from another thread.',
    codeSnippet: '',
    codeLanguage: '',
    difficulty: 2,
    orderInDeck: 10,
    version: 4,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    ...over,
  } as Card;
}

beforeEach(() => {
  signOut();
  signInAsSuperAdmin();
  api.fetchDeckById.mockResolvedValue(ok(deck));
  api.fetchCardsByDeck.mockResolvedValue(ok([card()]));
  api.fetchCardById.mockResolvedValue(ok(card()));
  api.updateCard.mockResolvedValue(ok(card()));
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  // The edit and new pages mount bare on the app singleton; clear it between
  // cases so a cached deck or card cannot cross over.
  queryClient.clear();
  signOut();
});

function mountList() {
  return renderWithQuery(
    <ConfirmDialogProvider>
      <CardListPage />
    </ConfirmDialogProvider>,
    [`/decks/cards?deckId=${DECK_ID}`],
  );
}

function mountEdit() {
  return render(
    <MemoryRouter initialEntries={[`/decks/cards/edit?deckId=${DECK_ID}&cardId=101`]}>
      <EditCardPage />
    </MemoryRouter>,
  );
}

function mountNew() {
  return render(
    <MemoryRouter initialEntries={[`/decks/cards/new?deckId=${DECK_ID}`]}>
      <NewCardPage />
    </MemoryRouter>,
  );
}

describe('the card list marks a card that carries an MCQ blob', () => {
  it('shows an MCQ badge in the Rarity cell of a card that carries mcq', async () => {
    api.fetchCardsByDeck.mockResolvedValue(
      ok([card(), card({ id: 102, stableUid: 'card-mcq', question: MCQ_QUESTION, mcq: MCQ })]),
    );
    mountList();
    await screen.findByText(MCQ_QUESTION);

    const badges = screen.getAllByTestId('card-mcq-badge');
    expect(badges).toHaveLength(1);
    expect(badges[0].textContent).toBe('MCQ');

    const row = badges[0].closest('tr')!;
    expect(within(row).getByText(MCQ_QUESTION)).toBeTruthy();
  });

  it('shows no MCQ badge on a Q/A card, whether mcq is null or absent', async () => {
    api.fetchCardsByDeck.mockResolvedValue(
      ok([card({ mcq: null }), card({ id: 103, stableUid: 'card-qa-2', question: OTHER_QUESTION })]),
    );
    mountList();
    await screen.findAllByText(OTHER_QUESTION);

    expect(screen.queryAllByTestId('card-mcq-badge')).toHaveLength(0);
  });
});

describe('the edit page shows the MCQ blob read-only', () => {
  it('renders the read-only MCQ panel on the edit page when the card carries mcq', async () => {
    api.fetchCardById.mockResolvedValue(ok(card({ mcq: MCQ })));
    mountEdit();
    await screen.findByRole('button', { name: /save changes/i });

    const panel = screen.getByTestId('card-form-mcq');
    const optionIds = [...panel.querySelectorAll('[data-testid^="card-form-mcq-option-"]')].map(n =>
      n.getAttribute('data-testid'),
    );
    expect(optionIds).toEqual([
      'card-form-mcq-option-a',
      'card-form-mcq-option-b',
      'card-form-mcq-option-c',
    ]);

    const correct = panel.querySelectorAll('[data-testid="card-form-mcq-correct"]');
    expect(correct).toHaveLength(1);
    expect(correct[0].closest('[data-testid="card-form-mcq-option-b"]')).toBeTruthy();

    expect(screen.getByTestId('card-form-mcq-qualifier').textContent).toContain(
      'LEAST operational overhead',
    );
    expect(screen.getByTestId('card-form-mcq-required').textContent).toBe('Single answer');

    const optionA = panel.querySelector('[data-testid="card-form-mcq-option-a"]')!;
    expect(optionA.textContent).toContain('Why the first option is wrong.');

    expect(panel.querySelectorAll('input, textarea, select, button')).toHaveLength(0);
  });

  it('renders no MCQ panel on the edit page for a Q/A card', async () => {
    api.fetchCardById.mockResolvedValue(ok(card({ mcq: null })));
    mountEdit();
    await screen.findByRole('button', { name: /save changes/i });

    expect(screen.queryByTestId('card-form-mcq')).toBeNull();
  });

  it('renders no MCQ panel on the new-card page', async () => {
    mountNew();
    await screen.findByRole('button', { name: /create card/i });

    expect(screen.queryByTestId('card-form-mcq')).toBeNull();
  });

  it('saving an MCQ card from the edit page sends no mcq key', async () => {
    // This is the page -> function half: EditCardPage.handleSubmit never mentions
    // mcq, so the server's blob is left alone. The function -> wire half — that an
    // explicit null is forwarded as an own key — is in authoringRequestBody.test.ts.
    api.fetchCardById.mockResolvedValue(ok(card({ mcq: MCQ })));
    mountEdit();
    const saveButton = await screen.findByRole('button', { name: /save changes/i });

    await userEvent.click(saveButton);

    await waitFor(() => expect(api.updateCard).toHaveBeenCalledTimes(1));
    const sent = api.updateCard.mock.calls[0][0] as Record<string, unknown>;
    expect(sent).toMatchObject({ id: 101, expectedVersion: 4 });
    expect(Object.hasOwn(sent, 'mcq')).toBe(false);
  });
});
