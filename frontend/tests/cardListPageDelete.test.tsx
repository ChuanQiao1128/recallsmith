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
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import type { QueryClient } from '@tanstack/react-query';
import userEvent from '@testing-library/user-event';

import type { Card } from '../src/types/card';
import type { Deck } from '../src/types/deck';
import type { ApiResult } from '../src/types/api';
import { KIND_HINT, KIND_LABEL } from '../src/lib/errorFeed';
import { signInAsSuperAdmin, signOut } from './support/consoleSession';
import { renderWithQuery } from './support/queryTestClient';
import { ConfirmDialogProvider } from '../src/components/ui/ConfirmDialog';

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

// The provider is the mechanism change this file absorbed when the four
// window.confirm calls became ConfirmDialog. Every assertion below is
// unchanged; what changed is that saying "yes" is now a click on a rendered
// button instead of a stubbed return value.
//
// Worth recording because the prediction was wrong in an informative way: this
// file did NOT go red on its own. useConfirm falls back to window.confirm when
// no provider is above it, so the old `vi.spyOn(window, 'confirm')` kept
// working and every case stayed green through the whole change. Leaving it
// that way was the tempting option and the wrong one — it would have left the
// delete path covered only along a route the application never takes.
async function mountCards(): Promise<QueryClient> {
  const { client } = renderWithQuery(
    <ConfirmDialogProvider>
      <CardListPage />
    </ConfirmDialogProvider>,
    [`/decks/cards?deckId=${DECK_ID}`],
  );
  // The page renders a loading screen until both fetches resolve; waiting on
  // the row is what tells us the table is real before anything is clicked.
  await screen.findByText(CARD_QUESTION);
  return client;
}

/** Press Delete the way a user does, through the row's own button, and say yes. */
async function clickDelete(): Promise<void> {
  const row = screen.getByText(CARD_QUESTION).closest('tr');
  expect(row).not.toBeNull();
  await userEvent.click(within(row as HTMLTableRowElement).getByRole('button', { name: 'Delete' }));

  // findByRole('alertdialog'), not 'dialog': dom-testing-library does not
  // resolve ARIA subclasses, and a destructive dialog is an alertdialog. The
  // second click is scoped inside it so it cannot resolve back to the row's
  // own Delete button — which is also why the dialog's button is labelled
  // "Delete card" rather than "Delete".
  const dialog = await screen.findByRole('alertdialog');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Delete card' }));
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

// A lock on the render helper itself, not on the page.
//
// Cache bleed between cases fails in shapes a human does not spot by reading:
// "green alone, red in a full run", or the worse "green in a full run, red
// alone". Two consecutive mounts of the same deck make it an assertion instead.
let firstMountClient: QueryClient | null = null;

describe('every mount gets its own query cache', () => {
  it('mounts the deck once and remembers which client served it', async () => {
    firstMountClient = await mountCards();
    expect(api.fetchCardsByDeck).toHaveBeenCalledTimes(1);
    expect(firstMountClient).not.toBeNull();
  });

  it('mounts the same deck again without inheriting the previous case', async () => {
    const client = await mountCards();

    // Behavioural half: this mount reached the network stub itself rather than
    // being served out of a cache that outlived the previous case. Counts are
    // reset in afterEach, so 1 means "fetched here", 0 would mean "inherited".
    expect(api.fetchCardsByDeck).toHaveBeenCalledTimes(1);
    expect(api.fetchDeckById).toHaveBeenCalledTimes(1);

    // Structural half: the mounts did not share a client at all. This is the
    // half that stays sharp even if the hooks are later allowed to cache, at
    // which point the count above would go quiet while the bleed came back.
    expect(client).not.toBe(firstMountClient);
  });
});
