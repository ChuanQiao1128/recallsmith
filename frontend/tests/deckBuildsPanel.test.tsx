// @vitest-environment jsdom
//
// The super-admin builds panel: lazy list, typed-confirm rollback, and the two
// all-decks maintenance actions. The panel is mounted inside the real
// ConfirmDialogProvider (not the window.confirm fallback), so the phrase input
// on the rollback dialog is genuinely exercised — the whole point of spending a
// confirmPhrase is that it can be tested to actually gate the action.
//
// The api module is spread with importOriginal so the exported types survive and
// only the four network functions are replaced with hoisted spies.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { DeckBuildsData } from '../src/api/authoring';
import { ok, refused } from './support/apiResult';
import { signInAsEditor, signInAsSuperAdmin, signOut } from './support/consoleSession';
import { renderAt } from './support/routerProbe';
import { queryClient } from '../src/api/queryClient';
import { ConfirmDialogProvider } from '../src/components/ui/ConfirmDialog';

const api = vi.hoisted(() => ({
  // panel functions
  fetchDeckBuilds: vi.fn(),
  rollbackDeck: vi.fn(),
  rebuildManifest: vi.fn(),
  reapStuckPublishJobs: vi.fn(),
  // DeckEditPage's own loads (for the page-level case)
  fetchDeckById: vi.fn(),
  fetchCardsByDeck: vi.fn(),
  updateDeck: vi.fn(),
}));

vi.mock('../src/api/authoring', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/api/authoring')>();
  return { ...actual, ...api };
});

const { DeckBuildsPanel } = await import('../src/components/console/DeckBuildsPanel');
const { DeckEditPage } = await import('../src/pages/DeckEditPage');

const DECK_ID = 7;
const DECK_SLUG = 'aws-deck';

const buildsData: DeckBuildsData = {
  deckId: DECK_ID,
  slug: DECK_SLUG,
  liveBuildId: 'b-new',
  builds: [
    { buildId: 'b-new', jobId: 'j-1', note: null, createdAt: '2026-01-02T00:00:00.000Z', isLive: true },
    { buildId: 'b-old', jobId: 'j-0', note: 'first cut', createdAt: '2026-01-01T00:00:00.000Z', isLive: false },
  ],
};

const deck = {
  id: DECK_ID,
  slug: DECK_SLUG,
  title: 'AWS Deck',
  author: 'console-tests',
  description: '',
  locale: 'en-US',
  deckType: 1,
  version: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
};

function mountPanel(): void {
  render(
    <ConfirmDialogProvider>
      <DeckBuildsPanel deckId={DECK_ID} deckSlug={DECK_SLUG} />
    </ConfirmDialogProvider>,
  );
}

beforeEach(() => {
  signOut();
  signInAsSuperAdmin();
  api.fetchDeckBuilds.mockResolvedValue(ok(buildsData));
  api.rollbackDeck.mockResolvedValue(
    ok({ deckId: DECK_ID, slug: DECK_SLUG, liveBuildId: 'b-old', previousBuildId: 'b-new', manifestRebuilt: true }),
  );
  api.rebuildManifest.mockResolvedValue(
    ok({ ok: true, manifestKey: 'content/manifest.json', generatedAtMs: 1, deckCount: 12 }),
  );
  api.reapStuckPublishJobs.mockResolvedValue(ok({ pending: 0, processing: 0, jobIds: [] as string[] }));
  api.fetchDeckById.mockResolvedValue(ok(deck));
  api.fetchCardsByDeck.mockResolvedValue(ok([]));
  api.updateDeck.mockResolvedValue(ok(deck));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  queryClient.clear();
  signOut();
});

describe('DeckBuildsPanel', () => {
  it('loads builds only when asked', async () => {
    mountPanel();
    // Nothing on mount: the DeckEditPage characterization tests spread the real
    // api module and a mount-time request would add a live call to every one.
    expect(api.fetchDeckBuilds).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Show builds' }));

    await waitFor(() => expect(api.fetchDeckBuilds).toHaveBeenCalledTimes(1));
    expect(api.fetchDeckBuilds).toHaveBeenCalledWith(DECK_ID);
    // After a load the button re-labels for a refresh.
    await screen.findByRole('button', { name: 'Refresh builds' });
  });

  it('marks the live build and offers rollback only for the others', async () => {
    mountPanel();
    await userEvent.click(screen.getByRole('button', { name: 'Show builds' }));

    await screen.findByText('b-old');
    // The live build wears a badge and offers no action.
    expect(screen.queryByText('Live')).not.toBeNull();
    // Exactly one rollback button — for the one non-live build.
    expect(screen.getAllByRole('button', { name: 'Roll back to this build' }).length).toBe(1);
  });

  it('rolls back only after the deck slug is typed', async () => {
    mountPanel();
    await userEvent.click(screen.getByRole('button', { name: 'Show builds' }));
    await screen.findByText('b-old');

    await userEvent.click(screen.getByRole('button', { name: 'Roll back to this build' }));

    const dialog = await screen.findByRole('alertdialog');
    const confirmBtn = within(dialog).getByRole('button', { name: 'Roll back' }) as HTMLButtonElement;
    // Locked until the slug is typed.
    expect(confirmBtn.disabled).toBe(true);
    expect(api.rollbackDeck).not.toHaveBeenCalled();

    await userEvent.type(within(dialog).getByRole('textbox'), DECK_SLUG);
    expect(confirmBtn.disabled).toBe(false);

    await userEvent.click(confirmBtn);

    await waitFor(() => expect(api.rollbackDeck).toHaveBeenCalledTimes(1));
    expect(api.rollbackDeck).toHaveBeenCalledWith(DECK_ID, 'b-old');
    await screen.findByText('Rolled back. Live build is now b-old.');
  });

  it('leaves the live build alone when the rollback is cancelled', async () => {
    mountPanel();
    await userEvent.click(screen.getByRole('button', { name: 'Show builds' }));
    await screen.findByText('b-old');

    await userEvent.click(screen.getByRole('button', { name: 'Roll back to this build' }));

    const dialog = await screen.findByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(api.rollbackDeck).not.toHaveBeenCalled();
  });

  it('rebuilds the manifest and reports the deck count', async () => {
    mountPanel();
    await userEvent.click(screen.getByRole('button', { name: 'Rebuild manifest' }));

    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Rebuild' }));

    await waitFor(() => expect(api.rebuildManifest).toHaveBeenCalledTimes(1));
    await screen.findByText('Manifest rebuilt: 12 decks.');
  });

  it('reaps stuck jobs and reports what it reaped', async () => {
    // First a healthy system: nothing to reap.
    mountPanel();
    await userEvent.click(screen.getByRole('button', { name: 'Reap stuck jobs' }));
    let dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reap' }));

    await waitFor(() => expect(api.reapStuckPublishJobs).toHaveBeenCalledTimes(1));
    await screen.findByText('No stuck jobs found.');

    // Then a run that actually reaps something.
    api.reapStuckPublishJobs.mockResolvedValue(ok({ pending: 2, processing: 1, jobIds: ['a', 'b', 'c'] }));
    await userEvent.click(screen.getByRole('button', { name: 'Reap stuck jobs' }));
    dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reap' }));

    await waitFor(() => expect(api.reapStuckPublishJobs).toHaveBeenCalledTimes(2));
    await screen.findByText('Reaped 2 pending and 1 processing jobs.');
  });

  it('surfaces a failed load in a red box', async () => {
    // Not one of the acceptance titles, but it keeps the failure path honest:
    // the ApiResult message is shown, not a hard-coded guess.
    api.fetchDeckBuilds.mockResolvedValue(refused('SERVER_ERROR', 'Builds are unavailable right now.'));
    mountPanel();
    await userEvent.click(screen.getByRole('button', { name: 'Show builds' }));

    await screen.findByText('Builds are unavailable right now.');
  });

  it('appears on DeckEditPage for a super_admin and not for an editor', async () => {
    signInAsSuperAdmin();
    renderAt(<DeckEditPage />, [`/decks/edit?deckId=${DECK_ID}`]);
    await screen.findByRole('button', { name: 'Save' });
    expect(screen.queryByRole('heading', { name: 'Builds' })).not.toBeNull();

    cleanup();
    queryClient.clear();

    signInAsEditor();
    renderAt(<DeckEditPage />, [`/decks/edit?deckId=${DECK_ID}`]);
    await screen.findByRole('button', { name: 'Save' });
    expect(screen.queryByRole('heading', { name: 'Builds' })).toBeNull();
  });
});
