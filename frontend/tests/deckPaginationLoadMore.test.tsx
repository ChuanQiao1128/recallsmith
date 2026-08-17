// @vitest-environment jsdom
//
// Characterization tests for loadPagedMore in DeckListPage.tsx — the "Load
// more" button and the append it performs. Written and run green against a
// COMPLETELY UNMODIFIED DeckListPage.tsx, before the paginated channel was
// lifted into useDeckPagination.
//
// loadPagedMore had zero coverage before this file. That matters for the
// extraction specifically: `applyDecksPage(prev, page, 'append')` and
// `applyDecksPage(empty, page, 'reset')` differ by one string literal, and a
// hook that returned `reset` for both would still render a page of decks, still
// answer "did it load?" yes, and still pass every other test in the suite. The
// only thing that goes wrong is that page 2 silently replaces page 1.
//
// THREE fixture pages, not two. Two pages would pass even if cursor-1 were
// sent twice, because the second request's response is the last one applied
// either way. The SECOND load-more is the only assertion that can see a stale
// `paged` closure — and a stale closure is exactly what a useCallback with the
// wrong deps array produces. The loaders are plain `async function`
// declarations today, rebuilt every render, so they always close over the
// newest `paged`; the third page is what will notice if that changes.
//
// The mount is deliberately bare — <MemoryRouter><DeckListPage /></MemoryRouter>
// with no ConfirmDialogProvider, matching deckListPagePolling.test.tsx. That is
// not laziness: useConfirm() falls back to window.confirm when no provider is
// an ancestor, and these four files are additional witnesses that the fallback
// is real rather than a claim in a comment.
//
// NOT COVERED, stated rather than papered over: the `!paged.hasMore` term of
// loadPagedMore's early-return guard cannot be reached through the UI, because
// the button is not rendered at all when hasMore is false. It is depth for a
// non-UI caller. Nothing here tests it.

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

// Spread over the real module so ADMIN_DECKS_ENDPOINT_MISSING stays the real
// constant: a hand-written copy of it would keep passing after the export was
// renamed.
vi.mock('../src/api/authoring', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/api/authoring')>();
  return { ...actual, ...api };
});

const { DeckListPage } = await import('../src/pages/DeckListPage');
const { DECKS_PAGE_SIZE } = await import('../src/pages/deckListPagination');

/** The four slugs this file can render. Chosen so no one is a substring of
 *  another, which is what lets rowSlugs() read a row by its text. */
const ALL_SLUGS = ['deck-1', 'deck-2', 'deck-3', 'deck-4'];

function ok<T>(data: T): ApiResult<T> {
  return { success: true, data, error: null, traceId: 'trace-ok' };
}

function item(slug: string, title: string): AdminDeckListItem {
  return {
    slug,
    title,
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

function page1(): AdminDecksPage {
  return { items: [item('deck-1', 'Deck One'), item('deck-2', 'Deck Two')], nextCursor: 'cur-1', hasMore: true };
}
function page2(): AdminDecksPage {
  return { items: [item('deck-3', 'Deck Three')], nextCursor: 'cur-2', hasMore: true };
}
function page3(): AdminDecksPage {
  return { items: [item('deck-4', 'Deck Four')], nextCursor: null, hasMore: false };
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

/**
 * The table's slugs, in render order, read off the single tbody.
 *
 * Returns the whole ordered array rather than a count on purpose: `['deck-3']`
 * and `['deck-1','deck-2','deck-3']` are both "some rows", and a length
 * assertion of 3 would also accept a page that had been reset and refilled.
 */
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

function loadMoreButton(): HTMLButtonElement {
  return screen.getByText('Load more') as HTMLButtonElement;
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
  // resetAllMocks, not clearAllMocks: this file queues responses with
  // mockResolvedValueOnce, and mockClear empties mock.calls while LEAVING an
  // unconsumed once-value in the queue. A case that fails early therefore hands
  // its leftover page to the next case as that case's FIRST response. Found by
  // mutation P1-M1, which turned T1 red and then turned T1b red too — for the
  // unrelated reason that T1's undrained page 3 (hasMore: false) arrived as
  // T1b's page 1, so there was no "Load more" button to press. A harness whose
  // failures propagate sideways makes every later mutation result unreadable.
  vi.resetAllMocks();
  signOut();

  expect(errors).toEqual([]);
  // No fallback is expected in this file, so a warning here would mean the page
  // quietly left paginated mode and these assertions were measuring legacy.
  expect(warns).toEqual([]);
});

describe('Load more walks the cursor forward and appends', () => {
  it('T1: three pages arrive in order, each keyed on the cursor the last one returned', async () => {
    api.fetchAdminDecksPage
      .mockResolvedValueOnce(ok(page1()))
      .mockResolvedValueOnce(ok(page2()))
      .mockResolvedValueOnce(ok(page3()));

    await mountConsole();

    expect(rowSlugs()).toEqual(['deck-1', 'deck-2']);
    expect(screen.getByText('Loaded 2 decks')).not.toBeNull();
    expect(loadMoreButton()).not.toBeNull();
    expect(api.fetchAdminDecksPage).toHaveBeenCalledTimes(1);
    // The first request carries no cursor at all; DECKS_PAGE_SIZE is imported
    // rather than written as 50, so changing the constant cannot make this file
    // assert a page size the app no longer uses.
    expect(api.fetchAdminDecksPage.mock.calls[0][0]).toEqual({ limit: DECKS_PAGE_SIZE, q: '' });

    await act(async () => {
      fireEvent.click(loadMoreButton());
    });
    await settle();

    expect(api.fetchAdminDecksPage).toHaveBeenCalledTimes(2);
    expect(api.fetchAdminDecksPage.mock.calls[1][0]).toEqual({
      limit: DECKS_PAGE_SIZE,
      cursor: 'cur-1',
      q: '',
    });
    // Appended, not replaced. This ordered array is the whole point of the file.
    expect(rowSlugs()).toEqual(['deck-1', 'deck-2', 'deck-3']);
    expect(screen.getByText('Loaded 3 decks')).not.toBeNull();
    expect(screen.queryByText('Load more')).not.toBeNull();

    await act(async () => {
      fireEvent.click(loadMoreButton());
    });
    await settle();

    expect(api.fetchAdminDecksPage).toHaveBeenCalledTimes(3);
    // cur-2, not cur-1. A loader memoised on a stale `paged` would re-send the
    // cursor it saw on the render that created it, and the list would stall on
    // page 2 forever while still looking like it was loading more.
    expect(api.fetchAdminDecksPage.mock.calls[2][0]).toEqual({
      limit: DECKS_PAGE_SIZE,
      cursor: 'cur-2',
      q: '',
    });
    expect(rowSlugs()).toEqual(['deck-1', 'deck-2', 'deck-3', 'deck-4']);
    expect(screen.getByText('Loaded 4 decks · end of list')).not.toBeNull();
    // hasMore false → the control is gone, not merely disabled.
    expect(screen.queryByText('Load more')).toBeNull();
  });

  it('T1b: a second press while the first is still in flight sends nothing', async () => {
    api.fetchAdminDecksPage
      .mockResolvedValueOnce(ok(page1()))
      // Never settles: the load-more stays in flight for the rest of the case.
      .mockReturnValueOnce(new Promise<never>(() => {}));

    await mountConsole();
    expect(api.fetchAdminDecksPage).toHaveBeenCalledTimes(1);

    await act(async () => {
      fireEvent.click(loadMoreButton());
    });
    await settle();

    expect(api.fetchAdminDecksPage).toHaveBeenCalledTimes(2);

    // The mechanism, asserted rather than inferred from the call count: while
    // pagedLoadingMore is true the control reports itself busy AND is disabled,
    // which is what actually stops the second press in a browser. The
    // `pagedLoadingMore ||` term of loadPagedMore's early-return guard is a
    // second line of defence behind this one, and is therefore NOT what this
    // case measures — see the mutation log.
    const busy = screen.getByText('Loading more…') as HTMLButtonElement;
    expect(busy.disabled).toBe(true);
    expect(screen.queryByText('Load more')).toBeNull();

    await act(async () => {
      fireEvent.click(busy);
    });
    await settle();

    expect(api.fetchAdminDecksPage).toHaveBeenCalledTimes(2);
    expect(rowSlugs()).toEqual(['deck-1', 'deck-2']);
  });
});
