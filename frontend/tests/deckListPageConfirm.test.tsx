// @vitest-environment jsdom
//
// The two row actions on DeckListPage, now that answering them is a click in a
// dialog rather than a value returned by the browser.
//
// Both handlers had the same shape before this step — `const ok =
// window.confirm(...); if (!ok) return;` — and neither had a test. The delete
// path is the interesting one: it is destroy-and-forget, and the only thing
// standing between a mis-click and a missing deck is the answer to that
// question. So "no means no" is asserted as hard as "yes means yes".
//
// The two dialogs are deliberately different roles, and that is asserted rather
// than left as a comment. Delete is an alertdialog because it destroys data;
// publish is an ordinary dialog because it uploads a file and rebuilds a
// manifest, which can be done again and is the fix for having done it early.
// Because dom-testing-library does not resolve alertdialog from dialog, a query
// written for the wrong one reads as "the dialog never opened" — so the roles
// are named explicitly in each case instead of using one shared helper.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

import type { AdminDecksPage, PublishJob } from '../src/api/authoring';
import type { ApiResult } from '../src/types/api';
import { signInAsSuperAdmin, signOut } from './support/consoleSession';
import { ConfirmDialogProvider } from '../src/components/ui/ConfirmDialog';

const api = vi.hoisted(() => ({
  fetchPublishJobs: vi.fn(),
  fetchAdminDecksPage: vi.fn(),
  fetchDecks: vi.fn(),
  fetchAdminManifest: vi.fn(),
  deleteDeck: vi.fn(),
  publishDeck: vi.fn(),
}));

vi.mock('../src/api/authoring', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/api/authoring')>();
  return { ...actual, ...api };
});

const { DeckListPage } = await import('../src/pages/DeckListPage');

const SLUG = 'csharp-async';
const TITLE = 'C# Async';
const DECK_ID = 41;

function ok<T>(data: T): ApiResult<T> {
  return { success: true, data, error: null, traceId: 'trace-ok' };
}

function onePage(): ApiResult<AdminDecksPage> {
  return ok({
    items: [
      {
        slug: SLUG,
        title: TITLE,
        id: DECK_ID,
        deckType: 2,
        tier: null,
        availability: null,
        totalCards: 12,
        version: 3,
        updatedAtMs: 1767225600000,
        latestBuildId: 'build-1',
      },
    ],
    nextCursor: null,
    hasMore: false,
  });
}

function noJobs(): ApiResult<PublishJob[]> {
  return ok([]);
}

/** The row's own action button, found through the row so it cannot be another deck's. */
function rowButton(name: string): HTMLElement {
  const row = screen.getByText(TITLE).closest('tr');
  expect(row).not.toBeNull();
  return within(row as HTMLElement).getByRole('button', { name });
}

async function mountConsole(): Promise<void> {
  render(
    <MemoryRouter initialEntries={['/']}>
      <ConfirmDialogProvider>
        <DeckListPage />
      </ConfirmDialogProvider>
    </MemoryRouter>,
  );
  await screen.findByText(TITLE, {}, { timeout: 2000 });
}

let consoleError: ReturnType<typeof vi.spyOn>;
let consoleWarn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  signOut();
  signInAsSuperAdmin();
  api.fetchPublishJobs.mockResolvedValue(noJobs());
  api.fetchAdminDecksPage.mockResolvedValue(onePage());
  api.fetchDecks.mockResolvedValue(ok([]));
  api.fetchAdminManifest.mockResolvedValue(ok({ manifest: { Decks: [] } }));
  api.deleteDeck.mockResolvedValue(ok(null));
  api.publishDeck.mockResolvedValue(ok({ jobId: 'job-1' }));
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  consoleError.mockRestore();
  consoleWarn.mockRestore();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  signOut();
  // DeckListPage caches decks and the manifest in localStorage for five
  // minutes; an inherited cache would let the next case render rows without a
  // request. signOut clears the session, this clears the cache.
  localStorage.clear();
});

describe('deleting a deck', () => {
  it('asks before it deletes, and says which deck', async () => {
    await mountConsole();
    await userEvent.click(rowButton('Delete'));

    const dialog = screen.getByRole('alertdialog');
    expect(within(dialog).getByText(`Delete deck "${SLUG}"?`)).not.toBeNull();
    // The consequence, which the old string ('Delete deck is destructive.')
    // asserted about itself rather than describing.
    expect(dialog.textContent).toContain('This cannot be undone.');
    // Not 'Delete': the row's own button is already called that, and two
    // buttons with one name is both an ambiguity for a screen reader and a
    // selector that can resolve to the wrong one.
    expect(within(dialog).getByRole('button', { name: 'Delete deck' })).not.toBeNull();
    expect(api.deleteDeck).not.toHaveBeenCalled();
  });

  it('does nothing at all when the answer is no', async () => {
    await mountConsole();
    await userEvent.click(rowButton('Delete'));
    await userEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancel' }),
    );

    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(api.deleteDeck).not.toHaveBeenCalled();
    // The row is the part a user would notice. An optimistic removal that then
    // never happened is the worse half of a mis-wired confirmation.
    expect(screen.queryByText(TITLE)).not.toBeNull();
  });

  it('deletes the deck the row belongs to when the answer is yes', async () => {
    await mountConsole();
    await userEvent.click(rowButton('Delete'));
    await userEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete deck' }),
    );

    await waitFor(() => expect(api.deleteDeck).toHaveBeenCalledWith(DECK_ID));
    await waitFor(() => expect(screen.queryByText(TITLE)).toBeNull());
  });

  it('hands focus back to the row button the user pressed', async () => {
    // Cancelling, not confirming: a confirmed delete removes the row, so there
    // is nothing to hand focus back to. This is the case where the promise the
    // component makes is keepable, and it is the one keyboard users feel.
    await mountConsole();
    const trigger = rowButton('Delete');
    await userEvent.click(trigger);
    await userEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancel' }),
    );

    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });
});

describe('publishing a deck', () => {
  it('asks in an ordinary dialog, keeping the two numbered steps', async () => {
    await mountConsole();
    await userEvent.click(rowButton('Publish'));

    // role="dialog", not alertdialog: publishing destroys nothing. Getting this
    // wrong in the other direction — marking everything an alertdialog — is
    // invisible on screen and tells a screen-reader user that a routine action
    // is an emergency.
    const dialog = screen.getByRole('dialog');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(dialog.textContent).toContain('1) Upload deck.json to S3');
    expect(dialog.textContent).toContain('2) Rebuild manifest.json');
    expect(within(dialog).getByRole('button', { name: 'Publish' })).not.toBeNull();
    expect(api.publishDeck).not.toHaveBeenCalled();
  });

  it('publishes when the answer is yes, and not when it is no', async () => {
    await mountConsole();

    await userEvent.click(rowButton('Publish'));
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.publishDeck).not.toHaveBeenCalled();

    await userEvent.click(rowButton('Publish'));
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Publish' }),
    );
    await waitFor(() => expect(api.publishDeck).toHaveBeenCalledWith(DECK_ID));
  });
});
