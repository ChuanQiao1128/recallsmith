// @vitest-environment jsdom
//
// Characterization tests for what pagedError and pagedLoading actually put on
// screen. Written and run green against a COMPLETELY UNMODIFIED
// DeckListPage.tsx.
//
// pagedError has two entirely different renderings and they were covered
// unevenly. deckListPageLegacyPath.test.tsx pins the half that says a
// non-fallback code must NOT flip the page into legacy mode; nothing pinned the
// half that says the message is then SHOWN, in one of two places depending on
// whether any rows survived:
//
//   * rows on screen  -> an inline note in the pagination footer, list intact;
//   * no rows at all  -> the full-page "Failed to load decks" panel.
//
// T4b is the one this repo most needed. The Retry button on that panel is a
// control that exists and, until this file, was never pressed by any test —
// the exact defect shape this codebase has shipped thirteen times. Pressing it
// is also the only way to find out that it re-enters the PAGINATED loader and
// not loadAll: those two differ by which endpoint gets hit, and both of them
// make the panel go away.
//
// Bare mount with no ConfirmDialogProvider, matching deckListPagePolling.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import type { AdminDeckListItem, AdminDecksPage, PublishJob } from '../src/api/authoring';
import type { ApiResult } from '../src/types/api';
import { signInAsSuperAdmin, signOut } from './support/consoleSession';

const api = vi.hoisted(() => ({
  fetchPublishJobs: vi.fn(),
  fetchAdminDecksPage: vi.fn(),
  fetchDecks: vi.fn(),
  fetchAdminManifest: vi.fn(),
}));

vi.mock('../src/api/authoring', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/api/authoring')>();
  return { ...actual, ...api };
});

const { DeckListPage } = await import('../src/pages/DeckListPage');
const { DECKS_PAGE_SIZE } = await import('../src/pages/deckListPagination');

const ALL_SLUGS = ['deck-1', 'deck-2', 'deck-3'];
const REBUILDING = 'deck index is rebuilding';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => {
    resolve = r;
  });
  return { promise, resolve };
}

function ok<T>(data: T): ApiResult<T> {
  return { success: true, data, error: null, traceId: 'trace-ok' };
}

function refused<T>(code: string, message: string): ApiResult<T> {
  return { success: false, data: null, error: { code, message }, traceId: 'trace-refused' };
}

function item(slug: string): AdminDeckListItem {
  return {
    slug,
    title: `Title ${slug}`,
    id: null,
    deckType: null,
    tier: null,
    availability: null,
    totalCards: 3,
    version: 1,
    updatedAtMs: 1767225600000,
    latestBuildId: 'build-1',
  };
}

function page(slugs: string[], nextCursor: string | null = null, hasMore = false): AdminDecksPage {
  return { items: slugs.map(item), nextCursor, hasMore };
}

function noJobs(): ApiResult<PublishJob[]> {
  return ok([]);
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
    </MemoryRouter>,
  );
  await settle();
}

function rowSlugs(): string[] {
  const bodies = document.querySelectorAll('tbody');
  expect(bodies).toHaveLength(1);
  const out: string[] = [];
  for (const tr of Array.from(bodies[0].querySelectorAll('tr'))) {
    const text = tr.textContent ?? '';
    for (const slug of ALL_SLUGS) {
      if (text.includes(slug)) out.push(slug);
    }
  }
  return out;
}

/**
 * The pagination footer, found through the "Loaded N decks" label it always
 * renders. Scoped deliberately: the fatal panel prints the SAME message string
 * elsewhere in the document, so a bare getByText(REBUILDING) would be satisfied
 * by the surface this case is asserting did NOT appear.
 */
function paginationFooter(): HTMLElement {
  const label = Array.from(document.querySelectorAll('span')).find(span =>
    /^(Loaded \d+ deck|Loading…$)/.test((span.textContent ?? '').trim()),
  );
  expect(label, 'pagination footer label not found').not.toBeUndefined();
  const footer = (label as HTMLElement).parentElement;
  expect(footer).not.toBeNull();
  return footer as HTMLElement;
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
  // resetAllMocks, not clearAllMocks — see the note in
  // tests/deckPaginationLoadMore.test.tsx. This file also queues responses with
  // mockResolvedValueOnce, and mockClear leaves an unconsumed one in the queue
  // for the next case to receive as its first response.
  vi.resetAllMocks();
  signOut();

  expect(errors).toEqual([]);
  // A fallback warning here would mean SERVER_ERROR had been treated as a
  // fallback code, which is the very thing these cases deny.
  expect(warns).toEqual([]);
});

describe('a failed load-more keeps the list and notes the failure beside it', () => {
  it('T4a: the message sits in the footer, and a later success clears it', async () => {
    api.fetchAdminDecksPage
      .mockResolvedValueOnce(ok(page(['deck-1', 'deck-2'], 'cur-1', true)))
      .mockResolvedValueOnce(refused<AdminDecksPage>('SERVER_ERROR', REBUILDING))
      .mockResolvedValueOnce(ok(page(['deck-3'])));

    await mountConsole();
    expect(rowSlugs()).toEqual(['deck-1', 'deck-2']);

    await act(async () => {
      fireEvent.click(screen.getByText('Load more'));
    });
    await settle();

    expect(paginationFooter().textContent).toContain(REBUILDING);
    // The rows the user already had are still there.
    expect(rowSlugs()).toEqual(['deck-1', 'deck-2']);
    // SERVER_ERROR is not in PAGINATED_FALLBACK_CODES, so the legacy path must
    // stay untouched — no silent second data source behind a one-line note.
    expect(api.fetchDecks).not.toHaveBeenCalled();
    expect(api.fetchAdminManifest).not.toHaveBeenCalled();
    expect(screen.queryByText('Load more')).not.toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByText('Load more'));
    });
    await settle();

    expect(paginationFooter().textContent).not.toContain(REBUILDING);
    expect(screen.queryByText(REBUILDING)).toBeNull();
    expect(rowSlugs()).toEqual(['deck-1', 'deck-2', 'deck-3']);
  });
});

describe('a failed first page takes over the screen, and Retry works', () => {
  it('T4b: the panel appears, and pressing Retry re-asks the paginated endpoint', async () => {
    api.fetchAdminDecksPage
      .mockResolvedValueOnce(refused<AdminDecksPage>('SERVER_ERROR', REBUILDING))
      .mockResolvedValueOnce(ok(page(['deck-1'])));

    await mountConsole();

    expect(screen.getByText('Failed to load decks')).not.toBeNull();
    expect(screen.getByText(REBUILDING)).not.toBeNull();
    expect(api.fetchDecks).not.toHaveBeenCalled();
    expect(document.querySelectorAll('tbody')).toHaveLength(0);

    await act(async () => {
      fireEvent.click(screen.getByText('Retry'));
    });
    await settle();

    // The endpoint, not merely "some request". `void loadAll(true)` would also
    // make the panel disappear and would also render rows — through the legacy
    // path, against an endpoint this session was never supposed to use.
    expect(api.fetchAdminDecksPage).toHaveBeenCalledTimes(2);
    expect(api.fetchAdminDecksPage.mock.calls[1][0]).toEqual({ limit: DECKS_PAGE_SIZE, q: '' });
    expect(api.fetchDecks).not.toHaveBeenCalled();

    expect(screen.queryByText('Failed to load decks')).toBeNull();
    expect(rowSlugs()).toEqual(['deck-1']);
  });
});

describe('an in-flight reload says so in the table body', () => {
  it('T4c: the rows give way to a loading line and come back', async () => {
    const second = deferred<ApiResult<AdminDecksPage>>();
    api.fetchAdminDecksPage
      .mockResolvedValueOnce(ok(page(['deck-1', 'deck-2'])))
      .mockReturnValueOnce(second.promise);

    await mountConsole();
    expect(rowSlugs()).toEqual(['deck-1', 'deck-2']);

    const input = screen.getByPlaceholderText('Search by slug or title...');
    await act(async () => {
      fireEvent.change(input, { target: { value: 'deck-3' } });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    await settle();

    expect(screen.getByText('Loading decks…')).not.toBeNull();
    // Not "plus a spinner": the old rows are gone while the new answer is
    // pending, so nothing on screen contradicts the query in the box.
    expect(rowSlugs()).toEqual([]);

    await act(async () => {
      second.resolve(ok(page(['deck-3'])));
    });
    await settle();

    expect(screen.queryByText('Loading decks…')).toBeNull();
    expect(rowSlugs()).toEqual(['deck-3']);
  });
});
