// @vitest-environment jsdom
//
// Wiring tests for the delete action on CardListPage.
//
// Why these are not more cases in errorFeed.test.ts: the feed is a pure
// function and is covered exhaustively, and it stayed green through a mutation
// that deleted the page's only call into it. It has to. reportBusinessFailure
// cannot observe a caller that never calls it, so the assertion that matters
// here is not "the feed builds the right notice" but "the page reaches the
// feed at all, and puts the result where a user can read it".
//
// The mutations these tests are built to fail against:
//
//   1. dropping the setErrors(reportBusinessFailure(...)) call in the
//      !result.success branch, which restores the original bug: a delete that
//      the server refused looks, from the page, exactly like nothing happened.
//   2. dropping the whole !result.success branch, which additionally removes
//      the row the server refused to delete.
//   3. swapping reportThrownFailure for reportBusinessFailure in the catch,
//      which tells a user whose request never came back that nothing changed.
//      That is the one piece of advice that is actively unsafe, because the
//      write may well have landed.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

import type { Card } from '../src/types/card';
import type { Deck } from '../src/types/deck';
import type { ApiResult } from '../src/types/api';
import { KIND_HINT, KIND_LABEL } from '../src/lib/errorFeed';
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
const CARD_ID = 101;
const CARD_QUESTION = 'What does the volatile keyword guarantee?';
const REFUSAL_MESSAGE = 'This card is referenced by a published build.';
const THROWN_MESSAGE = 'socket hang up';

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

const card: Card = {
  id: CARD_ID,
  deckId: DECK_ID,
  stableUid: 'card-volatile',
  question: CARD_QUESTION,
  difficulty: 2,
  orderInDeck: 1,
  version: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
};

function ok<T>(data: T): ApiResult<T> {
  return { success: true, data, error: null, traceId: 'trace-ok' };
}

/** HTTP 200 carrying success: false. The server understood, and said no. */
function refused(): ApiResult<null> {
  return {
    success: false,
    data: null,
    error: { code: 'CARD_IN_PUBLISHED_BUILD', message: REFUSAL_MESSAGE },
    traceId: 'trace-refused',
  };
}

async function mountCards(): Promise<void> {
  render(
    <MemoryRouter initialEntries={[`/decks/cards?deckId=${DECK_ID}`]}>
      <CardListPage />
    </MemoryRouter>,
  );
  // The page renders a loading screen until both fetches resolve; waiting on
  // the row is what tells us the table is real before anything is clicked.
  await screen.findByText(CARD_QUESTION);
}

/** Press Delete the way a user does, through the row's own button. */
async function clickDelete(): Promise<void> {
  const row = screen.getByText(CARD_QUESTION).closest('tr');
  expect(row).not.toBeNull();
  await userEvent.click(within(row as HTMLTableRowElement).getByRole('button', { name: 'Delete' }));
}

function bannerText(): string {
  const alerts = screen.getAllByRole('alert');
  expect(alerts).toHaveLength(1);
  return alerts[0].textContent ?? '';
}

beforeEach(() => {
  signOut();
  signInAsSuperAdmin();
  api.fetchDeckById.mockResolvedValue(ok(deck));
  api.fetchCardsByDeck.mockResolvedValue(ok([card]));
  // jsdom's window.confirm is a "not implemented" stub that returns undefined,
  // which would make every delete bail out before it reached the API. Saying
  // yes here is what puts the code under test on the path.
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  signOut();
});

describe('a delete the server refuses is visible on the page', () => {
  it('shows the refusal, in the wording the server chose', async () => {
    api.deleteCard.mockResolvedValue(refused());

    await mountCards();
    await clickDelete();

    // The bug this replaces was not "the wrong message", it was no message:
    // the click looked like it worked and the user moved on.
    const text = await waitFor(() => bannerText());
    expect(api.deleteCard).toHaveBeenCalledWith(CARD_ID);
    expect(text).toContain(`Deleting card #${CARD_ID} failed`);
    expect(text).toContain(REFUSAL_MESSAGE);
  });

  it('leaves the row on screen, because the server kept the card', async () => {
    api.deleteCard.mockResolvedValue(refused());

    await mountCards();
    await clickDelete();

    await waitFor(() => bannerText());
    // Removing the row anyway would make the page disagree with the server
    // until the next reload, which is the worse half of a silent failure.
    expect(screen.queryByText(CARD_QUESTION)).not.toBeNull();
  });

  it('removes the row only when the delete actually succeeded', async () => {
    api.deleteCard.mockResolvedValue(ok(null));

    await mountCards();
    await clickDelete();

    await waitFor(() => expect(screen.queryByText(CARD_QUESTION)).toBeNull());
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });
});

describe('a refusal and a dropped request give opposite advice', () => {
  it('calls a refusal final: the request was understood and nothing changed', async () => {
    api.deleteCard.mockResolvedValue(refused());

    await mountCards();
    await clickDelete();

    const text = await waitFor(() => bannerText());
    expect(text).toContain(KIND_LABEL.business);
    expect(text).toContain(KIND_HINT.business);
    expect(text).not.toContain(KIND_LABEL.network);
    expect(text).not.toContain(KIND_HINT.network);
  });

  it('calls a thrown request undetermined: the write may still have landed', async () => {
    api.deleteCard.mockRejectedValue(new Error(THROWN_MESSAGE));

    await mountCards();
    await clickDelete();

    const text = await waitFor(() => bannerText());
    expect(text).toContain(THROWN_MESSAGE);
    expect(text).toContain(KIND_LABEL.network);
    expect(text).toContain(KIND_HINT.network);
    // The distinction has to survive all the way to the rendered text. Only
    // the page knows which of the two happened, and the two recommend opposite
    // things: retry freely, versus reload before touching anything.
    expect(text).not.toContain(KIND_LABEL.business);
    expect(text).not.toContain(KIND_HINT.business);
    expect(screen.queryByText(CARD_QUESTION)).not.toBeNull();
  });
});
