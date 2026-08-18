// @vitest-environment jsdom
//
// Characterization tests for the paginated -> legacy fallback, which now lives
// in src/features/deckList/useDeckPagination.ts (:151-168) after that channel was lifted
// out of DeckListPage.tsx. Covers the two branches nothing pinned.
//
// PAGINATED_FALLBACK_CODES (useDeckPagination.ts:71-75) holds three genuinely
// distinct codes:
// ADMIN_DECKS_ENDPOINT_MISSING resolves to 'ENDPOINT_NOT_FOUND', which is NOT
// the same string as 'NOT_FOUND'. Only the first was covered
// (deckListPageLegacyPath.test.tsx L2), so deleting 'FORBIDDEN' from that set
// was an all-green edit — and 403 is the common case in the field: a session
// that is not super_admin refused at the gateway.
//
// F3 guards a single line, the `listModeRef.current = 'legacy'` assignment in
// the paginated-to-legacy fallback (useDeckPagination.ts:158):
//
//     listModeRef.current = 'legacy';
//     setListMode('legacy');
//
// The ref and the state say the same thing, which makes the ref look
// redundant, and merging them into one useState is the most natural move when
// this page is lifted into a hook. It is not redundant. The debounced-search
// effect (useDeckPagination.ts:207-211) reads listModeRef.current synchronously
// to decide whether
// to re-query the paginated endpoint, and no existing test types into the
// search box after a fallback — so today that line is written and never read
// by any test. Delete it and the console goes back to hammering an endpoint
// that already answered 403, once per search keystroke burst.
//
// These were written and run green against a completely unmodified
// DeckListPage.tsx, before anything was moved out of it. They then survived the
// useDeckPagination extraction with the assertions untouched — only the line
// references in this header changed, and only because the code they point at
// moved file. The bodies below are byte-for-byte what they were.
//
// This file duplicates ~40 lines of fixture from deckListPageLegacyPath.test.tsx
// rather than appending cases there. That file's header makes a specific
// provenance claim about L1-L3, and diluting it costs more than the
// duplication does.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import type { AdminDecksPage, PublishJob } from '../src/api/authoring';
import type { ApiResult } from '../src/types/api';
import type { Deck } from '../src/types/deck';
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
const { ADMIN_DECKS_ENDPOINT_MISSING } = await import('../src/api/authoring');

const PUBLISHED_SLUG = 'fallback-published';
const DRAFT_SLUG = 'fallback-draft';

function deck(overrides: Partial<Deck> & Pick<Deck, 'id' | 'slug' | 'title'>): Deck {
  return {
    author: 'tests',
    locale: 'en',
    deckType: 2,
    version: 1,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-02T00:00:00Z',
    totalCards: 12,
    ...overrides,
  };
}

function ok<T>(data: T): ApiResult<T> {
  return { success: true, data, error: null, traceId: 'trace-ok' };
}

function refused<T>(code: string, message: string): ApiResult<T> {
  return { success: false, data: null, error: { code, message }, traceId: 'trace-refused' };
}

function manifestPayload(): Record<string, unknown> {
  return {
    manifest: {
      SchemaVersion: 3,
      Prefix: 'content/v3',
      Decks: [
        { Slug: PUBLISHED_SLUG, Title: 'Fallback Published', BuildId: 'build-777', TotalCards: 12 },
        { Slug: DRAFT_SLUG, Title: 'Fallback Draft', BuildId: null, TotalCards: 4 },
      ],
    },
  };
}

/** Every fixture returns no jobs: these cases assert exact call counts, and an
 *  active job would move the poll off the 30s idle cadence. */
function noJobs(): ApiResult<PublishJob[]> {
  return ok([]);
}

const FALLBACK_LOG_PREFIX = '[DeckListPage] GET /api/v1/admin/decks unavailable';

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

/** Fallback warnings only; anything else on this channel is a real complaint. */
function fallbackWarnings(): unknown[][] {
  return (consoleWarn.mock.calls as unknown[][]).filter(call =>
    String(call[0]).startsWith(FALLBACK_LOG_PREFIX),
  );
}

function rowTitles(): string[] {
  const bodies = document.querySelectorAll('tbody');
  expect(bodies).toHaveLength(1);
  const out: string[] = [];
  for (const tr of Array.from(bodies[0].querySelectorAll('tr'))) {
    const text = tr.textContent ?? '';
    for (const slug of [PUBLISHED_SLUG, DRAFT_SLUG]) {
      if (text.includes(slug)) out.push(slug);
    }
  }
  return out;
}

beforeEach(() => {
  signOut();
  signInAsSuperAdmin();
  vi.useFakeTimers();
  api.fetchPublishJobs.mockResolvedValue(noJobs());
  api.fetchAdminDecksPage.mockResolvedValue(ok({ items: [], nextCursor: null, hasMore: false }));
  api.fetchDecks.mockResolvedValue(
    ok([
      deck({ id: 1, slug: PUBLISHED_SLUG, title: 'Fallback Published' }),
      deck({ id: 2, slug: DRAFT_SLUG, title: 'Fallback Draft', totalCards: 4 }),
    ]),
  );
  api.fetchAdminManifest.mockResolvedValue(ok(manifestPayload()));
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();

  const errors = consoleError.mock.calls as unknown[][];
  const otherWarns = (consoleWarn.mock.calls as unknown[][]).filter(
    call => !String(call[0]).startsWith(FALLBACK_LOG_PREFIX),
  );
  consoleError.mockRestore();
  consoleWarn.mockRestore();
  expect(errors).toEqual([]);
  expect(otherWarns).toEqual([]);

  vi.clearAllMocks();
  signOut();
});

describe('every code in PAGINATED_FALLBACK_CODES actually falls back', () => {
  it('F1: FORBIDDEN (403) re-fetches through the legacy path and renders rows', async () => {
    api.fetchAdminDecksPage.mockResolvedValue(
      refused<AdminDecksPage>('FORBIDDEN', 'super_admin required'),
    );

    await mountConsole();

    expect(api.fetchAdminDecksPage).toHaveBeenCalledTimes(1);
    // Not "the mode flipped": the two requests the fallback exists to issue.
    expect(api.fetchDecks).toHaveBeenCalledTimes(1);
    expect(api.fetchAdminManifest).toHaveBeenCalledTimes(1);
    // And a usable page, not an empty table under a switched flag.
    expect(rowTitles()).toEqual([PUBLISHED_SLUG, DRAFT_SLUG]);
    expect(fallbackWarnings()).toHaveLength(1);
  });

  it('F2: NOT_FOUND (404) re-fetches through the legacy path and renders rows', async () => {
    // Distinct from ADMIN_DECKS_ENDPOINT_MISSING, which is the string
    // 'ENDPOINT_NOT_FOUND'. F1 and F2 must not cover for each other.
    api.fetchAdminDecksPage.mockResolvedValue(
      refused<AdminDecksPage>('NOT_FOUND', 'no such route'),
    );

    await mountConsole();

    expect(api.fetchAdminDecksPage).toHaveBeenCalledTimes(1);
    expect(api.fetchDecks).toHaveBeenCalledTimes(1);
    expect(api.fetchAdminManifest).toHaveBeenCalledTimes(1);
    expect(rowTitles()).toEqual([PUBLISHED_SLUG, DRAFT_SLUG]);
    expect(fallbackWarnings()).toHaveLength(1);
  });
});

describe('after a fallback, the search box stays off the paginated endpoint', () => {
  it('F3: typing past the debounce issues no second paged request', async () => {
    api.fetchAdminDecksPage.mockResolvedValue(
      refused<AdminDecksPage>(ADMIN_DECKS_ENDPOINT_MISSING, 'admin decks endpoint not deployed'),
    );

    await mountConsole();

    expect(api.fetchAdminDecksPage).toHaveBeenCalledTimes(1);
    expect(api.fetchDecks).toHaveBeenCalledTimes(1);
    expect(rowTitles()).toEqual([PUBLISHED_SLUG, DRAFT_SLUG]);

    const input = screen.getByPlaceholderText('Search by slug or title...');
    await act(async () => {
      fireEvent.change(input, { target: { value: 'fallback' } });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    await settle();

    // The whole point of that assignment. With listModeRef left on
    // 'paginated', the
    // [debouncedQ] effect would call loadPagedFirst('fallback') and the console
    // would re-ask an endpoint that already refused — once per search burst.
    expect(api.fetchAdminDecksPage).toHaveBeenCalledTimes(1);
    expect(api.fetchDecks).toHaveBeenCalledTimes(1);
    // A second fallback log is the other visible symptom of the same edit.
    expect(fallbackWarnings()).toHaveLength(1);
    // The legacy client-side filter still works, so this is not passing
    // because the page went inert.
    expect(rowTitles()).toEqual([PUBLISHED_SLUG, DRAFT_SLUG]);
  });
});
