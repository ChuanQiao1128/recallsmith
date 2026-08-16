// @vitest-environment jsdom
//
// Four defects on the hand-entry path, which is the path this project's owner
// uses every day. They are unrelated in code and identical in shape: a control
// on screen that does not do what it appears to do.
//
//   F2  The difficulty select offers 1/2/3. Cards may hold 0..4, because the
//       importer accepts that range. Open a card holding 0 or 4 and the select
//       cannot show it, so it renders some other option and the screen states a
//       difficulty the card does not have.
//
//   F3a Every new card is created with orderInDeck = 1. From the second one on,
//       the deck has duplicates, and the export validation this console itself
//       runs reports "Duplicate OrderInDeck: 1".
//
//   F3b Download and Copy are disabled only on an empty payload, never on
//       validation errors, so the console hands out a deck.json it has already
//       decided is invalid.
//
//   F4  EditCardPage does not forward realWorldUsage. The API layer accepts it
//       and says so in a comment; the page just never passes it. The textarea
//       takes the edit and drops it. Unlike the stable uid next door, this field
//       is ordinary content and is supposed to be editable, so here the fix is
//       to forward it rather than to lock it.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

import type { Deck } from '../src/types/deck';
import type { Card } from '../src/types/card';
import type { ApiResult } from '../src/types/api';
import { signInAsSuperAdmin, signOut } from './support/consoleSession';

const api = vi.hoisted(() => ({
  fetchDeckById: vi.fn(),
  fetchCardsByDeck: vi.fn(),
  createCard: vi.fn(),
  updateCard: vi.fn(),
}));

vi.mock('../src/api/authoring', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/api/authoring')>();
  return { ...actual, ...api };
});

const { NewCardPage } = await import('../src/pages/NewCardPage');
const { EditCardPage } = await import('../src/pages/EditCardPage');
const { CardForm } = await import('../src/components/CardForm');
import type { CardFormValues } from '../src/components/CardForm';

const DECK_ID = 7;

const deck = {
  id: DECK_ID,
  slug: 'csharp-fundamentals',
  title: 'C# Fundamentals',
  version: 3,
} as Deck;

function ok<T>(data: T): ApiResult<T> {
  return { success: true, data, error: null, traceId: 'trace-ok' };
}

function card(over: Partial<Card> = {}): Card {
  return {
    id: 101,
    deckId: DECK_ID,
    stableUid: 'cs-volatile-001',
    question: 'What does volatile guarantee?',
    explanation: 'Visibility, not atomicity.',
    realWorldUsage: 'A flag polled from another thread.',
    codeSnippet: '',
    codeLanguage: '',
    difficulty: 2,
    orderInDeck: 10,
    version: 4,
    ...over,
  } as Card;
}

function orderField(): HTMLInputElement {
  return document.querySelector<HTMLInputElement>('#orderInDeck')!;
}

function difficultyField(): HTMLSelectElement {
  return document.querySelector<HTMLSelectElement>('#difficulty')!;
}

beforeEach(() => {
  signOut();
  signInAsSuperAdmin();
  api.fetchDeckById.mockResolvedValue(ok(deck));
  api.fetchCardsByDeck.mockResolvedValue(ok([card()]));
  api.createCard.mockResolvedValue(ok(card()));
  api.updateCard.mockResolvedValue(ok(card()));
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  signOut();
});

// --- F2 -------------------------------------------------------------------

describe('the difficulty control does not claim a value the card does not hold', () => {
  function mountForm(difficulty: number) {
    const values: CardFormValues = {
      question: 'q',
      stableUid: 'cs-x-001',
      explanation: '',
      realWorldUsage: '',
      codeSnippet: '',
      codeLanguage: '',
      difficulty,
      orderInDeck: 10,
      revision: 1,
    };
    render(
      <CardForm
        mode="edit"
        deck={deck}
        initialValues={values}
        onSubmit={async () => ({ ok: true })}
        onCancel={() => {}}
      />,
    );
  }

  it('shows a difficulty of 0 as 0 rather than as some other option', () => {
    mountForm(0);

    // The importer accepts 0..4. A select that only lists 1/2/3 has to resolve
    // an unlisted value somehow, and whatever it picks is a statement about the
    // card that is not true.
    expect(difficultyField().value).toBe('0');
  });

  it('shows a difficulty of 4 as 4', () => {
    mountForm(4);
    expect(difficultyField().value).toBe('4');
  });

  it('still offers the three ordinary choices for an ordinary card', () => {
    mountForm(2);

    expect(difficultyField().value).toBe('2');
    // The out-of-range escape hatch must not become a fourth normal option.
    const labels = [...difficultyField().options].map(o => o.textContent);
    expect(labels).toEqual(['Easy', 'Medium', 'Hard']);
  });
});

// --- F3a ------------------------------------------------------------------

describe('a new card is offered the next order in the deck', () => {
  function mountNew() {
    return render(
      <MemoryRouter initialEntries={[`/decks/cards/new?deckId=${DECK_ID}`]}>
        <NewCardPage />
      </MemoryRouter>,
    );
  }

  it('continues the deck instead of colliding with card one', async () => {
    api.fetchCardsByDeck.mockResolvedValue(
      ok([card({ id: 1, orderInDeck: 10 }), card({ id: 2, orderInDeck: 20 })]),
    );
    mountNew();

    // The importer numbers cards 0, 10, 20, so the next one is 30. Hardcoding 1
    // made the export validation this same console runs report a duplicate for
    // every card after the first.
    await waitFor(() => expect(orderField().value).toBe('30'));
  });

  it('starts an empty deck above zero', async () => {
    api.fetchCardsByDeck.mockResolvedValue(ok([]));
    mountNew();

    // Not 0: the export validation warns on OrderInDeck <= 0, and a console
    // that creates a card its own validator complains about is the defect in a
    // quieter form.
    await waitFor(() => expect(orderField().value).toBe('10'));
  });

  it('does not stall the form when the card list cannot be read', async () => {
    api.fetchCardsByDeck.mockResolvedValue({
      success: false,
      data: null,
      error: { code: 'NETWORK_ERROR', message: 'down' },
      traceId: 't',
    } satisfies ApiResult<Card[]>);
    mountNew();

    // Knowing the next number is a convenience. Failing to know it must not
    // stop someone from writing a card.
    await waitFor(() => expect(orderField()).not.toBeNull());
    expect(Number(orderField().value)).toBeGreaterThan(0);
  });
});

// --- F4 -------------------------------------------------------------------

describe('editing a card keeps the edit to its usage note', () => {
  function mountEdit() {
    return render(
      <MemoryRouter initialEntries={[`/decks/cards/edit?deckId=${DECK_ID}&cardId=101`]}>
        <EditCardPage />
      </MemoryRouter>,
    );
  }

  it('sends realWorldUsage along with everything else', async () => {
    const user = userEvent.setup();
    api.fetchCardsByDeck.mockResolvedValue(ok([card()]));
    mountEdit();

    const usage = await screen.findByDisplayValue('A flag polled from another thread.');
    await user.clear(usage);
    await user.type(usage, 'Polled by a background worker.');

    await user.click(screen.getByRole('button', { name: /save|保存|update/i }));

    await waitFor(() => expect(api.updateCard).toHaveBeenCalled());
    // The api layer omits undefined keys, so leaving it out is not data loss —
    // it is an edit that silently does not happen, which is the harder bug to
    // notice. The importer compares this field when deciding update vs
    // unchanged, so an edit that never lands also breaks "re-import is a no-op".
    expect(api.updateCard.mock.calls[0][0]).toMatchObject({
      realWorldUsage: 'Polled by a background worker.',
    });
  });
});

// --- F3b ------------------------------------------------------------------

const { DeckPreviewPage } = await import('../src/pages/DeckPreviewPage');

describe('the console does not hand out an export it has already rejected', () => {
  function mountPreview() {
    return render(
      <MemoryRouter initialEntries={[`/decks/preview?deckId=${DECK_ID}`]}>
        <DeckPreviewPage />
      </MemoryRouter>,
    );
  }

  async function buttons() {
    const copy = await screen.findByRole('button', { name: /copy json/i });
    const download = await screen.findByRole('button', { name: /download deck\.json/i });
    return { copy: copy as HTMLButtonElement, download: download as HTMLButtonElement };
  }

  it('refuses to copy or download while validation reports errors', async () => {
    // Two cards sharing an order is exactly what the old hardcoded 1 produced,
    // so this is the deck the console used to build and then offer for export.
    api.fetchCardsByDeck.mockResolvedValue(
      ok([
        card({ id: 1, stableUid: 'cs-a-001', orderInDeck: 1 }),
        card({ id: 2, stableUid: 'cs-b-001', orderInDeck: 1 }),
      ]),
    );
    mountPreview();

    expect(await screen.findByText(/Duplicate OrderInDeck/i)).not.toBeNull();

    // The buttons were disabled only on an empty payload. A deck.json the
    // validator has already called invalid is worse than no file: it is a file
    // that fails later, on a device, with no validator attached.
    const { copy, download } = await buttons();
    expect(copy.disabled).toBe(true);
    expect(download.disabled).toBe(true);
  });

  it('still allows export when only warnings are present', async () => {
    api.fetchCardsByDeck.mockResolvedValue(
      ok([card({ id: 1, stableUid: 'cs-a-001', orderInDeck: 10 })]),
    );
    mountPreview();

    await screen.findByRole('button', { name: /copy json/i });
    const { copy, download } = await buttons();
    // Warnings are advice, not a verdict. Blocking on them would make the
    // gate useless by making it constant.
    expect(copy.disabled).toBe(false);
    expect(download.disabled).toBe(false);
  });
});

// --- F6 -------------------------------------------------------------------

// The third control on this same form that collected a value and threw it away.
// Unlike F4 the field is not even mentioned in the client's request types, yet
// the backend has always read it: Cards.cs parses `revision` on create and
// carries it in the update field map. So the form asked for a number, refused
// to submit while it was invalid, and then dropped it.
//
// Validating an input that is never sent is the tell. A rule that guards
// nothing is not a safety net, it is a claim that something is being protected.
describe('the revision the form insists on is the revision that gets stored', () => {
  it('sends it when creating a card', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={[`/decks/cards/new?deckId=${DECK_ID}`]}>
        <NewCardPage />
      </MemoryRouter>,
    );

    const revision = await screen.findByLabelText('Revision');
    await user.clear(revision);
    await user.type(revision, '3');

    const question = screen.getByLabelText(/question/i);
    await user.type(question, 'What is a span?');
    await user.tab();

    await user.click(screen.getByRole('button', { name: /create|save|保存/i }));

    await waitFor(() => expect(api.createCard).toHaveBeenCalled());
    expect(api.createCard.mock.calls[0][0]).toMatchObject({ revision: 3 });
  });

  it('sends it when editing a card', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={[`/decks/cards/edit?deckId=${DECK_ID}&cardId=101`]}>
        <EditCardPage />
      </MemoryRouter>,
    );

    const revision = await screen.findByLabelText('Revision');
    await user.clear(revision);
    await user.type(revision, '7');

    await user.click(screen.getByRole('button', { name: /save|保存|update/i }));

    await waitFor(() => expect(api.updateCard).toHaveBeenCalled());
    expect(api.updateCard.mock.calls[0][0]).toMatchObject({ revision: 7 });
  });
});

// --- 可及性：每个 label 都要真的连着它的控件 --------------------------------

// Found by a test that could not locate the Question field by its label. Four
// of the nine labels carried htmlFor and five did not, so a screen reader had
// no way to say what those five inputs were for, and clicking the text did not
// focus the box. Pinned here rather than left as a convention, because the
// convention was already half broken and nothing noticed.
describe('every field on the card form is reachable by its label', () => {
  it('associates all nine labels with a control', () => {
    render(
      <CardForm
        mode="create"
        deck={deck}
        initialValues={{
          question: '', stableUid: '', explanation: '', realWorldUsage: '',
          codeSnippet: '', codeLanguage: '', difficulty: 2, orderInDeck: 10, revision: 1,
        }}
        onSubmit={async () => ({ ok: true })}
        onCancel={() => {}}
      />,
    );

    const labels = [...document.querySelectorAll('label')];
    expect(labels.length).toBeGreaterThanOrEqual(9);

    const orphans = labels
      .filter(l => {
        const id = l.getAttribute('for');
        return !id || document.getElementById(id) === null;
      })
      .map(l => l.textContent?.trim());

    expect(orphans).toEqual([]);
  });
});
