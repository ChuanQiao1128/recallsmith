// @vitest-environment jsdom
//
// The /ledger console page (R18 contract §9). src/api/ledger is mocked, so
// nothing here can leave the process; the session is a real token through
// tests/support/consoleSession, so the super_admin gate is the app's own.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

import { deferred, ok, refused } from './support/apiResult';
import { signInAsEditor, signInAsSuperAdmin, signOut } from './support/consoleSession';
import { renderAt } from './support/routerProbe';
import { ConsoleShell } from '../src/components/console/ConsoleShell';
import { documentTitleFor } from '../src/lib/brand';
import type { ApiResult } from '../src/types/api';
import type {
  AutomationBaseline,
  AutomationEventsPage,
  LedgerReport,
  LedgerSeriesPoint,
} from '../src/api/ledger';

const api = vi.hoisted(() => ({
  fetchAutomationLedger: vi.fn(),
  fetchAutomationEvents: vi.fn(),
  fetchAutomationBaselines: vi.fn(),
  updateAutomationBaseline: vi.fn(),
}));

vi.mock('../src/api/ledger', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/api/ledger')>();
  return { ...actual, ...api };
});

const { LedgerPage } = await import('../src/pages/LedgerPage');

function series(periodStart: string, automation: string, minutesSaved: number, defectsCaught = 0): LedgerSeriesPoint {
  return { periodStart, automation, runs: 1, units: 10, minutesSaved, defectsCaught };
}

function report(overrides: Partial<LedgerReport> = {}): LedgerReport {
  return {
    from: '2026-06-29',
    to: '2026-09-27',
    granularity: 'week',
    totals: {
      runs: 14,
      units: 320,
      baselineMinutes: 900,
      actualMinutes: 45,
      minutesSaved: 855,
      hoursSaved: 14.25,
      defectsCaught: 6,
      qaFalsePositives: 2,
    },
    automations: [
      {
        automation: 'publish_pipeline',
        unit: 'card',
        baselineMinutesPerUnit: 2,
        baselineSource: 'default',
        runs: 8,
        units: 300,
        failures: 1,
        failureRate: 0.125,
        baselineMinutes: 600,
        actualMinutes: 0,
        minutesSaved: 600,
        defectsCaught: 0,
      },
      {
        automation: 'ai_qa_review',
        unit: 'card',
        baselineMinutesPerUnit: 15,
        baselineSource: 'measured',
        runs: 6,
        units: 20,
        failures: 0,
        failureRate: 0,
        baselineMinutes: 300,
        actualMinutes: 45,
        minutesSaved: 255,
        defectsCaught: 6,
      },
    ],
    series: [
      series('2026-09-21', 'publish_pipeline', 300),
      series('2026-09-14', 'publish_pipeline', 300),
      series('2026-09-21', 'ai_qa_review', 255, 6),
    ],
    ...overrides,
  };
}

const BASELINES: AutomationBaseline[] = [
  {
    automation: 'publish_pipeline',
    unit: 'card',
    baselineMinutesPerUnit: 2,
    baselineSource: 'default',
    note: null,
    updatedAt: '2026-09-01T00:00:00Z',
  },
  {
    automation: 'ai_qa_review',
    unit: 'card',
    baselineMinutesPerUnit: 15,
    baselineSource: 'measured',
    note: 'timed on 40 cards',
    updatedAt: '2026-09-20T00:00:00Z',
  },
];

function eventsPage(nextCursor: string | null = null): ApiResult<AutomationEventsPage> {
  return ok({
    items: [
      {
        id: 91,
        automation: 'publish_pipeline',
        occurredAt: '2026-09-27T10:00:00Z',
        units: 40,
        outcome: 'success',
        actualMinutes: null,
        defectsCaught: 0,
        deckId: 7,
        ref: 'publish-7',
        source: 'live',
        dedupeKey: 'publish:7:3',
        details: null,
      },
    ],
    nextCursor,
  });
}

function mountPage() {
  return renderAt(<LedgerPage />, ['/ledger']);
}

async function mountLoaded() {
  mountPage();
  await waitFor(() => {
    expect(api.fetchAutomationLedger).toHaveBeenCalled();
    expect(api.fetchAutomationBaselines).toHaveBeenCalled();
    expect(api.fetchAutomationEvents).toHaveBeenCalled();
  });
  await screen.findByTestId('ledger-total-hoursSaved');
  await act(async () => {});
}

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.fetchAutomationLedger.mockResolvedValue(ok(report()));
  api.fetchAutomationBaselines.mockResolvedValue(ok({ items: BASELINES }));
  api.fetchAutomationEvents.mockResolvedValue(eventsPage());
  signInAsSuperAdmin();
});

afterEach(() => {
  cleanup();
  signOut();
});

describe('LedgerPage', () => {
  it('shows hours saved, defects caught and the per-automation table', async () => {
    await mountLoaded();
    expect(api.fetchAutomationLedger).toHaveBeenCalledWith({ from: undefined, to: undefined, granularity: 'week' });

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Automation ledger');
    expect(screen.getAllByRole('heading', { level: 2 }).map(h => h.textContent)).toEqual([
      'Totals',
      'By automation',
      'Minutes saved per period',
      'Baselines',
      'Recent events',
      'How these numbers are computed',
    ]);
    expect(screen.getByTestId('ledger-range').textContent).toContain('2026-06-29 – 2026-09-27');

    const hours = screen.getByTestId('ledger-total-hoursSaved');
    expect(hours.textContent).toContain('Hours saved');
    expect(hours.textContent).toContain('14.3 h');
    expect(screen.getByTestId('ledger-total-runs').textContent).toContain('14');
    expect(screen.getByTestId('ledger-total-units').textContent).toContain('320');
    const defects = screen.getByTestId('ledger-total-defectsCaught');
    expect(defects.textContent).toContain('Defects caught before publish');
    expect(defects.textContent).toContain('6');
    expect(screen.getByTestId('ledger-total-qaFalsePositives').textContent).toContain('2');
    expect(screen.getByTestId('ledger-total-actualMinutes').textContent).toContain('45');

    const table = screen.getByTestId('ledger-automations-table');
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('Publish pipeline');
    expect(rows[0].textContent).toContain('12.5%');
    expect(rows[1].textContent).toContain('AI QA review');
    expect(rows[1].textContent).toContain('0.0%');

    const events = screen.getByTestId('ledger-events-table');
    expect(within(events).getByText('publish-7')).toBeTruthy();
    expect(within(events).getByText('live')).toBeTruthy();
  });

  it('labels a seeded baseline as default — measure and replace', async () => {
    await mountLoaded();
    const table = screen.getByTestId('ledger-automations-table');
    const rows = within(table).getAllByRole('row').slice(1);
    expect(within(rows[0]).getByText('default — measure and replace')).toBeTruthy();
    expect(within(rows[1]).getByText('measured')).toBeTruthy();

    const baselines = screen.getByTestId('ledger-baselines-table');
    expect(within(baselines).getByText('default — measure and replace')).toBeTruthy();
    expect(within(baselines).getByText('timed on 40 cards')).toBeTruthy();
  });

  it('draws one bar per period in an inline SVG', async () => {
    await mountLoaded();
    const svg = screen.getByRole('img', { name: 'Minutes saved per period' });
    expect(svg.tagName.toLowerCase()).toBe('svg');
    const bars = screen.getAllByTestId('ledger-bar');
    expect(bars).toHaveLength(2);
    expect(bars.map(b => b.querySelector('title')?.textContent)).toEqual([
      '2026-09-14: 5.0 h saved, 0 defects',
      '2026-09-21: 9.3 h saved, 6 defects',
    ]);
    const heights = bars.map(b => Number(b.getAttribute('height')));
    expect(heights[1]).toBeGreaterThan(heights[0]);
    expect(heights[0] / heights[1]).toBeCloseTo(300 / 555, 5);
    expect(svg.textContent).toContain('2026-09-14');
    expect(svg.textContent).toContain('2026-09-21');
  });

  it('draws a long daily range at natural size and offers the values as a table', async () => {
    const days = Array.from({ length: 90 }, (_, i) => {
      const d = new Date(Date.UTC(2026, 5, 30 + i));
      return series(d.toISOString().slice(0, 10), 'publish_pipeline', 10 + i, i % 3);
    });
    api.fetchAutomationLedger.mockResolvedValue(ok(report({ granularity: 'day', series: days })));
    await mountLoaded();

    const svg = screen.getByRole('img', { name: 'Minutes saved per period' });
    // 90 bars × 40 px: drawn at that width inside the scrolling wrapper, not
    // squeezed into the card (which shrank labels to ~2 px).
    expect(svg.getAttribute('width')).toBe('3600');
    expect(svg.getAttribute('height')).toBe('180');
    expect(svg.getAttribute('class') ?? '').not.toContain('w-full');
    expect((svg as unknown as HTMLElement).style.maxHeight).toBe('');
    expect(svg.querySelector('text')?.getAttribute('font-size')).toBe('10');
    expect(screen.getByTestId('ledger-chart-scroll').className).toContain('overflow-x-auto');

    const table = screen.getByTestId('ledger-chart-table');
    expect(svg.getAttribute('aria-describedby')).toBe(table.id);
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(91);
    expect(within(rows[1]).getByRole('rowheader').textContent).toBe('2026-06-30');
    expect(rows[1].textContent).toContain('10');
    expect(within(table).getAllByRole('columnheader').map(h => h.textContent)).toEqual([
      'Period start',
      'Time saved',
      'Minutes saved',
      'Defects caught',
    ]);
  });

  it('says so when there are no runs in the range', async () => {
    api.fetchAutomationLedger.mockResolvedValue(ok(report({ series: [], automations: [] })));
    await mountLoaded();
    expect(screen.getByText('No automation runs in this range.')).toBeTruthy();
    expect(screen.queryByRole('img', { name: 'Minutes saved per period' })).toBeNull();
    expect(screen.queryAllByTestId('ledger-bar')).toHaveLength(0);
  });

  it('lets a super_admin edit a baseline and reloads the ledger', async () => {
    const user = userEvent.setup();
    const pending = deferred<ApiResult<AutomationBaseline>>();
    api.updateAutomationBaseline.mockReturnValue(pending.promise);
    await mountLoaded();
    const ledgerCalls = api.fetchAutomationLedger.mock.calls.length;
    const baselineCalls = api.fetchAutomationBaselines.mock.calls.length;

    await user.click(screen.getByRole('button', { name: 'Edit baseline Publish pipeline' }));
    const minutes = screen.getByLabelText('Minutes per unit');
    expect(minutes.getAttribute('step')).toBe('0.01');
    await user.clear(minutes);
    await user.type(minutes, '3.5');
    await user.selectOptions(screen.getByLabelText('Source'), 'measured');
    await user.type(screen.getByLabelText('Note'), 'timed 20 publishes');
    await user.click(screen.getByRole('button', { name: 'Save baseline' }));

    expect(api.updateAutomationBaseline).toHaveBeenCalledTimes(1);
    expect(api.updateAutomationBaseline).toHaveBeenCalledWith('publish_pipeline', {
      baselineMinutesPerUnit: 3.5,
      baselineSource: 'measured',
      note: 'timed 20 publishes',
    });
    expect((screen.getByRole('button', { name: 'Save baseline' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(true);

    api.fetchAutomationBaselines.mockResolvedValue(
      ok({ items: [{ ...BASELINES[0], baselineMinutesPerUnit: 3.5, baselineSource: 'measured', note: 'timed 20 publishes' }, BASELINES[1]] }),
    );
    await act(async () =>
      pending.resolve(ok({ ...BASELINES[0], baselineMinutesPerUnit: 3.5, baselineSource: 'measured', note: 'timed 20 publishes' })),
    );

    await waitFor(() => {
      expect(api.fetchAutomationBaselines.mock.calls.length).toBeGreaterThan(baselineCalls);
      expect(api.fetchAutomationLedger.mock.calls.length).toBeGreaterThan(ledgerCalls);
    });
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Save baseline' })).toBeNull());
    expect(await within(screen.getByTestId('ledger-baselines-table')).findByText('timed 20 publishes')).toBeTruthy();
  });

  it('refuses an out-of-range baseline without sending it', async () => {
    const user = userEvent.setup();
    await mountLoaded();
    await user.click(screen.getByRole('button', { name: 'Edit baseline AI QA review' }));
    const minutes = screen.getByLabelText('Minutes per unit');
    await user.clear(minutes);
    await user.type(minutes, '1000000');
    await user.click(screen.getByRole('button', { name: 'Save baseline' }));
    expect(screen.getByTestId('ledger-baseline-problem').textContent).toContain('between 0 and 999999.99');
    expect(api.updateAutomationBaseline).not.toHaveBeenCalled();
  });

  it('hides the baseline editor from an editor', async () => {
    signOut();
    signInAsEditor();
    await mountLoaded();
    expect(screen.queryByRole('button', { name: /^Edit baseline/ })).toBeNull();
    expect(screen.getByText('Only a super_admin can change baselines.')).toBeTruthy();
    expect(within(screen.getByTestId('ledger-baselines-table')).getByText('AI QA review')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Admin Management' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Automation ledger' }).getAttribute('href')).toBe('/ledger');
  });

  it('checks the date range before asking the server', async () => {
    const user = userEvent.setup();
    await mountLoaded();
    const calls = api.fetchAutomationLedger.mock.calls.length;

    await user.type(screen.getByLabelText('From'), '2026-09-27');
    await user.type(screen.getByLabelText('To'), '2026-09-01');
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(screen.getByTestId('ledger-range-problem').textContent).toBe('From must be on or before To.');
    await act(async () => {});
    expect(api.fetchAutomationLedger).toHaveBeenCalledTimes(calls);

    await user.clear(screen.getByLabelText('To'));
    await user.type(screen.getByLabelText('To'), '2026-09-30');
    await user.selectOptions(screen.getByLabelText('Granularity'), 'day');
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() =>
      expect(api.fetchAutomationLedger).toHaveBeenLastCalledWith({ from: '2026-09-27', to: '2026-09-30', granularity: 'day' }),
    );
    expect(screen.queryByTestId('ledger-range-problem')).toBeNull();

    api.fetchAutomationLedger.mockResolvedValue(refused('VALIDATION_ERROR', 'The range is longer than 366 days.'));
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect((await screen.findByTestId('ledger-validation-error')).textContent).toBe('The range is longer than 366 days.');
  });

  it('pages recent events and filters them by automation', async () => {
    const user = userEvent.setup();
    api.fetchAutomationEvents.mockResolvedValue(eventsPage('cursor-2'));
    await mountLoaded();

    api.fetchAutomationEvents.mockResolvedValueOnce(ok({ items: [], nextCursor: null }));
    await user.click(screen.getByRole('button', { name: 'Load more' }));
    expect(api.fetchAutomationEvents).toHaveBeenLastCalledWith({ automation: undefined, limit: 50, cursor: 'cursor-2' });
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull());

    await user.selectOptions(screen.getByLabelText('Automation'), 'bulk_import');
    await waitFor(() =>
      expect(api.fetchAutomationEvents).toHaveBeenLastCalledWith({ automation: 'bulk_import', limit: 50 }),
    );
  });

  it('announces range and baseline problems as alerts tied to their inputs', async () => {
    const user = userEvent.setup();
    await mountLoaded();
    await user.type(screen.getByLabelText('From'), '2026-09-27');
    await user.type(screen.getByLabelText('To'), '2026-09-01');
    await user.click(screen.getByRole('button', { name: 'Apply' }));

    const problem = screen.getByTestId('ledger-range-problem');
    expect(problem.getAttribute('role')).toBe('alert');
    for (const label of ['From', 'To']) {
      const input = screen.getByLabelText(label);
      expect(input.getAttribute('aria-invalid')).toBe('true');
      expect(input.getAttribute('aria-describedby')).toBe(problem.id);
    }

    await user.click(screen.getByRole('button', { name: 'Edit baseline AI QA review' }));
    const minutes = screen.getByLabelText('Minutes per unit');
    await user.clear(minutes);
    await user.type(minutes, '1000000');
    await user.click(screen.getByRole('button', { name: 'Save baseline' }));
    const baselineProblem = screen.getByTestId('ledger-baseline-problem');
    expect(baselineProblem.getAttribute('role')).toBe('alert');
    expect(minutes.getAttribute('aria-invalid')).toBe('true');
    expect(minutes.getAttribute('aria-describedby')).toBe(baselineProblem.id);
  });

  it('announces a saved baseline through the persistent live region', async () => {
    const user = userEvent.setup();
    api.updateAutomationBaseline.mockResolvedValue(ok({ ...BASELINES[0], baselineMinutesPerUnit: 3 }));
    await mountLoaded();
    const live = screen.getByTestId('ledger-live');
    expect(live.getAttribute('aria-live')).toBe('polite');
    expect(live.textContent).toBe('');

    await user.click(screen.getByRole('button', { name: 'Edit baseline Publish pipeline' }));
    await user.clear(screen.getByLabelText('Minutes per unit'));
    await user.type(screen.getByLabelText('Minutes per unit'), '3');
    await user.click(screen.getByRole('button', { name: 'Save baseline' }));
    await waitFor(() => expect(live.textContent).toBe('Baseline saved for Publish pipeline.'));
  });

  it('drops a Load more page whose automation filter changed while it was in flight', async () => {
    const user = userEvent.setup();
    const stale = deferred<ApiResult<AutomationEventsPage>>();
    const filtered = deferred<ApiResult<AutomationEventsPage>>();
    api.fetchAutomationEvents.mockImplementation(async (params: { automation?: string; cursor?: string }) => {
      if (params.cursor) return stale.promise;
      if (params.automation === 'bulk_import') return filtered.promise;
      return eventsPage('cursor-2');
    });
    await mountLoaded();

    await user.click(screen.getByRole('button', { name: 'Load more' }));
    await user.selectOptions(screen.getByLabelText('Automation'), 'bulk_import');
    expect(await screen.findByTestId('ledger-events-refetching')).toBeTruthy();
    expect(screen.getByTestId('ledger-events-table').getAttribute('aria-busy')).toBe('true');

    const bulkRow = {
      id: 92,
      automation: 'bulk_import',
      occurredAt: '2026-09-26T10:00:00Z',
      units: 12,
      outcome: 'success',
      actualMinutes: null,
      defectsCaught: 0,
      deckId: 8,
      ref: 'import-8',
      source: 'live',
      dedupeKey: 'import:8',
      details: null,
    };
    await act(async () => filtered.resolve(ok({ items: [bulkRow], nextCursor: null })));
    await waitFor(() => expect(screen.queryByTestId('ledger-events-refetching')).toBeNull());
    await act(async () =>
      stale.resolve(ok({ items: [{ ...bulkRow, id: 93, automation: 'publish_pipeline', ref: 'stale-ref' }], nextCursor: 'cursor-3' })),
    );

    const table = within(screen.getByTestId('ledger-events-table'));
    expect(table.getByText('import-8')).toBeTruthy();
    expect(table.queryByText('stale-ref')).toBeNull();
    expect(table.queryByText('publish-7')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
  });

  it('explains a server that has not run the ledger migration', async () => {
    api.fetchAutomationLedger.mockResolvedValue(refused('SERVER_NOT_READY_LEDGER', 'migration 028 missing'));
    api.fetchAutomationBaselines.mockResolvedValue(refused('SERVER_NOT_READY_LEDGER', 'migration 028 missing'));
    api.fetchAutomationEvents.mockResolvedValue(refused('SERVER_NOT_READY_LEDGER', 'migration 028 missing'));
    mountPage();
    const notice = await screen.findByTestId('ledger-not-ready');
    expect(notice.textContent).toContain('The automation ledger is not set up yet');
    expect(notice.textContent).toContain('The server has not run the ledger database migration.');
  });

  it('shows the server message for any other failure', async () => {
    api.fetchAutomationLedger.mockResolvedValue(refused('INTERNAL_ERROR', 'The ledger query failed.'));
    mountPage();
    expect(await screen.findByText('The ledger query failed.')).toBeTruthy();
    expect(screen.queryByTestId('ledger-not-ready')).toBeNull();
  });

  it('prints how the numbers are computed', async () => {
    await mountLoaded();
    const terms = Array.from(document.querySelectorAll('dl dt')).map(dt => dt.textContent);
    expect(terms).toEqual([
      'Run',
      'Units',
      'Baseline minutes',
      'Actual minutes',
      'Minutes saved',
      'Defects caught before publish',
      'QA false positives',
      'Failure rate',
      'Default baselines',
    ]);
    expect(document.querySelectorAll('dl dd')).toHaveLength(9);
  });

  it('names the route Automation ledger and links it from the shell', () => {
    expect(documentTitleFor('/ledger')).toBe('Automation ledger · DeveloperCards Console');

    function shell(href?: string) {
      return render(
        <MemoryRouter>
          <ConsoleShell title="t" ledgerHref={href}>
            body
          </ConsoleShell>
        </MemoryRouter>,
      );
    }

    shell('/ledger');
    const link = screen.getByRole('link', { name: 'Automation ledger' });
    expect(link.getAttribute('href')).toBe('/ledger');
    expect(link.querySelector('span')).toBeNull();
    cleanup();

    shell(undefined);
    expect(screen.queryByRole('link', { name: 'Automation ledger' })).toBeNull();
  });
});
