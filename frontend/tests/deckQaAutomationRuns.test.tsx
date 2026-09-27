// @vitest-environment jsdom
//
// The runs the automation starts, on the /decks/qa page (A00 §16.3, A17): the
// QA mirror of an auto-accepted draft and a source re-check are labelled in
// "Past runs"; a person's run is not. src/api/qa and the three src/api/authoring
// reads are mocked as in deckQaPage.test.tsx, so nothing leaves the process.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';

import { ok } from './support/apiResult';
import { signInAsSuperAdmin, signOut } from './support/consoleSession';
import { QA_DECK_ID, qaCards, qaDeck, qaRun, qaStatus } from './support/qaFixtures';
import { renderAt } from './support/routerProbe';
import type { QaRunDetail, QaStartResult } from '../src/api/qa';
import type { ApiResult } from '../src/types/api';

const qa = vi.hoisted(() => ({
  startQaRun: vi.fn(),
  listQaRuns: vi.fn(),
  fetchQaRun: vi.fn(),
  fetchQaStatus: vi.fn(),
  resolveQaFinding: vi.fn(),
}));

const authoring = vi.hoisted(() => ({
  fetchDecks: vi.fn(),
  fetchDeckById: vi.fn(),
  fetchCardsByDeck: vi.fn(),
}));

vi.mock('../src/api/qa', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/api/qa')>();
  return { ...actual, ...qa };
});

vi.mock('../src/api/authoring', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/api/authoring')>();
  return { ...actual, ...authoring };
});

const { DeckQaPage } = await import('../src/pages/DeckQaPage');
const { normalizeQaRun } = await import('../src/api/qa');

const PAGE = `/decks/qa?deckId=${QA_DECK_ID}`;

function detail(overrides: Partial<QaRunDetail> = {}): ApiResult<QaRunDetail> {
  return ok({ run: qaRun(), items: [], findings: [], ...overrides });
}

function runsPage(items = [qaRun()], nextCursor: string | null = null) {
  return ok({ items, nextCursor });
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  signInAsSuperAdmin();
  authoring.fetchDecks.mockResolvedValue(ok([qaDeck]));
  authoring.fetchDeckById.mockResolvedValue(ok(qaDeck));
  authoring.fetchCardsByDeck.mockResolvedValue(ok(qaCards));
  qa.fetchQaStatus.mockResolvedValue(ok(qaStatus()));
  qa.listQaRuns.mockResolvedValue(runsPage([]));
  qa.fetchQaRun.mockResolvedValue(detail());
  qa.startQaRun.mockResolvedValue(ok<QaStartResult>({ runId: 'run-2', status: 'queued', cardCount: 2, chunkCount: 1 }));
  qa.resolveQaFinding.mockResolvedValue(ok(null));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const fn of [...Object.values(qa), ...Object.values(authoring)]) fn.mockReset();
  signOut();
});

async function openPage(entry = PAGE) {
  renderAt(<DeckQaPage />, [entry]);
  await screen.findByRole('heading', { level: 1, name: 'AI QA' });
  await waitFor(() => expect(qa.fetchQaStatus).toHaveBeenCalled());
  await waitFor(() => expect(screen.queryByText('Loading the publish gate…')).toBeNull());
}

async function pastRuns(): Promise<HTMLElement> {
  const section = screen.getByRole('region', { name: 'Past runs' });
  await within(section).findAllByRole('button', { name: /^View run / });
  return section;
}

describe('AI QA runs started by the automation', () => {
  it('labels an automation mirror run and a source re-check run', async () => {
    qa.listQaRuns.mockResolvedValue(
      runsPage([
        qaRun({
          runId: 'run-m',
          requestedBySub: 'automation',
          scope: 'cards',
          cardCount: 1,
          cardsDone: 1,
          status: 'done',
          effectiveStatus: 'done',
        }),
        qaRun({ runId: 'run-r', requestedBySub: 'automation', scope: 'cards', cardCount: 3 }),
      ]),
    );
    await openPage();

    const section = await pastRuns();
    const mirrorRow = within(section).getByRole('button', { name: 'View run run-m' }).closest('tr') as HTMLElement;
    const recheckRow = within(section).getByRole('button', { name: 'View run run-r' }).closest('tr') as HTMLElement;
    expect(within(mirrorRow).getByTestId('qa-run-origin').textContent).toBe('Automation — auto-accepted draft');
    expect(within(recheckRow).getByTestId('qa-run-origin').textContent).toBe('Automation — source re-check');
    expect(screen.getByRole('link', { name: 'Automation' }).getAttribute('href')).toBe('/automation');
  });

  it('leaves a human run unlabelled', async () => {
    qa.listQaRuns.mockResolvedValue(runsPage([qaRun({ runId: 'run-h', requestedBySub: 'console-tests-admin-sub' })]));
    await openPage();

    const section = await pastRuns();
    expect(within(section).queryByTestId('qa-run-origin')).toBeNull();
    expect(screen.queryByTestId('qa-run-origin')).toBeNull();
  });

  it('reads requestedBySub from the runs response', () => {
    expect(normalizeQaRun({ runId: 'r', status: 'done', requestedBySub: 'automation' })?.requestedBySub).toBe(
      'automation',
    );
    expect(normalizeQaRun({ runId: 'r', status: 'done' })?.requestedBySub).toBeNull();
  });
});
