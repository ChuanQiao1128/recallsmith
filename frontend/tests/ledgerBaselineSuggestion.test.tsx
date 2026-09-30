// @vitest-environment jsdom
//
// R20 V10: a baseline row carrying `suggestedMeasuredMinutes` (contract §7,
// GET …/automation/baselines) reads "Suggested from N reviews: X min" on the
// Ledger page. A super_admin's "Use as measured" pre-fills the existing edit
// form; saving is the unchanged PUT. Rows without the keys look as before.
// src/api/ledger is mocked for the page and replaced at the adapter for the
// normaliser, so nothing here can leave the process.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AxiosResponse, InternalAxiosRequestConfig } from 'axios';

import { ok } from './support/apiResult';
import { signInAsEditor, signInAsSuperAdmin, signOut } from './support/consoleSession';
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
// The real normaliser, below the page-level mock.
const ledgerActual = await vi.importActual<typeof import('../src/api/ledger')>('../src/api/ledger');
const { http } = await import('../src/api/http');

const REPORT: LedgerReport = {
  from: '2026-09-01',
  to: '2026-09-30',
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
    bySource: null,
    byBaselineSource: null,
  },
  automations: [],
  series: [],
  agentDrafts: null,
};

const DRAFT_REVIEW: AutomationBaseline = {
  automation: 'ai_draft_review',
  unit: 'card',
  baselineMinutesPerUnit: 4,
  baselineSource: 'default',
  note: 'seeded',
  updatedAt: '2026-09-01T00:00:00Z',
  suggestedMeasuredMinutes: 2.75,
  suggestedFromN: 12,
};

const PUBLISH: AutomationBaseline = {
  automation: 'publish_pipeline',
  unit: 'card',
  baselineMinutesPerUnit: 2,
  baselineSource: 'default',
  note: null,
  updatedAt: null,
};

const TOO_FEW: AutomationBaseline = {
  automation: 'ai_qa_review',
  unit: 'card',
  baselineMinutesPerUnit: 15,
  baselineSource: 'measured',
  note: null,
  updatedAt: null,
  suggestedMeasuredMinutes: null,
  suggestedFromN: 3,
};

async function mountLoaded() {
  renderAt(<LedgerPage />, ['/ledger']);
  const table = await screen.findByTestId('ledger-baselines-table');
  await waitFor(() => expect(within(table).getByText('AI draft review')).toBeTruthy());
  await act(async () => {});
}

const originalAdapter = http.defaults.adapter;

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.fetchAutomationLedger.mockResolvedValue(ok(REPORT));
  api.fetchAutomationBaselines.mockResolvedValue(ok({ items: [DRAFT_REVIEW, PUBLISH, TOO_FEW] }));
  api.fetchAutomationEvents.mockResolvedValue(ok({ items: [], nextCursor: null }));
  api.updateAutomationBaseline.mockResolvedValue(ok({ ...DRAFT_REVIEW, baselineMinutesPerUnit: 2.75, baselineSource: 'measured' }));
  signInAsSuperAdmin();
});

afterEach(() => {
  cleanup();
  signOut();
  http.defaults.adapter = originalAdapter;
});

describe('the suggested measured baseline on the Ledger page', () => {
  it('shows the suggestion only on the row that has one', async () => {
    await mountLoaded();
    const table = screen.getByTestId('ledger-baselines-table');
    expect(within(table).getByTestId('ledger-baseline-suggestion-ai_draft_review').textContent).toContain(
      'Suggested from 12 reviews: 2.75 min',
    );
    // Absent keys and a null suggestion (fewer than 5 reviews) both show nothing.
    expect(within(table).queryByTestId('ledger-baseline-suggestion-publish_pipeline')).toBeNull();
    expect(within(table).queryByTestId('ledger-baseline-suggestion-ai_qa_review')).toBeNull();
    expect(within(table).getAllByRole('button', { name: /^Use as measured/ })).toHaveLength(1);
  });

  it('pre-fills the edit form for a super_admin, and Save sends the unchanged PUT', async () => {
    const user = userEvent.setup();
    await mountLoaded();
    await user.click(screen.getByRole('button', { name: 'Use as measured: AI draft review' }));

    const form = screen.getByRole('form', { name: 'Baseline for AI draft review' });
    expect((within(form).getByLabelText('Minutes per unit') as HTMLInputElement).value).toBe('2.75');
    expect((within(form).getByLabelText('Source') as HTMLSelectElement).value).toBe('measured');
    expect((within(form).getByLabelText('Note') as HTMLTextAreaElement).value).toBe('seeded');
    // Nothing is saved until Save.
    expect(api.updateAutomationBaseline).not.toHaveBeenCalled();

    await user.click(within(form).getByRole('button', { name: 'Save baseline' }));
    expect(api.updateAutomationBaseline).toHaveBeenCalledWith('ai_draft_review', {
      baselineMinutesPerUnit: 2.75,
      baselineSource: 'measured',
      note: 'seeded',
    });
  });

  it('rounds a non-terminating suggestion to the input step, so the form can be submitted', async () => {
    // median review 164,800 ms / 60,000 = 2.74666…
    api.fetchAutomationBaselines.mockResolvedValue(
      ok({ items: [{ ...DRAFT_REVIEW, suggestedMeasuredMinutes: 164_800 / 60_000 }, PUBLISH, TOO_FEW] }),
    );
    const user = userEvent.setup();
    await mountLoaded();
    expect(screen.getByTestId('ledger-baseline-suggestion-ai_draft_review').textContent).toContain(
      'Suggested from 12 reviews: 2.75 min',
    );
    await user.click(screen.getByRole('button', { name: 'Use as measured: AI draft review' }));

    const form = screen.getByRole('form', { name: 'Baseline for AI draft review' }) as HTMLFormElement;
    const input = within(form).getByLabelText('Minutes per unit') as HTMLInputElement;
    expect(input.value).toBe('2.75');
    expect(input.step).toBe('0.01');
    expect(input.validity.stepMismatch).toBe(false);
    expect(form.checkValidity()).toBe(true);

    await user.click(within(form).getByRole('button', { name: 'Save baseline' }));
    expect(api.updateAutomationBaseline).toHaveBeenCalledWith('ai_draft_review', {
      baselineMinutesPerUnit: 2.75,
      baselineSource: 'measured',
      note: 'seeded',
    });
  });

  it('shows an editor the suggestion but no button', async () => {
    signInAsEditor();
    await mountLoaded();
    expect(screen.getByTestId('ledger-baseline-suggestion-ai_draft_review').textContent).toContain(
      'Suggested from 12 reviews: 2.75 min',
    );
    expect(screen.queryByRole('button', { name: /^Use as measured/ })).toBeNull();
  });
});

describe('the baselines normaliser keeps the suggestion keys only when sent', () => {
  function serve(data: unknown) {
    http.defaults.adapter = async (config: InternalAxiosRequestConfig) =>
      ({ data, status: 200, statusText: 'OK', headers: {}, config }) as AxiosResponse;
  }

  it('coerces the suggestion and its n, and leaves both out on an older server', async () => {
    serve(
      ok({
        items: [
          { automation: 'ai_draft_review', unit: 'card', baselineMinutesPerUnit: '4', baselineSource: 'default', suggestedMeasuredMinutes: '2.50', suggestedFromN: '9' },
          { automation: 'ai_qa_review', unit: 'card', baselineMinutesPerUnit: 15, baselineSource: 'measured', suggestedMeasuredMinutes: null, suggestedFromN: 2 },
          { automation: 'bulk_import', unit: 'row', baselineMinutesPerUnit: 1, baselineSource: 'default', suggestedMeasuredMinutes: 'soon' },
          { automation: 'publish_pipeline', unit: 'card', baselineMinutesPerUnit: 2, baselineSource: 'default' },
        ],
      }),
    );
    const res = await ledgerActual.fetchAutomationBaselines();
    const [measured, tooFew, junk, older] = res.data?.items ?? [];
    expect(measured.suggestedMeasuredMinutes).toBe(2.5);
    expect(measured.suggestedFromN).toBe(9);
    expect(tooFew.suggestedMeasuredMinutes).toBeNull();
    expect(tooFew.suggestedFromN).toBe(2);
    expect(junk.suggestedMeasuredMinutes).toBeNull();
    expect('suggestedMeasuredMinutes' in older).toBe(false);
    expect('suggestedFromN' in older).toBe(false);
  });
});
