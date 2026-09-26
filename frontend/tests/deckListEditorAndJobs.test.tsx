// @vitest-environment jsdom
//
// F24. Three defects on DeckListPage, all proven from the page's own render:
//
//   CFE-04  an editor session must not fetch the super_admin-only admin manifest
//           (it always 403s), must never show the red "Manifest Sync Error"
//           banner, and must derive publish status from each deck's liveBuildId.
//   CFE-22  an editor session must not poll publish jobs at all — the Publish
//           Jobs tab is super_admin-only, so there is nothing to watch.
//   CFE-09  a FAILED publish job must show its errorMessage instead of sending
//           the owner to CloudWatch to find out why.
//
// Mocked the same way as deckListPageLegacyPath.test.tsx: the real
// src/api/authoring is spread through so ADMIN_DECKS_ENDPOINT_MISSING and the
// normalisers stay live, and only the four fetches are replaced.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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

vi.mock('../src/api/authoring', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/api/authoring')>();
  return { ...actual, ...api };
});

const { DeckListPage } = await import('../src/pages/DeckListPage');

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

function emptyDecksPage(): ApiResult<AdminDecksPage> {
  return ok({ items: [], nextCursor: null, hasMore: false });
}

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
  await screen.findByText(/Console|Failed to load decks/i, {}, { timeout: 2000 });
}

let consoleError: ReturnType<typeof vi.spyOn>;
let consoleWarn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  signOut();
  api.fetchPublishJobs.mockResolvedValue(ok<PublishJob[]>([]));
  api.fetchAdminDecksPage.mockResolvedValue(emptyDecksPage());
  api.fetchDecks.mockResolvedValue(
    ok<Deck[]>([deck({ id: 1, slug: 'csharp-async', title: 'C# Async', liveBuildId: 'b-1' })]),
  );
  // An editor would get a 403 for this; the whole point of F24 is that it is
  // never called for them. Point it at a refusal so a regression that DID call
  // it would light the banner and fail the "no banner" case loudly.
  api.fetchAdminManifest.mockResolvedValue(refused('FORBIDDEN', 'super_admin only'));
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  consoleError.mockRestore();
  consoleWarn.mockRestore();
  vi.clearAllMocks();
  signOut();
});

describe('an editor session skips the manifest and the poll', () => {
  it('never asks an editor session for the admin manifest', async () => {
    signInAsEditor();

    await mountConsole();

    expect(api.fetchDecks).toHaveBeenCalledTimes(1);
    expect(api.fetchAdminManifest).not.toHaveBeenCalled();
    expect(api.fetchAdminDecksPage).not.toHaveBeenCalled();
  });

  it('shows no Manifest Sync Error to an editor', async () => {
    signInAsEditor();

    await mountConsole();

    expect(await screen.findByText('C# Async')).not.toBeNull();
    expect(screen.queryByText('Manifest Sync Error')).toBeNull();
  });

  it('marks an editor row Published from liveBuildId', async () => {
    signInAsEditor();
    api.fetchDecks.mockResolvedValue(
      ok<Deck[]>([
        deck({ id: 1, slug: 'csharp-async', title: 'C# Async', liveBuildId: 'b-1', totalCards: 3 }),
        deck({ id: 2, slug: 'csharp-linq', title: 'C# LINQ', liveBuildId: null, totalCards: 3 }),
      ]),
    );

    await mountConsole();

    // The published signal is liveBuildId, not a manifest entry: no manifest was
    // fetched at all.
    expect(within(rowFor('C# Async')).getByText('Published')).not.toBeNull();
    // Same card count, null liveBuildId: it has content but is not live yet.
    expect(within(rowFor('C# LINQ')).getByText('Needs Publish')).not.toBeNull();
    expect(within(rowFor('C# LINQ')).queryByText('Published')).toBeNull();
  });

  it('does not poll publish jobs for an editor', async () => {
    signInAsEditor();

    await mountConsole();

    // The Publish Jobs tab and its poll are super_admin-only, so an editor
    // session must never issue a single publish/jobs request.
    expect(api.fetchPublishJobs).not.toHaveBeenCalled();
  });
});

describe('a FAILED publish job explains itself', () => {
  it('shows why a FAILED publish job failed', async () => {
    signInAsSuperAdmin();
    const reason = 'MCQ card cs-q-001 has no correct option';
    api.fetchPublishJobs.mockResolvedValue(
      ok<PublishJob[]>([
        {
          jobId: 'job-abcdef12345',
          deckSlug: 'csharp-async',
          status: 'FAILED',
          errorMessage: reason,
          createdAt: 1_700_000_000_000,
        },
      ]),
    );

    await mountConsole();

    // Switch to the Publish Jobs tab (super_admin-only). F32 (CFE-19) gave the
    // switcher real tab semantics, so this control is now role="tab", not a
    // plain button.
    fireEvent.click(screen.getByRole('tab', { name: 'Publish Jobs' }));

    const errorCell = await screen.findByTestId('publish-job-error');
    expect(errorCell.textContent).toBe(reason);
  });
});
