// @vitest-environment jsdom
//
// The /automation console page (contract A00 §16). src/api/automation and the
// deck list are mocked, so nothing here can leave the process; the session is a
// real token through tests/support/consoleSession, so the super_admin gate is
// the app's own.

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
import { signInAsEditor, signInAsSuperAdmin, signOut } from './support/consoleSession';
import { renderAt } from './support/routerProbe';
import { consoleSectionFor } from '../src/components/console/consoleNav';
import { ConfirmDialogProvider } from '../src/components/ui/ConfirmDialog';
import { documentTitleFor } from '../src/lib/brand';
import { MODE_CHANGE_HINT } from '../src/lib/automationRules';
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

const MUTATING = [
  'Record eval gate',
  'Revoke gate',
  'Add to queue',
  'Skip',
  'Add feed',
  'Deactivate',
  'Activate',
  'Send test email',
  // B07 frontend-console-9: the row buttons name their target.
  /^Deactivate target /,
  /^Activate target /,
  /^Edit target /,
];

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

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  authoring.fetchDecks.mockReset();
  api.fetchAutomationStatus.mockResolvedValue(ok(statusFixture()));
  api.fetchEvalGate.mockResolvedValue(ok({ current: evalGateFixture(), history: [evalGateFixture()] }));
  api.listAutomationRuns.mockResolvedValue(ok({ items: [runFixture()], nextCursor: null }));
  api.listAutomationDecisions.mockResolvedValue(ok({ items: [decisionFixture()], nextCursor: null }));
  api.fetchAutomationDecision.mockResolvedValue(ok(decisionDetailFixture()));
  api.listQueueItems.mockResolvedValue(
    ok({ items: [queueItemFixture(), queueItemFixture({ itemId: 11, status: 'done' })], nextCursor: null }),
  );
  api.fetchWatch.mockResolvedValue(ok(watchPageFixture()));
  api.listNotifications.mockResolvedValue(ok({ items: [notificationFixture()], nextCursor: null }));
  api.fetchNotification.mockResolvedValue(ok(notificationDetailFixture()));
  authoring.fetchDecks.mockResolvedValue(ok([DECK]));
  signInAsSuperAdmin();
});

afterEach(() => {
  cleanup();
  signOut();
});

describe('AutomationPage', () => {
  it('is routed at /automation with its own title and nav link', async () => {
    expect(documentTitleFor('/automation')).toBe('Automation · DeveloperCards Console');
    expect(consoleSectionFor('/automation')).toBe('automation');

    mountAt('/automation');
    await screen.findByTestId('automation-mode-banner');
    const nav = screen.getByRole('navigation', { name: 'Console sections' });
    const link = within(nav).getByRole('link', { name: 'Automation' });
    expect(link.getAttribute('href')).toBe('/automation');
    expect(link.getAttribute('aria-current')).toBe('page');
    expect(within(nav).getByRole('link', { name: 'Automation ledger' }).getAttribute('aria-current')).toBeNull();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Automation');
  });

  it('shows the mode banner and never a mode switch', async () => {
    mountAt('/automation');
    const banner = await screen.findByTestId('automation-mode-banner');
    expect(banner.textContent).toContain('Dry run: every decision is recorded, nothing is accepted or published');
    expect(banner.textContent).toContain('Configured: dry_run · Effective: dry_run');
    expect(banner.textContent).toContain(MODE_CHANGE_HINT);
    await screen.findByText('owner-mac');
    await settle();

    const controls = ['button', 'combobox', 'checkbox', 'switch', 'radio', 'textbox', 'spinbutton', 'slider'].flatMap(
      role => screen.queryAllByRole(role),
    );
    expect(controls.length).toBeGreaterThan(0);
    for (const control of controls) {
      const name = control.getAttribute('aria-label') ?? control.textContent ?? '';
      const label = control.id ? document.querySelector(`label[for="${control.id}"]`)?.textContent ?? '' : '';
      expect(`${name} ${label}`, 'a control that names the mode').not.toMatch(/mode/i);
    }
    // The banner is text only.
    expect(within(banner).queryAllByRole('button')).toHaveLength(0);
    expect(within(banner).queryAllByRole('combobox')).toHaveLength(0);

    // Every tab carries the banner.
    await userEvent.click(within(screen.getByRole('navigation', { name: 'Automation tabs' })).getByRole('link', { name: 'Queue' }));
    expect(await screen.findByTestId('automation-mode-banner')).toBeTruthy();
  });

  it('opens the tab a deep link names', async () => {
    mountAt('/automation?tab=email');
    await waitFor(() => expect(api.listNotifications).toHaveBeenCalledWith({ kind: undefined, status: undefined, limit: 50 }));
    const tabs = screen.getByRole('navigation', { name: 'Automation tabs' });
    expect(within(tabs).getByRole('link', { name: 'Email log' }).getAttribute('aria-current')).toBe('page');
    expect(await screen.findByText(notificationFixture().subject)).toBeTruthy();
    expect(api.listAutomationRuns).not.toHaveBeenCalled();
    cleanup();

    mountAt(`/automation?runId=${RUN_ID}`);
    await waitFor(() => expect(api.listAutomationDecisions).toHaveBeenCalledWith({ runId: RUN_ID, limit: 50 }));
    expect(
      within(screen.getByRole('navigation', { name: 'Automation tabs' }))
        .getByRole('link', { name: 'Runs' })
        .getAttribute('aria-current'),
    ).toBe('page');
    const runDecisions = await screen.findByRole('region', { name: 'Run decisions' });
    expect(await within(runDecisions).findByText('s3-versioning-01')).toBeTruthy();
    cleanup();

    mountAt('/automation?tab=watch&targetId=3');
    const row = await screen.findByTestId('automation-watch-target-3');
    expect(row.getAttribute('aria-current')).toBe('true');
    expect(row.className).toContain('bg-indigo-50');
    expect(screen.getByTestId('automation-watch-target-2').getAttribute('aria-current')).toBeNull();
  });

  it('shows the decision detail with findings, events and a review link', async () => {
    // Live: an open dry-run decision hides its verdict until revealed (E05 frontend-console-30).
    api.fetchAutomationDecision.mockResolvedValue(ok(decisionDetailFixture({ mode: 'live' })));
    mountAt('/automation?draftId=41');
    await waitFor(() => expect(api.fetchAutomationDecision).toHaveBeenCalledWith(41));
    const detail = await screen.findByRole('region', { name: 'Decision detail' });
    expect(await within(detail).findByText('Option C is obviously wrong.')).toBeTruthy();
    expect(within(detail).getByText('Weak distractor')).toBeTruthy();
    expect(within(detail).getByText('S3 Versioning keeps every version of every object in a bucket.')).toBeTruthy();
    expect(within(detail).getAllByText('AI QA found a blocker or major issue').length).toBeGreaterThan(0);
    expect(within(detail).getAllByText('In AI QA').length).toBeGreaterThan(0);

    // B07 frontend-console-6: renamed, and offered whenever a person may still decide.
    const review = within(detail).getByRole('link', { name: 'Decide in review queue' });
    expect(review.getAttribute('href')).toBe('/review?deckId=7&draftId=41');
    expect(within(detail).getByRole('link', { name: 'Close' }).getAttribute('href')).toBe('/automation?tab=decisions');

    // A decision a person already decided has no review link (B07 frontend-console-6:
    // an undecided dry-run would_accept draft now has one; see automationConsoleFixes.test.tsx).
    cleanup();
    api.fetchAutomationDecision.mockResolvedValue(
      ok(decisionDetailFixture({ state: 'would_accept', reason: null, humanAction: 'accepted' })),
    );
    mountAt('/automation?draftId=41');
    const other = await screen.findByRole('region', { name: 'Decision detail' });
    await within(other).findByText('Option C is obviously wrong.');
    expect(within(other).queryByRole('link', { name: 'Decide in review queue' })).toBeNull();

    // A draft without a decision says so.
    cleanup();
    api.fetchAutomationDecision.mockResolvedValue(refused('DRAFT_DECISION_NOT_FOUND', 'not found'));
    mountAt('/automation?draftId=99');
    expect(await screen.findByText('No automatic decision exists for that draft.')).toBeTruthy();
  });

  it('opens a decision from the list through the search parameters', async () => {
    mountAt('/automation?tab=decisions');
    await userEvent.click(await screen.findByRole('button', { name: 'Details of draft 41' }));
    await waitFor(() => expect(api.fetchAutomationDecision).toHaveBeenCalledWith(41));
    expect(await screen.findByRole('region', { name: 'Decision detail' })).toBeTruthy();
    expect(screen.getByTestId('loc').textContent).toBe('/automation?tab=decisions&draftId=41');
  });

  it('hides every mutating control from an editor', async () => {
    signOut();
    signInAsEditor();
    for (const tab of ['overview', 'runs', 'decisions', 'queue', 'watch', 'email']) {
      mountAt(`/automation?tab=${tab}`);
      await screen.findByTestId('automation-mode-banner');
      await settle();
      await settle();
      for (const name of MUTATING) {
        expect(screen.queryByRole('button', { name }), `${tab}: ${name}`).toBeNull();
      }
      expect(screen.queryByRole('button', { name: /^Skip queue item/ })).toBeNull();
      expect(screen.queryByLabelText('Gate report JSON')).toBeNull();
      cleanup();
    }
    // The editor still reads the tables.
    expect(api.listQueueItems).toHaveBeenCalled();
    expect(api.fetchWatch).toHaveBeenCalled();
    expect(api.listNotifications).toHaveBeenCalled();
    expect(api.fetchEvalGate).toHaveBeenCalled();
  });

  it('records an eval gate report as a super_admin', async () => {
    const user = userEvent.setup();
    const pasted = '{"v":1,"kind":"automation-gate","passed":true,  "failures":[]}';
    api.recordEvalGate.mockResolvedValue(ok(evalGateFixture({ gateId: 5 })));
    mountAt('/automation');

    const textarea = await screen.findByLabelText('Gate report JSON');
    // D07 frontend-console-23 (M4): a failed report asks first; cancelled, it never reaches the server.
    await user.click(textarea);
    await user.paste('{"v":1,"kind":"automation-gate","passed":false}');
    await user.click(screen.getByRole('button', { name: 'Record eval gate' }));
    const failedDialog = await screen.findByRole('alertdialog');
    expect(
      within(failedDialog).getByText(
        'This report failed. Recording it makes it the newest evaluation, which blocks live mode.',
      ),
    ).toBeTruthy();
    await user.click(within(failedDialog).getByRole('button', { name: 'Cancel' }));
    expect(api.recordEvalGate).not.toHaveBeenCalled();

    await user.clear(textarea);
    await user.paste(pasted);
    await user.click(screen.getByRole('button', { name: 'Record eval gate' }));
    await waitFor(() => expect(api.recordEvalGate).toHaveBeenCalledWith(pasted));
    await waitFor(() => expect(screen.getByTestId('automation-live').textContent).toBe('Eval gate 5 recorded.'));
    // The gate and the status reload after the write.
    await waitFor(() => expect(api.fetchEvalGate).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(api.fetchAutomationStatus).toHaveBeenCalledTimes(2));

    // A refusal shows the mapped sentence and the server's details.
    api.recordEvalGate.mockResolvedValue({
      success: false,
      data: null,
      error: { code: 'EVAL_GATE_INVALID', message: 'bad report', details: 'reviewer missing' },
      traceId: 't',
    });
    await user.click(textarea);
    await user.paste(pasted);
    await user.click(screen.getByRole('button', { name: 'Record eval gate' }));
    expect(
      await screen.findByText('The server could not read this gate report. bad report reviewer missing'),
    ).toBeTruthy();
    await user.clear(textarea);

    // Revoking asks first.
    api.revokeEvalGate.mockResolvedValue(ok(evalGateFixture({ revokedAt: '2026-09-28T12:00:00Z' })));
    await user.click(screen.getByRole('button', { name: 'Revoke gate' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Live mode falls back to dry run on the next request.')).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Revoke this gate' }));
    await waitFor(() => expect(api.revokeEvalGate).toHaveBeenCalledWith(4));
  });

  it('adds a queue item and skips one after confirmation', async () => {
    const user = userEvent.setup();
    api.addQueueItem.mockResolvedValue(ok(queueItemFixture({ itemId: 13 })));
    api.skipQueueItem.mockResolvedValue(ok(queueItemFixture({ status: 'skipped' })));
    mountAt('/automation?tab=queue');

    await screen.findByRole('button', { name: 'Skip queue item 12' });
    // Only a queued row can be skipped.
    expect(screen.queryByRole('button', { name: 'Skip queue item 11' })).toBeNull();

    // The form checks first.
    await user.click(screen.getByRole('button', { name: 'Add to queue' }));
    expect(await screen.findByText('Enter a URL.')).toBeTruthy();
    expect(api.addQueueItem).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText('URL'), 'https://docs.aws.amazon.com/AmazonS3/latest/userguide/Versioning.html');
    await waitFor(() => expect(screen.getByRole('option', { name: 'aws-saa-c03' })).toBeTruthy());
    await user.selectOptions(screen.getByLabelText('Deck'), '7');
    await user.type(screen.getByLabelText('Title'), 'Versioning');
    await user.click(screen.getByRole('button', { name: 'Add to queue' }));
    await waitFor(() =>
      expect(api.addQueueItem).toHaveBeenCalledWith({
        url: 'https://docs.aws.amazon.com/AmazonS3/latest/userguide/Versioning.html',
        deckId: 7,
        title: 'Versioning',
        note: '',
      }),
    );
    await waitFor(() => expect(screen.getByTestId('automation-live').textContent).toBe('Queue item 13 added.'));
    await waitFor(() => expect(api.listQueueItems).toHaveBeenCalledTimes(2));

    // Cancelling the dialog calls nothing.
    await user.click(screen.getByRole('button', { name: 'Skip queue item 12' }));
    let dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Skip this queue item?')).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.skipQueueItem).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Skip queue item 12' }));
    dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Skip this item' }));
    await waitFor(() => expect(api.skipQueueItem).toHaveBeenCalledWith(12));
    await waitFor(() => expect(screen.getByTestId('automation-live').textContent).toBe('Queue item 12 skipped.'));

    // A refusal shows the mapped sentence.
    api.addQueueItem.mockResolvedValue(refused('QUEUE_ITEM_EXISTS', 'conflict'));
    await user.type(screen.getByLabelText('URL'), 'https://docs.aws.amazon.com/');
    await user.selectOptions(screen.getByLabelText('Deck'), '7');
    await user.click(screen.getByRole('button', { name: 'Add to queue' }));
    expect(await screen.findByText('That URL is already queued or being drafted for this deck.')).toBeTruthy();
  });

  it('adds a feed and toggles a watched target', async () => {
    const user = userEvent.setup();
    api.addWatchTarget.mockResolvedValue(ok(watchPageFixture().items[1]));
    api.updateWatchTarget.mockResolvedValue(ok(watchPageFixture().items[1]));
    mountAt('/automation?tab=watch');

    await screen.findByTestId('automation-watch-target-3');
    expect((screen.getByLabelText('Check interval (minutes)') as HTMLInputElement).value).toBe('360');
    await user.type(screen.getByLabelText('Feed URL'), 'https://example.com/feed.xml');
    await user.selectOptions(screen.getByLabelText('Feed format'), 'atom');
    await waitFor(() => expect(screen.getAllByRole('option', { name: 'aws-saa-c03' }).length).toBeGreaterThan(0));
    await user.selectOptions(screen.getByLabelText('Deck'), '7');
    await user.click(screen.getByRole('button', { name: 'Add feed' }));
    await waitFor(() =>
      expect(api.addWatchTarget).toHaveBeenCalledWith({
        url: 'https://example.com/feed.xml',
        feedFormat: 'atom',
        deckId: 7,
        itemTitlePattern: null,
        checkIntervalMinutes: 360,
      }),
    );

    const row = screen.getByTestId('automation-watch-target-3');
    // B07 frontend-console-9: the row's buttons carry the target id in their name.
    await user.click(within(row).getByRole('button', { name: 'Deactivate target 3' }));
    await waitFor(() => expect(api.updateWatchTarget).toHaveBeenCalledWith(3, { active: false }));
  });

  it('shows the not-ready notice when migration 034 has not run', async () => {
    api.fetchAutomationStatus.mockResolvedValue(refused('SERVER_NOT_READY_AUTOMATION', 'Migration 034 has not run.'));
    mountAt('/automation');
    const notice = await screen.findByTestId('automation-not-ready');
    expect(notice.textContent).toContain('The server has not run the automation database migration (034).');
    expect(screen.queryByRole('navigation', { name: 'Automation tabs' })).toBeNull();
    expect(screen.queryByTestId('automation-mode-banner')).toBeNull();
    expect(api.fetchEvalGate).not.toHaveBeenCalled();

    // Any other failure is an alert, and the tabs still render.
    cleanup();
    api.fetchAutomationStatus.mockResolvedValue(refused('HTTP_500', 'Internal error.'));
    mountAt('/automation?tab=queue');
    expect((await screen.findByRole('alert')).textContent).toContain('Internal error.');
    expect(screen.getByRole('navigation', { name: 'Automation tabs' })).toBeTruthy();
    await waitFor(() => expect(api.listQueueItems).toHaveBeenCalled());
  });

  it('shows an email body and sends a test email', async () => {
    const user = userEvent.setup();
    api.sendTestNotification.mockResolvedValue(ok({ notificationId: NOTIFICATION_ID, status: 'queued' }));
    mountAt('/automation?tab=email');

    await user.click(await screen.findByRole('button', { name: `Show email ${NOTIFICATION_ID.slice(0, 8)}` }));
    await waitFor(() => expect(api.fetchNotification).toHaveBeenCalledWith(NOTIFICATION_ID));
    const body = await screen.findByTestId('automation-email-body');
    expect(body.tagName).toBe('PRE');
    expect(body.textContent).toBe(notificationDetailFixture().bodyText);
    // No recipient column exists.
    const headers = screen.getAllByRole('columnheader').map(h => h.textContent ?? '');
    expect(headers.some(h => /recipient|^to$/i.test(h))).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Send test email' }));
    await waitFor(() => expect(api.sendTestNotification).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByTestId('automation-live').textContent).toBe('Test email queued.'));
    await waitFor(() => expect(api.listNotifications).toHaveBeenCalledTimes(2));

    api.sendTestNotification.mockResolvedValue(refused('NOTIFY_NOT_CONFIGURED', 'queue url empty'));
    await user.click(screen.getByRole('button', { name: 'Send test email' }));
    expect(
      await screen.findByText('Email is not configured on the server (AUTOMATION_NOTIFY_QUEUE_URL is empty).'),
    ).toBeTruthy();
  });
});
