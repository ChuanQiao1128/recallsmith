// @vitest-environment jsdom
//
// The strongest witness in this step: the real <App/>, a real route, a real row.
//
// Every other file here can pass while the application is broken. The
// accessibility cases mount ConfirmDialog under a provider they build
// themselves. The page cases mount one page under a provider they build
// themselves. tests/appConfirmWiring.test.ts reads App.tsx's AST, which proves
// the tag is in the right place in the source and nothing about what renders.
// None of them would notice if the provider stopped being reachable from
// main.tsx — and "present but unreachable" is exactly the state ConfirmDialog
// was in for the whole of its life before this step: not merely unwired, but
// absent from the production bundle, with no chunk containing its markup.
//
// The trick that makes this file a gate rather than a demonstration is the
// window.confirm stub. useConfirm falls back to the browser dialog when no
// provider is above it, which is deliberate and is what lets bare-mounted page
// tests keep working. That same fallback would let a regression here pass
// silently: delete the provider from App.tsx and the delete flow keeps working,
// through the browser dialog, in a test that stubbed it to return true. So the
// stub throws instead. If the provider ever leaves App.tsx, this file dies with
// an exception naming exactly what happened.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';

import type { Card } from '../src/types/card';
import type { Deck } from '../src/types/deck';
import type { ApiResult } from '../src/types/api';
import { AuthProvider } from '../src/auth/AuthContext';
import { makeTestQueryClient } from './support/queryTestClient';
import { signInAsSuperAdmin, signOut } from './support/consoleSession';
import { queryClient } from '../src/api/queryClient';

const api = vi.hoisted(() => ({
  fetchDeckById: vi.fn(),
  fetchCardsByDeck: vi.fn(),
  deleteCard: vi.fn(),
  fetchPublishJobs: vi.fn(),
  fetchAdminDecksPage: vi.fn(),
  fetchDecks: vi.fn(),
  fetchAdminManifest: vi.fn(),
}));

vi.mock('../src/api/authoring', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/api/authoring')>();
  return { ...actual, ...api };
});

// App is imported after the mock is registered, because App's module scope
// kicks off import('./pages/DeckListPage') the moment it is evaluated.
const { default: App } = await import('../src/App');

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

/**
 * The application, assembled the way main.tsx assembles it, minus BrowserRouter
 * (jsdom has no history to speak of) and minus the app's singleton QueryClient
 * (a shared cache would let one case read another's rows).
 */
async function mountApp(): Promise<void> {
  render(
    <QueryClientProvider client={makeTestQueryClient()}>
      <AuthProvider>
        <MemoryRouter initialEntries={[`/decks/cards?deckId=${DECK_ID}`]}>
          <App />
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
  // The route is lazy. Waiting on the card question waits out the chunk, the
  // Suspense fallback and both queries in one assertion.
  await screen.findByText(CARD_QUESTION, {}, { timeout: 5000 });
}

/** The row's own Delete button — the thing a user actually presses. */
function rowDeleteButton(): HTMLElement {
  const row = screen.getByText(CARD_QUESTION).closest('tr');
  expect(row).not.toBeNull();
  return within(row as HTMLTableRowElement).getByRole('button', { name: 'Delete' });
}

beforeEach(() => {
  signOut();
  signInAsSuperAdmin();
  api.fetchDeckById.mockResolvedValue(ok(deck));
  api.fetchCardsByDeck.mockResolvedValue(ok([card]));
  api.deleteCard.mockResolvedValue(ok(null));
  // The deck list prefetch fires at App's module scope and on any navigation
  // away; answer it so nothing here depends on an unhandled rejection.
  api.fetchPublishJobs.mockResolvedValue(ok([]));
  api.fetchAdminDecksPage.mockResolvedValue(ok({ items: [], nextCursor: null, hasMore: false }));
  api.fetchDecks.mockResolvedValue(ok([]));
  api.fetchAdminManifest.mockResolvedValue(ok({ manifest: { Decks: [] } }));

  // Not a stub that answers — a stub that reports. Reaching the browser dialog
  // from inside the assembled application means the provider is gone, and that
  // should be loud.
  vi.spyOn(window, 'confirm').mockImplementation(() => {
    throw new Error(
      'window.confirm was reached from inside <App/>: the ConfirmDialogProvider is no longer an ancestor of the routes.',
    );
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  // This file mounts under its own test client, but the app singleton is cleared
  // too so nothing leaks into the bare-mount files that share it.
  queryClient.clear();
  signOut();
  localStorage.clear();
});

describe('the assembled application', () => {
  it('opens its own dialog, not the browser one, from a real row', async () => {
    await mountApp();
    await userEvent.click(rowDeleteButton());

    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Delete this card?')).not.toBeNull();
    expect(window.confirm).not.toHaveBeenCalled();
  });

  it('opens that dialog with focus on Cancel, all the way through the real tree', async () => {
    // The same claim confirmDialogA11y makes about the component, asked of the
    // application: nothing between main.tsx and the page re-introduces an
    // autoFocus, and no wrapper steals focus on the way.
    await mountApp();
    await userEvent.click(rowDeleteButton());

    const dialog = await screen.findByRole('alertdialog');
    expect(document.activeElement).toBe(
      within(dialog).getByRole('button', { name: 'Cancel' }),
    );
  });

  it('leaves the card alone when the dialog is dismissed', async () => {
    await mountApp();
    await userEvent.click(rowDeleteButton());

    const dialog = await screen.findByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(api.deleteCard).not.toHaveBeenCalled();
    expect(screen.queryByText(CARD_QUESTION)).not.toBeNull();
  });

  it('deletes the card when the dialog is confirmed', async () => {
    await mountApp();
    await userEvent.click(rowDeleteButton());

    const dialog = await screen.findByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete card' }));

    await waitFor(() => expect(api.deleteCard).toHaveBeenCalledWith(CARD_ID));
    await waitFor(() => expect(screen.queryByText(CARD_QUESTION)).toBeNull());
  });
});
