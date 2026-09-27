// @vitest-environment jsdom
//
// The D07 fixes on the /automation console (R18A fix round 3, contract items
// M2, M3, M4). Mocks as in automationConsoleRound2.test.tsx: src/api/automation
// and the deck list are replaced, so nothing leaves the process.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ok } from './support/apiResult';
import {
  RUN_ID,
  decisionDetailFixture,
  decisionFixture,
  evalGateFixture,
  notificationFixture,
  queueItemFixture,
  runFixture,
  statusFixture,
  watchPageFixture,
} from './support/automationFixtures';
import { signInAsSuperAdmin, signOut } from './support/consoleSession';
import { renderAt } from './support/routerProbe';
import { ConfirmDialogProvider } from '../src/components/ui/ConfirmDialog';
import { clearVerdictSeen, wasVerdictSeen } from '../src/lib/automationVerdictSeen';
import type { Deck } from '../src/types/deck';

const api = vi.hoisted(() => ({
  fetchAutomationStatus: vi.fn(),
  listAutomationRuns: vi.fn(),
  listAutomationDecisions: vi.fn(),
  fetchAutomationDecision: vi.fn(),
  fetchEvalGate: vi.fn(),
  recordEvalGate: vi.fn(),
  revokeEvalGate: vi.fn(),
  listQueueItems: vi.fn(),
  addQueueItem: vi.fn(),
  skipQueueItem: vi.fn(),
  fetchWatch: vi.fn(),
  addWatchTarget: vi.fn(),
  updateWatchTarget: vi.fn(),
  listNotifications: vi.fn(),
  fetchNotification: vi.fn(),
  sendTestNotification: vi.fn(),
}));

const authoring = vi.hoisted(() => ({ fetchDecks: vi.fn() }));

vi.mock('../src/api/automation', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/api/automation')>();
  return { ...actual, ...api };
});

vi.mock('../src/api/authoring', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/api/authoring')>();
  return { ...actual, ...authoring };
});

const { AutomationPage } = await import('../src/pages/AutomationPage');

const DECK: Deck = {
  id: 7,
  slug: 'aws-saa-c03',
  title: 'AWS SAA-C03',
  author: 'DeveloperCards',
  locale: 'en',
  deckType: 0,
  version: 1,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const FAILED_REPORT = '{"v":1,"kind":"automation-gate","passed":false,"failures":["seededRecall"]}';
const PASSED_REPORT = '{"v":1,"kind":"automation-gate","passed":true,"failures":[]}';

function mountAt(entry: string) {
  return renderAt(
    <ConfirmDialogProvider>
      <AutomationPage />
    </ConfirmDialogProvider>,
    [entry],
  );
}

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  authoring.fetchDecks.mockReset();
  api.fetchAutomationStatus.mockResolvedValue(ok(statusFixture()));
  api.fetchEvalGate.mockResolvedValue(ok({ current: evalGateFixture(), history: [evalGateFixture()] }));
  api.listAutomationRuns.mockResolvedValue(ok({ items: [runFixture()], nextCursor: null }));
  api.listAutomationDecisions.mockResolvedValue(ok({ items: [decisionFixture()], nextCursor: null }));
  api.fetchAutomationDecision.mockResolvedValue(ok(decisionDetailFixture()));
  api.listQueueItems.mockResolvedValue(ok({ items: [queueItemFixture()], nextCursor: null }));
  api.fetchWatch.mockResolvedValue(ok(watchPageFixture()));
  api.listNotifications.mockResolvedValue(ok({ items: [notificationFixture()], nextCursor: null }));
  authoring.fetchDecks.mockResolvedValue(ok([DECK]));
  Element.prototype.scrollIntoView = function scrollIntoView() {};
  clearVerdictSeen();
  signInAsSuperAdmin();
});

afterEach(() => {
  cleanup();
  signOut();
  clearVerdictSeen();
  delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
});

describe('the Overview reads the blind shadow agreement (frontend-console-22, automation-21, M3)', () => {
  it('shows the blind pair with the server rate, the totals and the go-live floor', async () => {
    const base = statusFixture();
    api.fetchAutomationStatus.mockResolvedValue(
      ok(
        statusFixture({
          shadow: {
            ...base.shadow,
            humanDecided: 10,
            humanAccepted: 8,
            agreementRate: 0.25,
            blindDecided: 4,
            blindAccepted: 1,
          },
        }),
      ),
    );
    mountAt('/automation');

    const card = await screen.findByRole('region', { name: 'Dry-run shadow agreement' });
    expect(within(card).getByTestId('automation-shadow-blind').textContent).toBe(
      '1 of 4 would-accept drafts decided blind were accepted unedited (25.0%).',
    );
    expect(within(card).getByTestId('automation-shadow-totals').textContent).toBe(
      '10 decided in all, 6 of them after seeing the verdict.',
    );
    expect(within(card).getByTestId('automation-shadow-threshold').textContent).toBe(
      'Go-live floor: 4 / 100 blind decisions',
    );
    // The all-decisions pair never appears next to the blind rate.
    expect(card.textContent).not.toContain('8 of 10');
  });

  it('shows no rate when nothing was decided blind, whatever the non-blind counts say', async () => {
    const base = statusFixture();
    api.fetchAutomationStatus.mockResolvedValue(
      ok(
        statusFixture({
          shadow: { ...base.shadow, humanDecided: 12, humanAccepted: 12, agreementRate: null, blindDecided: 0, blindAccepted: 0 },
        }),
      ),
    );
    mountAt('/automation');

    const card = await screen.findByRole('region', { name: 'Dry-run shadow agreement' });
    expect(within(card).getByTestId('automation-shadow-blind').textContent).toBe('No blind decision yet.');
    expect(card.textContent).not.toMatch(/%/);
  });

  it('renders an older server without the blind counts and without live', async () => {
    const base = statusFixture();
    api.fetchAutomationStatus.mockResolvedValue(
      ok(
        statusFixture({
          shadow: { ...base.shadow, agreementRate: 0.875, blindDecided: null, blindAccepted: null },
          live: null,
        }),
      ),
    );
    mountAt('/automation');

    const card = await screen.findByRole('region', { name: 'Dry-run shadow agreement' });
    expect(within(card).getByTestId('automation-shadow-blind').textContent).toBe(
      'This server does not report blind decisions yet, so the shadow agreement cannot be read here.',
    );
    expect(within(card).queryByTestId('automation-shadow-threshold')).toBeNull();
    expect(card.textContent).not.toMatch(/87\.5/);
    const live = screen.getByRole('region', { name: 'Live quality' });
    expect(live.textContent).toContain('This server does not report live quality yet.');
  });
});

describe('the Overview shows live quality (M2)', () => {
  it('shows the four numbers of status.live', async () => {
    api.fetchAutomationStatus.mockResolvedValue(
      ok(statusFixture({ live: { autoAccepted30d: 40, deletedByPerson: 1, editedByPerson: 2, overrideRate: 0.075 } })),
    );
    mountAt('/automation');

    const live = await screen.findByTestId('automation-live-quality');
    const values = within(live)
      .getAllByRole('definition')
      .map(dd => dd.textContent);
    expect(values).toEqual(['40', '1', '2', '7.5%']);
    expect(live.textContent).toContain('Deleted by a person');
    expect(live.textContent).toContain('Edited by a person');
  });

  it('shows a dash for the override rate when nothing was auto-accepted', async () => {
    mountAt('/automation');
    const live = await screen.findByTestId('automation-live-quality');
    expect(within(live).getAllByRole('definition').map(dd => dd.textContent)).toEqual(['0', '0', '0', '—']);
  });
});

describe('the eval-gate card records failed reports (frontend-console-23, M4)', () => {
  it('posts a failed report after the confirm and reloads after 400 EVAL_GATE_FAILED', async () => {
    const user = userEvent.setup();
    api.recordEvalGate.mockResolvedValue({
      success: false,
      data: null,
      error: { code: 'EVAL_GATE_FAILED', message: 'The eval gate report fails: seededRecall' },
      traceId: 't',
    });
    mountAt('/automation');

    const textarea = await screen.findByLabelText('Gate report JSON');
    await user.click(textarea);
    await user.paste(FAILED_REPORT);
    // The newest row is now the failed gate #5: it blocks live.
    const failedGate = evalGateFixture({ gateId: 5, passed: false, createdAt: '2026-09-28T12:00:00Z' });
    api.fetchEvalGate.mockResolvedValue(ok({ current: null, history: [failedGate, evalGateFixture()] }));
    await user.click(screen.getByRole('button', { name: 'Record eval gate' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Record the failed report' }));

    await waitFor(() => expect(api.recordEvalGate).toHaveBeenCalledWith(FAILED_REPORT));
    // The gate and the status reload exactly as after a success.
    await waitFor(() => expect(api.fetchEvalGate).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(api.fetchAutomationStatus).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.getByTestId('automation-gate-recorded-failed').textContent).toBe(
        'Recorded as gate #5 (failed): live mode now runs as a dry run. The eval gate report fails: seededRecall',
      ),
    );
    // The old gate is no longer shown as effective with a Revoke button.
    expect(screen.queryByTestId('automation-gate-current')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Revoke gate' })).toBeNull();
    expect((textarea as HTMLTextAreaElement).value).toBe('');
  });

  it('reloads after a server-recomputed failure of a report that claimed to pass', async () => {
    const user = userEvent.setup();
    api.recordEvalGate.mockResolvedValue({
      success: false,
      data: null,
      error: { code: 'EVAL_GATE_FAILED', message: 'The eval gate report fails: defectEscapeRate' },
      traceId: 't',
    });
    mountAt('/automation');
    const textarea = await screen.findByLabelText('Gate report JSON');
    await user.click(textarea);
    await user.paste(PASSED_REPORT);
    api.fetchEvalGate.mockResolvedValue(
      ok({ current: null, history: [evalGateFixture({ gateId: 6, passed: false }), evalGateFixture()] }),
    );
    await user.click(screen.getByRole('button', { name: 'Record eval gate' }));

    // A report that says it passed needs no confirm.
    expect(screen.queryByRole('alertdialog')).toBeNull();
    await waitFor(() => expect(api.fetchEvalGate).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(api.fetchAutomationStatus).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.getByTestId('automation-gate-recorded-failed').textContent).toContain(
        'Recorded as gate #6 (failed): live mode now runs as a dry run.',
      ),
    );
  });

  it('says a re-posted revoked report needs a new evaluation, and maps a stale report', async () => {
    const user = userEvent.setup();
    api.recordEvalGate.mockResolvedValue({
      success: false,
      data: null,
      error: { code: 'EVAL_GATE_REVOKED', message: 'server words' },
      traceId: 't',
    });
    mountAt('/automation');
    const textarea = await screen.findByLabelText('Gate report JSON');
    await user.click(textarea);
    await user.paste(PASSED_REPORT);
    await user.click(screen.getByRole('button', { name: 'Record eval gate' }));
    expect(
      await screen.findByText('This report belongs to a revoked eval gate; run the evaluation again.'),
    ).toBeTruthy();
    expect(screen.queryByText('That eval gate is already revoked.')).toBeNull();
    // Nothing was recorded, so nothing reloads.
    expect(api.fetchEvalGate).toHaveBeenCalledTimes(1);

    api.recordEvalGate.mockResolvedValue({
      success: false,
      data: null,
      error: { code: 'EVAL_GATE_STALE', message: 'server words' },
      traceId: 't',
    });
    await user.click(screen.getByRole('button', { name: 'Record eval gate' }));
    expect(
      await screen.findByText('A newer evaluation is already recorded; this report is older and cannot replace it.'),
    ).toBeTruthy();
  });
});

describe('a failed run shows why (frontend-console-24)', () => {
  it('shows the error under the outcome and in full in the run section', async () => {
    const error = 'AGENT_BLOCKED: the source page needs a login';
    api.listAutomationRuns.mockResolvedValue(
      ok({ items: [runFixture({ status: 'failed', outcome: 'failed', error })], nextCursor: null }),
    );
    mountAt(`/automation?tab=runs&runId=${RUN_ID}`);

    expect((await screen.findByTestId(`automation-run-error-${RUN_ID}`)).textContent).toBe(error);
    expect((await screen.findByTestId('automation-run-error-full')).textContent).toContain(error);
  });

  it('clips a long error in the table and keeps it whole in the run section', async () => {
    const error = `RUNNER_UNAVAILABLE: ${'x'.repeat(400)}`;
    api.listAutomationRuns.mockResolvedValue(
      ok({ items: [runFixture({ status: 'failed', outcome: 'failed', error })], nextCursor: null }),
    );
    mountAt(`/automation?tab=runs&runId=${RUN_ID}`);

    const cell = await screen.findByTestId(`automation-run-error-${RUN_ID}`);
    expect(cell.textContent?.length).toBe(200);
    expect(cell.textContent?.endsWith('…')).toBe(true);
    expect((await screen.findByTestId('automation-run-error-full')).textContent).toContain(error);
  });
});

describe("a run's decisions page (frontend-console-28)", () => {
  it('loads the next page of a run with more than 50 decisions', async () => {
    const user = userEvent.setup();
    api.listAutomationDecisions.mockImplementation((params: { runId?: string; cursor?: string }) => {
      if (params.cursor === 'p2') {
        return Promise.resolve(ok({ items: [decisionFixture({ draftId: 99 })], nextCursor: null }));
      }
      return Promise.resolve(ok({ items: [decisionFixture({ draftId: 41 })], nextCursor: 'p2' }));
    });
    mountAt(`/automation?tab=runs&runId=${RUN_ID}`);

    const section = await screen.findByRole('region', { name: 'Run decisions' });
    await within(section).findByRole('button', { name: 'Details of draft 41' });
    expect(section.textContent).toContain('1 shown; this run has more.');
    await user.click(within(section).getByRole('button', { name: 'Load more decisions' }));

    await within(section).findByRole('button', { name: 'Details of draft 99' });
    expect(api.listAutomationDecisions).toHaveBeenLastCalledWith({ runId: RUN_ID, limit: 50, cursor: 'p2' });
    expect(within(section).getByRole('button', { name: 'Details of draft 41' })).toBeTruthy();
    expect(within(section).queryByRole('button', { name: 'Load more decisions' })).toBeNull();
  });
});

describe('the Automation page keeps a pending dry-run verdict hidden (frontend-console-25)', () => {
  const pendingWouldAccept = decisionFixture({
    draftId: 51,
    state: 'would_accept',
    reason: null,
    reasonDetail: null,
    qa: { ...decisionFixture().qa!, major: 0 },
  });

  it('hides the verdict in the table until revealed, and records the reveal', async () => {
    const user = userEvent.setup();
    api.listAutomationDecisions.mockResolvedValue(ok({ items: [pendingWouldAccept], nextCursor: null }));
    mountAt('/automation?tab=decisions');

    const reveal = await screen.findByRole('button', { name: 'Reveal the verdict of draft 51' });
    const table = screen.getByRole('region', { name: 'Decisions' }).querySelector('tbody') as HTMLElement;
    expect(within(table).getByText('Verdict hidden until you decide')).toBeTruthy();
    expect(table.textContent).not.toContain('Would be accepted');
    expect(wasVerdictSeen(51)).toBe(false);

    await user.click(reveal);
    expect(within(table).getByText('Would be accepted')).toBeTruthy();
    expect(wasVerdictSeen(51)).toBe(true);
  });

  it('hides the verdict, findings and events in the drawer until revealed', async () => {
    const user = userEvent.setup();
    api.listAutomationDecisions.mockResolvedValue(ok({ items: [pendingWouldAccept], nextCursor: null }));
    api.fetchAutomationDecision.mockResolvedValue(
      ok({ ...decisionDetailFixture(), ...pendingWouldAccept, events: [] }),
    );
    mountAt('/automation?tab=decisions&draftId=51');

    const drawer = await screen.findByRole('region', { name: 'Decision detail' });
    await within(drawer).findByTestId('automation-decision-hidden');
    expect(drawer.textContent).not.toMatch(/Would be accepted|AI QA findings|Option C is obviously wrong/);
    // Deciding from the hidden drawer is still a blind decision.
    expect(within(drawer).getByRole('link', { name: 'Decide in review queue' }).getAttribute('href')).toBe(
      '/review?deckId=7&draftId=51',
    );

    await user.click(within(drawer).getByRole('button', { name: 'Reveal verdict' }));
    expect(within(drawer).getByText('Would be accepted')).toBeTruthy();
    expect(within(drawer).getByText('Option C is obviously wrong.')).toBeTruthy();
    expect(wasVerdictSeen(51)).toBe(true);
  });

  it('counts a list filtered by the would-accept state as seen', async () => {
    api.listAutomationDecisions.mockResolvedValue(ok({ items: [pendingWouldAccept], nextCursor: null }));
    mountAt('/automation?tab=decisions&state=would_accept');

    await screen.findByTestId('automation-decisions-verdict-filter');
    await waitFor(() => expect(wasVerdictSeen(51)).toBe(true));
    expect(screen.queryByRole('button', { name: 'Reveal the verdict of draft 51' })).toBeNull();
  });
});

describe('the exception inbox (frontend-console-27)', () => {
  it('labels the open filter by what the server applies and links an open routed row to Decide', async () => {
    api.listAutomationDecisions.mockResolvedValue(
      ok({ items: [decisionFixture({ draftId: 41 }), decisionFixture({ draftId: 42, humanAction: 'accepted' })], nextCursor: null }),
    );
    mountAt('/automation?tab=decisions');

    expect(await screen.findByLabelText('Open exceptions only (routed to you, still pending)')).toBeTruthy();
    const decide = await screen.findByRole('link', { name: 'Decide draft 41 in the review queue' });
    expect(decide.getAttribute('href')).toBe('/review?deckId=7&draftId=41');
    // A handled row has nothing to decide.
    expect(screen.queryByRole('link', { name: 'Decide draft 42 in the review queue' })).toBeNull();
  });

  it('never offers Decide on a would-accept row', async () => {
    api.listAutomationDecisions.mockResolvedValue(
      ok({ items: [decisionFixture({ draftId: 51, state: 'would_accept', reason: null })], nextCursor: null }),
    );
    mountAt('/automation?tab=decisions');
    await screen.findByRole('button', { name: 'Details of draft 51' });
    expect(screen.queryByRole('link', { name: 'Decide draft 51 in the review queue' })).toBeNull();
  });

  it('says under the backlog that in dry run every pending draft waits in the review queue', async () => {
    mountAt('/automation');
    const line = await screen.findByTestId('automation-backlog-dry-run');
    expect(line.textContent).toBe('Dry run: every pending draft also waits for you in the review queue.');
    expect(within(line).getByRole('link', { name: 'review queue' }).getAttribute('href')).toBe('/review');
  });
});
