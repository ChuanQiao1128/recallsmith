// @vitest-environment jsdom
//
// The /decks/qa console page (R18 contract §7). src/api/qa and the three
// src/api/authoring reads are mocked, so nothing here can leave the process; the
// session is a real token through tests/support/consoleSession. Fake timers step
// the poll loop; shouldAdvanceTime keeps findBy*/waitFor settling.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { deferred, ok, refused } from './support/apiResult';
import { signInAsSuperAdmin, signOut } from './support/consoleSession';
import { QA_DECK_ID, qaCards, qaDeck, qaFinding, qaItem, qaRun, qaStatus } from './support/qaFixtures';
import { renderAt } from './support/routerProbe';
import { ConsoleShell } from '../src/components/console/ConsoleShell';
import { documentTitleFor } from '../src/lib/brand';
import { QA_POLL_INTERVAL_MS, QA_POLL_MAX_FAILURES, estimateQaCostUsd, formatUsd } from '../src/lib/qaReview';
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

function startButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: 'Start AI QA' }) as HTMLButtonElement;
}

describe('DeckQaPage', () => {
  it('offers a deck picker when no deckId is given', async () => {
    renderAt(<DeckQaPage />, ['/decks/qa']);
    expect(await screen.findByText('Choose a deck to review with AI QA.')).toBeTruthy();
    const link = await screen.findByRole('link', { name: /AWS Solutions Architect Associate/ });
    expect(link.getAttribute('href')).toBe(`/decks/qa?deckId=${QA_DECK_ID}`);
    expect(qa.fetchQaStatus).not.toHaveBeenCalled();
    expect(qa.listQaRuns).not.toHaveBeenCalled();
  });

  it('shows the publish gate preview from the status route', async () => {
    qa.fetchQaStatus.mockResolvedValue(
      ok(
        qaStatus({
          required: true,
          changedCards: 3,
          reviewedCurrent: 1,
          missing: [{ cardId: 102, stableUid: 'aws-s3-cloudfront-oac' }],
          openBlockers: [
            {
              findingId: 501,
              cardId: 101,
              stableUid: 'aws-s3-storage-classes',
              category: 'incorrect_answer',
              message: 'Deep Archive is not a lifecycle target.',
            },
          ],
          wouldBlock: true,
        }),
      ),
    );
    await openPage();

    expect(qa.fetchQaStatus).toHaveBeenCalledWith(QA_DECK_ID);
    const gate = screen.getByTestId('qa-gate-status');
    expect(gate.textContent).toContain('Publishing requires AI QA.');
    expect(gate.textContent).toContain('3 changed card(s), 1 reviewed at their current content.');
    expect(within(gate).getByText('Publishing is blocked')).toBeTruthy();
    expect(gate.textContent).toContain('aws-s3-cloudfront-oac');
    expect(gate.textContent).toContain('aws-s3-storage-classes: Incorrect answer — Deep Archive is not a lifecycle target.');

    expect(screen.getAllByRole('heading', { level: 2 }).map(h => h.textContent)).toEqual([
      'Publish gate',
      'Start a review',
      'Progress',
      'Findings',
      'Past runs',
    ]);

    cleanup();
    qa.fetchQaStatus.mockResolvedValue(ok(qaStatus({ required: false })));
    await openPage();
    const clear = screen.getByTestId('qa-gate-status');
    expect(clear.textContent).toContain('AI QA is advisory: publishing is not blocked by it.');
    expect(clear.textContent).toContain('Publishing is not blocked by AI QA.');
  });

  it('shows the card count and cost estimate before starting', async () => {
    await openPage();

    expect(screen.getByRole('radiogroup', { name: 'Scope' })).toBeTruthy();
    expect((screen.getByRole('radio', { name: 'Changed cards' }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByTestId('qa-card-count').textContent).toBe('2 card(s) will be reviewed.');
    expect(screen.getByTestId('qa-cost-estimate').textContent).toBe(
      `Estimated cost ≈ ${formatUsd(estimateQaCostUsd(2))} (estimate only; the provider bills separately).`,
    );
    expect(startButton().disabled).toBe(false);

    fireEvent.click(screen.getByRole('radio', { name: 'All cards' }));
    await waitFor(() => expect(screen.getByTestId('qa-card-count').textContent).toBe('3 card(s) will be reviewed.'));
    expect(screen.getByTestId('qa-cost-estimate').textContent).toContain(formatUsd(estimateQaCostUsd(3)));

    fireEvent.click(screen.getByRole('radio', { name: 'Selected cards' }));
    await waitFor(() => expect(screen.getByTestId('qa-card-count').textContent).toBe('0 card(s) will be reviewed.'));
    expect(startButton().disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox', { name: /aws-iam-roles-vs-users/ }));
    await waitFor(() => expect(screen.getByTestId('qa-card-count').textContent).toBe('1 card(s) will be reviewed.'));
    expect(startButton().disabled).toBe(false);
    expect(qa.startQaRun).not.toHaveBeenCalled();

    fireEvent.click(startButton());
    await waitFor(() =>
      expect(qa.startQaRun).toHaveBeenCalledWith({ deckId: QA_DECK_ID, scope: 'cards', cardIds: [103] }),
    );
  });

  it('disables Start when AI QA is off on the server', async () => {
    qa.fetchQaStatus.mockResolvedValue(ok(qaStatus({ enabled: false })));
    await openPage();

    expect(screen.getByTestId('qa-gate-status').textContent).toContain(
      'AI QA is switched off on the server. Runs cannot start until the owner enables it.',
    );
    expect(startButton().disabled).toBe(true);
    fireEvent.click(startButton());
    expect(qa.startQaRun).not.toHaveBeenCalled();
  });

  it('starts one run per click and polls it until done', async () => {
    const pending = deferred<ApiResult<QaStartResult>>();
    qa.startQaRun.mockReturnValue(pending.promise);
    await openPage();
    expect(qa.fetchQaRun).not.toHaveBeenCalled();

    fireEvent.click(startButton());
    fireEvent.click(startButton());
    await waitFor(() => expect(startButton().disabled).toBe(true));
    fireEvent.click(startButton());
    expect(qa.startQaRun).toHaveBeenCalledTimes(1);
    expect(qa.startQaRun).toHaveBeenCalledWith({ deckId: QA_DECK_ID, scope: 'changed' });

    const run2 = { runId: 'run-2', cardCount: 2, cardsDone: 0, blockerCount: 0 };
    qa.fetchQaRun
      .mockResolvedValueOnce(detail({ run: qaRun({ ...run2, status: 'queued', effectiveStatus: 'queued' }) }))
      .mockResolvedValueOnce(
        detail({ run: qaRun({ ...run2, status: 'running', effectiveStatus: 'running', cardsDone: 1 }) }),
      )
      .mockResolvedValue(detail({ run: qaRun({ ...run2, status: 'done', effectiveStatus: 'done', cardsDone: 2 }) }));
    const statusCalls = qa.fetchQaStatus.mock.calls.length;

    pending.resolve(ok({ runId: 'run-2', status: 'queued', cardCount: 2, chunkCount: 1 }));
    await waitFor(() => expect(qa.fetchQaRun).toHaveBeenCalledWith('run-2'));
    const bar = await screen.findByRole('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBe('0');
    expect(bar.getAttribute('aria-valuemax')).toBe('2');
    expect(screen.getByTestId('qa-run-progress').textContent).toContain('queued');
    expect(startButton().disabled).toBe(true);

    await vi.advanceTimersByTimeAsync(QA_POLL_INTERVAL_MS);
    await waitFor(() => expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('1'));
    expect(screen.getByTestId('qa-run-progress').textContent).toContain('running');

    await vi.advanceTimersByTimeAsync(QA_POLL_INTERVAL_MS);
    await waitFor(() => expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('2'));
    expect(screen.getByTestId('qa-run-progress').textContent).toContain('done');
    await waitFor(() => expect(qa.fetchQaStatus.mock.calls.length).toBe(statusCalls + 1));
    expect(qa.fetchQaRun).toHaveBeenCalledTimes(3);

    await vi.advanceTimersByTimeAsync(QA_POLL_INTERVAL_MS * 3);
    expect(qa.fetchQaRun).toHaveBeenCalledTimes(3);
    expect(qa.startQaRun).toHaveBeenCalledTimes(1);
  });

  it('stops polling after repeated failures and offers a refresh', async () => {
    const active = qaRun({ status: 'running', effectiveStatus: 'running', cardsDone: 1 });
    qa.listQaRuns.mockResolvedValue(runsPage([active]));
    qa.fetchQaRun.mockResolvedValueOnce(detail({ run: active })).mockResolvedValue(refused('HTTP_502', 'Bad gateway'));
    await openPage();
    await screen.findByRole('progressbar');

    for (let i = 0; i < QA_POLL_MAX_FAILURES; i += 1) {
      await vi.advanceTimersByTimeAsync(QA_POLL_INTERVAL_MS);
    }
    const stopped = await screen.findByTestId('qa-poll-stopped');
    expect(stopped.textContent).toContain('Progress is not refreshing.');
    expect(qa.fetchQaRun).toHaveBeenCalledTimes(1 + QA_POLL_MAX_FAILURES);

    await vi.advanceTimersByTimeAsync(QA_POLL_INTERVAL_MS * 3);
    expect(qa.fetchQaRun).toHaveBeenCalledTimes(1 + QA_POLL_MAX_FAILURES);

    qa.fetchQaRun.mockResolvedValue(detail({ run: active }));
    fireEvent.click(within(stopped).getByRole('button', { name: 'Refresh progress' }));
    await waitFor(() => expect(qa.fetchQaRun).toHaveBeenCalledTimes(2 + QA_POLL_MAX_FAILURES));
    await waitFor(() => expect(screen.queryByTestId('qa-poll-stopped')).toBeNull());
  });

  it('stops polling when the page unmounts', async () => {
    const active = qaRun({ status: 'running', effectiveStatus: 'running' });
    qa.listQaRuns.mockResolvedValue(runsPage([active]));
    qa.fetchQaRun.mockResolvedValue(detail({ run: active }));
    await openPage();
    await screen.findByRole('progressbar');
    expect(qa.fetchQaRun).toHaveBeenCalledTimes(1);

    cleanup();
    await vi.advanceTimersByTimeAsync(QA_POLL_INTERVAL_MS * 5);
    expect(qa.fetchQaRun).toHaveBeenCalledTimes(1);
  });

  it('reports a stale run as failed from effectiveStatus', async () => {
    const stale = qaRun({ status: 'running', effectiveStatus: 'failed', errorCode: 'TIMEOUT', cardsDone: 1 });
    qa.listQaRuns.mockResolvedValue(runsPage([stale]));
    qa.fetchQaRun.mockResolvedValue(detail({ run: stale }));
    await openPage();

    const progress = await screen.findByTestId('qa-run-progress');
    expect(progress.textContent).toContain('failed');
    expect(progress.textContent).toContain('This run stopped reporting and was marked failed.');
    expect(progress.textContent).toContain('TIMEOUT');
    expect(startButton().disabled).toBe(false);

    await vi.advanceTimersByTimeAsync(QA_POLL_INTERVAL_MS * 2);
    expect(qa.fetchQaRun).toHaveBeenCalledTimes(1);
  });

  it('maps a run already in progress and the daily cap to plain messages', async () => {
    qa.startQaRun.mockResolvedValueOnce(refused('AI_QA_DAILY_CAP', 'cap reached'));
    await openPage();

    fireEvent.click(startButton());
    expect(await screen.findByText("Today's AI QA spend has reached the daily cap. Try again after midnight UTC."))
      .toBeTruthy();
    expect(screen.getByRole('alert').textContent).not.toContain('cap reached');

    const active = qaRun({ runId: 'run-9', status: 'running', effectiveStatus: 'running' });
    qa.startQaRun.mockResolvedValueOnce(refused('AI_QA_RUN_IN_PROGRESS', 'busy'));
    qa.listQaRuns.mockResolvedValue(runsPage([active]));
    qa.fetchQaRun.mockResolvedValue(detail({ run: active }));

    fireEvent.click(startButton());
    expect(
      await screen.findByText('A run is already in progress for this deck; its progress is shown below.'),
    ).toBeTruthy();
    await waitFor(() => expect(qa.fetchQaRun).toHaveBeenCalledWith('run-9'));
    expect((await screen.findByRole('progressbar')).getAttribute('aria-valuemax')).toBe('3');
  });

  it('groups findings by card and resolves one as fixed', async () => {
    const run = qaRun({ blockerCount: 1, minorCount: 1 });
    const blocker = qaFinding({ findingId: 501, cardId: 101, severity: 'blocker' });
    const minor = qaFinding({
      findingId: 502,
      cardId: 102,
      severity: 'minor',
      category: 'weak_distractor',
      message: 'The public-bucket distractor is obviously wrong.',
      suggestedFix: null,
    });
    qa.listQaRuns.mockResolvedValue(runsPage([run]));
    qa.fetchQaRun.mockResolvedValue(
      detail({
        run,
        items: [
          qaItem(102, 'aws-s3-cloudfront-oac'),
          qaItem(101, 'aws-s3-storage-classes'),
          qaItem(103, 'aws-iam-roles-vs-users', { status: 'refused', errorCode: 'REFUSAL' }),
        ],
        findings: [minor, blocker],
      }),
    );
    await openPage();

    const flagged = await screen.findByTestId('qa-card-101');
    const passed = screen.getByTestId('qa-card-102');
    const refusedCard = screen.getByTestId('qa-card-103');
    expect(flagged.compareDocumentPosition(passed) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(flagged).getByText('Flagged')).toBeTruthy();
    expect(within(flagged).getByText('Incorrect answer')).toBeTruthy();
    expect(flagged.textContent).toContain('Suggested fix: Say Glacier Flexible Retrieval for the retention period.');
    expect(flagged.textContent).toContain('An application writes logs to S3');
    expect(within(flagged).getByRole('link', { name: 'Edit card' }).getAttribute('href')).toBe(
      `/decks/cards/edit?deckId=${QA_DECK_ID}&cardId=101`,
    );
    expect(within(passed).getByText('Passed')).toBeTruthy();
    expect(within(passed).getByText('Weak distractor')).toBeTruthy();
    expect(refusedCard.textContent).toContain('The model declined to review this card.');

    const pending = deferred<ApiResult<null>>();
    qa.resolveQaFinding.mockReturnValue(pending.promise);
    const runCalls = qa.fetchQaRun.mock.calls.length;
    const statusCalls = qa.fetchQaStatus.mock.calls.length;

    fireEvent.change(screen.getByLabelText('Resolution note for finding 501'), {
      target: { value: 'Rewrote the answer.' },
    });
    const fix = screen.getByRole('button', { name: 'Mark finding 501 fixed' }) as HTMLButtonElement;
    fireEvent.click(fix);
    fireEvent.click(fix);
    await waitFor(() => expect(fix.disabled).toBe(true));
    expect(qa.resolveQaFinding).toHaveBeenCalledTimes(1);
    expect(qa.resolveQaFinding).toHaveBeenCalledWith(501, { resolution: 'fixed', note: 'Rewrote the answer.' });

    pending.resolve(ok(null));
    await waitFor(() => expect(qa.fetchQaRun.mock.calls.length).toBe(runCalls + 1));
    await waitFor(() => expect(qa.fetchQaStatus.mock.calls.length).toBe(statusCalls + 1));
  });

  it('refreshes when a finding was already resolved elsewhere', async () => {
    const run = qaRun({ blockerCount: 1 });
    qa.listQaRuns.mockResolvedValue(runsPage([run]));
    qa.fetchQaRun.mockResolvedValue(
      detail({ run, items: [qaItem(101, 'aws-s3-storage-classes')], findings: [qaFinding()] }),
    );
    qa.resolveQaFinding.mockResolvedValue(refused('FINDING_ALREADY_RESOLVED', 'Already resolved.'));
    await openPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Dismiss finding 501' }));
    expect(await screen.findByText('This finding was already resolved elsewhere.')).toBeTruthy();
    expect(qa.resolveQaFinding).toHaveBeenCalledWith(501, { resolution: 'dismissed' });
    await waitFor(() => expect(qa.fetchQaRun).toHaveBeenCalledTimes(2));

    qa.resolveQaFinding.mockResolvedValue(refused('FINDING_NOT_FOUND', 'No such finding.'));
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss finding 501' }));
    expect(await screen.findByText('No such finding.')).toBeTruthy();
  });

  it('explains a server that has not run the AI QA migration', async () => {
    qa.fetchQaStatus.mockResolvedValue(refused('SERVER_NOT_READY_AI_QA', 'ai_qa tables are missing'));
    qa.listQaRuns.mockResolvedValue(refused('SERVER_NOT_READY_AI_QA', 'ai_qa tables are missing'));
    renderAt(<DeckQaPage />, [PAGE]);

    const notReady = await screen.findByTestId('qa-not-ready');
    expect(notReady.textContent).toBe('The server has not run the AI QA database migration.');
    expect(screen.getByText('AI QA is not set up yet')).toBeTruthy();
    expect(screen.queryByText('ai_qa tables are missing')).toBeNull();
  });

  it('names the route AI QA and links it from the shell', () => {
    expect(documentTitleFor('/decks/qa')).toBe('AI QA · DeveloperCards Console');

    render(
      <MemoryRouter>
        <ConsoleShell title="t" qaHref="/decks/qa?deckId=7">
          body
        </ConsoleShell>
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: 'AI QA' }).getAttribute('href')).toBe('/decks/qa?deckId=7');

    cleanup();
    render(
      <MemoryRouter>
        <ConsoleShell title="t">body</ConsoleShell>
      </MemoryRouter>,
    );
    expect(screen.queryByRole('link', { name: 'AI QA' })).toBeNull();
  });
});
