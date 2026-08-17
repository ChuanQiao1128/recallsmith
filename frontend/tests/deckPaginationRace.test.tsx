// @vitest-environment jsdom
//
// Characterization tests for the pagedRequestSeq guard in DeckListPage.tsx —
// the two lines that decide whether a response is still wanted by the time it
// arrives. Written and run green against a COMPLETELY UNMODIFIED
// DeckListPage.tsx.
//
//     const seq = ++pagedRequestSeq.current;
//     ...
//     if (!mountedRef.current || seq !== pagedRequestSeq.current) return;
//
// Zero coverage before this file, and it is the single most fragile thing in
// the block being lifted into a hook: `pagedRequestSeq` is a useRef, and a ref
// that becomes a useState looks identical at every call site, type-checks, and
// destroys the guard — the comparison then reads the value captured by the
// render that started the request instead of the newest one, so every guard
// passes and the LAST response to arrive wins rather than the NEWEST request.
//
// HOW ARRIVAL ORDER IS CONTROLLED: not by timing. Each call to
// fetchAdminDecksPage returns a promise that is parked in `pending` and never
// settles until this file calls resolve on it by index. Order of arrival is
// therefore a statement in the test body, independent of jsdom, of fake timers,
// and of microtask scheduling — none of which can be relied on to interleave
// two awaits reproducibly.
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

const ALL_SLUGS = ['alpha', 'stale-beta', 'gamma', 'deck-1', 'deck-2', 'deck-3', 'deck-9'];

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

/** A promise whose resolve is reachable from outside it. */
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => {
    resolve = r;
  });
  return { promise, resolve };
}

let pending: Deferred<ApiResult<AdminDecksPage>>[] = [];

function ok<T>(data: T): ApiResult<T> {
  return { success: true, data, error: null, traceId: 'trace-ok' };
}

function item(slug: string): AdminDeckListItem {
  return {
    slug,
    title: slug.toUpperCase(),
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

function mountConsole(): void {
  render(
    <MemoryRouter initialEntries={['/']}>
      <DeckListPage />
    </MemoryRouter>,
  );
}

/** Resolve the i-th parked request and let React finish with the answer. */
async function land(index: number, value: ApiResult<AdminDecksPage>): Promise<void> {
  pending[index].resolve(value);
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

async function search(value: string): Promise<void> {
  const input = screen.getByPlaceholderText('Search by slug or title...');
  await act(async () => {
    fireEvent.change(input, { target: { value } });
  });
  await act(async () => {
    // The 300ms debounce constant is read, never written: this file must not
    // become a reason the constant cannot change.
    await vi.advanceTimersByTimeAsync(300);
  });
  await settle();
}

beforeEach(() => {
  signOut();
  signInAsSuperAdmin();
  vi.useFakeTimers();
  pending = [];
  api.fetchPublishJobs.mockResolvedValue(noJobs());
  api.fetchDecks.mockResolvedValue(ok([]));
  api.fetchAdminManifest.mockResolvedValue(ok({}));
  api.fetchAdminDecksPage.mockImplementation(() => {
    const d = deferred<ApiResult<AdminDecksPage>>();
    pending.push(d);
    return d.promise;
  });
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

describe('a superseded first-page load cannot overwrite a newer one', () => {
  it('R1: the older search result lands last and changes nothing', async () => {
    mountConsole();
    await settle();

    // The first response has to land before anything else can happen: until
    // pagedInitialized flips, initialLoading blanks the whole page and there is
    // no search box to type into.
    expect(pending).toHaveLength(1);
    await land(0, ok(page(['alpha'])));
    expect(rowSlugs()).toEqual(['alpha']);

    await search('be');
    await search('bet');

    expect(pending).toHaveLength(3);
    expect(api.fetchAdminDecksPage.mock.calls[1][0].q).toBe('be');
    expect(api.fetchAdminDecksPage.mock.calls[2][0].q).toBe('bet');

    // Newest first.
    await land(2, ok(page(['gamma'])));
    expect(rowSlugs()).toEqual(['gamma']);

    // Then the one the user already abandoned. Landing it LAST is the only
    // ordering in which a missing guard is visible: if the stale response
    // arrived first, the newer one's 'reset' would paper over it anyway.
    await land(1, ok(page(['stale-beta'])));
    expect(rowSlugs()).toEqual(['gamma']);
    expect(screen.queryByText('stale-beta')).toBeNull();
  });

  it('R1c: that same stale fixture renders fine when nothing supersedes it', async () => {
    // Anti-vacuum control. Without this, R1 would also pass if `stale-beta`
    // simply could not be rendered — a fixture typo would look like a guard.
    mountConsole();
    await settle();

    expect(pending).toHaveLength(1);
    await land(0, ok(page(['stale-beta'])));

    expect(rowSlugs()).toEqual(['stale-beta']);
    expect(screen.queryByText('stale-beta')).not.toBeNull();
  });
});

describe('a superseded load-more cannot append onto a newer first page', () => {
  it('R2: the in-flight page 2 is dropped when a search has replaced the list', async () => {
    mountConsole();
    await settle();

    expect(pending).toHaveLength(1);
    await land(0, ok(page(['deck-1', 'deck-2'], 'cur-1', true)));
    expect(rowSlugs()).toEqual(['deck-1', 'deck-2']);

    // Older request: load-more, seq N.
    await act(async () => {
      fireEvent.click(screen.getByText('Load more'));
    });
    await settle();
    expect(pending).toHaveLength(2);

    // Newer request: a search-driven first page, seq N+1.
    await search('deck-9');
    expect(pending).toHaveLength(3);

    await land(2, ok(page(['deck-9'], 'cur-9', true)));
    expect(rowSlugs()).toEqual(['deck-9']);

    // And now the abandoned page 2 arrives. Appending it here would show a row
    // that does not match the query the user is looking at.
    await land(1, ok(page(['deck-3'], 'cur-3', true)));

    expect(rowSlugs()).toEqual(['deck-9']);
    expect(screen.queryByText('deck-3')).toBeNull();

    // The control is usable again rather than stuck reporting work that was
    // abandoned.
    const button = screen.getByText('Load more') as HTMLButtonElement;
    expect(button.disabled).toBe(false);
  });
});
