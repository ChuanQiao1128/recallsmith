// @vitest-environment jsdom
//
// publishingSlug / deletingSlug: the per-row pending state on DeckListPage.
//
// WHY THIS FILE EXISTS. Before it, `grep -rn 'Publishing…\|Deleting…' tests/`
// returned nothing. Both flags were written, read in four JSX sites and cleared
// in a `finally`, and not one line of that was observed by a test.
//
// THE ONE ASSERTION THAT MATTERS MOST is not "the row says Publishing…" — it is
// "the OTHER TWO ROWS DO NOT". Both flags hold a slug, and every read compares
// it to the row's own slug. A split that hands the table `publishing={publishingSlug !== null}`
// instead of `publishing={publishingSlug === row.slug}` still lights the right
// row, and lights the other two as well. That mistake is invisible to any
// single-row fixture, which is why every case here mounts THREE rows and
// asserts against all of them. P4-M4 below is the mutation that proves it.
//
// Written and run green against a COMPLETELY UNMODIFIED DeckListPage.tsx.
//
// Real timers, not fake ones: the confirmation is now an in-page dialog driven
// by userEvent, and userEvent's own internal delays deadlock against fake
// timers unless every call site passes an advanceTimers bridge. The polling
// timer this leaves running is a 30s setTimeout that no case here lives long
// enough to reach.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

import type { AdminDeckListItem, AdminDecksPage, PublishJob } from '../src/api/authoring';
import type { ApiResult } from '../src/types/api';
import { deferred, ok } from './support/apiResult';
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

// Three rows. The middle one is the target in every case, so a mutation that
// pins the flag to "the first row" or "the last row" is caught too.
const SLUGS = ['alpha-deck', 'beta-deck', 'gamma-deck'] as const;
const TARGET = SLUGS[1];
const OTHERS = [SLUGS[0], SLUGS[2]];

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
    // null, not a timestamp: safeDateTime then renders a literal em dash and no
    // case in this file depends on the runner's timezone.
    updatedAtMs: null,
    latestBuildId: 'build-1',
  };
}

function threeRows(): ApiResult<AdminDecksPage> {
  return ok<AdminDecksPage>({
    items: SLUGS.map((slug, i) => item(slug, 100 + i)),
    nextCursor: null,
    hasMore: false,
  });
}

/** The row whose text carries `slug`, found through the table body. */
function rowFor(slug: string): HTMLElement {
  const row = screen.getByText(slug).closest('tr');
  expect(row, `no row for ${slug}`).not.toBeNull();
  return row as HTMLElement;
}

/**
 * A row's action button, matched on a REGEX covering both the idle and the
 * pending spelling.
 *
 * Matching on the exact idle name instead would make "the button now reads
 * Publishing…" indistinguishable from "the button is gone", and a mutation that
 * deleted the button entirely would produce the same green as one that left it
 * alone. Finding it either way and asserting on textContent separates those.
 */
function actionButton(slug: string, pattern: RegExp): HTMLButtonElement {
  return within(rowFor(slug)).getByRole('button', { name: pattern }) as HTMLButtonElement;
}

const PUBLISH_RE = /^(Publish|Publishing…)$/;
const DELETE_RE = /^(Delete|Deleting…)$/;

/** Label + disabled for one row's button, as one comparable object. */
function buttonState(slug: string, pattern: RegExp): { label: string; disabled: boolean } {
  const button = actionButton(slug, pattern);
  return { label: (button.textContent ?? '').trim(), disabled: button.disabled };
}

async function mountConsole(): Promise<void> {
  render(
    <MemoryRouter initialEntries={['/']}>
      <ConfirmDialogProvider>
        <DeckListPage />
      </ConfirmDialogProvider>
    </MemoryRouter>,
  );
  await screen.findByText(TARGET, {}, { timeout: 2000 });
}

/** Press a row action and answer its dialog. */
async function actOnRow(slug: string, trigger: RegExp, answer: string): Promise<void> {
  await userEvent.click(actionButton(slug, trigger));
  const dialog = await screen.findByRole(trigger === DELETE_RE ? 'alertdialog' : 'dialog');
  await userEvent.click(within(dialog).getByRole('button', { name: answer }));
}

let consoleError: ReturnType<typeof vi.spyOn>;
let consoleWarn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  signOut();
  signInAsSuperAdmin();
  api.fetchPublishJobs.mockResolvedValue(ok<PublishJob[]>([]));
  api.fetchAdminDecksPage.mockResolvedValue(threeRows());
  api.fetchDecks.mockResolvedValue(ok([]));
  api.fetchAdminManifest.mockResolvedValue(ok({ manifest: { Decks: [] } }));
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

describe('P1/P2 publish marks exactly one row busy, then releases it', () => {
  it('P1: the publishing row is disabled and relabelled; the other two are untouched', async () => {
    const gate = deferred<ApiResult<{ jobId: string }>>();
    api.publishDeck.mockReturnValue(gate.promise);

    await mountConsole();

    // Pre-state: all three idle. Without this, a page that rendered
    // "Publishing…" from the very first paint would still pass the next block.
    for (const slug of SLUGS) {
      expect(buttonState(slug, PUBLISH_RE)).toEqual({ label: 'Publish', disabled: false });
    }

    await actOnRow(TARGET, PUBLISH_RE, 'Publish');
    await waitFor(() => expect(api.publishDeck).toHaveBeenCalledWith(101));

    expect(buttonState(TARGET, PUBLISH_RE)).toEqual({ label: 'Publishing…', disabled: true });
    // The half a per-row flag exists for.
    for (const slug of OTHERS) {
      expect(buttonState(slug, PUBLISH_RE)).toEqual({ label: 'Publish', disabled: false });
    }
    // Delete on the same row is a different flag and must not have moved.
    expect(buttonState(TARGET, DELETE_RE)).toEqual({ label: 'Delete', disabled: false });

    gate.resolve(ok({ jobId: 'job-1' }));
    await waitFor(() =>
      expect(buttonState(TARGET, PUBLISH_RE)).toEqual({ label: 'Publish', disabled: false }),
    );
  });

  it('P2: finishing the publish returns every row to idle', async () => {
    const gate = deferred<ApiResult<{ jobId: string }>>();
    api.publishDeck.mockReturnValue(gate.promise);

    await mountConsole();
    await actOnRow(TARGET, PUBLISH_RE, 'Publish');
    await waitFor(() =>
      expect(buttonState(TARGET, PUBLISH_RE)).toEqual({ label: 'Publishing…', disabled: true }),
    );

    gate.resolve(ok({ jobId: 'job-1' }));

    await waitFor(() => {
      for (const slug of SLUGS) {
        expect(buttonState(slug, PUBLISH_RE)).toEqual({ label: 'Publish', disabled: false });
      }
    });
  });
});

describe('P3 delete marks exactly one row busy, then releases it', () => {
  it('P3: the deleting row is disabled and relabelled; the other two are untouched', async () => {
    const gate = deferred<ApiResult<null>>();
    api.deleteDeck.mockReturnValue(gate.promise);

    await mountConsole();

    for (const slug of SLUGS) {
      expect(buttonState(slug, DELETE_RE)).toEqual({ label: 'Delete', disabled: false });
    }

    await actOnRow(TARGET, DELETE_RE, 'Delete deck');
    await waitFor(() => expect(api.deleteDeck).toHaveBeenCalledWith(101));

    expect(buttonState(TARGET, DELETE_RE)).toEqual({ label: 'Deleting…', disabled: true });
    for (const slug of OTHERS) {
      expect(buttonState(slug, DELETE_RE)).toEqual({ label: 'Delete', disabled: false });
    }
    // Publish on the same row is the other flag, and it must not have moved.
    expect(buttonState(TARGET, PUBLISH_RE)).toEqual({ label: 'Publish', disabled: false });

    gate.resolve(ok(null));
    // A successful delete removes the row, so the release is observed on the
    // survivors: the point is that they were never captured in the first place.
    await waitFor(() => expect(screen.queryByText(TARGET)).toBeNull());
    for (const slug of OTHERS) {
      expect(buttonState(slug, DELETE_RE)).toEqual({ label: 'Delete', disabled: false });
    }
  });
});

describe('P4 a thrown action still releases the row', () => {
  it('P4: publish throwing clears the pending label instead of stranding it', async () => {
    // The `finally` is the only path that reaches this. A page that cleared the
    // flag at the end of the success branch would leave this row reading
    // "Publishing…", disabled, for the rest of the session — with a red banner
    // above it telling the user to try again on a button they can no longer press.
    const gate = deferred<void>();
    api.publishDeck.mockImplementation(async () => {
      await gate.promise;
      throw new Error('socket hung up');
    });

    await mountConsole();
    await actOnRow(TARGET, PUBLISH_RE, 'Publish');
    await waitFor(() =>
      expect(buttonState(TARGET, PUBLISH_RE)).toEqual({ label: 'Publishing…', disabled: true }),
    );

    gate.resolve(undefined);

    await waitFor(() =>
      expect(buttonState(TARGET, PUBLISH_RE)).toEqual({ label: 'Publish', disabled: false }),
    );
    // And the failure is on screen — otherwise "released the row" would also be
    // satisfied by a page that silently swallowed the error.
    const alerts = screen.getAllByRole('alert');
    expect(
      alerts.some(a => (a.textContent ?? '').includes(`Publishing deck "${TARGET}" failed`)),
    ).toBe(true);
    for (const slug of OTHERS) {
      expect(buttonState(slug, PUBLISH_RE)).toEqual({ label: 'Publish', disabled: false });
    }
  });
});

describe('P5 declining the confirmation never enters pending', () => {
  it('P5: cancelling leaves all three rows idle and issues no request', async () => {
    await mountConsole();

    await actOnRow(TARGET, PUBLISH_RE, 'Cancel');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    expect(api.publishDeck).not.toHaveBeenCalled();
    for (const slug of SLUGS) {
      expect(buttonState(slug, PUBLISH_RE)).toEqual({ label: 'Publish', disabled: false });
      expect(buttonState(slug, DELETE_RE)).toEqual({ label: 'Delete', disabled: false });
    }

    await actOnRow(TARGET, DELETE_RE, 'Cancel');
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());

    expect(api.deleteDeck).not.toHaveBeenCalled();
    for (const slug of SLUGS) {
      expect(buttonState(slug, DELETE_RE)).toEqual({ label: 'Delete', disabled: false });
    }
  });
});
