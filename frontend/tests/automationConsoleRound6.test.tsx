// @vitest-environment jsdom
//
// The G04 fixes on the /automation console (R18A fix round 6): the 7-day
// publish split stays blind (frontend-console-39), a verdict-revealing
// Decisions filter withholds the pending dry-run rows (-40), the Overview's
// publish decks and blind notes follow what can reveal a verdict in each mode
// (-41), and the Runs notes keep AA contrast on the selected row (-42). Mocks
// as in automationConsoleRound5.test.tsx, so nothing leaves the process.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';

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

const LIVE = { configured: 'live', effective: 'live', liveBlockedReason: null, autoPublish: true };
const OFF = { configured: 'off', effective: 'off', liveBlockedReason: null, autoPublish: true };
const routed = decisionFixture({ draftId: 41 });
const wouldAccept = decisionFixture({ draftId: 51, state: 'would_accept', reason: null, reasonDetail: null });

describe('the dry-run Overview keeps the 7-day publish split blind (frontend-console-39)', () => {
  it('shows one hidden Dry-run outcome line in place of the would-publish and needs-you counts', async () => {
    api.fetchAutomationStatus.mockResolvedValue(
      ok(statusFixture({ publishes7d: { byState: { would_publish: 2, human: 1, published: 0 } } })),
    );
    mountAt('/automation');
    const card = await screen.findByRole('region', { name: 'Publishes in the last 7 days' });
    expect(card.textContent).not.toContain('Would publish');
    expect(card.textContent).not.toContain('Needs you');
    expect(within(card).getByTestId('automation-publishes-blind').textContent).toBe(
      'Dry-run outcome' + 'hidden until every draft is decided',
    );
    expect(card.textContent).not.toMatch(/[12]/);
    expect(within(card).getByText('Published')).toBeTruthy();
  });

  it('keeps it blind in off mode', async () => {
    api.fetchAutomationStatus.mockResolvedValue(ok(statusFixture({ mode: OFF })));
    mountAt('/automation');
    const card = await screen.findByRole('region', { name: 'Publishes in the last 7 days' });
    expect(card.textContent).not.toContain('Would publish');
    expect(within(card).getByTestId('automation-publishes-blind')).toBeTruthy();
  });

  it('shows the split in live mode', async () => {
    api.fetchAutomationStatus.mockResolvedValue(ok(statusFixture({ mode: LIVE })));
    mountAt('/automation');
    const card = await screen.findByRole('region', { name: 'Publishes in the last 7 days' });
    expect(within(card).getByText('Would publish').nextElementSibling?.textContent).toBe('2');
    expect(within(card).queryByTestId('automation-publishes-blind')).toBeNull();
  });
});

describe('a verdict-revealing Decisions filter withholds the pending dry-run rows (frontend-console-40)', () => {
  it('lists no pending dry-run row under state=human and records none as seen', async () => {
    const handled = decisionFixture({ draftId: 42, humanAction: 'rejected' });
    api.listAutomationDecisions.mockResolvedValue(ok({ items: [routed, handled], nextCursor: null }));
    mountAt('/automation?tab=decisions&state=human');
    const section = await screen.findByRole('region', { name: 'Decisions' });
    await within(section).findByRole('button', { name: 'Details of draft 42' });
    expect(within(section).queryByRole('button', { name: 'Details of draft 41' })).toBeNull();
    expect(section.textContent).not.toContain('Needs you (dry run)');
    expect(screen.getByTestId('automation-decisions-pending-withheld').textContent).toBe(
      'In a dry run, drafts still waiting for your decision are not listed under this filter; decide them in the review queue.',
    );
    expect(wasVerdictSeen(41)).toBe(false);
  });

  it('shows the note even when no pending row was left out, so it tells nothing', async () => {
    api.listAutomationDecisions.mockResolvedValue(
      ok({ items: [decisionFixture({ draftId: 42, humanAction: 'rejected' })], nextCursor: null }),
    );
    mountAt('/automation?tab=decisions&state=human');
    await screen.findByRole('button', { name: 'Details of draft 42' });
    expect(screen.getByTestId('automation-decisions-pending-withheld')).toBeTruthy();
  });

  it('keeps the pending rows of a would_accept list and records them as seen', async () => {
    api.listAutomationDecisions.mockResolvedValue(ok({ items: [wouldAccept], nextCursor: null }));
    mountAt('/automation?tab=decisions&state=would_accept');
    await screen.findByRole('button', { name: 'Details of draft 51' });
    await waitFor(() => expect(wasVerdictSeen(51)).toBe(true));
    expect(screen.queryByTestId('automation-decisions-pending-withheld')).toBeNull();
  });

  it('leaves the unfiltered list as it was: every row listed, the pending ones hidden', async () => {
    api.listAutomationDecisions.mockResolvedValue(ok({ items: [routed, wouldAccept], nextCursor: null }));
    mountAt('/automation?tab=decisions');
    await screen.findByRole('button', { name: 'Details of draft 41' });
    expect(screen.getByRole('button', { name: 'Details of draft 51' })).toBeTruthy();
    expect(screen.queryByTestId('automation-decisions-pending-withheld')).toBeNull();
    expect(wasVerdictSeen(41)).toBe(false);
  });
});

describe('the Overview blind rule and copy follow each mode (frontend-console-41)', () => {
  it('lists the live publishes waiting for a person by deck outside live mode', async () => {
    mountAt('/automation');
    const backlog = await screen.findByRole('region', { name: 'Open exceptions' });
    const list = within(backlog).getByRole('list', { name: 'Publishes waiting for you' });
    expect(list.textContent).toContain('aws-saa-c03');
    expect(within(list).getByRole('link', { name: 'AI QA of aws-saa-c03' })).toBeTruthy();
    expect(backlog.textContent).not.toContain('tells that a draft would be accepted');
    // The routed-draft count stays blind.
    expect(within(backlog).queryByTestId('automation-backlog-human-pending')).toBeNull();
  });

  it('words the blind notes by mode: never "Dry run" in off mode', async () => {
    api.fetchAutomationStatus.mockResolvedValue(ok(statusFixture({ mode: OFF })));
    mountAt('/automation');
    const note = await screen.findByTestId('automation-backlog-dry-run');
    expect(note.textContent).toBe('Automation off: every pending draft also waits for you in the review queue.');
    expect(screen.getByTestId('automation-reasons-blind').textContent).toBe(
      'Automation off: hidden while drafts may wait for you, because only a routed draft has a reason.',
    );
    expect(screen.getByRole('region', { name: 'Open exceptions' }).textContent).not.toContain('Dry run');
  });

  it('keeps the dry-run words in dry run', async () => {
    mountAt('/automation');
    expect((await screen.findByTestId('automation-reasons-blind')).textContent).toBe(
      'Dry run: hidden while drafts may wait for you, because only a routed draft has a reason.',
    );
  });
});

describe('the Runs notes keep AA contrast on the selected row (frontend-console-42)', () => {
  it('draws both hidden notes in text-slate-600 on the indigo-50 row the email link opens', async () => {
    mountAt(`/automation?tab=runs&runId=${RUN_ID}`);
    const counts = await screen.findByTestId(`automation-run-counts-${RUN_ID}`);
    const row = counts.closest('tr') as HTMLElement;
    expect(row.className).toContain('bg-indigo-50');
    const split = within(counts).getByText('split hidden until every draft is decided (dry run)');
    const publish = within(screen.getByTestId(`automation-run-publishes-${RUN_ID}`)).getByText(
      'hidden until every draft is decided',
    );
    for (const note of [split, publish]) {
      expect(note.className).toContain('text-slate-600');
      expect(note.className).not.toContain('text-slate-500');
    }
  });
});
