// @vitest-environment jsdom
//
// DeckImportPage, step 3, the parts F27 added: cancelling a run in flight, the
// leave guard while a run is in progress, the disabled back link, and the
// re-preview button that replaced the stale-action retry.
//
// Only behaviour a single-line edit to DeckImportPage.tsx can break lives here.
// The batch runner's own semantics (chunking, backoff, notRun accounting) are
// pinned in deckImportBatchRunner.test.ts; this file mocks importCardsBatch and
// asserts what the PAGE does with a run that is pending, cancelled or failed.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { ImportCardsBatchResult } from '../src/api/authoring';
import type { ApiResult } from '../src/types/api';
import type { Deck } from '../src/types/deck';
import { deferred, ok } from './support/apiResult';
import { renderAt } from './support/routerProbe';

const api = vi.hoisted(() => ({
  fetchDeckById: vi.fn(),
  fetchCardsByDeck: vi.fn(),
  importCardsBatch: vi.fn(),
}));

vi.mock('../src/api/authoring', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/api/authoring')>();
  return { ...actual, ...api };
});

const { DeckImportPage } = await import('../src/pages/DeckImportPage');

const DECK_ID = 7;
const DECK_SLUG = 'csharp-backend-fundamentals';

const deck: Deck = {
  id: DECK_ID,
  slug: DECK_SLUG,
  title: 'C# Backend Fundamentals',
  author: 'console-tests',
  description: 'Interview prep',
  locale: 'en-US',
  deckType: 1,
  version: 3,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
};

const SMALL_DOC = [
  `# deck: ${DECK_SLUG}`,
  '',
  '## cs-a-001 | d2',
  'Q:',
  'Alpha question',
  'A:',
  'Alpha answer',
  '',
  '## cs-b-002 | d3',
  'Q:',
  'Beta question',
  'A:',
  'Beta answer',
].join('\n');

/** A deck document with `n` plain Q/A cards, so the plan splits into >1 batch. */
function genDoc(n: number): string {
  const lines = [`# deck: ${DECK_SLUG}`, ''];
  for (let i = 0; i < n; i++) {
    const uid = `gen-${String(i).padStart(5, '0')}`;
    lines.push(`## ${uid} | d2`, 'Q:', `Question ${i}`, 'A:', `Answer ${i}`, '');
  }
  return lines.join('\n');
}

function batchOk(counts: Partial<ImportCardsBatchResult> = {}): ApiResult<ImportCardsBatchResult> {
  return {
    success: true,
    data: { created: counts.created ?? 0, updated: counts.updated ?? 0, unchanged: counts.unchanged ?? 0 },
    error: null,
    traceId: 't',
  };
}

function batchFail(code: string, message: string): ApiResult<ImportCardsBatchResult> {
  return { success: false, data: null, error: { code, message }, traceId: 't' };
}

function sourceBox(): HTMLTextAreaElement {
  const el = document.querySelector('textarea');
  if (!(el instanceof HTMLTextAreaElement)) throw new Error('no textarea on the page');
  return el;
}

async function toPreview(user: ReturnType<typeof userEvent.setup>, doc: string): Promise<void> {
  renderAt(<DeckImportPage />, [`/decks/import?deckId=${DECK_ID}`]);
  await screen.findByText('1 · Source');
  fireEvent.change(sourceBox(), { target: { value: doc } });
  await user.click(screen.getByRole('button', { name: 'Preview import' }));
  await screen.findByText('2 · Preview');
}

beforeEach(() => {
  api.fetchDeckById.mockResolvedValue(ok(deck));
  api.fetchCardsByDeck.mockResolvedValue(ok([]));
  api.importCardsBatch.mockResolvedValue(batchOk({ created: 2 }));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('cancelling a run', () => {
  it('offers Cancel import while a run is in progress and stops before the next batch', async () => {
    const user = userEvent.setup();
    // 501 cards split into two batches (500 + 1). The first batch is held open so
    // the run is observably in progress when Cancel is pressed.
    const firstBatch = deferred<ApiResult<ImportCardsBatchResult>>();
    let calls = 0;
    api.importCardsBatch.mockImplementation(() => {
      calls += 1;
      return calls === 1 ? firstBatch.promise : Promise.resolve(batchOk({ created: 1 }));
    });

    await toPreview(user, genDoc(501));
    await user.click(screen.getByRole('button', { name: /^Import \d+ card/ }));

    const cancel = await screen.findByRole('button', { name: 'Cancel import' });
    await user.click(cancel);
    expect(screen.getByRole('button', { name: 'Cancelling...' })).not.toBeNull();

    // The first batch lands; the run must then stop rather than send the second.
    firstBatch.resolve(batchOk({ created: 500 }));

    const banner = await screen.findByText(/Import cancelled\./);
    expect(banner.textContent).toContain('500 created');
    expect(banner.textContent).toContain('1 not written');
    expect(api.importCardsBatch).toHaveBeenCalledTimes(1);
  });
});

describe('the leave guard', () => {
  it('asks the browser to confirm leaving while a run is in progress', async () => {
    const user = userEvent.setup();
    const pending = deferred<ApiResult<ImportCardsBatchResult>>();
    api.importCardsBatch.mockReturnValue(pending.promise);

    await toPreview(user, SMALL_DOC);
    await user.click(screen.getByRole('button', { name: /^Import \d+ card/ }));
    await screen.findByText('Writing cards...');

    const duringRun = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(duringRun);
    expect(duringRun.defaultPrevented).toBe(true);

    // Once the run finishes, the guard is gone.
    pending.resolve(batchOk({ created: 2 }));
    await screen.findByText('Finished');

    const afterRun = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(afterRun);
    expect(afterRun.defaultPrevented).toBe(false);
  });

  it('turns the header back link into plain text while a run is in progress', async () => {
    const user = userEvent.setup();
    const pending = deferred<ApiResult<ImportCardsBatchResult>>();
    api.importCardsBatch.mockReturnValue(pending.promise);

    await toPreview(user, SMALL_DOC);
    // Before the run, the header offers a real link.
    expect(screen.queryByRole('link', { name: '← Back to Cards' })).not.toBeNull();

    await user.click(screen.getByRole('button', { name: /^Import \d+ card/ }));
    await screen.findByText('Writing cards...');

    // While running, it is plain, disabled text instead of a link.
    expect(screen.queryByRole('link', { name: '← Back to Cards' })).toBeNull();
    const span = screen.getByText('← Back to Cards');
    expect(span.getAttribute('aria-disabled')).toBe('true');

    pending.resolve(batchOk({ created: 2 }));
    await screen.findByText('Finished');
  });
});

describe('after a failed run', () => {
  it('offers Re-run the preview instead of replaying failed writes', async () => {
    const user = userEvent.setup();
    api.importCardsBatch.mockResolvedValue(batchFail('VERSION_CONFLICT', 'A card was modified elsewhere.'));

    await toPreview(user, SMALL_DOC);
    await user.click(screen.getByRole('button', { name: /^Import \d+ card/ }));
    await screen.findByText(/card(s)? failed/);

    // No stale-action retry button; the replacement re-plans against the server.
    expect(screen.queryByRole('button', { name: /^Retry/ })).toBeNull();
    const rerun = screen.getByRole('button', { name: 'Re-run the preview' });
    expect(rerun).not.toBeNull();

    expect(api.fetchCardsByDeck).toHaveBeenCalledTimes(1);
    await user.click(rerun);
    await waitFor(() => expect(api.fetchCardsByDeck).toHaveBeenCalledTimes(2));
  });
});
