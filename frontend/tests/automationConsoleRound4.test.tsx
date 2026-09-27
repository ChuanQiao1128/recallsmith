// @vitest-environment jsdom
//
// The E05 fixes on the /automation console (R18A fix round 4, contract items
// N1 and N5). Mocks as in automationConsoleRound3.test.tsx: src/api/automation
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

/** A pending dry-run would-accept draft, and a pending dry-run draft routed to a person (QA_FLAGGED). */
const wouldAccept = decisionFixture({
  draftId: 51,
  state: 'would_accept',
  reason: null,
  reasonDetail: null,
  qa: { ...decisionFixture().qa!, major: 0, minor: 0 },
});
const routed = decisionFixture({ draftId: 41 });

function rowOf(scope: HTMLElement, draftId: number): HTMLElement {
  return within(scope).getByRole('button', { name: `Details of draft ${draftId}` }).closest('tr') as HTMLElement;
}

/** A row's cells as text, with the draft id taken out, so two rows can be compared cell by cell. */
function cellsOf(row: HTMLElement, draftId: number): string[] {
  return [...row.querySelectorAll('td')].map(td => (td.textContent ?? '').replaceAll(String(draftId), '#'));
}

describe('every pending dry-run row hides its verdict alike (frontend-console-30, N5)', () => {
  it('renders no distinguishing badge, reason, QA counts or Decide link between a would-accept and a routed row', async () => {
    api.listAutomationDecisions.mockResolvedValue(ok({ items: [wouldAccept, routed], nextCursor: null }));
    mountAt('/automation?tab=decisions');

    const section = await screen.findByRole('region', { name: 'Decisions' });
    await within(section).findByRole('button', { name: 'Details of draft 51' });
    const table = section.querySelector('tbody') as HTMLElement;
    for (const text of ['Needs you', 'Would be accepted', 'AI QA found a blocker or major issue', '1 major finding', '0/1/2']) {
      expect(table.textContent, text).not.toContain(text);
    }
    expect(within(table).getAllByText('Verdict hidden until you decide')).toHaveLength(2);
    // Both rows link to the review queue the same way.
    for (const id of [51, 41]) {
      expect(within(table).getByRole('link', { name: `Decide draft ${id} in the review queue` }).getAttribute('href')).toBe(
        `/review?deckId=7&draftId=${id}`,
      );
    }
    // Question, uid and created time are the fixture's; every other cell is identical.
    const a = cellsOf(rowOf(table, 51), 51);
    const b = cellsOf(rowOf(table, 41), 41);
    expect(a).toEqual(b);
    expect(wasVerdictSeen(41)).toBe(false);
    expect(wasVerdictSeen(51)).toBe(false);
  });

  it('shows a routed row in live mode as before', async () => {
    api.listAutomationDecisions.mockResolvedValue(ok({ items: [{ ...routed, mode: 'live' }], nextCursor: null }));
    mountAt('/automation?tab=decisions');
    const section = await screen.findByRole('region', { name: 'Decisions' });
    await within(section).findByRole('button', { name: 'Details of draft 41' });
    const table = section.querySelector('tbody') as HTMLElement;
    expect(within(table).getByText('Needs you')).toBeTruthy();
    expect(within(table).getByText('AI QA found a blocker or major issue')).toBeTruthy();
    expect(within(table).getByText('0/1/2')).toBeTruthy();
  });

  it('hides a pending routed draft in the drawer too', async () => {
    api.fetchAutomationDecision.mockResolvedValue(ok(decisionDetailFixture()));
    mountAt('/automation?tab=decisions&draftId=41');
    const drawer = await screen.findByRole('region', { name: 'Decision detail' });
    await within(drawer).findByTestId('automation-decision-hidden');
    expect(drawer.textContent).not.toMatch(/Needs you|AI QA found a blocker|AI QA findings|Option C is obviously wrong/);
  });

  it('records the rows of any state-filtered list as seen, the open exceptions too', async () => {
    api.listAutomationDecisions.mockResolvedValue(ok({ items: [routed], nextCursor: null }));
    mountAt('/automation?tab=decisions&state=human&open=1');
    const section = await screen.findByRole('region', { name: 'Decisions' });
    await within(section).findByRole('button', { name: 'Details of draft 41' });
    expect(within(section.querySelector('tbody') as HTMLElement).getByText('Needs you')).toBeTruthy();
    await waitFor(() => expect(wasVerdictSeen(41)).toBe(true));
    expect(screen.getByTestId('automation-decisions-verdict-filter')).toBeTruthy();
  });

  it('records the rows of a reason-filtered list as seen', async () => {
    api.listAutomationDecisions.mockResolvedValue(ok({ items: [routed], nextCursor: null }));
    mountAt('/automation?tab=decisions&reason=QA_FLAGGED');
    await waitFor(() => expect(wasVerdictSeen(41)).toBe(true));
  });

  it('shows no split of a dry-run run with pending drafts, the would-accept count included', async () => {
    mountAt('/automation?tab=runs');
    const cell = await screen.findByTestId(`automation-run-counts-${RUN_ID}`);
    expect(cell.textContent).toBe('3 submitted' + 'split hidden until every draft is decided (dry run)');
    const row = cell.closest('tr') as HTMLElement;
    expect(row.textContent).not.toMatch(/\d+ \/ \d+/);
  });

  it("shows the split once the run's decisions are all loaded and none is pending", async () => {
    api.listAutomationDecisions.mockResolvedValue(
      ok({
        items: [
          { ...wouldAccept, humanAction: 'accepted' },
          { ...routed, humanAction: 'rejected' },
          decisionFixture({ draftId: 60, state: 'superseded', reason: 'DECIDED_BY_HUMAN', humanAction: 'accepted' }),
        ],
        nextCursor: null,
      }),
    );
    mountAt(`/automation?tab=runs&runId=${RUN_ID}`);
    await waitFor(() => expect(screen.getByTestId(`automation-run-counts-${RUN_ID}`).textContent).toBe('3 / 0 / 1 / 1 / 0'));
  });

  it('keeps the split hidden while a page of the run is not loaded', async () => {
    api.listAutomationDecisions.mockResolvedValue(
      ok({ items: [{ ...wouldAccept, humanAction: 'accepted' }], nextCursor: 'p2' }),
    );
    mountAt(`/automation?tab=runs&runId=${RUN_ID}`);
    const section = await screen.findByRole('region', { name: 'Run decisions' });
    await within(section).findByRole('button', { name: 'Details of draft 51' });
    expect(screen.getByTestId(`automation-run-counts-${RUN_ID}`).textContent).toContain('split hidden');
  });

  it('shows the split in live mode', async () => {
    api.fetchAutomationStatus.mockResolvedValue(
      ok(statusFixture({ mode: { configured: 'live', effective: 'live', liveBlockedReason: null, autoPublish: true } })),
    );
    mountAt('/automation?tab=runs');
    await waitFor(() => expect(screen.getByTestId(`automation-run-counts-${RUN_ID}`).textContent).toBe('3 / 0 / 1 / 1 / 0'));
  });
});

describe('the console knows AUTHOR_NOT_GATED and shows the gate author (frontend-console-31, N1)', () => {
  const authorId = 'c0ffee'.repeat(10) + 'beef';

  it('offers the reason in the filter, keeps it from the URL and labels it', async () => {
    const row = decisionFixture({ draftId: 41, mode: 'live', reason: 'AUTHOR_NOT_GATED', reasonDetail: null });
    api.listAutomationDecisions.mockResolvedValue(ok({ items: [row], nextCursor: null }));
    mountAt('/automation?tab=decisions&reason=AUTHOR_NOT_GATED');

    const select = (await screen.findByLabelText('Reason')) as HTMLSelectElement;
    expect(select.value).toBe('AUTHOR_NOT_GATED');
    expect(within(select).getByRole('option', { name: 'Author configuration differs from the eval gate' })).toBeTruthy();
    await waitFor(() =>
      expect(api.listAutomationDecisions).toHaveBeenCalledWith(expect.objectContaining({ reason: 'AUTHOR_NOT_GATED' })),
    );
    const table = (await screen.findByRole('region', { name: 'Decisions' })).querySelector('tbody') as HTMLElement;
    await within(table).findByText('Author configuration differs from the eval gate');
    expect(table.textContent).not.toContain('AUTHOR_NOT_GATED');
  });

  it("shows the current gate's author configuration id in full", async () => {
    api.fetchEvalGate.mockResolvedValue(
      ok({ current: evalGateFixture({ authorConfigId: authorId }), history: [evalGateFixture({ authorConfigId: authorId })] }),
    );
    mountAt('/automation');
    expect((await screen.findByTestId('automation-gate-author')).textContent).toBe(authorId);
  });

  it('says when the gate records no author configuration', async () => {
    mountAt('/automation');
    expect((await screen.findByTestId('automation-gate-author')).textContent).toContain('Not recorded');
  });
});

describe('focus after a Reveal control removes itself (frontend-console-33, WCAG 2.4.3)', () => {
  it('moves focus to the revealed state in the table', async () => {
    const user = userEvent.setup();
    api.listAutomationDecisions.mockResolvedValue(ok({ items: [wouldAccept], nextCursor: null }));
    mountAt('/automation?tab=decisions');

    await user.click(await screen.findByRole('button', { name: 'Reveal the verdict of draft 51' }));
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement).toBe(screen.getByTestId('automation-decision-state-51'));
    expect(document.activeElement?.textContent).toContain('Would be accepted');
  });

  it('moves focus to the revealed verdict in the drawer', async () => {
    const user = userEvent.setup();
    api.listAutomationDecisions.mockResolvedValue(ok({ items: [wouldAccept], nextCursor: null }));
    api.fetchAutomationDecision.mockResolvedValue(ok({ ...decisionDetailFixture(), ...wouldAccept, events: [] }));
    mountAt('/automation?tab=decisions&draftId=51');

    const drawer = await screen.findByRole('region', { name: 'Decision detail' });
    await user.click(await within(drawer).findByRole('button', { name: 'Reveal verdict' }));
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement).toBe(within(drawer).getByTestId('automation-decision-verdict'));
  });
});

describe('the go-live floor shows both halves of the runbook criterion (frontend-console-34)', () => {
  function withShadow(blindDecided: number, blindAccepted: number, agreementRate: number | null) {
    const base = statusFixture();
    api.fetchAutomationStatus.mockResolvedValue(
      ok(statusFixture({ shadow: { ...base.shadow, humanDecided: blindDecided, blindDecided, blindAccepted, agreementRate } })),
    );
  }

  it('reads not met at 100 blind decisions with 80% agreement', async () => {
    withShadow(100, 80, 0.8);
    mountAt('/automation');
    const card = await screen.findByRole('region', { name: 'Dry-run shadow agreement' });
    expect(within(card).getByTestId('automation-shadow-threshold').textContent).toBe(
      'Go-live floor: ≥ 100 blind decisions (100) and ≥ 95.0% agreement (80.0%)',
    );
    expect(within(card).getByTestId('automation-shadow-floor-met').textContent).toBe('Not met');
  });

  it('reads met once both halves pass', async () => {
    withShadow(120, 116, 116 / 120);
    mountAt('/automation');
    const card = await screen.findByRole('region', { name: 'Dry-run shadow agreement' });
    expect(within(card).getByTestId('automation-shadow-floor-met').textContent).toBe('Met');
  });
});
