// @vitest-environment jsdom
//
// Proof that CardListPage reads through the shared query cache, and that
// moving it there changed nothing a user can see.
//
// The existing tests in cardListPageDelete.test.tsx cannot tell the difference:
// a page that fetches by hand and a page that fetches through useCards render
// the same table, so every one of those assertions stays green either way. What
// separates them is where the data lands. Only a component that calls a hook
// keyed by QueryKeys can put a row under ['cards', 7]; a hand-rolled useEffect
// puts it in component state, where nothing else in the app can reach it. So
// the cache is what gets asserted here.
//
// The rest of the file is parity: the error wording, the number of requests,
// the behaviour of a URL with no deckId, and the ambient refetching that a
// shared QueryClient would otherwise switch on for free.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import { focusManager, onlineManager } from '@tanstack/react-query';
import userEvent from '@testing-library/user-event';

import type { Card } from '../src/types/card';
import type { Deck } from '../src/types/deck';
import type { ApiResult } from '../src/types/api';
import {
  makeAppDefaultsQueryClient,
  renderWithClient,
  renderWithQuery,
} from './support/queryTestClient';
import { signInAsSuperAdmin, signOut } from './support/consoleSession';
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

/** What the api layer returns when the transport fails: a result, never a throw. */
function fail<T>(message: string): ApiResult<T> {
  return {
    success: false,
    data: null,
    error: { code: 'NETWORK_ERROR', message },
    traceId: 'trace-fail',
  };
}

/** HTTP 200 carrying success: false, with no message of its own. */
function refusedWithoutMessage<T>(): ApiResult<T> {
  return { success: false, data: null, error: null, traceId: 'trace-refused' };
}

// Wrapped in the provider because one case below deletes a card, and after the
// window.confirm replacement saying yes means clicking a button in a rendered
// dialog. The three `renderWithClient(makeAppDefaultsQueryClient(), ...)` calls
// further down stay deliberately bare: they are about react-query defaults, they
// never open a dialog, and mounting them without the provider keeps proving
// that this page renders on its own.
function mount(search: string) {
  return renderWithQuery(
    <ConfirmDialogProvider>
      <CardListPage />
    </ConfirmDialogProvider>,
    [`/decks/cards${search}`],
  );
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
  // Leaving the focus flag pinned would change how later files behave.
  focusManager.setFocused(undefined);
  // Same reason as the focus flag: a pinned offline flag would follow this
  // file into the next one. Reset to true rather than undefined — the manager
  // stores whatever it is handed, and undefined reads as falsy, which is the
  // offline branch. That mistake pauses every later mutation instead of
  // clearing the flag, and it looks like an unrelated test breaking.
  onlineManager.setOnline(true);
  signOut();
});

describe('the rows come from the shared query cache', () => {
  it('files the deck and its cards under the keys the rest of the app uses', async () => {
    const { client } = mount(`?deckId=${DECK_ID}`);
    await screen.findByText(CARD_QUESTION);

    // A page fetching into its own useState renders exactly the same table and
    // leaves both of these undefined.
    expect(client.getQueryData(['cards', DECK_ID])).toHaveLength(1);
    expect(client.getQueryData(['decks', DECK_ID])).toEqual(deck);
  });

  it('asks for each of them exactly once', async () => {
    mount(`?deckId=${DECK_ID}`);
    await screen.findByText(CARD_QUESTION);

    expect(api.fetchDeckById).toHaveBeenCalledTimes(1);
    expect(api.fetchCardsByDeck).toHaveBeenCalledTimes(1);
  });

  it('drops a deleted row from the cache, not just from the table', async () => {
    api.deleteCard.mockResolvedValue(ok(null));

    const { client } = mount(`?deckId=${DECK_ID}`);
    await screen.findByText(CARD_QUESTION);

    const row = screen.getByText(CARD_QUESTION).closest('tr');
    expect(row).not.toBeNull();
    await userEvent.click(
      within(row as HTMLTableRowElement).getByRole('button', { name: 'Delete' }),
    );
    // Mechanism only: the row's button opens the confirmation, and the answer
    // is a click inside it. Scoped to the dialog so it cannot pick up the row's
    // own button again.
    const dialog = await screen.findByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete card' }));

    await waitFor(() => expect(screen.queryByText(CARD_QUESTION)).toBeNull());
    // The row leaving the screen is not the claim. The claim is that the
    // deletion reached the cache every other reader of ['cards', 7] shares,
    // instead of a private array this component happened to be holding.
    expect(client.getQueryData(['cards', DECK_ID])).toHaveLength(0);
  });
});

// These three run against the application's real QueryClient defaults, because
// each one is about a setting that used to be dangerous there. Under the
// permissive test client they would all pass either way.
//
// WHAT THEY WITNESS CHANGED, and it is worth stating rather than letting the
// wording rot. The defaults used to be staleTime 5min / gcTime 10min / retry 1
// / refetchOnWindowFocus true, and these cases proved the HOOKS overrode them
// one by one. The defaults are now the conservative set and the hooks state
// none of the four, so the same three cases prove the DEFAULT is safe. Neither
// the assertions nor the numbers below moved; the thing standing behind them
// did. tests/queryClientDefaults.test.tsx holds the hooks out of it, because a
// hook that restated `staleTime: 0` would make all three green again while the
// shared client went back to five minutes.
describe('fetching still behaves the way it did before react-query', () => {
  it('ignores the window regaining focus', async () => {
    renderWithClient(makeAppDefaultsQueryClient(), <CardListPage />, [
      `/decks/cards?deckId=${DECK_ID}`,
    ]);
    await screen.findByText(CARD_QUESTION);
    expect(api.fetchCardsByDeck).toHaveBeenCalledTimes(1);

    await act(async () => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    // Alt-tabbing back into the tab is not a request to reload the list, and
    // before the migration nothing here could have interpreted it as one.
    expect(api.fetchCardsByDeck).toHaveBeenCalledTimes(1);
    expect(api.fetchDeckById).toHaveBeenCalledTimes(1);
  });

  it('reloads on the next visit instead of serving a remembered list', async () => {
    const client = makeAppDefaultsQueryClient();

    renderWithClient(client, <CardListPage />, [`/decks/cards?deckId=${DECK_ID}`]);
    await screen.findByText(CARD_QUESTION);
    expect(api.fetchCardsByDeck).toHaveBeenCalledTimes(1);

    cleanup();

    renderWithClient(client, <CardListPage />, [`/decks/cards?deckId=${DECK_ID}`]);
    await screen.findByText(CARD_QUESTION);

    // This is the regression a five-minute staleTime would introduce today.
    // The reason has narrowed and has not gone away: NewCardPage and
    // EditCardPage do now invalidate ['cards', deckId] when they write, so the
    // list would eventually be told — but only for the writes that go through
    // this console. A deck edited by the importer, by another tab, or by
    // anybody else is still invisible to it, and re-entering this page is the
    // only moment the console has to find out. Raising it is a decision, not a
    // default.
    expect(api.fetchCardsByDeck).toHaveBeenCalledTimes(2);
  });

  it('shows a refusal at once instead of quietly retrying first', async () => {
    api.fetchDeckById.mockResolvedValue(refusedWithoutMessage<Deck>());

    renderWithClient(makeAppDefaultsQueryClient(), <CardListPage />, [
      `/decks/cards?deckId=${DECK_ID}`,
    ]);

    expect(await screen.findByText('Deck not found.')).not.toBeNull();
    // A retry would send the same rejected request a second time and hold the
    // loading screen up for the backoff first. The server already answered.
    expect(api.fetchDeckById).toHaveBeenCalledTimes(1);
  });
});

describe('the wording of a failed load is unchanged', () => {
  it('repeats what the server said about the deck', async () => {
    api.fetchDeckById.mockResolvedValue({
      success: false,
      data: null,
      error: { code: 'DECK_ARCHIVED', message: 'Deck 7 has been archived.' },
      traceId: 'trace-archived',
    } satisfies ApiResult<Deck>);

    mount(`?deckId=${DECK_ID}`);
    expect(await screen.findByText('Deck 7 has been archived.')).not.toBeNull();
  });

  it('says "Deck not found." when the server refuses without a message', async () => {
    api.fetchDeckById.mockResolvedValue(refusedWithoutMessage<Deck>());

    mount(`?deckId=${DECK_ID}`);
    // The hook used to throw 'Failed to fetch deck' here, which is not a
    // sentence this console has ever shown anyone.
    expect(await screen.findByText('Deck not found.')).not.toBeNull();
  });

  it('says "Deck not found." when the response is a success carrying no deck', async () => {
    api.fetchDeckById.mockResolvedValue(ok(null));

    mount(`?deckId=${DECK_ID}`);
    expect(await screen.findByText('Deck not found.')).not.toBeNull();
  });

  it('says "Failed to load cards." when only the cards request fails', async () => {
    api.fetchCardsByDeck.mockResolvedValue(refusedWithoutMessage<Card[]>());

    mount(`?deckId=${DECK_ID}`);
    expect(await screen.findByText('Failed to load cards.')).not.toBeNull();
  });

  it('lets the deck failure speak first when both requests fail', async () => {
    api.fetchDeckById.mockResolvedValue({
      success: false,
      data: null,
      error: { code: 'DECK_ARCHIVED', message: 'Deck 7 has been archived.' },
      traceId: 'trace-archived',
    } satisfies ApiResult<Deck>);
    api.fetchCardsByDeck.mockResolvedValue(refusedWithoutMessage<Card[]>());

    mount(`?deckId=${DECK_ID}`);
    expect(await screen.findByText('Deck 7 has been archived.')).not.toBeNull();
    expect(screen.queryByText('Failed to load cards.')).toBeNull();
  });
});

describe('a URL with no usable deckId', () => {
  it('says so at once instead of loading forever', async () => {
    mount('');

    expect(await screen.findByText('Missing or invalid deckId.')).not.toBeNull();
    // A disabled react-query query reports status 'pending' for as long as it
    // stays disabled. Read that as "still loading" and this page would spin
    // until the tab is closed.
    expect(screen.queryByText('Loading cards...')).toBeNull();
    expect(api.fetchDeckById).not.toHaveBeenCalled();
    expect(api.fetchCardsByDeck).not.toHaveBeenCalled();
  });

  it('still sends a deckId the server is the one to reject', async () => {
    api.fetchDeckById.mockResolvedValue({
      success: false,
      data: null,
      error: { code: 'NOT_FOUND', message: 'Deck -5 does not exist.' },
      traceId: 'trace-404',
    } satisfies ApiResult<Deck>);

    mount('?deckId=-5');

    // Before the migration a negative deckId went to the API and came back as
    // the server's own 404 wording. The hooks guard on the same predicate the
    // page does — 0 and NaN only — so that stays true. Tightening the guard to
    // `id > 0` would replace this message with a permanent loading screen.
    expect(await screen.findByText('Deck -5 does not exist.')).not.toBeNull();
    expect(api.fetchDeckById).toHaveBeenCalledWith(-5);
  });
});

// The page has one loading screen and two ways to get stuck on it forever.
//
// The invalidDeckId branch above guards the first: a disabled query reports
// status 'pending' for good, so reading isPending first would park a URL with
// no deckId on "Loading cards..." instead of saying what is wrong. That one was
// caught during the migration and is commented in the page.
//
// This is the second, and it arrives the same way: react-query's default
// networkMode 'online' does not run queryFn while the browser reports offline.
// It parks the query at fetchStatus 'paused' with status still 'pending' — the
// same spinner, from a different cause. The useEffect this replaced had no such
// notion; it fired the request, the request failed, and the failure is what the
// user saw. Nothing in the hand-written code could express "wait for the
// network", so nothing in the migration is allowed to introduce it.
describe('being offline still produces an error, not a spinner', () => {
  it('sends the request anyway and shows what came back', async () => {
    // The api layer converts transport failures into a fail() result rather
    // than throwing, so this is what an offline fetch actually returns here.
    api.fetchCardsByDeck.mockResolvedValue(
      fail('Network error. Check your connection.'),
    );
    onlineManager.setOnline(false);

    renderWithClient(makeAppDefaultsQueryClient(), <CardListPage />, [
      `/decks/cards?deckId=${DECK_ID}`,
    ]);

    // The sharp assertion is this one rather than the text: under networkMode
    // 'online' queryFn is never entered at all, so the mock records zero calls
    // and the page renders "Loading cards..." with nothing on the way to end it.
    expect(
      await screen.findByText('Network error. Check your connection.'),
    ).not.toBeNull();
    expect(api.fetchCardsByDeck).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Loading cards...')).toBeNull();
  });
});
