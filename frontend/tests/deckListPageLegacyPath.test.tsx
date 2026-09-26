// @vitest-environment jsdom
//
// Characterization tests for DeckListPage's legacy data path.
//
// This page has two ways to load decks. The super-admin path asks the
// cursor-paged /api/v1/admin/decks. Everyone else — and every super admin whose
// first request comes back 403 or 404 — goes down the legacy path: a full
// fetchDecks() beside a fetchAdminManifest(), joined by slug, with publish
// status derived from whether the manifest entry carries a buildId or a path.
//
// deckListPagePolling.test.tsx is the only other test that mounts this page,
// and every one of its cases signs in as a super admin against a paginated
// endpoint that answers. So the entire legacy branch — four manifest parsing
// functions, the slug join, the fallback — has never been executed by a test.
//
// The case that matters most here is L2. The fallback is written as two
// statements:
//
//   setListMode('legacy');
//   void loadAll(false);
//
// A test that only checks "the mode switched" passes with the second line
// deleted, and certifies a fallback that falls back to nothing and renders an
// empty table forever. So L2 asserts the requests were actually issued and the
// rows actually appeared. L3 exists so L2 cannot be satisfied by a page that
// simply falls back on every error: an error code outside the fallback set has
// to stay put.
//
// These were written and run green against a completely unmodified
// DeckListPage.tsx, before any function was exported or moved out of it. That
// ordering is what makes them evidence about the old behaviour rather than a
// restatement of the new.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import type { AdminDecksPage, PublishJob } from '../src/api/authoring';
import type { ApiResult } from '../src/types/api';
import type { Deck } from '../src/types/deck';
import { signInAsEditor, signInAsSuperAdmin, signOut } from './support/consoleSession';

const api = vi.hoisted(() => ({
  fetchPublishJobs: vi.fn(),
  fetchAdminDecksPage: vi.fn(),
  fetchDecks: vi.fn(),
  fetchAdminManifest: vi.fn(),
}));

// Spread the real module rather than replacing it: DeckListPage also imports
// ADMIN_DECKS_ENDPOINT_MISSING and builds its 403/404 fallback set from it, and
// a hand-written stub of that constant would let the fallback branch drift away
// from the code under test without any test noticing.
vi.mock('../src/api/authoring', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/api/authoring')>();
  return { ...actual, ...api };
});

const { DeckListPage } = await import('../src/pages/DeckListPage');
const { ADMIN_DECKS_ENDPOINT_MISSING } = await import('../src/api/authoring');

const PUBLISHED_SLUG = 'csharp-async';
const DRAFT_SLUG = 'csharp-linq';

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

/**
 * A manifest in the shape the server actually sends: wrapped in { manifest },
 * PascalCase keys, one entry carrying a buildId and one carrying neither
 * buildId nor path. Only the first is published.
 */
function manifestPayload(): Record<string, unknown> {
  return {
    manifest: {
      SchemaVersion: 3,
      Prefix: 'content/v3',
      GeneratedAtMs: '1767225600000',
      Decks: [
        { Slug: PUBLISHED_SLUG, Title: 'C# Async', BuildId: 'build-777', TotalCards: 12 },
        { Slug: DRAFT_SLUG, Title: 'C# LINQ', BuildId: null, TotalCards: 4 },
      ],
    },
  };
}

function emptyDecksPage(): ApiResult<AdminDecksPage> {
  return ok({ items: [], nextCursor: null, hasMore: false });
}

function noJobs(): ApiResult<PublishJob[]> {
  return ok([]);
}

let consoleError: ReturnType<typeof vi.spyOn>;
let consoleWarn: ReturnType<typeof vi.spyOn>;

/** The page logs the fallback itself; anything else on these channels is a bug. */
const FALLBACK_LOG_PREFIX = '[DeckListPage] GET /api/v1/admin/decks unavailable';

/**
 * The table row for one deck, found the way a reader would: locate the title,
 * then look at the line it is on.
 *
 * Scoping matters. "Published" also appears as a summary tile and as an option
 * in the status filter, both of which are present no matter what the manifest
 * said, so an unscoped getByText would pass against a page that derived no
 * status at all. Asking for the badge *on this deck's row* is the only form
 * that ties the word to the join under test.
 */
function rowFor(title: string): HTMLElement {
  const row = screen.getByText(title).closest('tr');
  expect(row).not.toBeNull();
  return row as HTMLElement;
}

async function mountConsole(): Promise<void> {
  render(
    <MemoryRouter initialEntries={['/']}>
      <DeckListPage />
    </MemoryRouter>,
  );
  // The legacy path awaits two fetches in parallel and the fallback path awaits
  // a third before those two even start, so several microtask turns are needed
  // before the table exists. findBy* would only wait for one element; this
  // waits for the whole cascade to settle.
  await screen.findByText(/Console|Failed to load decks/i, {}, { timeout: 2000 });
}

beforeEach(() => {
  // Starts every case cold. DeckListPage caches decks and manifest in
  // localStorage for five minutes, and an inherited cache would let a case
  // render rows without issuing a request — which is exactly what these tests
  // claim to measure.
  signOut();
  api.fetchPublishJobs.mockResolvedValue(noJobs());
  api.fetchAdminDecksPage.mockResolvedValue(emptyDecksPage());
  api.fetchDecks.mockResolvedValue(
    ok([
      // liveBuildId is what an editor's Published badge now comes from: editors
      // skip the manifest, so decks.live_build_id is their only publish signal.
      deck({ id: 1, slug: PUBLISHED_SLUG, title: 'C# Async', liveBuildId: 'build-777' }),
      deck({ id: 2, slug: DRAFT_SLUG, title: 'C# LINQ', totalCards: 4, liveBuildId: null }),
    ]),
  );
  api.fetchAdminManifest.mockResolvedValue(ok(manifestPayload()));
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();

  const unexpectedErrors = consoleError.mock.calls as unknown[][];
  const unexpectedWarns = (consoleWarn.mock.calls as unknown[][]).filter(
    call => !String(call[0]).startsWith(FALLBACK_LOG_PREFIX),
  );
  consoleError.mockRestore();
  consoleWarn.mockRestore();
  expect(unexpectedErrors).toEqual([]);
  expect(unexpectedWarns).toEqual([]);

  vi.clearAllMocks();
  signOut();
});

describe('the legacy deck list path', () => {
  it('L1: an editor session loads decks without the paged endpoint or the manifest', async () => {
    signInAsEditor();

    await mountConsole();

    // Not "the mode is legacy" — the paged endpoint is super-admin gated, so
    // probing it at all would be a guaranteed 403 on every console load.
    expect(api.fetchAdminDecksPage).not.toHaveBeenCalled();
    expect(api.fetchDecks).toHaveBeenCalledTimes(1);
    // The manifest is super_admin-only too. Asking for it always 403s for an
    // editor and used to light a red banner on every load, so an editor session
    // must never touch it — publish status comes from liveBuildId instead.
    expect(api.fetchAdminManifest).not.toHaveBeenCalled();

    // The first deck carries a liveBuildId, so it reads Published even though no
    // manifest was ever fetched.
    expect(await screen.findByText('C# Async')).not.toBeNull();
    expect(within(rowFor('C# Async')).getByText('Published')).not.toBeNull();

    // The second deck has a null liveBuildId, so it must NOT be published —
    // otherwise "Published" above would prove nothing about the field, only that
    // the page can print the word.
    expect(within(rowFor('C# LINQ')).getByText('Needs Publish')).not.toBeNull();
    expect(within(rowFor('C# LINQ')).queryByText('Published')).toBeNull();
  });

  it('L2: a super admin whose paged endpoint is missing actually re-fetches, not just re-labels', async () => {
    signInAsSuperAdmin();
    api.fetchAdminDecksPage.mockResolvedValue(
      refused<AdminDecksPage>(ADMIN_DECKS_ENDPOINT_MISSING, 'admin decks endpoint not deployed'),
    );

    await mountConsole();

    expect(api.fetchAdminDecksPage).toHaveBeenCalledTimes(1);
    // The two lines that a mode-only assertion cannot see.
    expect(api.fetchDecks).toHaveBeenCalledTimes(1);
    expect(api.fetchAdminManifest).toHaveBeenCalledTimes(1);

    // And the rows arrived, so the fallback produced a usable page rather than
    // an empty table under a switched flag.
    expect(await screen.findByText('C# Async')).not.toBeNull();
    expect(within(rowFor('C# Async')).getByText('Published')).not.toBeNull();
  });

  it('L3: an error outside the fallback set stays on the paged path and surfaces', async () => {
    signInAsSuperAdmin();
    api.fetchAdminDecksPage.mockResolvedValue(
      refused<AdminDecksPage>('INTERNAL', 'deck index is rebuilding'),
    );

    await mountConsole();

    // Falling back here would hide a real server fault behind a slower query
    // against a different endpoint, and would also make L2 unfalsifiable: a
    // page that falls back on everything passes L2 for the wrong reason.
    expect(api.fetchDecks).not.toHaveBeenCalled();
    expect(api.fetchAdminManifest).not.toHaveBeenCalled();
    expect(screen.getByText('Failed to load decks')).not.toBeNull();
    expect(screen.getByText('deck index is rebuilding')).not.toBeNull();
  });
});
