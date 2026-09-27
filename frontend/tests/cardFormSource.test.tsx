// @vitest-environment jsdom
//
// The card form's Source URL / Source quote inputs (contract §5.1): the form
// refuses what lib/sourceRules.ts refuses before onSubmit runs, and the two card
// pages send `source` beside buildCardBody — only when a URL was entered on
// create, and always (null clears) on edit.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { CardForm } from '../src/components/CardForm';
import type { CardFormValues } from '../src/components/CardForm';
import { buildCardSource } from '../src/lib/authoringBodies';
import { renderAt } from './support/routerProbe';
import type { Card } from '../src/types/card';
import type { Deck } from '../src/types/deck';
import { signInAsSuperAdmin, signOut } from './support/consoleSession';
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

const { EditCardPage } = await import('../src/pages/EditCardPage');
const { NewCardPage } = await import('../src/pages/NewCardPage');

const DECK_ID = 7;
const SRC_URL = 'https://example.com/docs/volatile';

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
    question: 'What does the volatile keyword guarantee?',
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

/** A card that raises no hint and passes every hard check. */
function values(over: Partial<CardFormValues> = {}): CardFormValues {
  return {
    question: 'What does await actually suspend?',
    stableUid: 'cs-async-001',
    explanation: 'The async function, not the thread.',
    realWorldUsage: '',
    codeSnippet: '',
    codeLanguage: '',
    difficulty: 2,
    orderInDeck: 10,
    revision: 1,
    topic: '',
    sourceUrl: '',
    sourceQuote: '',
    ...over,
  };
}

let submitted: CardFormValues[] = [];

function mount(initial: CardFormValues) {
  submitted = [];
  return render(
    <CardForm
      mode="create"
      deck={deck}
      initialValues={initial}
      onSubmit={async v => {
        submitted.push(v);
        return { ok: true };
      }}
      onCancel={() => {}}
    />,
  );
}

function submitButton(): HTMLElement {
  return screen.getByRole('button', { name: /create card/i });
}

beforeEach(() => {
  signOut();
  signInAsSuperAdmin();
  api.fetchDeckById.mockResolvedValue(ok(deck));
  api.fetchCardsByDeck.mockResolvedValue(ok([card()]));
  api.fetchCardById.mockResolvedValue(ok(card()));
  api.createCard.mockResolvedValue(ok(card()));
  api.updateCard.mockResolvedValue(ok(card()));
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  queryClient.clear();
  signOut();
});

describe('the card form collects a source', () => {
  it('renders Source URL and Source quote inputs with labels', () => {
    mount(values());
    const url = screen.getByLabelText('Source URL');
    const quote = screen.getByLabelText('Source quote');
    expect(url.tagName).toBe('INPUT');
    expect(quote.tagName).toBe('TEXTAREA');
    expect((url as HTMLInputElement).value).toBe('');
    expect((quote as HTMLTextAreaElement).value).toBe('');
  });

  it('refuses a source URL that is not https before calling onSubmit', async () => {
    const user = userEvent.setup();
    mount(values());
    await user.type(screen.getByLabelText('Source URL'), 'http://example.com/page');
    await user.click(submitButton());

    expect(
      await screen.findByText('Source URL must start with https:// and contain no spaces (max 2048 characters).'),
    ).toBeTruthy();
    expect(submitted).toEqual([]);
  });

  it('refuses a source quote without a source URL', async () => {
    const user = userEvent.setup();
    mount(values());
    await user.type(screen.getByLabelText('Source quote'), 'A passage with no page.');
    await user.click(submitButton());

    expect(await screen.findByText('Add a Source URL for the source quote, or clear the quote.')).toBeTruthy();
    expect(submitted).toEqual([]);
  });

  it('refuses a source quote longer than 1000 characters', async () => {
    const user = userEvent.setup();
    mount(values({ sourceUrl: SRC_URL }));
    fireEvent.change(screen.getByLabelText('Source quote'), { target: { value: 'q'.repeat(1001) } });
    await user.click(submitButton());

    expect(await screen.findByText('Source quote is too long (max 1000 characters).')).toBeTruthy();
    expect(submitted).toEqual([]);

    // Exactly 1000 is accepted.
    fireEvent.change(screen.getByLabelText('Source quote'), { target: { value: 'q'.repeat(1000) } });
    await user.click(submitButton());
    await waitFor(() => expect(submitted).toHaveLength(1));
    expect(submitted[0].sourceQuote).toHaveLength(1000);
  });

  it('buildCardSource trims both fields and turns a blank quote into null', () => {
    expect(buildCardSource({ sourceUrl: `  ${SRC_URL}  `, sourceQuote: '  A quote.\n' })).toEqual({
      url: SRC_URL,
      quote: 'A quote.',
    });
    expect(buildCardSource({ sourceUrl: SRC_URL, sourceQuote: '   ' })).toEqual({ url: SRC_URL, quote: null });
    expect(buildCardSource({ sourceUrl: SRC_URL })).toEqual({ url: SRC_URL, quote: null });
    expect(buildCardSource({ sourceUrl: '   ', sourceQuote: 'ignored' })).toBeNull();
    expect(buildCardSource({})).toBeNull();
  });
});

describe('the card pages send source beside buildCardBody', () => {
  async function fillNewCard(user: ReturnType<typeof userEvent.setup>) {
    renderAt(<NewCardPage />, [`/decks/cards/new?deckId=${DECK_ID}`]);
    const question = await screen.findByLabelText(/question/i);
    await user.type(question, 'What is a span?');
    await user.tab();
  }

  it('NewCardPage sends source only when a URL was entered', async () => {
    const user = userEvent.setup();
    await fillNewCard(user);
    await user.click(screen.getByRole('button', { name: /create card/i }));
    await waitFor(() => expect(api.createCard).toHaveBeenCalledTimes(1));
    const bare = api.createCard.mock.calls[0][0] as Record<string, unknown>;
    expect(Object.hasOwn(bare, 'source')).toBe(false);

    cleanup();
    queryClient.clear();
    api.createCard.mockClear();

    await fillNewCard(user);
    await user.type(screen.getByLabelText('Source URL'), ` ${SRC_URL} `);
    await user.type(screen.getByLabelText('Source quote'), 'The quoted passage.');
    await user.click(screen.getByRole('button', { name: /create card/i }));
    await waitFor(() => expect(api.createCard).toHaveBeenCalledTimes(1));
    const withSource = api.createCard.mock.calls[0][0] as Record<string, unknown>;
    expect(withSource.source).toEqual({ url: SRC_URL, quote: 'The quoted passage.' });
  });

  it('EditCardPage prefills the source fields from the card', async () => {
    api.fetchCardById.mockResolvedValue(ok(card({ source: { url: SRC_URL, quote: 'Stored passage.' } })));
    renderAt(<EditCardPage />, [`/decks/cards/edit?deckId=${DECK_ID}&cardId=101`]);
    await screen.findByRole('button', { name: /save changes/i });

    expect((screen.getByLabelText('Source URL') as HTMLInputElement).value).toBe(SRC_URL);
    expect((screen.getByLabelText('Source quote') as HTMLTextAreaElement).value).toBe('Stored passage.');
  });

  it('EditCardPage sends source null when both source fields are cleared', async () => {
    const user = userEvent.setup();
    api.fetchCardById.mockResolvedValue(ok(card({ source: { url: SRC_URL, quote: 'Stored passage.' } })));
    renderAt(<EditCardPage />, [`/decks/cards/edit?deckId=${DECK_ID}&cardId=101`]);
    const save = await screen.findByRole('button', { name: /save changes/i });

    await user.clear(screen.getByLabelText('Source URL'));
    await user.clear(screen.getByLabelText('Source quote'));
    await user.click(save);

    await waitFor(() => expect(api.updateCard).toHaveBeenCalledTimes(1));
    const sent = api.updateCard.mock.calls[0][0] as Record<string, unknown>;
    expect(sent).toMatchObject({ id: 101, expectedVersion: 4 });
    expect(Object.hasOwn(sent, 'source')).toBe(true);
    expect(sent.source).toBeNull();
    expect(Object.hasOwn(sent, 'mcq')).toBe(false);
  });
});
