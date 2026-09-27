// @vitest-environment jsdom
//
// The C07 fixes on the /automation console (R18A fix round 2, contract items
// L3, L4, L5). Mocks as in automationConsoleFixes.test.tsx: src/api/automation
// and the deck list are replaced, so nothing leaves the process.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

import { ok, refused } from './support/apiResult';
import {
  NOTIFICATION_ID,
  decisionDetailFixture,
  decisionFixture,
  evalGateFixture,
  notificationDetailFixture,
  notificationFixture,
  queueItemFixture,
  runFixture,
  statusFixture,
  watchPageFixture,
  watchTargetFixture,
} from './support/automationFixtures';
import { signInAsSuperAdmin, signOut } from './support/consoleSession';
import { renderAt } from './support/routerProbe';
import { ConfirmDialogProvider } from '../src/components/ui/ConfirmDialog';
import { DraftAutomationPanel } from '../src/features/automation/DraftAutomationPanel';
import {
  backlogLinkLabel,
  evalGateRowStatus,
  evalGateSummary,
  hiddenDecidedText,
} from '../src/lib/automationRules';
import type { ApiResult } from '../src/types/api';
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

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void };

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => {
    resolve = r;
  });
  return { promise, resolve };
}

function mountAt(entry: string) {
  return renderAt(
    <ConfirmDialogProvider>
      <AutomationPage />
    </ConfirmDialogProvider>,
    [entry],
  );
}

async function settle() {
  await act(async () => {});
}

let scrolled: Element[] = [];

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
  api.fetchNotification.mockResolvedValue(ok(notificationDetailFixture()));
  authoring.fetchDecks.mockResolvedValue(ok([DECK]));
  scrolled = [];
  Element.prototype.scrollIntoView = function scrollIntoView(this: Element) {
    scrolled.push(this);
  };
  signInAsSuperAdmin();
});

afterEach(() => {
  cleanup();
  signOut();
  delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
});

describe('open exceptions come from the server (automation-19, frontend-console-13, L4)', () => {
  it("reaches the only open item although it sits on the unfiltered list's second page", async () => {
    // Unfiltered, the newest 50 are all handled and the open one is on page 2.
    api.listAutomationDecisions.mockImplementation((params: { open?: boolean; cursor?: string }) => {
      if (params.open) return Promise.resolve(ok({ items: [decisionFixture({ draftId: 77 })], nextCursor: null }));
      if (params.cursor === 'p2') {
        return Promise.resolve(ok({ items: [decisionFixture({ draftId: 77 })], nextCursor: null }));
      }
      return Promise.resolve(
        ok({
          items: [41, 42, 43].map(id => decisionFixture({ draftId: id, humanAction: 'accepted' })),
          nextCursor: 'p2',
        }),
      );
    });
    mountAt('/automation?tab=decisions&state=human&open=1');

    expect(await screen.findByRole('button', { name: 'Details of draft 77' })).toBeTruthy();
    expect(api.listAutomationDecisions).toHaveBeenCalledWith({
      deckId: undefined,
      state: 'human',
      reason: undefined,
      open: true,
      limit: 50,
    });
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
    expect(screen.queryByText(/hidden on the loaded pages/)).toBeNull();
    expect(screen.queryByText('No automatic decision matches.')).toBeNull();
  });

  it('asks page 2 of the open list with open=true and its cursor', async () => {
    const user = userEvent.setup();
    api.listAutomationDecisions.mockImplementation((params: { cursor?: string }) =>
      Promise.resolve(
        params.cursor
          ? ok({ items: [decisionFixture({ draftId: 78 })], nextCursor: null })
          : ok({ items: [decisionFixture({ draftId: 77 })], nextCursor: 'o2' }),
      ),
    );
    mountAt('/automation?tab=decisions&state=human&open=1');
    await user.click(await screen.findByRole('button', { name: 'Load more' }));
    await screen.findByRole('button', { name: 'Details of draft 78' });
    expect(api.listAutomationDecisions).toHaveBeenLastCalledWith(
      expect.objectContaining({ open: true, state: 'human', cursor: 'o2' }),
    );
  });

  it('never sends open when the box is clear, and reads open=true in a link', async () => {
    mountAt('/automation?tab=decisions&state=human');
    await screen.findByRole('button', { name: 'Details of draft 41' });
    expect(api.listAutomationDecisions.mock.calls[0][0]).not.toHaveProperty('open', true);
    cleanup();

    mountAt('/automation?tab=decisions&state=human&open=true');
    await screen.findByRole('button', { name: 'Details of draft 41' });
    expect((screen.getByLabelText('Open only (no person has decided)') as HTMLInputElement).checked).toBe(true);
    expect(api.listAutomationDecisions).toHaveBeenLastCalledWith(expect.objectContaining({ open: true }));
  });

  it('pluralises the hidden-count note (frontend-console-11)', () => {
    expect(hiddenDecidedText(1)).toBe('1 decided by a person is hidden on the loaded pages.');
    expect(hiddenDecidedText(3)).toBe('3 decided by a person are hidden on the loaded pages.');
  });
});

describe('the publishes waiting for a person (frontend-console-15, L4)', () => {
  it('lists each deck and reason and links its AI QA page and the Runs tab', async () => {
    api.fetchAutomationStatus.mockResolvedValue(
      ok(
        statusFixture({
          backlog: {
            humanPending: 0,
            oldestHumanPendingAt: null,
            humanPublishes: 2,
            humanPublishItems: [
              { deckId: 7, deckSlug: 'aws-saa-c03', reason: 'DECK_NEVER_PUBLISHED', since: '2026-09-27T12:00:00Z' },
              { deckId: 9, deckSlug: 'aws-dva-c02', reason: 'AI_QA_BLOCKED', since: '2026-09-28T08:00:00Z' },
            ],
          },
        }),
      ),
    );
    mountAt('/automation');
    const backlog = await screen.findByRole('region', { name: 'Open exceptions' });
    const count = within(backlog).getByTestId('automation-backlog-human-publishes');
    expect(count.textContent).toBe('2');
    expect(count.getAttribute('href')).toBe('/automation?tab=runs');
    expect(count.getAttribute('aria-label')).toBe('2 publishes waiting for you: show the runs');

    const list = within(backlog).getByRole('list', { name: 'Publishes waiting for you' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText('The first publish of a deck is always a person')).toBeTruthy();
    expect(within(rows[0]).getByText('since 2026-09-27 12:00 UTC')).toBeTruthy();
    expect(within(rows[0]).getByRole('link', { name: 'AI QA of aws-saa-c03' }).getAttribute('href')).toBe(
      '/decks/qa?deckId=7',
    );
    expect(within(rows[1]).getByText('AI QA blocker open')).toBeTruthy();
    expect(within(rows[1]).queryByText('AI_QA_BLOCKED')).toBeNull();
  });

  it('points at the Runs tab when the server does not list the decks yet', async () => {
    api.fetchAutomationStatus.mockResolvedValue(
      ok(
        statusFixture({
          backlog: { humanPending: 0, oldestHumanPendingAt: null, humanPublishes: 1, humanPublishItems: null },
        }),
      ),
    );
    mountAt('/automation');
    const backlog = await screen.findByRole('region', { name: 'Open exceptions' });
    expect(backlog.textContent).toContain('on the Runs tab, the Publishes column shows each deck marked Needs you');
    expect(within(backlog).queryByRole('list')).toBeNull();
  });

  it('names the drafts link by what it opens, not by its digit (frontend-console-19)', async () => {
    mountAt('/automation');
    const backlog = await screen.findByRole('region', { name: 'Open exceptions' });
    const link = within(backlog).getByRole('link', { name: '2 drafts waiting for you: show open exceptions' });
    expect(link.textContent).toBe('2');
    expect(backlogLinkLabel(1)).toBe('1 draft waiting for you: show open exceptions');
  });
});

describe('unconfirmed email on the Email card (frontend-console-16, L5)', () => {
  it('shows the count with a warning and links the queued emails', async () => {
    api.fetchAutomationStatus.mockResolvedValue(
      ok(statusFixture({ notifications: { sent24h: 3, failed24h: 0, queued: 2, unconfirmed: 2, lastSentAt: null } })),
    );
    mountAt('/automation');
    const card = await screen.findByRole('region', { name: 'Email summary' });
    const cell = within(card).getByTestId('automation-email-unconfirmed');
    expect(within(cell).getByText('2').className).toContain('bg-amber-50');
    const link = within(cell).getByRole('link', { name: 'Check the queued emails' });
    expect(link.getAttribute('href')).toBe('/automation?tab=email&status=queued');
  });

  it('shows 0 without a warning or link', async () => {
    mountAt('/automation');
    const card = await screen.findByRole('region', { name: 'Email summary' });
    const cell = within(card).getByTestId('automation-email-unconfirmed');
    expect(cell.textContent).toBe('0');
    expect(within(cell).queryByRole('link')).toBeNull();
  });

  it('opens the Email log on the status the link names', async () => {
    mountAt('/automation?tab=email&status=queued');
    await screen.findByRole('button', { name: `Show email ${NOTIFICATION_ID.slice(0, 8)}` });
    expect((screen.getByLabelText('Status') as HTMLSelectElement).value).toBe('queued');
    expect(api.listNotifications).toHaveBeenCalledWith({ kind: undefined, status: 'queued', limit: 50 });
  });
});

describe('the eval gate follows K2: only the newest evaluation counts (frontend-console-17, L3)', () => {
  it('names a revoked newest gate and marks the older passed one superseded', async () => {
    api.fetchEvalGate.mockResolvedValue(
      ok({
        current: null,
        history: [
          evalGateFixture({ gateId: 2, revokedAt: '2026-09-28T09:00:00Z', revokedBySub: 'owner-sub' }),
          evalGateFixture({ gateId: 1 }),
        ],
      }),
    );
    mountAt('/automation');
    const card = await screen.findByRole('region', { name: 'Eval gate' });
    const summary = await within(card).findByTestId('automation-gate-summary');
    expect(summary.textContent).toBe(
      'The newest eval gate (#2) is revoked. Only the newest evaluation counts, so live mode runs as a dry run. Record a new report to go live.',
    );
    expect(card.textContent).not.toContain('No passed eval gate is recorded');
    expect(card.textContent).toContain('Only the newest evaluation counts');

    const table = within(card).getByRole('table');
    expect(within(table).getByRole('columnheader', { name: 'Status' })).toBeTruthy();
    const rows = within(table).getAllByRole('row').slice(1);
    expect(within(rows[0]).getByText('Revoked 2026-09-28 09:00 UTC')).toBeTruthy();
    expect(within(rows[1]).getByText('Superseded')).toBeTruthy();
    expect(within(rows[1]).queryByText('Effective')).toBeNull();
  });

  it('shows a failed newest evaluation as blocking live', async () => {
    api.fetchEvalGate.mockResolvedValue(
      ok({ current: null, history: [evalGateFixture({ gateId: 5, passed: false }), evalGateFixture({ gateId: 4 })] }),
    );
    mountAt('/automation');
    const card = await screen.findByRole('region', { name: 'Eval gate' });
    const summary = await within(card).findByTestId('automation-gate-summary');
    expect(summary.textContent).toContain('The newest evaluation (#5) failed, and it blocks live mode');
    const rows = within(within(card).getByRole('table')).getAllByRole('row').slice(1);
    expect(within(rows[0]).getByText('Failed: blocks live')).toBeTruthy();
    expect(within(rows[1]).getByText('Superseded')).toBeTruthy();
  });

  it('marks the current gate effective, labels its metrics and offers Revoke', async () => {
    api.fetchEvalGate.mockResolvedValue(
      ok({
        current: evalGateFixture({ gateId: 4, metrics: { autoAcceptPrecisionCiLower: 0.95, newMetric: 1 } }),
        history: [evalGateFixture({ gateId: 4 }), evalGateFixture({ gateId: 3 })],
      }),
    );
    mountAt('/automation');
    const card = await screen.findByRole('region', { name: 'Eval gate' });
    const current = await within(card).findByTestId('automation-gate-current');
    expect(within(current).getByText('Auto-accept precision, 95% CI lower bound')).toBeTruthy();
    expect(within(current).queryByText('autoAcceptPrecisionCiLower')).toBeNull();
    // An unknown metric key still shows, raw.
    expect(within(current).getByText('newMetric')).toBeTruthy();
    expect(within(current).getByRole('button', { name: 'Revoke gate' })).toBeTruthy();
    expect(within(card).queryByTestId('automation-gate-summary')).toBeNull();
    const rows = within(within(card).getByRole('table')).getAllByRole('row').slice(1);
    expect(within(rows[0]).getByText('Effective')).toBeTruthy();
    expect(within(rows[1]).getByText('Superseded')).toBeTruthy();
  });

  it('computes the summary from the newest row, whatever order history arrives in', () => {
    const passed1 = { gateId: 1, passed: true, revokedAt: null };
    const revoked2 = { gateId: 2, passed: true, revokedAt: '2026-09-28T09:00:00Z' };
    expect(evalGateSummary({ current: null, history: [] })).toEqual({ kind: 'none' });
    expect(evalGateSummary({ current: null, history: [passed1, revoked2] })).toEqual({ kind: 'revoked', gateId: 2 });
    expect(evalGateSummary({ current: passed1, history: [passed1] })).toEqual({ kind: 'effective', gateId: 1 });
    expect(evalGateRowStatus(passed1, [passed1, revoked2], null)).toEqual({ label: 'Superseded', tone: 'neutral' });
  });
});

describe('focus returns after an action removes the focused control (frontend-console-18)', () => {
  it('Close returns focus to the Details button of the row', async () => {
    const user = userEvent.setup();
    mountAt('/automation?tab=decisions');
    await user.click(await screen.findByRole('button', { name: 'Details of draft 41' }));
    const detail = await screen.findByRole('region', { name: 'Decision detail' });
    await user.click(within(detail).getByRole('link', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Decision detail' })).toBeNull());
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Details of draft 41' })),
    );
  });

  it('Close falls back to the Decisions heading when the row is not loaded', async () => {
    const user = userEvent.setup();
    api.fetchAutomationDecision.mockResolvedValue(ok(decisionDetailFixture({ draftId: 99 })));
    mountAt('/automation?tab=decisions&draftId=99');
    const detail = await screen.findByRole('region', { name: 'Decision detail' });
    await user.click(within(detail).getByRole('link', { name: 'Close' }));
    const heading = screen.getByRole('heading', { name: 'Decisions' });
    await waitFor(() => expect(document.activeElement).toBe(heading));
    expect(heading.getAttribute('tabindex')).toBe('-1');
  });

  it('Hide returns focus to the Show button it came from', async () => {
    const user = userEvent.setup();
    mountAt('/automation?tab=email');
    const show = await screen.findByRole('button', { name: `Show email ${NOTIFICATION_ID.slice(0, 8)}` });
    await user.click(show);
    const body = await screen.findByRole('region', { name: 'Email body' });
    await user.click(within(body).getByRole('button', { name: 'Hide' }));
    expect(screen.queryByRole('region', { name: 'Email body' })).toBeNull();
    expect(document.activeElement).toBe(show);
  });

  it('Edit focuses the pattern field, and Cancel and Save return to the Edit button', async () => {
    const user = userEvent.setup();
    api.updateWatchTarget.mockResolvedValue(ok(watchTargetFixture()));
    mountAt('/automation?tab=watch');
    await screen.findByTestId('automation-watch-target-3');

    await user.click(screen.getByRole('button', { name: 'Edit target 3' }));
    const row = screen.getByTestId('automation-watch-target-3');
    await waitFor(() =>
      expect(document.activeElement).toBe(within(row).getByLabelText('Title pattern (PostgreSQL regex)')),
    );
    await user.click(within(row).getByRole('button', { name: 'Cancel editing target 3' }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Edit target 3' })));

    await user.click(screen.getByRole('button', { name: 'Edit target 3' }));
    await user.click(within(screen.getByTestId('automation-watch-target-3')).getByRole('button', { name: 'Save target 3' }));
    await waitFor(() => expect(screen.getByTestId('automation-live').textContent).toBe('Target 3 saved.'));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Edit target 3' })));
  });
});

describe('the watch deep link and its contrast (frontend-console-19)', () => {
  it('scrolls the marked row into view and keeps its pattern text at AA contrast', async () => {
    mountAt('/automation?tab=watch&targetId=3');
    const row = await screen.findByTestId('automation-watch-target-3');
    expect(row.getAttribute('aria-current')).toBe('true');
    await waitFor(() => expect(scrolled).toContain(row));
    const pattern = within(row).getByText(watchTargetFixture().itemTitlePattern as string);
    // text-slate-500 on bg-indigo-50 is 4.26:1; slate-600 passes 4.5:1.
    expect(pattern.className).toContain('text-slate-600');
    expect(pattern.className).not.toContain('text-slate-500');
    expect(screen.queryByTestId('automation-watch-target-missing')).toBeNull();
  });

  it('says so when the linked target is not on the loaded pages', async () => {
    api.fetchWatch.mockResolvedValue(ok(watchPageFixture({ nextCursor: 'w2' })));
    mountAt('/automation?tab=watch&targetId=88');
    const note = await screen.findByTestId('automation-watch-target-missing');
    expect(note.textContent).toBe('Target 88 is not on the loaded pages. Load more to look further.');
    expect(scrolled).toHaveLength(0);
    cleanup();

    api.fetchWatch.mockResolvedValue(ok(watchPageFixture()));
    mountAt('/automation?tab=watch&targetId=88');
    expect((await screen.findByTestId('automation-watch-target-missing')).textContent).toBe(
      'Target 88 is not in the list.',
    );
  });
});

describe('machine codes read as words, round 2 (frontend-console-11)', () => {
  it('labels the run kind, the watch kind and feed format, and a finding severity', async () => {
    api.listAutomationRuns.mockResolvedValue(ok({ items: [runFixture({ kind: 'source_changed' })], nextCursor: null }));
    mountAt('/automation?tab=runs');
    const runs = await screen.findByRole('region', { name: 'Runs' });
    expect(await within(runs).findByText('Source changed')).toBeTruthy();
    expect(within(runs).queryByText('source_changed')).toBeNull();
    cleanup();

    api.fetchWatch.mockResolvedValue(
      ok(watchPageFixture({ items: [watchTargetFixture(), watchTargetFixture({ targetId: 4, kind: 'page', feedFormat: null })] })),
    );
    mountAt('/automation?tab=watch');
    const feed = await screen.findByTestId('automation-watch-target-3');
    expect(within(feed).getByText('Feed')).toBeTruthy();
    expect(within(feed).getByText('RSS')).toBeTruthy();
    expect(within(feed).queryByText('rss')).toBeNull();
    expect(within(screen.getByTestId('automation-watch-target-4')).getByText('Cited page')).toBeTruthy();
    expect(screen.getByRole('option', { name: 'HTML headings' })).toBeTruthy();
    cleanup();

    mountAt('/automation?draftId=41');
    const detail = await screen.findByRole('region', { name: 'Decision detail' });
    const findings = await within(detail).findByRole('table', { name: 'AI QA findings' });
    expect(within(findings).getByText('Major').className).toContain('bg-red-50');
    expect(within(findings).queryByText('major')).toBeNull();
  });

  it("labels the mode and severity in the review queue's automation panel", () => {
    render(
      <MemoryRouter>
        <DraftAutomationPanel
          draftId={41}
          automation={{
            state: 'human',
            reason: 'QA_FLAGGED',
            mode: 'live',
            qa: {
              status: 'done',
              errorCode: null,
              provider: 'bedrock-converse',
              model: 'global.openai.gpt-5.5',
              promptVersion: 'qa-v4',
              blocker: 0,
              major: 0,
              minor: 1,
              findings: [{ severity: 'minor', category: 'clarity', message: 'Wordy stem.', suggestedFix: null }],
            },
            acceptedCardId: null,
            humanAction: null,
          }}
        />
      </MemoryRouter>,
    );
    const panel = screen.getByTestId('review-automation');
    expect(within(panel).getByText('Mode: Live')).toBeTruthy();
    expect(within(panel).getByText('Minor')).toBeTruthy();
    expect(panel.textContent).not.toMatch(/Mode: live|>minor</);
  });
});

describe('Load more failures belong to their list (frontend-console-20)', () => {
  for (const tab of ['queue', 'watch', 'email'] as const) {
    it(`${tab}: shows the failure by its Load more and drops it with the list`, async () => {
      const user = userEvent.setup();
      const failure = refused('HTTP_500', 'Internal error.');
      if (tab === 'queue') {
        api.listQueueItems.mockImplementation((params: { cursor?: string }) =>
          Promise.resolve(params.cursor ? failure : ok({ items: [queueItemFixture()], nextCursor: 'c1' })),
        );
      } else if (tab === 'watch') {
        api.fetchWatch.mockImplementation((params: { cursor?: string }) =>
          Promise.resolve(params.cursor ? failure : ok(watchPageFixture({ nextCursor: 'c1' }))),
        );
      } else {
        api.listNotifications.mockImplementation((params: { cursor?: string }) =>
          Promise.resolve(params.cursor ? failure : ok({ items: [notificationFixture()], nextCursor: 'c1' })),
        );
      }
      mountAt(`/automation?tab=${tab}`);
      await user.click(await screen.findByRole('button', { name: 'Load more' }));
      const alert = await screen.findByText('Internal error.');
      // Inside the list's own card, not the page-level write-error slot above it.
      const list = alert.closest('section') as HTMLElement;
      expect(within(list).getByRole('button', { name: 'Load more' })).toBeTruthy();

      await user.click(within(list).getByRole('button', { name: 'Refresh' }));
      await waitFor(() => expect(screen.queryByText('Internal error.')).toBeNull());
    });
  }

  it('queue: a new filter does not show the abandoned Load more as busy', async () => {
    const user = userEvent.setup();
    const more = deferred<ApiResult<unknown>>();
    api.listQueueItems.mockImplementation((params: { cursor?: string; status?: string }) => {
      if (params.cursor) return more.promise;
      if (params.status === 'failed') {
        return Promise.resolve(ok({ items: [queueItemFixture({ itemId: 20, status: 'failed' })], nextCursor: 'f1' }));
      }
      return Promise.resolve(ok({ items: [queueItemFixture()], nextCursor: 'c1' }));
    });
    mountAt('/automation?tab=queue');
    await user.click(await screen.findByRole('button', { name: 'Load more' }));
    await user.selectOptions(screen.getByLabelText('Status'), 'failed');
    await within(await screen.findByRole('table')).findByText('20');
    const button = screen.getByRole('button', { name: 'Load more' }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    await act(async () => more.resolve(ok({ items: [], nextCursor: null })));
    await settle();
  });
});
