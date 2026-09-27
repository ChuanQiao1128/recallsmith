// What src/api/ledger.ts sends, below every page-level mock.
//
// src/api/http is replaced wholesale, as in adminConsoleRequests.test.tsx:
// .env.development points VITE_API_BASE at a real origin, so with the module
// mocked an outbound request has nowhere to go.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AxiosError, AxiosHeaders } from 'axios';

import { ok } from './support/apiResult';

const httpMock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
}));

vi.mock('../src/api/http', () => ({ http: httpMock }));

const api = await import('../src/api/ledger');

function report(overrides: Record<string, unknown> = {}) {
  return {
    from: '2026-06-29',
    to: '2026-09-27',
    granularity: 'week',
    totals: {
      runs: 3,
      units: 40,
      baselineMinutes: 120,
      actualMinutes: 10,
      minutesSaved: 110,
      hoursSaved: 1.83,
      defectsCaught: 2,
      qaFalsePositives: 1,
    },
    automations: [],
    series: [],
    ...overrides,
  };
}

function axiosFailure(status: number, data: unknown): AxiosError {
  const config = { headers: new AxiosHeaders() };
  return new AxiosError('Request failed', 'ERR_BAD_REQUEST', config, null, {
    status,
    statusText: 'Error',
    headers: {},
    config,
    data,
  });
}

beforeEach(() => {
  for (const fn of Object.values(httpMock)) fn.mockReset();
});

describe('src/api/ledger', () => {
  it('reads the ledger with only the filters that are set', async () => {
    httpMock.get.mockResolvedValue({ data: ok(report()) });

    await api.fetchAutomationLedger();
    expect(httpMock.get).toHaveBeenLastCalledWith('/api/v1/admin/automation/ledger', { params: {} });

    await api.fetchAutomationLedger({ granularity: 'month' });
    expect(httpMock.get).toHaveBeenLastCalledWith('/api/v1/admin/automation/ledger', {
      params: { granularity: 'month' },
    });

    await api.fetchAutomationLedger({ from: '2026-09-01', to: '2026-09-27', granularity: 'day' });
    expect(httpMock.get).toHaveBeenLastCalledWith('/api/v1/admin/automation/ledger', {
      params: { from: '2026-09-01', to: '2026-09-27', granularity: 'day' },
    });

    await api.fetchAutomationLedger({ from: undefined, to: undefined, granularity: 'week' });
    expect(httpMock.get).toHaveBeenLastCalledWith('/api/v1/admin/automation/ledger', {
      params: { granularity: 'week' },
    });

    httpMock.get.mockResolvedValueOnce({ data: ok({ items: [] }) });
    await api.fetchAutomationBaselines();
    expect(httpMock.get).toHaveBeenLastCalledWith('/api/v1/admin/automation/baselines');
  });

  it('coerces numeric strings in the ledger totals to numbers', async () => {
    httpMock.get.mockResolvedValueOnce({
      data: ok(
        report({
          totals: {
            runs: '3',
            units: '40',
            baselineMinutes: '120.50',
            actualMinutes: null,
            minutesSaved: '110.5',
            hoursSaved: '1.84',
            defectsCaught: 2,
            qaFalsePositives: 'n/a',
          },
          automations: [
            {
              automation: 'publish_pipeline',
              unit: 'card',
              baselineMinutesPerUnit: '2.50',
              baselineSource: 'default',
              runs: '2',
              units: '40',
              failures: '1',
              failureRate: '0.5',
              baselineMinutes: '100.00',
              actualMinutes: '0',
              minutesSaved: '100',
              defectsCaught: '0',
            },
          ],
          series: [
            { periodStart: '2026-09-21', automation: 'publish_pipeline', runs: '2', units: '40', minutesSaved: '100.00', defectsCaught: '0' },
          ],
        }),
      ),
    });

    const res = await api.fetchAutomationLedger();
    expect(res.success).toBe(true);
    expect(res.data?.totals).toEqual({
      runs: 3,
      units: 40,
      baselineMinutes: 120.5,
      actualMinutes: 0,
      minutesSaved: 110.5,
      hoursSaved: 1.84,
      defectsCaught: 2,
      qaFalsePositives: 0,
      // An older server sends no split: null, never invented zeros.
      bySource: null,
      byBaselineSource: null,
    });
    expect(res.data?.agentDrafts).toBeNull();
    expect(res.data?.automations[0]).toMatchObject({ baselineMinutesPerUnit: 2.5, failures: 1, failureRate: 0.5, minutesSaved: 100 });
    expect(res.data?.series[0]).toEqual({
      periodStart: '2026-09-21',
      automation: 'publish_pipeline',
      runs: 2,
      units: 40,
      minutesSaved: 100,
      defectsCaught: 0,
    });

    httpMock.get.mockResolvedValueOnce({
      data: ok({
        items: [{ automation: 'bulk_import', unit: 'row', baselineMinutesPerUnit: '0.75', baselineSource: 'measured', note: null, updatedAt: '2026-09-27T00:00:00Z' }],
      }),
    });
    const baselines = await api.fetchAutomationBaselines();
    expect(baselines.data?.items[0].baselineMinutesPerUnit).toBe(0.75);
  });

  it('keeps the live/backfill split, the baseline split and agentDrafts (automation-4, automation-11)', async () => {
    httpMock.get.mockResolvedValueOnce({
      data: ok(
        report({
          totals: {
            runs: 3,
            units: 40,
            baselineMinutes: 120,
            actualMinutes: 10,
            minutesSaved: 110,
            hoursSaved: 1.83,
            defectsCaught: 2,
            qaFalsePositives: 1,
            bySource: {
              live: { runs: '2', units: 30, minutesSaved: '80.5', hoursSaved: 1.34 },
              backfill: { runs: 1, units: 10, minutesSaved: 29.5, hoursSaved: '0.49' },
            },
            byBaselineSource: { measured: { minutesSaved: '70' }, default: { minutesSaved: 40 } },
          },
          agentDrafts: {
            decided: '10',
            accepted: 8,
            editedAccepted: 2,
            rejected: 2,
            defectRejects: 1,
            acceptanceRate: '0.8',
            editedAcceptRate: 0.25,
            defectRate: 0.1,
            avgReviewMinutes: null,
            reviewNotMeasured: '3',
          },
        }),
      ),
    });
    const res = await api.fetchAutomationLedger();
    expect(res.data?.totals.bySource).toEqual({
      live: { runs: 2, units: 30, minutesSaved: 80.5, hoursSaved: 1.34 },
      backfill: { runs: 1, units: 10, minutesSaved: 29.5, hoursSaved: 0.49 },
    });
    expect(res.data?.totals.byBaselineSource).toEqual({ measured: 70, default: 40 });
    expect(res.data?.agentDrafts).toEqual({
      decided: 10,
      accepted: 8,
      editedAccepted: 2,
      rejected: 2,
      defectRejects: 1,
      acceptanceRate: 0.8,
      editedAcceptRate: 0.25,
      defectRate: 0.1,
      avgReviewMinutes: null,
      reviewNotMeasured: 3,
    });
  });

  it('posts the backfill with dryRun and reads its counts (automation-11)', async () => {
    httpMock.post.mockResolvedValueOnce({
      data: ok({ dryRun: true, inserted: { publish_pipeline: '4', bulk_import: 1 }, skipped: { publish_pipeline: 0, bulk_import: 2 } }),
    });
    const res = await api.runAutomationBackfill(true);
    expect(httpMock.post).toHaveBeenCalledWith('/api/v1/admin/automation/backfill', { dryRun: true });
    expect(res.data).toEqual({
      dryRun: true,
      inserted: { publish_pipeline: 4, bulk_import: 1 },
      skipped: { publish_pipeline: 0, bulk_import: 2 },
    });

    httpMock.post.mockResolvedValueOnce({ data: ok({ inserted: {} }) });
    const bad = await api.runAutomationBackfill(false);
    expect(bad.success).toBe(false);
    expect(bad.error?.code).toBe('BAD_RESPONSE');
  });

  it('pages events with the automation filter and cursor', async () => {
    httpMock.get.mockResolvedValueOnce({
      data: ok({
        items: [
          {
            id: '41',
            automation: 'bulk_import',
            occurredAt: '2026-09-27T10:00:00Z',
            units: '12',
            outcome: 'success',
            actualMinutes: null,
            defectsCaught: '0',
            deckId: '7',
            ref: 'job-1',
            source: 'live',
            dedupeKey: 'import:job-1',
            details: { rows: 12 },
          },
          {
            id: 40,
            automation: 'bulk_import',
            occurredAt: '2026-09-26T10:00:00Z',
            units: 0,
            outcome: 'failure',
            actualMinutes: '4.5',
            defectsCaught: 0,
            deckId: null,
            ref: null,
            source: 'backfill',
            dedupeKey: null,
            details: null,
          },
        ],
        nextCursor: 'c-2',
      }),
    });
    const first = await api.fetchAutomationEvents({ automation: 'bulk_import', limit: 50 });
    expect(httpMock.get).toHaveBeenLastCalledWith('/api/v1/admin/automation/events', {
      params: { automation: 'bulk_import', limit: 50 },
    });
    expect(first.data?.nextCursor).toBe('c-2');
    expect(first.data?.items[0]).toMatchObject({ id: 41, units: 12, actualMinutes: null, deckId: 7 });
    expect(first.data?.items[1]).toMatchObject({ id: 40, actualMinutes: 4.5, deckId: null, source: 'backfill' });

    httpMock.get.mockResolvedValueOnce({ data: ok({ items: [], nextCursor: null }) });
    const second = await api.fetchAutomationEvents({ automation: 'bulk_import', limit: 50, cursor: 'c-2' });
    expect(httpMock.get).toHaveBeenLastCalledWith('/api/v1/admin/automation/events', {
      params: { automation: 'bulk_import', limit: 50, cursor: 'c-2' },
    });
    expect(second.data).toEqual({ items: [], nextCursor: null });

    httpMock.get.mockResolvedValueOnce({ data: ok({ items: [], nextCursor: null }) });
    await api.fetchAutomationEvents({ automation: '', cursor: null });
    expect(httpMock.get).toHaveBeenLastCalledWith('/api/v1/admin/automation/events', { params: {} });
  });

  it('updates a baseline through PUT /api/v1/admin/automation/baselines/:automation', async () => {
    const row = {
      automation: 'publish pipeline/x',
      unit: 'card',
      baselineMinutesPerUnit: '3.25',
      baselineSource: 'measured',
      note: 'timed 20 cards',
      updatedAt: '2026-09-27T12:00:00Z',
    };
    httpMock.put.mockResolvedValueOnce({ data: ok(row) });
    const input = { baselineMinutesPerUnit: 3.25, baselineSource: 'measured' as const, note: 'timed 20 cards' };
    const res = await api.updateAutomationBaseline('publish pipeline/x', input);
    expect(httpMock.put).toHaveBeenCalledWith('/api/v1/admin/automation/baselines/publish%20pipeline%2Fx', input);
    expect(res.success).toBe(true);
    expect(res.data).toEqual({ ...row, baselineMinutesPerUnit: 3.25 });
  });

  it('keeps the server error code when a request fails', async () => {
    httpMock.get.mockRejectedValueOnce(
      axiosFailure(503, { success: false, data: null, error: { code: 'SERVER_NOT_READY_LEDGER', message: 'migration 028 missing' }, traceId: 't-1' }),
    );
    const notReady = await api.fetchAutomationLedger();
    expect(notReady.success).toBe(false);
    expect(notReady.error?.code).toBe('SERVER_NOT_READY_LEDGER');
    expect(notReady.error?.message).toBe('migration 028 missing');

    httpMock.put.mockRejectedValueOnce(
      axiosFailure(404, { success: false, data: null, error: { code: 'AUTOMATION_NOT_FOUND', message: 'no such automation' }, traceId: 't-2' }),
    );
    const missing = await api.updateAutomationBaseline('nope', { baselineMinutesPerUnit: 1, baselineSource: 'measured' });
    expect(missing.error?.code).toBe('AUTOMATION_NOT_FOUND');

    httpMock.get.mockResolvedValueOnce({
      data: { success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'range too long' }, traceId: 't-3' },
    });
    const invalid = await api.fetchAutomationLedger({ from: '2024-01-01', to: '2026-01-01' });
    expect(invalid.error?.code).toBe('VALIDATION_ERROR');
    expect(invalid.error?.message).toBe('range too long');
  });

  it('reports BAD_RESPONSE when the series is not an array', async () => {
    httpMock.get.mockResolvedValueOnce({ data: ok(report({ series: null })) });
    const res = await api.fetchAutomationLedger();
    expect(res.success).toBe(false);
    expect(res.error?.code).toBe('BAD_RESPONSE');

    httpMock.get.mockResolvedValueOnce({ data: ok(report({ automations: 'x' })) });
    expect((await api.fetchAutomationLedger()).error?.code).toBe('BAD_RESPONSE');

    httpMock.get.mockResolvedValueOnce({ data: ok({ items: {} }) });
    expect((await api.fetchAutomationEvents()).error?.code).toBe('BAD_RESPONSE');

    httpMock.get.mockResolvedValueOnce({ data: ok({}) });
    expect((await api.fetchAutomationBaselines()).error?.code).toBe('BAD_RESPONSE');
  });
});
