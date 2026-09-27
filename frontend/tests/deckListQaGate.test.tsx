// @vitest-environment jsdom
//
// The deck list's half of the AI QA publish gate (R18 contract §7.10): the
// publish confirm dialog previews GET …/qa/status (loaded lazily after the
// click), and the two gate refusals become a banner that links to the AI QA
// page. The mount and mocks are copied from deckListPageActionFailures.test.tsx;
// src/api/qa is mocked so the preview never leaves the process.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

import type { AdminDeckListItem, AdminDecksPage, PublishJob } from '../src/api/authoring';
import { ok, refused } from './support/apiResult';
import { signInAsSuperAdmin, signOut } from './support/consoleSession';
import { ConfirmDialogProvider } from '../src/components/ui/ConfirmDialog';
import { emptyErrorFeed, reportBusinessFailure } from '../src/lib/errorFeed';
import { qaPublishPreviewLine } from '../src/lib/qaGate';
import { qaStatus } from './support/qaFixtures';

const api = vi.hoisted(() => ({
  fetchPublishJobs: vi.fn(),
  fetchAdminDecksPage: vi.fn(),
  fetchDecks: vi.fn(),
  fetchAdminManifest: vi.fn(),
  deleteDeck: vi.fn(),
  publishDeck: vi.fn(),
}));

const qa = vi.hoisted(() => ({ fetchQaStatus: vi.fn() }));

vi.mock('../src/api/qa', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/api/qa')>();
  return { ...actual, ...qa };
});

vi.mock('../src/api/authoring', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/api/authoring')>();
  return { ...actual, ...api };
});

const { DeckListPage } = await import('../src/pages/DeckListPage');

const SLUG = 'aws-saa-c03';
const OTHER = 'claude-ccdv-f';
const DECK_ID = 11;
const GATE_MESSAGE = 'AI QA blocked publish: s3-01: incorrect_answer';

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
    updatedAtMs: null,
    latestBuildId: 'build-1',
  };
}

function twoRows() {
  return ok<AdminDecksPage>({
    items: [item(SLUG, DECK_ID), item(OTHER, 12)],
    nextCursor: null,
    hasMore: false,
  });
}

function rowFor(slug: string): HTMLElement {
  const row = screen.getByText(slug).closest('tr');
  expect(row, `no row for ${slug}`).not.toBeNull();
  return row as HTMLElement;
}

/** The one alert whose text contains `needle`. Fails if there is not exactly one. */
function alertContaining(needle: string): HTMLElement {
  const hits = Array.from(document.querySelectorAll<HTMLElement>('[role="alert"]')).filter(a =>
    (a.textContent ?? '').includes(needle),
  );
  expect(hits, `expected exactly one alert containing ${JSON.stringify(needle)}`).toHaveLength(1);
  return hits[0];
}

async function mountConsole(): Promise<void> {
  render(
    <MemoryRouter initialEntries={['/']}>
      <ConfirmDialogProvider>
        <DeckListPage />
      </ConfirmDialogProvider>
    </MemoryRouter>,
  );
  await screen.findByText(SLUG, {}, { timeout: 2000 });
}

async function publishRow(slug: string): Promise<void> {
  await userEvent.click(within(rowFor(slug)).getByRole('button', { name: 'Publish' }));
  const dialog = await screen.findByRole('dialog');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Publish' }));
}

let consoleError: ReturnType<typeof vi.spyOn>;
let consoleWarn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  signOut();
  signInAsSuperAdmin();
  api.fetchPublishJobs.mockResolvedValue(ok<PublishJob[]>([]));
  api.fetchAdminDecksPage.mockResolvedValue(twoRows());
  api.fetchDecks.mockResolvedValue(ok([]));
  api.fetchAdminManifest.mockResolvedValue(ok({ manifest: { Decks: [] } }));
  api.deleteDeck.mockResolvedValue(ok(null));
  api.publishDeck.mockResolvedValue(ok({ jobId: 'job-1' }));
  qa.fetchQaStatus.mockResolvedValue(ok(qaStatus({ changedCards: 0, reviewedCurrent: 0 })));
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

describe('the AI QA publish gate on the deck list', () => {
  it('publish refused by the AI QA gate links to the QA page', async () => {
    for (const code of ['AI_QA_BLOCKED', 'AI_QA_REQUIRED']) {
      api.publishDeck.mockResolvedValue(refused<{ jobId: string }>(code, GATE_MESSAGE));

      await mountConsole();
      await publishRow(SLUG);

      await waitFor(() => expect(api.publishDeck).toHaveBeenCalledWith(DECK_ID));
      const alert = await waitFor(() => alertContaining(`Publishing deck "${SLUG}" failed`));
      expect(alert.textContent).toContain(GATE_MESSAGE);
      const link = within(alert).getByRole('link', { name: 'Open AI QA' });
      expect(link.getAttribute('href')).toBe(`/decks/qa?deckId=${DECK_ID}`);

      cleanup();
      api.publishDeck.mockClear();
    }
  });

  it('links the refusal to the run the gate chained, and says when it could not start (automation-17)', async () => {
    api.publishDeck.mockResolvedValue({
      success: false,
      data: null,
      error: {
        code: 'AI_QA_REQUIRED',
        message: GATE_MESSAGE,
        runId: 'run-77',
        qaRun: { status: 'queued', code: null, message: null },
      },
      traceId: 't',
    });
    await mountConsole();
    await publishRow(SLUG);
    let alert = await waitFor(() => alertContaining(`Publishing deck "${SLUG}" failed`));
    expect(within(alert).getByRole('link', { name: 'Open AI QA' }).getAttribute('href')).toBe(
      `/decks/qa?deckId=${DECK_ID}&runId=run-77`,
    );
    expect(alert.textContent).not.toContain('could not start');
    cleanup();

    api.publishDeck.mockResolvedValue({
      success: false,
      data: null,
      error: {
        code: 'AI_QA_REQUIRED',
        message: GATE_MESSAGE,
        qaRun: { status: 'not_started', code: 'AI_QA_DAILY_CAP', message: 'Daily AI QA cap reached' },
      },
      traceId: 't',
    });
    await mountConsole();
    await publishRow(SLUG);
    alert = await waitFor(() => alertContaining(`Publishing deck "${SLUG}" failed`));
    expect(alert.textContent).toContain('AI QA could not start a review run: Daily AI QA cap reached.');
    expect(within(alert).getByRole('link', { name: 'Open AI QA' }).getAttribute('href')).toBe(
      `/decks/qa?deckId=${DECK_ID}`,
    );
  });

  it('an ordinary publish refusal carries no QA link', async () => {
    api.publishDeck.mockResolvedValue(refused<{ jobId: string }>('BUILD_LOCKED', 'Another build holds the lock.'));

    await mountConsole();
    await publishRow(SLUG);

    await waitFor(() => expect(api.publishDeck).toHaveBeenCalledWith(DECK_ID));
    const alert = await waitFor(() => alertContaining(`Publishing deck "${SLUG}" failed`));
    expect(alert.textContent).toContain('Another build holds the lock.');
    expect(screen.queryByRole('link', { name: 'Open AI QA' })).toBeNull();
  });

  it('the publish dialog previews open blockers and unreviewed cards from the QA status', async () => {
    qa.fetchQaStatus.mockResolvedValue(
      ok(
        qaStatus({
          required: false,
          changedCards: 3,
          reviewedCurrent: 1,
          openBlockers: [
            { findingId: 501, cardId: 101, stableUid: 's3-01', category: 'incorrect_answer', message: 'm' },
          ],
          wouldBlock: false,
        }),
      ),
    );
    await mountConsole();
    await userEvent.click(within(rowFor(SLUG)).getByRole('button', { name: 'Publish' }));
    const dialog = await screen.findByRole('dialog');

    expect(qa.fetchQaStatus).toHaveBeenCalledWith(DECK_ID);
    expect(dialog.textContent).toContain('Upload deck.json to S3');
    expect(dialog.textContent).toContain(
      'AI QA: 1 open blocker(s), 2 card(s) not reviewed. AI QA is advisory, so publishing is not blocked.',
    );
    expect(within(dialog).getByRole('link', { name: 'Open AI QA' }).getAttribute('href')).toBe(
      `/decks/qa?deckId=${DECK_ID}`,
    );

    await userEvent.click(within(dialog).getByRole('button', { name: 'Publish' }));
    await waitFor(() => expect(api.publishDeck).toHaveBeenCalledWith(DECK_ID));
  });

  it('following Open AI QA from the dialog does not publish', async () => {
    qa.fetchQaStatus.mockResolvedValue(
      ok(qaStatus({ required: true, changedCards: 2, reviewedCurrent: 0, wouldBlock: true })),
    );
    await mountConsole();
    await userEvent.click(within(rowFor(SLUG)).getByRole('button', { name: 'Publish' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('The server will refuse this publish until they are resolved.');

    await userEvent.click(within(dialog).getByRole('link', { name: 'Open AI QA' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.publishDeck).not.toHaveBeenCalled();
  });

  it('the publish dialog falls back to its plain body when the QA status cannot be read', async () => {
    for (const failure of [
      () => qa.fetchQaStatus.mockResolvedValue(refused('SERVER_NOT_READY_AI_QA', 'not migrated')),
      () => qa.fetchQaStatus.mockRejectedValue(new Error('network down')),
    ]) {
      failure();
      await mountConsole();
      await userEvent.click(within(rowFor(SLUG)).getByRole('button', { name: 'Publish' }));
      const dialog = await screen.findByRole('dialog');
      expect(dialog.textContent).toContain('Rebuild manifest.json');
      expect(dialog.textContent).not.toContain('AI QA:');
      expect(within(dialog).queryByRole('link', { name: 'Open AI QA' })).toBeNull();
      await userEvent.click(within(dialog).getByRole('button', { name: 'Publish' }));
      await waitFor(() => expect(api.publishDeck).toHaveBeenCalledWith(DECK_ID));
      cleanup();
      api.publishDeck.mockClear();
    }
  });

  it('a clean QA status adds nothing to the publish dialog', async () => {
    expect(qaPublishPreviewLine(qaStatus({ changedCards: 2, reviewedCurrent: 2 }))).toBeNull();
    await mountConsole();
    await userEvent.click(within(rowFor(SLUG)).getByRole('button', { name: 'Publish' }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(qa.fetchQaStatus).toHaveBeenCalledWith(DECK_ID));
    expect(dialog.textContent).not.toContain('AI QA:');
    expect(within(dialog).queryByRole('link', { name: 'Open AI QA' })).toBeNull();
  });

  it('a notice without a link has no link key', () => {
    const notice = reportBusinessFailure(emptyErrorFeed(), 'k', 't', 'm')[0];
    expect(Object.prototype.hasOwnProperty.call(notice, 'link')).toBe(false);

    const linked = reportBusinessFailure(emptyErrorFeed(), 'k', 't', 'm', { href: '/decks/qa?deckId=1', label: 'Open AI QA' })[0];
    expect(linked.link).toEqual({ href: '/decks/qa?deckId=1', label: 'Open AI QA' });
  });

  it('adds no QA line or link when AI QA is switched off on the server (frontend-console-15)', async () => {
    const off = qaStatus({ enabled: false, changedCards: 3, reviewedCurrent: 0, missing: [{ cardId: 1, stableUid: 'a' }] });
    expect(qaPublishPreviewLine(off)).toBeNull();
    expect(qaPublishPreviewLine({ ...off, enabled: true })).toContain('advisory');

    qa.fetchQaStatus.mockResolvedValue(ok(off));
    await mountConsole();
    await userEvent.click(within(rowFor(SLUG)).getByRole('button', { name: 'Publish' }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(qa.fetchQaStatus).toHaveBeenCalledWith(DECK_ID));
    expect(dialog.textContent).not.toContain('AI QA:');
    expect(dialog.textContent).not.toContain('advisory');
    expect(within(dialog).queryByRole('link', { name: 'Open AI QA' })).toBeNull();
  });

  it('shows the row busy while the QA preview loads, and opens the plain dialog when it hangs (frontend-console-21)', async () => {
    // A preview that never answers: the dialog must still open after the timeout.
    qa.fetchQaStatus.mockReturnValue(new Promise(() => {}));
    await mountConsole();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      await user.click(within(rowFor(SLUG)).getByRole('button', { name: 'Publish' }));
      const busy = await within(rowFor(SLUG)).findByRole('button', { name: 'Checking AI QA…' });
      expect((busy as HTMLButtonElement).disabled).toBe(true);
      // The other row is untouched.
      expect((within(rowFor(OTHER)).getByRole('button', { name: 'Publish' }) as HTMLButtonElement).disabled).toBe(false);
      // A second click on the busy row starts nothing.
      await user.click(busy);
      expect(qa.fetchQaStatus).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole('dialog')).toBeNull();

      await vi.advanceTimersByTimeAsync(3000);
      const dialog = await screen.findByRole('dialog');
      expect(dialog.textContent).toContain('Rebuild manifest.json');
      expect(dialog.textContent).not.toContain('AI QA:');
      expect(screen.getAllByRole('dialog')).toHaveLength(1);

      await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      const publish = within(rowFor(SLUG)).getByRole('button', { name: 'Publish' }) as HTMLButtonElement;
      expect(publish.disabled).toBe(false);
      expect(api.publishDeck).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
