// @vitest-environment jsdom
//
// Characterization tests for resolveDeckId in DeckListPage.tsx. Written and run
// green against a COMPLETELY UNMODIFIED DeckListPage.tsx.
//
// PROVENANCE, stated precisely so this file is not misread later:
// resolveDeckId is NOT part of the block being lifted into useDeckPagination,
// and nothing here is evidence about moved text. It is in this set for one
// reason: its `row.id === null` branch is reachable ONLY in paginated mode —
// AdminDeckListItem declares id as optional and the contract does not promise
// it, while every legacy row is built from a Deck that has one. The hook's
// output is therefore this function's only input, and the hook is about to
// start producing that output from a different file. What it writes on failure
// (setErrors / ERR_RESOLVE_ID) stays on the page, which is precisely why the
// resolvedIdsRef declaration two lines below the paginated state block does NOT
// travel with it.
//
// The page is mounted as a direct child of MemoryRouter with no <Routes> around
// it — the shape every existing test in this repo uses. That is load-bearing
// here and not incidental: because no route gates it, navigate() updates
// history without unmounting the page, which is the only reason clicking a
// SECOND action on the SAME row is possible at all. Under a <Routes> the first
// click would tear the table down and take resolvedIdsRef with it, and T3b
// could not exist.
//
// Bare mount with no ConfirmDialogProvider, matching deckListPagePolling.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';

import type { AdminDeckListItem, AdminDecksPage, PublishJob } from '../src/api/authoring';
import type { ApiResult } from '../src/types/api';
import type { Deck } from '../src/types/deck';
import { signInAsSuperAdmin, signOut } from './support/consoleSession';

const api = vi.hoisted(() => ({
  fetchPublishJobs: vi.fn(),
  fetchAdminDecksPage: vi.fn(),
  fetchDecks: vi.fn(),
  fetchAdminManifest: vi.fn(),
  fetchDeckBySlug: vi.fn(),
}));

vi.mock('../src/api/authoring', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/api/authoring')>();
  return { ...actual, ...api };
});

const { DeckListPage } = await import('../src/pages/DeckListPage');

function ok<T>(data: T): ApiResult<T> {
  return { success: true, data, error: null, traceId: 'trace-ok' };
}

function refused<T>(code: string, message: string): ApiResult<T> {
  return { success: false, data: null, error: { code, message }, traceId: 'trace-refused' };
}

function item(slug: string, id: number | null): AdminDeckListItem {
  return {
    slug,
    title: `Title ${slug}`,
    id,
    deckType: null,
    tier: null,
    availability: null,
    totalCards: 3,
    version: 1,
    updatedAtMs: 1767225600000,
    latestBuildId: 'build-1',
  };
}

function onePage(items: AdminDeckListItem[]): AdminDecksPage {
  return { items, nextCursor: null, hasMore: false };
}

function noJobs(): ApiResult<PublishJob[]> {
  return ok([]);
}

/** Renders the current location so navigate() is observable without <Routes>. */
function LocationProbe() {
  const location = useLocation();
  return <span data-testid="loc">{`${location.pathname}${location.search}`}</span>;
}

let consoleError: ReturnType<typeof vi.spyOn>;
let consoleWarn: ReturnType<typeof vi.spyOn>;

async function settle(): Promise<void> {
  for (let i = 0; i < 6; i += 1) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
  }
}

async function mountConsole(): Promise<void> {
  render(
    <MemoryRouter initialEntries={['/']}>
      <DeckListPage />
      <LocationProbe />
    </MemoryRouter>,
  );
  await settle();
}

function locationText(): string {
  return screen.getByTestId('loc').textContent ?? '';
}

/** Click a row action by its label, inside the row carrying `slug`. */
async function clickRowAction(slug: string, label: string): Promise<void> {
  const bodies = document.querySelectorAll('tbody');
  expect(bodies).toHaveLength(1);
  const row = Array.from(bodies[0].querySelectorAll('tr')).find(tr =>
    (tr.textContent ?? '').includes(slug),
  );
  expect(row, `no row for ${slug}`).not.toBeUndefined();

  const button = Array.from((row as HTMLElement).querySelectorAll('button')).find(
    b => (b.textContent ?? '').trim() === label,
  );
  expect(button, `no ${label} button in the ${slug} row`).not.toBeUndefined();

  await act(async () => {
    fireEvent.click(button as HTMLButtonElement);
  });
  await settle();
}

beforeEach(() => {
  signOut();
  signInAsSuperAdmin();
  vi.useFakeTimers();
  api.fetchPublishJobs.mockResolvedValue(noJobs());
  api.fetchDecks.mockResolvedValue(ok([]));
  api.fetchAdminManifest.mockResolvedValue(ok({}));
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();

  const errors = consoleError.mock.calls as unknown[][];
  const warns = consoleWarn.mock.calls as unknown[][];
  consoleError.mockRestore();
  consoleWarn.mockRestore();
  // Teardown runs BEFORE the first assertion, and that order is load-bearing.
  // With the assertions first, an afterEach that fails (say, an unexpected
  // console.warn) skips its own cleanup, so the failing case leaks its
  // undrained mock queue into the NEXT case. Found by mutation P4-M3, which
  // made T4b warn as designed and then made T4c fail for reasons that had
  // nothing to do with T4c. A teardown that only runs when the test passes is
  // not a teardown.
  vi.resetAllMocks();
  signOut();

  expect(errors).toEqual([]);
  expect(warns).toEqual([]);
});

describe('a paginated row with no id resolves one through the slug', () => {
  beforeEach(() => {
    api.fetchAdminDecksPage.mockResolvedValue(ok(onePage([item('deck-1', null)])));
    api.fetchDeckBySlug.mockResolvedValue(ok({ id: 7, slug: 'deck-1', title: 'Title deck-1' } as Deck));
  });

  it('T3a: the first action looks the id up and navigates with it', async () => {
    await mountConsole();
    expect(locationText()).toBe('/');

    await clickRowAction('deck-1', 'Cards');

    expect(api.fetchDeckBySlug).toHaveBeenCalledTimes(1);
    expect(api.fetchDeckBySlug.mock.calls[0][0]).toBe('deck-1');
    expect(locationText()).toBe('/decks/cards?deckId=7');
  });

  it('T3b: a second action on the same row reuses the cache and asks nothing', async () => {
    await mountConsole();

    await clickRowAction('deck-1', 'Cards');
    expect(api.fetchDeckBySlug).toHaveBeenCalledTimes(1);

    await clickRowAction('deck-1', 'Edit');

    expect(locationText()).toBe('/decks/edit?deckId=7');
    // Still one. resolvedIdsRef is the whole reason a deck with twelve row
    // actions costs one lookup rather than twelve.
    expect(api.fetchDeckBySlug).toHaveBeenCalledTimes(1);
  });
});

describe('a paginated row that already carries an id skips the lookup', () => {
  it('T3c: no request is issued at all', async () => {
    api.fetchAdminDecksPage.mockResolvedValue(ok(onePage([item('deck-2', 9)])));
    api.fetchDeckBySlug.mockResolvedValue(ok({ id: 9, slug: 'deck-2', title: 'Title deck-2' } as Deck));

    await mountConsole();
    await clickRowAction('deck-2', 'Cards');

    // The control for T3a: without it, "resolves through the slug" would also
    // be satisfied by a page that ignores the id the server sent.
    expect(api.fetchDeckBySlug).not.toHaveBeenCalled();
    expect(locationText()).toBe('/decks/cards?deckId=9');
  });
});

describe('a lookup that fails says so and stays put', () => {
  it('T3d: the failure is on screen, navigation did not happen, and a retry re-asks', async () => {
    api.fetchAdminDecksPage.mockResolvedValue(ok(onePage([item('deck-1', null)])));
    api.fetchDeckBySlug.mockResolvedValue(refused<Deck>('NOT_FOUND', 'Deck not found'));

    await mountConsole();
    await clickRowAction('deck-1', 'Cards');

    const alerts = screen.getAllByRole('alert');
    expect(alerts.length).toBeGreaterThan(0);
    expect(alerts.some(a => (a.textContent ?? '').includes('Could not look up deck "deck-1"'))).toBe(
      true,
    );
    expect(locationText()).toBe('/');

    await clickRowAction('deck-1', 'Cards');

    // Nothing was cached, so the second press is a real second attempt. If the
    // NaN had been written into resolvedIdsRef, this would be 1 and the row
    // would be permanently dead for the rest of the session.
    expect(api.fetchDeckBySlug).toHaveBeenCalledTimes(2);
    expect(locationText()).toBe('/');
  });
});
