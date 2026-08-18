// @vitest-environment jsdom
//
// The deck list this console remembers, and whose it is.
//
// DeckListPage's legacy path paints from a five-minute localStorage cache
// before any request goes out. That is a real optimisation and it was carrying
// three defects at once, each of which is invisible on its own:
//
//   1. one pair of keys for the BROWSER, not per account. Signing out and
//      signing in as somebody else showed the previous account's decks —
//      including decks this account has no permission to read — with no request
//      involved, so no server check could have caught it.
//   2. signing out did not clear it.
//   3. deleting or publishing a deck did not invalidate it, so the list kept
//      the deleted deck for up to five minutes.
//
// The scenario in "another account's cached rows" below is the one that makes
// (1) more than theoretical even with (2) fixed: closing the tab ends the
// session — sessionStorage holds the tokens — while localStorage survives it.
// So the next person to open this browser arrives with no session and a full
// cache, which is precisely the state a sign-out handler cannot clean up.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import type { AdminDecksPage, PublishJob } from '../src/api/authoring';
import type { Deck } from '../src/types/deck';
import {
  CACHE_TTL,
  clearSessionCaches,
  readSessionCache,
  writeSessionCache,
} from '../src/lib/sessionCache';
import { clearStoredTokens } from '../src/auth/tokenStore';
import { ok } from './support/apiResult';
import {
  TEST_ADMIN_SUB,
  TEST_EDITOR_SUB,
  signInAsEditor,
  signOut,
} from './support/consoleSession';

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
const hooks = await import('../src/hooks');
const { renderHook } = await import('@testing-library/react');

const MY_SLUG = 'my-own-deck';
const OTHER_SLUG = 'somebody-elses-deck';

function deck(id: number, slug: string, title: string): Deck {
  return {
    id,
    slug,
    title,
    author: 'tests',
    locale: 'en',
    deckType: 2,
    version: 1,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-02T00:00:00Z',
    totalCards: 12,
  };
}

function noJobs() {
  return ok<PublishJob[]>([]);
}

function emptyDecksPage() {
  return ok<AdminDecksPage>({ items: [], nextCursor: null, hasMore: false });
}

/** Every cache key this browser is holding. */
function cacheKeys(): string[] {
  return Object.keys(localStorage)
    .filter(key => key.startsWith('recallsmith/'))
    .sort();
}

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  signOut();
  api.fetchPublishJobs.mockResolvedValue(noJobs());
  api.fetchAdminDecksPage.mockResolvedValue(emptyDecksPage());
  api.fetchDecks.mockResolvedValue(ok([deck(1, MY_SLUG, 'My Own Deck')]));
  api.fetchAdminManifest.mockResolvedValue(ok({ manifest: { decks: [] } }));
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  consoleError.mockRestore();
  vi.clearAllMocks();
  signOut();
});

describe('a cache entry belongs to one account', () => {
  it('is not visible to another account', () => {
    writeSessionCache('decks', 'user-a', ['a']);
    expect(readSessionCache<string[]>('decks', 'user-a')).toEqual(['a']);
    // The whole defect in two lines: before the key carried an owner, this read
    // returned user-a's data.
    expect(readSessionCache<string[]>('decks', 'user-b')).toBeNull();
  });

  it('is not visible to a session with no identity at all', () => {
    writeSessionCache('decks', 'user-a', ['a']);
    expect(readSessionCache<string[]>('decks', null)).toBeNull();
  });

  it('is not written at all when there is no identity to attribute it to', () => {
    // A shared "anonymous" bucket would reintroduce the original defect for
    // exactly the sessions least able to notice it.
    writeSessionCache('decks', null, ['a']);
    expect(cacheKeys()).toEqual([]);
  });

  it('keeps the two caches apart for the same owner', () => {
    writeSessionCache('decks', 'user-a', ['deck']);
    writeSessionCache('manifest', 'user-a', ['manifest']);
    expect(readSessionCache<string[]>('decks', 'user-a')).toEqual(['deck']);
    expect(readSessionCache<string[]>('manifest', 'user-a')).toEqual(['manifest']);
  });

  it('expires after the window rather than being served forever', () => {
    vi.useFakeTimers();
    try {
      writeSessionCache('decks', 'user-a', ['a']);
      vi.advanceTimersByTime(CACHE_TTL + 1);
      expect(readSessionCache<string[]>('decks', 'user-a')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('what clears the cache', () => {
  it('clearSessionCaches drops every owner, and touches nothing else', () => {
    writeSessionCache('decks', 'user-a', ['a']);
    writeSessionCache('decks', 'user-b', ['b']);
    writeSessionCache('manifest', 'user-a', ['m']);
    localStorage.setItem('something-else', 'kept');

    clearSessionCaches();

    expect(cacheKeys()).toEqual([]);
    expect(localStorage.getItem('something-else')).toBe('kept');
  });

  it('ending the session ends the cache', () => {
    writeSessionCache('decks', 'user-a', ['a']);
    writeSessionCache('manifest', 'user-a', ['m']);

    // clearTokens is the narrow waist every ending passes through: both sign-out
    // buttons, the 401 handler, and a refresh token that will not refresh.
    // Hanging the clear off the two buttons would have covered two of five.
    clearStoredTokens();

    expect(cacheKeys()).toEqual([]);
  });

  it('deleting a deck drops it, because the cached list still has that deck in it', async () => {
    api.deleteDeck.mockResolvedValue(ok(null));
    writeSessionCache('decks', 'user-a', ['a']);

    const { result } = renderHook(() => hooks.useDeleteDeck());
    await result.current.mutateAsync({ id: 1 });

    expect(cacheKeys()).toEqual([]);
  });

  it('publishing a deck drops it too', async () => {
    api.publishDeck.mockResolvedValue(ok({ mode: 'async', jobId: 'job-1' }));
    writeSessionCache('decks', 'user-a', ['a']);

    const { result } = renderHook(() => hooks.usePublishDeck());
    await result.current.mutateAsync({ id: 1 });

    expect(cacheKeys()).toEqual([]);
  });

  it('a refused delete leaves it alone, since nothing changed', async () => {
    api.deleteDeck.mockResolvedValue({
      success: false,
      data: null,
      error: { code: 'FORBIDDEN', message: 'Not allowed.' },
      traceId: 't',
    });
    writeSessionCache('decks', 'user-a', ['a']);

    const { result } = renderHook(() => hooks.useDeleteDeck());
    await result.current.mutateAsync({ id: 1 });

    expect(readSessionCache<string[]>('decks', 'user-a')).toEqual(['a']);
  });
});

describe('the page and the account it is signed in as', () => {
  async function mountConsole(): Promise<void> {
    render(
      <MemoryRouter initialEntries={['/']}>
        <DeckListPage />
      </MemoryRouter>,
    );
    await screen.findByText(/Console|Failed to load decks/i, {}, { timeout: 2000 });
  }

  it('files what it loaded under the signed-in account', async () => {
    signInAsEditor();
    await mountConsole();

    await screen.findByText('My Own Deck');
    // Not "a cache exists" — the OWNER is the whole repair, so the owner is
    // what is asserted.
    expect(cacheKeys()).toEqual([
      `recallsmith/v1/${TEST_EDITOR_SUB}/decks`,
      `recallsmith/v1/${TEST_EDITOR_SUB}/manifest`,
    ]);
  });

  it('will not paint another account’s cached rows', async () => {
    // The state a closed tab leaves behind: localStorage survives, the tokens
    // in sessionStorage do not. So this cache belongs to an account that is not
    // the one about to sign in, and no sign-out handler ever ran.
    writeSessionCache('decks', TEST_ADMIN_SUB, [deck(9, OTHER_SLUG, 'Somebody Else Deck')]);
    writeSessionCache('manifest', TEST_ADMIN_SUB, { meta: {}, bySlug: {}, raw: null });

    signInAsEditor();
    await mountConsole();

    // What it must show is what the server just sent this account...
    await screen.findByText('My Own Deck');
    // ...and never the row it found lying in the browser.
    expect(screen.queryByText('Somebody Else Deck')).toBeNull();
    expect(screen.queryByText(OTHER_SLUG)).toBeNull();
  });
});
