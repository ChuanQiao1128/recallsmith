// @vitest-environment jsdom
//
// What DeckListPage says when a row action fails, and what it does NOT say.
//
// Neither ERR_DELETE_DECK nor ERR_PUBLISH_DECK appeared anywhere under tests/
// before this file: both failure paths were unobserved, including the one place
// where the two interact.
//
// THE DISTINCTION THIS FILE DEFENDS. Each handler has two failure branches that
// are easy to collapse into one:
//
//   * `!res.success`  -> reportBusinessFailure -> kind 'business'
//   * `catch (err)`   -> reportThrownFailure   -> kind 'network'
//
// They produce the same TITLE and opposite ADVICE. A refusal reached the server
// and changed nothing; a thrown request may or may not have been applied. Tell a
// user "nothing changed" after a request that actually deleted their deck and
// the message is worse than no message. So E2/E5 assert the two branches are
// distinguishable, not merely that "an error appeared".
//
// AND THE SLOT RULE. The feed is keyed per operation — the comment above the
// constants in DeckListPage.tsx says so in words ("a publish failure from
// erasing a delete failure the user has not read yet") and E6 is the assertion
// that makes the words checkable. Two operations, two slots, both visible at
// once.
//
// Written and run green against a COMPLETELY UNMODIFIED DeckListPage.tsx.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

import type { AdminDeckListItem, AdminDecksPage, PublishJob } from '../src/api/authoring';
import { ok, refused } from './support/apiResult';
import { signInAsSuperAdmin, signOut } from './support/consoleSession';
import { ConfirmDialogProvider } from '../src/components/ui/ConfirmDialog';
import { KIND_HINT, KIND_LABEL } from '../src/lib/errorFeed';

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

const SLUG = 'alpha-deck';
const OTHER = 'beta-deck';
const REFUSAL = 'Deck is referenced by an active subscription';
const THROWN = 'socket hung up mid-request';

function item(slug: string, id: number): AdminDeckListItem {
  return {
    slug,
    title: `Title ${slug}`,
    id,
    deckType: 2,
    tier: null,
    availability: null,
    totalCards: 4,
    version: 1,
    updatedAtMs: null,
    latestBuildId: 'build-1',
  };
}

function twoRows() {
  return ok<AdminDecksPage>({
    items: [item(SLUG, 11), item(OTHER, 12)],
    nextCursor: null,
    hasMore: false,
  });
}

function rowFor(slug: string): HTMLElement {
  const row = screen.getByText(slug).closest('tr');
  expect(row, `no row for ${slug}`).not.toBeNull();
  return row as HTMLElement;
}

/** All role="alert" text on the page. */
function alertTexts(): string[] {
  return Array.from(document.querySelectorAll('[role="alert"]')).map(a => a.textContent ?? '');
}

/** The one alert whose text contains `needle`. Fails if there is not exactly one. */
function alertContaining(needle: string): string {
  const hits = alertTexts().filter(t => t.includes(needle));
  expect(hits, `expected exactly one alert containing ${JSON.stringify(needle)}`).toHaveLength(1);
  return hits[0];
}

async function mountConsole(): Promise<void> {
  render(
    <MemoryRouter initialEntries={['/']}>
      <ConfirmDialogProvider>
        <DeckListPage />
      </ConfirmDialogProvider>
    </MemoryRouter>,
  );
  await screen.findByText(SLUG, {}, { timeout: 2000 });
}

async function actOnRow(slug: string, trigger: string, answer: string): Promise<void> {
  await userEvent.click(within(rowFor(slug)).getByRole('button', { name: trigger }));
  const dialog = await screen.findByRole(trigger === 'Delete' ? 'alertdialog' : 'dialog');
  await userEvent.click(within(dialog).getByRole('button', { name: answer }));
}

let consoleError: ReturnType<typeof vi.spyOn>;
let consoleWarn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  signOut();
  signInAsSuperAdmin();
  api.fetchPublishJobs.mockResolvedValue(ok<PublishJob[]>([]));
  api.fetchAdminDecksPage.mockResolvedValue(twoRows());
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
  localStorage.clear();
});

describe('a delete that fails', () => {
  it('E1: a refusal names the deck, quotes the server, and leaves the row alone', async () => {
    api.deleteDeck.mockResolvedValue(refused<null>('DECK_IN_USE', REFUSAL));

    await mountConsole();
    await actOnRow(SLUG, 'Delete', 'Delete deck');

    await waitFor(() => expect(api.deleteDeck).toHaveBeenCalledWith(11));
    const alert = alertContaining(`Deleting deck "${SLUG}" failed`);
    // The server's own wording, not a string the page invented. Asserting a
    // hard-coded page string here would pass against a page that ignored the
    // response entirely.
    expect(alert).toContain(REFUSAL);
    expect(alert).toContain(KIND_LABEL.business);

    // The row is the part a user would act on. A failed delete that removed the
    // row anyway is the worst outcome available here, and it looks like success.
    expect(screen.queryByText(SLUG)).not.toBeNull();
    expect(screen.queryByText(OTHER)).not.toBeNull();
  });

  it('E2: a thrown request is reported differently from a refusal', async () => {
    api.deleteDeck.mockRejectedValue(new Error(THROWN));

    await mountConsole();
    await actOnRow(SLUG, 'Delete', 'Delete deck');

    await waitFor(() => expect(alertTexts().join('')).toContain(`Deleting deck "${SLUG}" failed`));
    const alert = alertContaining(`Deleting deck "${SLUG}" failed`);
    expect(alert).toContain(THROWN);

    // Same title as E1, opposite advice. This pair is the whole point: a page
    // that routed both branches through reportBusinessFailure would still show
    // a red banner with the right title, and would tell the user "nothing
    // changed" about a request that may well have deleted the deck.
    expect(alert).toContain(KIND_LABEL.network);
    expect(alert).toContain(KIND_HINT.network);
    expect(alert).not.toContain(KIND_LABEL.business);
    expect(alert).not.toContain(KIND_HINT.business);

    expect(screen.queryByText(SLUG)).not.toBeNull();
  });

  it('E3: a later success clears the banner and removes the row', async () => {
    api.deleteDeck.mockResolvedValueOnce(refused<null>('DECK_IN_USE', REFUSAL));

    await mountConsole();
    await actOnRow(SLUG, 'Delete', 'Delete deck');
    await waitFor(() => expect(alertTexts().join('')).toContain(`Deleting deck "${SLUG}" failed`));

    // Second attempt, same row, and the mock now resolves ok.
    await actOnRow(SLUG, 'Delete', 'Delete deck');

    await waitFor(() => expect(screen.queryByText(SLUG)).toBeNull());
    // The banner is gone because handleDeleteDeck clears its own slot BEFORE
    // the attempt. Without that clear, the success path would have to remember
    // to do it, and this page has two success paths.
    expect(alertTexts().join('')).not.toContain('Deleting deck');
  });
});

describe('a publish that fails', () => {
  it('E4: a refusal names the deck and quotes the server', async () => {
    api.publishDeck.mockResolvedValue(refused<{ jobId: string }>('BUILD_LOCKED', REFUSAL));

    await mountConsole();
    await actOnRow(SLUG, 'Publish', 'Publish');

    await waitFor(() => expect(api.publishDeck).toHaveBeenCalledWith(11));
    const alert = alertContaining(`Publishing deck "${SLUG}" failed`);
    expect(alert).toContain(REFUSAL);
    expect(alert).toContain(KIND_LABEL.business);
    expect(screen.queryByText(SLUG)).not.toBeNull();
  });

  it('E5: a thrown request is reported differently from a refusal', async () => {
    api.publishDeck.mockRejectedValue(new Error(THROWN));

    await mountConsole();
    await actOnRow(SLUG, 'Publish', 'Publish');

    await waitFor(() => expect(alertTexts().join('')).toContain(`Publishing deck "${SLUG}" failed`));
    const alert = alertContaining(`Publishing deck "${SLUG}" failed`);
    expect(alert).toContain(THROWN);
    expect(alert).toContain(KIND_LABEL.network);
    expect(alert).toContain(KIND_HINT.network);
    expect(alert).not.toContain(KIND_LABEL.business);
  });

  it('E6: a publish failure does not erase an unread delete failure', async () => {
    api.deleteDeck.mockResolvedValue(refused<null>('DECK_IN_USE', REFUSAL));
    api.publishDeck.mockResolvedValue(refused<{ jobId: string }>('BUILD_LOCKED', 'Build queue is locked'));

    await mountConsole();

    await actOnRow(SLUG, 'Delete', 'Delete deck');
    await waitFor(() => expect(alertTexts().join('')).toContain(`Deleting deck "${SLUG}" failed`));

    await actOnRow(OTHER, 'Publish', 'Publish');
    await waitFor(() => expect(alertTexts().join('')).toContain(`Publishing deck "${OTHER}" failed`));

    // Both slots occupied at once. One shared slot would show only the publish
    // failure, and the user would never learn why their delete did nothing.
    const combined = alertTexts().join('\n');
    expect(combined).toContain(`Deleting deck "${SLUG}" failed`);
    expect(combined).toContain(REFUSAL);
    expect(combined).toContain(`Publishing deck "${OTHER}" failed`);
    expect(combined).toContain('Build queue is locked');
  });
});
