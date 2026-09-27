// @vitest-environment jsdom
//
// The ledger's events filter lists the automation types the server returns
// (A00 §14, §16.3, A17), after the six seeded ones. src/api/ledger is mocked as
// in ledgerPage.test.tsx, so nothing here can leave the process.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ok } from './support/apiResult';
import { signInAsSuperAdmin, signOut } from './support/consoleSession';
import { renderAt } from './support/routerProbe';
import type { AutomationBaseline, LedgerReport } from '../src/api/ledger';

const api = vi.hoisted(() => ({
  fetchAutomationLedger: vi.fn(),
  fetchAutomationEvents: vi.fn(),
  fetchAutomationBaselines: vi.fn(),
  updateAutomationBaseline: vi.fn(),
  runAutomationBackfill: vi.fn(),
}));

vi.mock('../src/api/ledger', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/api/ledger')>();
  return { ...actual, ...api };
});

const { LedgerPage } = await import('../src/pages/LedgerPage');

function report(): LedgerReport {
  return {
    from: '2026-06-29',
    to: '2026-09-27',
    granularity: 'week',
    totals: {
      runs: 0,
      units: 0,
      baselineMinutes: 0,
      actualMinutes: 0,
      minutesSaved: 0,
      hoursSaved: 0,
      defectsCaught: 0,
      qaFalsePositives: 0,
      bySource: {
        live: { runs: 0, units: 0, minutesSaved: 0, hoursSaved: 0 },
        backfill: { runs: 0, units: 0, minutesSaved: 0, hoursSaved: 0 },
      },
      byBaselineSource: { measured: 0, default: 0 },
    },
    automations: [],
    series: [],
    agentDrafts: {
      decided: 0,
      accepted: 0,
      editedAccepted: 0,
      rejected: 0,
      defectRejects: 0,
      acceptanceRate: 0,
      editedAcceptRate: 0,
      defectRate: 0,
      avgReviewMinutes: null,
      reviewNotMeasured: 0,
    },
  };
}

function baseline(automation: string): AutomationBaseline {
  return {
    automation,
    unit: 'card',
    baselineMinutesPerUnit: 2,
    baselineSource: 'default',
    note: null,
    updatedAt: '2026-09-01T00:00:00Z',
  };
}

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.fetchAutomationLedger.mockResolvedValue(ok(report()));
  api.fetchAutomationBaselines.mockResolvedValue(
    ok({ items: [baseline('publish_pipeline'), baseline('auto_accept'), baseline('source_watch')] }),
  );
  api.fetchAutomationEvents.mockResolvedValue(ok({ items: [], nextCursor: null }));
  signInAsSuperAdmin();
});

afterEach(() => {
  cleanup();
  signOut();
});

describe('ledger events filter', () => {
  it('lists the automation types the server returns in the events filter', async () => {
    const user = userEvent.setup();
    renderAt(<LedgerPage />, ['/ledger']);
    await waitFor(() => {
      expect(api.fetchAutomationLedger).toHaveBeenCalled();
      expect(api.fetchAutomationBaselines).toHaveBeenCalled();
      expect(api.fetchAutomationEvents).toHaveBeenCalled();
    });
    await screen.findByTestId('ledger-total-hoursSaved');
    await act(async () => {});

    const select = screen.getByLabelText('Automation') as HTMLSelectElement;
    await waitFor(() => expect(within(select).queryByRole('option', { name: 'Auto-accept' })).not.toBeNull());
    expect(within(select).getAllByRole('option').map(o => o.textContent)).toEqual([
      'All automations',
      'Publish pipeline',
      'Bulk import',
      'AI draft review',
      'AI QA review',
      'Webhook notifications',
      'Publish gate',
      'Auto-accept',
      'Source watch',
    ]);

    await user.selectOptions(select, 'auto_accept');
    await waitFor(() =>
      expect(api.fetchAutomationEvents).toHaveBeenLastCalledWith(expect.objectContaining({ automation: 'auto_accept' })),
    );
  });
});
