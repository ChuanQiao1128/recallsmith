// @vitest-environment jsdom
//
// The F04 fixes on the /automation console (R18A fix round 5, contract item
// O2 and the N5 blinding). Mocks as in automationConsoleRound4.test.tsx:
// src/api/automation and the deck list are replaced, so nothing leaves the process.

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
import { decisionReasonLabel } from '../src/lib/automationRules';
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
const routed = decisionFixture({ draftId: 41 });

describe('the Runs table hides the publish outcome of a run with pending drafts (frontend-console-35, O2)', () => {
  it('shows no publish state of a dry-run run with pending drafts', async () => {
    mountAt('/automation?tab=runs');
    const cell = await screen.findByTestId(`automation-run-publishes-${RUN_ID}`);
    expect(cell.textContent).toBe('hidden until every draft is decided');
    const row = cell.closest('tr') as HTMLElement;
    expect(row.textContent).not.toMatch(/Would publish|Published|Needs you/);
  });

  it('hides an empty publish list the same way, so no publish tells no would-accept either', async () => {
    api.listAutomationRuns.mockResolvedValue(ok({ items: [runFixture({ publishes: [] })], nextCursor: null }));
    mountAt('/automation?tab=runs');
    const cell = await screen.findByTestId(`automation-run-publishes-${RUN_ID}`);
    expect(cell.textContent).toBe('hidden until every draft is decided');
  });

  it("shows the publish once the run's decisions are all loaded and none is pending", async () => {
    api.listAutomationDecisions.mockResolvedValue(
      ok({
        items: [
          { ...routed, draftId: 51, state: 'would_accept', reason: null, humanAction: 'accepted' },
          { ...routed, humanAction: 'rejected' },
        ],
        nextCursor: null,
      }),
    );
    mountAt(`/automation?tab=runs&runId=${RUN_ID}`);
    await waitFor(() =>
      expect(screen.getByTestId(`automation-run-publishes-${RUN_ID}`).textContent).toBe('aws-saa-c03: Would publish'),
    );
  });

  it('shows the publish in live mode', async () => {
    api.fetchAutomationStatus.mockResolvedValue(ok(statusFixture({ mode: LIVE })));
    api.listAutomationRuns.mockResolvedValue(
      ok({
        items: [runFixture({ publishes: [{ ...runFixture().publishes[0], mode: 'live', state: 'published' }] })],
        nextCursor: null,
      }),
    );
    mountAt('/automation?tab=runs');
    await waitFor(() =>
      expect(screen.getByTestId(`automation-run-publishes-${RUN_ID}`).textContent).toBe('aws-saa-c03: Published'),
    );
  });
});

describe('the dry-run Overview keeps its counts blind (frontend-console-35)', () => {
  it('shows no routed-draft count, no per-state would-accept or routed count and no reasons', async () => {
    mountAt('/automation');
    const backlog = await screen.findByRole('region', { name: 'Open exceptions' });
    expect(within(backlog).queryByTestId('automation-backlog-human-pending')).toBeNull();
    expect(within(backlog).queryByText('Drafts waiting for you')).toBeNull();
    expect(within(backlog).queryByText('Oldest waiting since')).toBeNull();
    expect(within(backlog).queryByRole('link', { name: /show open exceptions/ })).toBeNull();
    expect(within(backlog).getByTestId('automation-backlog-dry-run')).toBeTruthy();
    // The count stays, as in the weekly digest. G04 frontend-console-41 replaced "and no publish decks":
    // the server lists live publishes only, whose drafts were auto-accepted, so their decks tell no
    // dry-run verdict and stay listed (automationConsoleRound6.test.tsx).
    expect(within(backlog).getByTestId('automation-backlog-human-publishes').textContent).toBe('1');
    expect(within(backlog).getByRole('list', { name: 'Publishes waiting for you' })).toBeTruthy();
    expect(within(backlog).queryByTestId('automation-backlog-publishes-blind')).toBeNull();

    const recent = screen.getByRole('region', { name: 'Decisions in the last 24 hours' });
    for (const text of ['Would be accepted', 'Routed to a person', 'Waiting for AI QA', 'In AI QA', 'QA_FLAGGED']) {
      expect(recent.textContent, text).not.toContain(text);
    }
    expect(recent.textContent).not.toContain(decisionReasonLabel('QA_FLAGGED'));
    expect(within(recent).queryByRole('link')).toBeNull();
    // would_accept 3 + human 1 in one row, in the table and the chart.
    const row = within(recent).getByRole('cell', { name: 'Waiting for you or decided' }).closest('tr') as HTMLElement;
    expect(row.textContent).toBe('Waiting for you or decided' + '4');
    expect(within(recent).getByRole('img').textContent).toContain('Waiting for you or decided4');
    expect(within(recent).getByTestId('automation-reasons-blind')).toBeTruthy();
  });

  it('keeps them blind in off mode too', async () => {
    api.fetchAutomationStatus.mockResolvedValue(
      ok(statusFixture({ mode: { configured: 'off', effective: 'off', liveBlockedReason: null, autoPublish: true } })),
    );
    mountAt('/automation');
    const recent = await screen.findByRole('region', { name: 'Decisions in the last 24 hours' });
    expect(recent.textContent).not.toContain('Would be accepted');
    expect(screen.queryByTestId('automation-backlog-human-pending')).toBeNull();
  });

  it('shows every count in live mode', async () => {
    api.fetchAutomationStatus.mockResolvedValue(ok(statusFixture({ mode: LIVE })));
    mountAt('/automation');
    const backlog = await screen.findByRole('region', { name: 'Open exceptions' });
    expect(within(backlog).getByTestId('automation-backlog-human-pending').textContent).toBe('2');
    expect(within(backlog).getByRole('list', { name: 'Publishes waiting for you' })).toBeTruthy();
    expect(within(backlog).queryByTestId('automation-backlog-dry-run')).toBeNull();
    const recent = screen.getByRole('region', { name: 'Decisions in the last 24 hours' });
    expect(within(recent).getAllByText('Would be accepted').length).toBeGreaterThan(0);
    expect(within(recent).getByRole('link', { name: 'Routed to a person' })).toBeTruthy();
    expect(within(recent).getByText(decisionReasonLabel('QA_FLAGGED'))).toBeTruthy();
    expect(within(recent).queryByText('Waiting for you or decided')).toBeNull();
  });
});

describe('the open-only Decisions list shows the verdict (frontend-console-36)', () => {
  // G04 frontend-console-40 replaced "shows each routed row ... and records them as seen" for dry-run
  // rows: a pending dry-run row is withheld from the list (automationConsoleRound6.test.tsx). A live
  // routed row still shows its verdict with only the checkbox ticked.
  it('shows each live routed row and the filter note with only the checkbox ticked', async () => {
    api.listAutomationDecisions.mockResolvedValue(ok({ items: [{ ...routed, mode: 'live' }], nextCursor: null }));
    mountAt('/automation?tab=decisions&open=1');
    const section = await screen.findByRole('region', { name: 'Decisions' });
    await within(section).findByRole('button', { name: 'Details of draft 41' });
    const table = section.querySelector('tbody') as HTMLElement;
    expect(within(table).getByText('Needs you')).toBeTruthy();
    expect(within(table).queryByText('Verdict hidden until you decide')).toBeNull();
    expect(within(table).queryByRole('button', { name: /Reveal the verdict/ })).toBeNull();
    expect(screen.getByTestId('automation-decisions-verdict-filter')).toBeTruthy();
  });

  it('records no row the open-only list drops or withholds (an older server that ignores open=true)', async () => {
    const wouldAccept = decisionFixture({ draftId: 51, state: 'would_accept', reason: null, reasonDetail: null });
    api.listAutomationDecisions.mockResolvedValue(ok({ items: [wouldAccept, routed], nextCursor: null }));
    mountAt('/automation?tab=decisions&open=1');
    await screen.findByTestId('automation-decisions-pending-withheld');
    expect(screen.queryByRole('button', { name: 'Details of draft 51' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Details of draft 41' })).toBeNull();
    expect(wasVerdictSeen(51)).toBe(false);
    expect(wasVerdictSeen(41)).toBe(false);
  });
});
