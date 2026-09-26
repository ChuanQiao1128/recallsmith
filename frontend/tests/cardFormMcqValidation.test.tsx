// @vitest-environment jsdom
//
// CFE-24: the card form runs the MCQ rules over what the author is typing and
// splits the verdict the way the server does. A stem that drops its qualifier,
// an empty explanation and the other server-enforced codes BLOCK the submit;
// the importer-only codes (a letter reference, forbidden option text) are shown
// as advice and never block. The form still never sends the mcq blob.
//
// The first block mounts the bare CardForm (the cardFormHints harness). The last
// two cases drive the real EditCardPage (the cardMcqConsole harness) to pin that
// the edited topic reaches updateCard trimmed while no mcq key ever does.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { CardForm } from '../src/components/CardForm';
import type { CardFormValues } from '../src/components/CardForm';
import type { Deck } from '../src/types/deck';
import type { McqBlob } from '../src/types/mcq';

// Copied from cardMcqConsole: a valid single-answer MCQ and a stem that carries
// its qualifier. Keeping them local avoids importing across test files.
const MCQ_QUESTION = 'Which storage option has the LEAST operational overhead?';
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

const deck = {
  id: 7,
  slug: 'csharp-fundamentals',
  title: 'C# Fundamentals',
} as Deck;

/** Valid MCQ form values: a stem with the qualifier and a plain explanation. */
function values(over: Partial<CardFormValues> = {}): CardFormValues {
  return {
    question: MCQ_QUESTION,
    stableUid: 'cs-storage-001',
    explanation: 'Managed object storage keeps the operational overhead low.',
    realWorldUsage: '',
    codeSnippet: '',
    codeLanguage: '',
    difficulty: 2,
    orderInDeck: 10,
    revision: 1,
    topic: '',
    ...over,
  };
}

function mount(initial: CardFormValues, mcq: McqBlob | null) {
  const onSubmit = vi.fn<(values: CardFormValues) => Promise<{ ok: boolean; error?: string }>>(
    async () => ({ ok: true }),
  );
  render(
    <CardForm
      mode="edit"
      deck={deck}
      initialValues={initial}
      onSubmit={onSubmit}
      onCancel={() => {}}
      mcq={mcq}
    />,
  );
  return { onSubmit };
}

const field = (id: string) => document.getElementById(id) as HTMLTextAreaElement & HTMLInputElement;
const saveButton = () => screen.getByRole('button', { name: /save changes/i });

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('the card form checks the MCQ rules before submit', () => {
  it('lists the qualifier-not-in-stem issue when the stem loses the qualifier', async () => {
    const user = userEvent.setup();
    mount(values(), MCQ);

    expect(screen.queryByTestId('card-form-mcq-issues')).toBeNull();

    await user.clear(field('question'));
    await user.type(field('question'), 'Which storage option is the cheapest?');

    expect(screen.getByTestId('card-form-mcq-issues').textContent).toContain(
      'does not appear in the question stem',
    );
  });

  it('does not call onSubmit while a blocking MCQ issue is present', async () => {
    const user = userEvent.setup();
    const { onSubmit } = mount(values({ question: 'Which storage option is the cheapest?' }), MCQ);

    await user.click(saveButton());

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText('Fix the multiple-choice issues listed below before saving.')).toBeTruthy();
  });

  it('submits once the stem carries the qualifier again', async () => {
    const user = userEvent.setup();
    const { onSubmit } = mount(values({ question: 'Which storage option is the cheapest?' }), MCQ);

    await user.click(saveButton());
    expect(onSubmit).not.toHaveBeenCalled();

    await user.clear(field('question'));
    await user.type(field('question'), MCQ_QUESTION);
    await user.click(saveButton());

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  });

  it('shows a letter reference as advice and still submits', async () => {
    const user = userEvent.setup();
    const { onSubmit } = mount(
      values({ explanation: 'Option B is managed, so its overhead is lowest.' }),
      MCQ,
    );

    expect(screen.getByTestId('card-form-mcq-advice').textContent).toContain('names a letter');
    expect(screen.queryByTestId('card-form-mcq-issues')).toBeNull();

    await user.click(saveButton());
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  });

  it('blocks an MCQ card whose explanation was emptied', async () => {
    const user = userEvent.setup();
    const { onSubmit } = mount(values(), MCQ);

    await user.clear(field('explanation'));
    expect(screen.getByTestId('card-form-mcq-issues').textContent).toContain(
      'An MCQ card needs an explanation.',
    );

    await user.click(saveButton());
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('shows no MCQ checks on a Q/A card', () => {
    mount(values(), null);

    expect(screen.queryByTestId('card-form-mcq-issues')).toBeNull();
    expect(screen.queryByTestId('card-form-mcq-advice')).toBeNull();
  });

  it('hands the topic to onSubmit as typed', async () => {
    const user = userEvent.setup();
    const { onSubmit } = mount(values(), MCQ);

    await user.type(field('topic'), '  spaced topic  ');
    await user.click(saveButton());

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ topic: '  spaced topic  ' });
  });
});

// ---------------------------------------------------------------------------
// The real EditCardPage, mounted the way cardMcqConsole does, so the page ->
// updateCard path is what is asserted rather than a stand-in.
// ---------------------------------------------------------------------------

import { renderAt } from './support/routerProbe';
import type { Card } from '../src/types/card';
import { signInAsSuperAdmin, signOut } from './support/consoleSession';
import { ok } from './support/apiResult';
import { queryClient } from '../src/api/queryClient';

const api = vi.hoisted(() => ({
  fetchDeckById: vi.fn(),
  fetchCardById: vi.fn(),
  updateCard: vi.fn(),
}));

vi.mock('../src/api/authoring', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/api/authoring')>();
  return { ...actual, ...api };
});

const { EditCardPage } = await import('../src/pages/EditCardPage');

const DECK_ID = 7;

const editDeck: Deck = {
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

// A valid MCQ card: the stem carries the qualifier and the explanation is
// non-empty, so nothing blocks the save and the topic is what is under test.
function editCard(over: Partial<Card> = {}): Card {
  return {
    id: 101,
    deckId: DECK_ID,
    stableUid: 'cs-storage-001',
    question: MCQ_QUESTION,
    explanation: 'Managed storage removes the operational burden.',
    realWorldUsage: '',
    codeSnippet: '',
    codeLanguage: '',
    difficulty: 2,
    orderInDeck: 10,
    version: 4,
    mcq: MCQ,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    ...over,
  } as Card;
}

describe('EditCardPage sends the topic and never an mcq key', () => {
  beforeEach(() => {
    signOut();
    signInAsSuperAdmin();
    api.fetchDeckById.mockResolvedValue(ok(editDeck));
    api.updateCard.mockResolvedValue(ok(editCard()));
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.clearAllMocks();
    queryClient.clear();
    signOut();
  });

  function mountEdit() {
    return renderAt(<EditCardPage />, [`/decks/cards/edit?deckId=${DECK_ID}&cardId=101`]);
  }

  it('EditCardPage sends the edited topic trimmed and never an mcq key', async () => {
    api.fetchCardById.mockResolvedValue(ok(editCard()));
    mountEdit();
    await screen.findByRole('button', { name: /save changes/i });

    await userEvent.type(document.getElementById('topic') as HTMLInputElement, '  storage  ');
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(api.updateCard).toHaveBeenCalledTimes(1));
    const sent = api.updateCard.mock.calls[0][0] as Record<string, unknown>;
    expect(sent).toMatchObject({ id: 101, topic: 'storage' });
    expect(Object.hasOwn(sent, 'mcq')).toBe(false);
  });

  it('EditCardPage sends an emptied topic as an empty string', async () => {
    api.fetchCardById.mockResolvedValue(ok(editCard({ topic: 'networking' })));
    mountEdit();
    await screen.findByRole('button', { name: /save changes/i });

    await userEvent.clear(document.getElementById('topic') as HTMLInputElement);
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(api.updateCard).toHaveBeenCalledTimes(1));
    const sent = api.updateCard.mock.calls[0][0] as Record<string, unknown>;
    expect(sent.topic).toBe('');
  });
});
