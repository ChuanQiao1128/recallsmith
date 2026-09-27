// @vitest-environment jsdom
//
// The B07 fixes on the /automation console (R18A fix round 1). Mocks as in
// automationPage.test.tsx: src/api/automation and the deck list are replaced,
// so nothing leaves the process; the session is a real token.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ok, refused } from './support/apiResult';
import {
  NOTIFICATION_ID,
  RUN_ID,
  decisionDetailFixture,
  decisionFixture,
  evalGateFixture,
  notificationDetailFixture,
  notificationFixture,
  queueItemFixture,
  runFixture,
  statusFixture,
  watchPageFixture,
} from './support/automationFixtures';
import { signInAsSuperAdmin, signOut } from './support/consoleSession';
import { renderAt } from './support/routerProbe';
import { ConfirmDialogProvider } from '../src/components/ui/ConfirmDialog';
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

const RUN_2 = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const NOTIFICATION_2 = '1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e';

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
  // jsdom has no layout, so scrollIntoView is absent; record the calls instead.
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

describe('handled vs open exceptions (frontend-console-1, automation-10, K7)', () => {
  it('labels a handled human decision and shows who decided in a Person column', async () => {
    api.listAutomationDecisions.mockResolvedValue(
      ok({
        items: [
          // Live: an open dry-run row hides its state until decided (E05 frontend-console-30).
          decisionFixture({ draftId: 41, mode: 'live' }),
          decisionFixture({ draftId: 42, humanAction: 'rejected', humanReason: 'Duplicate of s3-01' }),
        ],
        nextCursor: null,
      }),
    );
    mountAt('/automation?tab=decisions');
    const table = await screen.findByRole('table');
    expect(within(table).getByRole('columnheader', { name: 'Person' })).toBeTruthy();
    const open = within(table).getByRole('button', { name: 'Details of draft 41' }).closest('tr') as HTMLElement;
    const handled = within(table).getByRole('button', { name: 'Details of draft 42' }).closest('tr') as HTMLElement;
    expect(within(open).getByText('Needs you')).toBeTruthy();
    expect(within(handled).queryByText('Needs you')).toBeNull();
    expect(within(handled).getByText('Handled: rejected')).toBeTruthy();
    expect(within(handled).getByText('Rejected')).toBeTruthy();
    expect(within(handled).getByText('Duplicate of s3-01')).toBeTruthy();
  });

  it('reads its filters from the URL, writes them back, and filters to open items', async () => {
    const user = userEvent.setup();
    api.listAutomationDecisions.mockResolvedValue(
      ok({
        items: [decisionFixture({ draftId: 41 }), decisionFixture({ draftId: 42, humanAction: 'accepted' })],
        nextCursor: null,
      }),
    );
    mountAt('/automation?tab=decisions&state=human');
    await waitFor(() =>
      expect(api.listAutomationDecisions).toHaveBeenCalledWith({
        deckId: undefined,
        state: 'human',
        reason: undefined,
        limit: 50,
      }),
    );
    expect((screen.getByLabelText('State') as HTMLSelectElement).value).toBe('human');
    await screen.findByRole('button', { name: 'Details of draft 42' });

    await user.selectOptions(screen.getByLabelText('Reason'), 'QA_FLAGGED');
    await waitFor(() =>
      expect(api.listAutomationDecisions).toHaveBeenLastCalledWith({
        deckId: undefined,
        state: 'human',
        reason: 'QA_FLAGGED',
        limit: 50,
      }),
    );
    expect(screen.getByTestId('loc').textContent).toBe('/automation?tab=decisions&state=human&reason=QA_FLAGGED');

    await waitFor(() => expect(screen.getAllByRole('option', { name: 'aws-saa-c03' }).length).toBeGreaterThan(0));
    await user.selectOptions(screen.getByLabelText('Deck'), '7');
    await waitFor(() =>
      expect(api.listAutomationDecisions).toHaveBeenLastCalledWith({
        deckId: 7,
        state: 'human',
        reason: 'QA_FLAGGED',
        limit: 50,
      }),
    );

    // D07 frontend-console-27: the label says what the server filter is.
    await user.click(screen.getByLabelText('Open exceptions only (routed to you, still pending)'));
    // The filters are written in one canonical order.
    expect(screen.getByTestId('loc').textContent).toBe(
      '/automation?tab=decisions&deckId=7&state=human&reason=QA_FLAGGED&open=1',
    );
    // C07 (L4, frontend-console-13): "Open only" is a server filter now, so it
    // asks again with open=true. This mock answers like an older server that
    // ignores the parameter, so the client guard still hides the handled one.
    await waitFor(() =>
      expect(api.listAutomationDecisions).toHaveBeenLastCalledWith({
        deckId: 7,
        state: 'human',
        reason: 'QA_FLAGGED',
        open: true,
        limit: 50,
      }),
    );
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Details of draft 42' })).toBeNull());
    expect(screen.getByRole('button', { name: 'Details of draft 41' })).toBeTruthy();
    expect(screen.getByText('1 decided by a person is hidden on the loaded pages.')).toBeTruthy();

    // Opening a detail keeps the filters, and Close returns to them.
    await user.click(screen.getByRole('button', { name: 'Details of draft 41' }));
    expect(screen.getByTestId('loc').textContent).toBe(
      '/automation?tab=decisions&deckId=7&state=human&reason=QA_FLAGGED&open=1&draftId=41',
    );
    const detail = await screen.findByRole('region', { name: 'Decision detail' });
    expect(within(detail).getByRole('link', { name: 'Close' }).getAttribute('href')).toBe(
      '/automation?tab=decisions&deckId=7&state=human&reason=QA_FLAGGED&open=1',
    );
  });

  it('shows the open backlog on the Overview and links it to the open exceptions', async () => {
    mountAt('/automation');
    const backlog = await screen.findByRole('region', { name: 'Open exceptions' });
    const pending = within(backlog).getByTestId('automation-backlog-human-pending');
    expect(pending.textContent).toBe('2');
    expect(pending.getAttribute('href')).toBe('/automation?tab=decisions&state=human&open=1');
    expect(within(backlog).getByText('2 d ago')).toBeTruthy();
    expect(within(backlog).getByText('Publishes waiting for you').nextElementSibling?.textContent).toBe('1');

    // The 24-hour counts mix handled and open, so their row says so and links the state.
    const recent = screen.getByRole('region', { name: 'Decisions in the last 24 hours' });
    const routed = within(recent).getByRole('link', { name: 'Routed to a person' });
    expect(routed.getAttribute('href')).toBe('/automation?tab=decisions&state=human');
    expect(within(recent).queryByText('Needs you')).toBeNull();
  });

  it('tolerates a server without the backlog field', async () => {
    api.fetchAutomationStatus.mockResolvedValue(ok(statusFixture({ backlog: null })));
    mountAt('/automation');
    const backlog = await screen.findByRole('region', { name: 'Open exceptions' });
    expect(backlog.textContent).toContain('This server does not report the open backlog yet.');
    expect(within(backlog).queryByRole('link')).toBeNull();
  });
});

describe('Load more never mixes two lists (frontend-console-2)', () => {
  it('Decisions: drops a page that arrives after the filter changed', async () => {
    const user = userEvent.setup();
    const more = deferred<ApiResult<unknown>>();
    const fresh = deferred<ApiResult<unknown>>();
    api.listAutomationDecisions.mockImplementation((params: { cursor?: string; state?: string }) => {
      if (params.cursor) return more.promise;
      if (params.state === 'human') return fresh.promise;
      return Promise.resolve(ok({ items: [decisionFixture({ draftId: 41 })], nextCursor: 'c1' }));
    });
    mountAt('/automation?tab=decisions');
    await user.click(await screen.findByRole('button', { name: 'Load more' }));
    expect(api.listAutomationDecisions).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: 'c1' }));

    await user.selectOptions(screen.getByLabelText('State'), 'human');
    // Load more is not offered while the new list loads: its cursor would be foreign.
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
    await act(async () => fresh.resolve(ok({ items: [decisionFixture({ draftId: 50 })], nextCursor: 'h1' })));
    await screen.findByRole('button', { name: 'Details of draft 50' });
    await act(async () => more.resolve(ok({ items: [decisionFixture({ draftId: 99 })], nextCursor: 'c2' })));
    await settle();

    expect(screen.queryByRole('button', { name: 'Details of draft 99' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Details of draft 41' })).toBeNull();
    // The next Load more pairs the new filter with its own cursor.
    api.listAutomationDecisions.mockResolvedValue(ok({ items: [], nextCursor: null }));
    await user.click(screen.getByRole('button', { name: 'Load more' }));
    expect(api.listAutomationDecisions).toHaveBeenLastCalledWith(
      expect.objectContaining({ state: 'human', cursor: 'h1' }),
    );
  });

  it('Decisions: appends a page to the list it was asked for', async () => {
    const user = userEvent.setup();
    api.listAutomationDecisions.mockImplementation((params: { cursor?: string }) =>
      Promise.resolve(
        params.cursor
          ? ok({ items: [decisionFixture({ draftId: 42 })], nextCursor: null })
          : ok({ items: [decisionFixture({ draftId: 41 })], nextCursor: 'c1' }),
      ),
    );
    mountAt('/automation?tab=decisions&reason=QA_FLAGGED');
    await user.click(await screen.findByRole('button', { name: 'Load more' }));
    await screen.findByRole('button', { name: 'Details of draft 42' });
    expect(screen.getByRole('button', { name: 'Details of draft 41' })).toBeTruthy();
    expect(api.listAutomationDecisions).toHaveBeenLastCalledWith({
      deckId: undefined,
      state: undefined,
      reason: 'QA_FLAGGED',
      limit: 50,
      cursor: 'c1',
    });
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
  });

  it('Runs: drops a page that arrives after the status filter changed', async () => {
    const user = userEvent.setup();
    const more = deferred<ApiResult<unknown>>();
    api.listAutomationRuns.mockImplementation((params: { cursor?: string; status?: string }) => {
      if (params.cursor) return more.promise;
      if (params.status === 'failed') return Promise.resolve(ok({ items: [runFixture({ runId: RUN_2 })], nextCursor: null }));
      return Promise.resolve(ok({ items: [runFixture()], nextCursor: 'c1' }));
    });
    mountAt('/automation?tab=runs');
    await user.click(await screen.findByRole('button', { name: 'Load more' }));
    expect(api.listAutomationRuns).toHaveBeenLastCalledWith({ status: undefined, limit: 50, cursor: 'c1' });
    await user.selectOptions(screen.getByLabelText('Status'), 'failed');
    await screen.findByRole('button', { name: `Decisions of run ${RUN_2.slice(0, 8)}` });
    await act(async () => more.resolve(ok({ items: [runFixture({ runId: '5d6e7f80-9a1b-4c2d-8e3f-4a5b6c7d8e9f' })], nextCursor: 'c2' })));
    await settle();
    expect(screen.getAllByRole('button', { name: /^Decisions of run / })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
  });

  it('Queue: drops a page that arrives after the status filter changed', async () => {
    const user = userEvent.setup();
    const more = deferred<ApiResult<unknown>>();
    api.listQueueItems.mockImplementation((params: { cursor?: string; status?: string }) => {
      if (params.cursor) return more.promise;
      if (params.status === 'failed') {
        return Promise.resolve(ok({ items: [queueItemFixture({ itemId: 20, status: 'failed' })], nextCursor: null }));
      }
      return Promise.resolve(ok({ items: [queueItemFixture()], nextCursor: 'c1' }));
    });
    mountAt('/automation?tab=queue');
    await user.click(await screen.findByRole('button', { name: 'Load more' }));
    expect(api.listQueueItems).toHaveBeenLastCalledWith({ status: undefined, limit: 50, cursor: 'c1' });
    await user.selectOptions(screen.getByLabelText('Status'), 'failed');
    const table = await screen.findByRole('table');
    await within(table).findByText('20');
    await act(async () => more.resolve(ok({ items: [queueItemFixture({ itemId: 99 })], nextCursor: 'c2' })));
    await settle();
    expect(within(screen.getByRole('table')).queryByText('99')).toBeNull();
    expect(within(screen.getByRole('table')).queryByText('12')).toBeNull();
  });

  it('Email log: drops a page that arrives after the kind filter changed', async () => {
    const user = userEvent.setup();
    const more = deferred<ApiResult<unknown>>();
    api.listNotifications.mockImplementation((params: { cursor?: string; kind?: string }) => {
      if (params.cursor) return more.promise;
      if (params.kind === 'exception') {
        return Promise.resolve(
          ok({ items: [notificationFixture({ notificationId: NOTIFICATION_2, subject: 'Exception mail' })], nextCursor: null }),
        );
      }
      return Promise.resolve(ok({ items: [notificationFixture()], nextCursor: 'c1' }));
    });
    mountAt('/automation?tab=email');
    await user.click(await screen.findByRole('button', { name: 'Load more' }));
    expect(api.listNotifications).toHaveBeenLastCalledWith({ kind: undefined, status: undefined, limit: 50, cursor: 'c1' });
    await user.selectOptions(screen.getByLabelText('Kind'), 'exception');
    await screen.findByText('Exception mail');
    await act(async () => more.resolve(ok({ items: [notificationFixture({ subject: 'Stale mail' })], nextCursor: 'c2' })));
    await settle();
    expect(screen.queryByText('Stale mail')).toBeNull();
    expect(screen.queryByText(notificationFixture().subject)).toBeNull();
  });
});

describe('opening a detail moves focus and scroll to it (frontend-console-4)', () => {
  it('focuses the decision heading after Details, but not on a deep link', async () => {
    const user = userEvent.setup();
    mountAt('/automation?tab=decisions');
    await user.click(await screen.findByRole('button', { name: 'Details of draft 41' }));
    const heading = await screen.findByRole('heading', { name: 'Draft 41' });
    await waitFor(() => expect(document.activeElement).toBe(heading));
    expect(heading.getAttribute('tabindex')).toBe('-1');
    expect(scrolled).toContain(heading);
    cleanup();

    scrolled = [];
    mountAt('/automation?draftId=41');
    const linked = await screen.findByRole('heading', { name: 'Draft 41' });
    await settle();
    expect(document.activeElement).not.toBe(linked);
    expect(scrolled).toHaveLength(0);
  });

  it("focuses a run's decisions after Decisions", async () => {
    const user = userEvent.setup();
    mountAt('/automation?tab=runs');
    await user.click(await screen.findByRole('button', { name: `Decisions of run ${RUN_ID.slice(0, 8)}` }));
    const heading = await screen.findByRole('heading', { name: `Decisions of run ${RUN_ID.slice(0, 8)}` });
    await waitFor(() => expect(document.activeElement).toBe(heading));
    expect(scrolled).toContain(heading);
  });

  it('focuses the email body after Show', async () => {
    const user = userEvent.setup();
    mountAt('/automation?tab=email');
    await user.click(await screen.findByRole('button', { name: `Show email ${NOTIFICATION_ID.slice(0, 8)}` }));
    const heading = await screen.findByRole('heading', { name: notificationDetailFixture().subject });
    await waitFor(() => expect(document.activeElement).toBe(heading));
    expect(scrolled).toContain(heading);
  });
});

describe('the review link of a would-accept draft (frontend-console-6)', () => {
  it('offers "Decide in review queue" for an undecided dry-run would-accept draft', async () => {
    api.fetchAutomationDecision.mockResolvedValue(ok(decisionDetailFixture({ state: 'would_accept', reason: null })));
    mountAt('/automation?draftId=41');
    const detail = await screen.findByRole('region', { name: 'Decision detail' });
    const link = await within(detail).findByRole('link', { name: 'Decide in review queue' });
    expect(link.getAttribute('href')).toBe('/review?deckId=7&draftId=41');
  });

  it('shows who decided a handled decision instead of a review link', async () => {
    api.fetchAutomationDecision.mockResolvedValue(
      ok(decisionDetailFixture({ humanAction: 'edited_accepted', humanReason: null })),
    );
    mountAt('/automation?draftId=41');
    const detail = await screen.findByRole('region', { name: 'Decision detail' });
    expect(await within(detail).findByText('Handled: edited and accepted')).toBeTruthy();
    expect(within(detail).getByText('Edited and accepted')).toBeTruthy();
    expect(within(detail).queryByRole('link', { name: 'Decide in review queue' })).toBeNull();
  });
});

describe('Show answers only for the email last asked for (frontend-console-8)', () => {
  it('ignores an older answer and marks the button busy while loading', async () => {
    const user = userEvent.setup();
    const first = deferred<ApiResult<unknown>>();
    const second = deferred<ApiResult<unknown>>();
    api.listNotifications.mockResolvedValue(
      ok({
        items: [notificationFixture(), notificationFixture({ notificationId: NOTIFICATION_2, subject: 'Second' })],
        nextCursor: null,
      }),
    );
    api.fetchNotification.mockImplementation((id: string) => (id === NOTIFICATION_ID ? first.promise : second.promise));
    mountAt('/automation?tab=email');

    const showA = await screen.findByRole('button', { name: `Show email ${NOTIFICATION_ID.slice(0, 8)}` });
    const showB = screen.getByRole('button', { name: `Show email ${NOTIFICATION_2.slice(0, 8)}` });
    await user.click(showA);
    expect((showA as HTMLButtonElement).disabled).toBe(true);
    await user.click(showB);
    expect((showB as HTMLButtonElement).disabled).toBe(true);

    await act(async () =>
      second.resolve(ok(notificationDetailFixture({ notificationId: NOTIFICATION_2, subject: 'Second', bodyText: 'B body' }))),
    );
    await act(async () => first.resolve(ok(notificationDetailFixture({ bodyText: 'A body' }))));
    await settle();
    expect(screen.getByTestId('automation-email-body').textContent).toBe('B body');
    expect((showB as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('accessible names and invalid fields (frontend-console-9)', () => {
  it('names each watch row button after its target', async () => {
    mountAt('/automation?tab=watch');
    await screen.findByTestId('automation-watch-target-3');
    expect(screen.getByRole('button', { name: 'Deactivate target 2' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Deactivate target 3' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Edit target 2' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Edit target 3' })).toBeTruthy();
    const names = screen.getAllByRole('button').map(b => b.getAttribute('aria-label') ?? b.textContent);
    expect(names.filter(n => n === 'Deactivate' || n === 'Edit')).toEqual([]);
  });

  it('marks every queue field that fails its check', async () => {
    const user = userEvent.setup();
    mountAt('/automation?tab=queue');
    await user.type(await screen.findByLabelText('Title'), 'x'.repeat(301));
    await user.click(screen.getByRole('button', { name: 'Add to queue' }));
    await screen.findByText('Enter a URL.');
    // D07 frontend-console-28: each field points at its own message, not at the whole list.
    for (const [label, field_] of [
      ['URL', 'url'],
      ['Deck', 'deckId'],
      ['Title', 'title'],
    ] as const) {
      const field = screen.getByLabelText(label);
      expect(field.getAttribute('aria-invalid'), label).toBe('true');
      expect(field.getAttribute('aria-describedby'), label).toBe(`automation-queue-problems-${field_}`);
      expect(field.className, label).toContain('border-red-400');
    }
    const note = screen.getByLabelText('Note');
    expect(note.getAttribute('aria-invalid')).toBeNull();
    expect(note.getAttribute('aria-describedby')).toBeNull();
  });

  it('marks the watch fields that fail, in the add form', async () => {
    const user = userEvent.setup();
    mountAt('/automation?tab=watch');
    await screen.findByTestId('automation-watch-target-3');
    await user.clear(screen.getByLabelText('Check interval (minutes)'));
    await user.type(screen.getByLabelText('Check interval (minutes)'), '30');
    await user.click(screen.getByRole('button', { name: 'Add feed' }));
    await screen.findByText('Enter a URL.');
    expect(screen.getByLabelText('Feed URL').getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByLabelText('Deck').getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByLabelText('Check interval (minutes)').getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByLabelText('Feed format').getAttribute('aria-invalid')).toBeNull();
    expect(screen.getByLabelText('Title pattern (PostgreSQL regex)').getAttribute('aria-invalid')).toBeNull();
  });
});

describe('the watch edit (frontend-console-5)', () => {
  it('saves a new pattern and interval', async () => {
    const user = userEvent.setup();
    api.updateWatchTarget.mockResolvedValue(ok(watchPageFixture().items[1]));
    mountAt('/automation?tab=watch');
    await screen.findByTestId('automation-watch-target-3');
    await user.click(screen.getByRole('button', { name: 'Edit target 3' }));
    const row = screen.getByTestId('automation-watch-target-3');
    const pattern = within(row).getByLabelText('Title pattern (PostgreSQL regex)');
    await user.clear(pattern);
    await user.type(pattern, 'Lambda');
    const interval = within(row).getByLabelText('Check interval (minutes)');
    await user.clear(interval);
    await user.type(interval, '240');
    await user.click(within(row).getByRole('button', { name: 'Save target 3' }));
    await waitFor(() =>
      expect(api.updateWatchTarget).toHaveBeenCalledWith(3, { itemTitlePattern: 'Lambda', checkIntervalMinutes: 240 }),
    );
    await waitFor(() => expect(screen.getByTestId('automation-live').textContent).toBe('Target 3 saved.'));
    expect(within(screen.getByTestId('automation-watch-target-3')).queryByRole('button', { name: 'Save target 3' })).toBeNull();
  });

  it('refuses an interval out of range before any request', async () => {
    const user = userEvent.setup();
    mountAt('/automation?tab=watch');
    await screen.findByTestId('automation-watch-target-3');
    await user.click(screen.getByRole('button', { name: 'Edit target 3' }));
    const row = screen.getByTestId('automation-watch-target-3');
    const interval = within(row).getByLabelText('Check interval (minutes)');
    await user.clear(interval);
    await user.type(interval, '10');
    await user.click(within(row).getByRole('button', { name: 'Save target 3' }));
    expect(
      await within(row).findByText('The check interval must be a whole number of minutes from 60 to 43200.'),
    ).toBeTruthy();
    expect(interval.getAttribute('aria-invalid')).toBe('true');
    expect(api.updateWatchTarget).not.toHaveBeenCalled();
  });

  it('shows WATCH_PATTERN_INVALID on the pattern field and keeps the edit open', async () => {
    const user = userEvent.setup();
    api.updateWatchTarget.mockResolvedValue(refused('WATCH_PATTERN_INVALID', 'invalid regular expression'));
    mountAt('/automation?tab=watch');
    await screen.findByTestId('automation-watch-target-3');
    await user.click(screen.getByRole('button', { name: 'Edit target 3' }));
    const row = screen.getByTestId('automation-watch-target-3');
    const pattern = within(row).getByLabelText('Title pattern (PostgreSQL regex)');
    await user.clear(pattern);
    await user.type(pattern, '(unclosed');
    await user.click(within(row).getByRole('button', { name: 'Save target 3' }));
    expect(await within(row).findByText('PostgreSQL rejected the title pattern.')).toBeTruthy();
    expect(pattern.getAttribute('aria-invalid')).toBe('true');
    expect(pattern.getAttribute('aria-describedby')).toBe('automation-watch-edit-problem');
    expect(within(row).getByRole('button', { name: 'Save target 3' })).toBeTruthy();
  });
});

describe('a failed deck list is shown with a retry (frontend-console-10)', () => {
  for (const [tab, emptyLabel] of [
    ['queue', 'Choose a deck'],
    ['watch', 'Choose a deck'],
    ['decisions', 'All decks'],
  ] as const) {
    it(`${tab}: says why the deck select is empty and retries`, async () => {
      const user = userEvent.setup();
      authoring.fetchDecks.mockResolvedValueOnce(refused('HTTP_500', 'Internal error.'));
      mountAt(`/automation?tab=${tab}`);
      const alert = await screen.findByText(/Could not load the deck list: Internal error\./);
      expect(screen.getByRole('option', { name: emptyLabel })).toBeTruthy();
      expect(screen.queryByRole('option', { name: 'aws-saa-c03' })).toBeNull();
      await user.click(within(alert.closest('[role="alert"]') as HTMLElement).getByRole('button', { name: 'Retry loading decks' }));
      expect(await screen.findByRole('option', { name: 'aws-saa-c03' })).toBeTruthy();
      expect(screen.queryByText(/Could not load the deck list/)).toBeNull();
      expect(authoring.fetchDecks).toHaveBeenCalledTimes(2);
    });
  }
});

describe('machine codes read as words (frontend-console-11)', () => {
  it('labels a QA_ERROR detail, the mode and the statuses', async () => {
    api.listAutomationDecisions.mockResolvedValue(
      ok({ items: [decisionFixture({ reason: 'QA_ERROR', reasonDetail: 'PROVIDER_ACCESS_DENIED' })], nextCursor: null }),
    );
    mountAt('/automation?tab=decisions');
    const table = await screen.findByRole('table');
    await within(table).findByText('AI QA returned an error');
    expect(within(table).queryByText('PROVIDER_ACCESS_DENIED')).toBeNull();
    expect(within(table).getByText('Dry run')).toBeTruthy();
    expect(within(table).queryByText('dry_run')).toBeNull();
    cleanup();

    mountAt('/automation?tab=email');
    const emails = await screen.findByRole('table');
    await within(emails).findByText('Batch summary');
    expect(within(emails).getAllByText('Sent').some(cell => cell.tagName === 'TD')).toBe(true);
    expect(within(emails).queryByText('batch_summary')).toBeNull();
    cleanup();

    mountAt('/automation?tab=queue');
    const queue = await screen.findByRole('table');
    expect(await within(queue).findByText('Queued')).toBeTruthy();
    expect(within(queue).getByText('Manual')).toBeTruthy();
  });

  it('shows a failing runner as a danger badge and marks the mode with its own badge', async () => {
    const base = statusFixture();
    api.fetchAutomationStatus.mockResolvedValue(
      ok(statusFixture({ runners: [{ ...base.runners[0], state: 'login_expired' }] })),
    );
    mountAt('/automation');
    const runners = await screen.findByRole('region', { name: 'Runners' });
    const badge = within(runners).getByText('Login expired');
    expect(badge.className).toContain('bg-red-50');
    expect(within(screen.getByTestId('automation-mode-badge')).getByText('DRY RUN')).toBeTruthy();
    cleanup();

    api.fetchAutomationStatus.mockResolvedValue(
      ok(statusFixture({ mode: { configured: 'off', effective: 'off', liveBlockedReason: null, autoPublish: true } })),
    );
    mountAt('/automation');
    expect(within(await screen.findByTestId('automation-mode-badge')).getByText('OFF')).toBeTruthy();
  });
});

describe('agent notes on the Runs tab (automation-3, K3)', () => {
  it('shows the notes as plain text, never as markup', async () => {
    const notes = 'Card s3-versioning-02 says 1000 versions.\n<img src=x onerror="alert(1)"><b>bold</b>';
    api.listAutomationRuns.mockResolvedValue(
      ok({ items: [runFixture({ summary: notes, outcome: 'nothing_new' })], nextCursor: null }),
    );
    mountAt('/automation?tab=runs');
    expect(await screen.findByRole('columnheader', { name: 'Agent notes' })).toBeTruthy();
    const cell = await screen.findByTestId(`automation-run-notes-${RUN_ID}`);
    expect(cell.textContent).toBe(notes);
    expect(cell.querySelector('img')).toBeNull();
    expect(cell.querySelector('b')).toBeNull();
    expect(screen.getByText('Nothing new')).toBeTruthy();
  });

  it('shows a dash for a run without notes', async () => {
    mountAt('/automation?tab=runs');
    await screen.findByRole('columnheader', { name: 'Agent notes' });
    expect(screen.queryByTestId(`automation-run-notes-${RUN_ID}`)).toBeNull();
  });
});
