// What src/api/qa.ts sends and how it normalises what comes back.
//
// src/api/http is replaced wholesale, as in draftsApi.test.ts:
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

const api = await import('../src/api/qa');

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

describe('src/api/qa', () => {
  it('starts a run through POST /api/v1/authoring/qa/runs', async () => {
    httpMock.post.mockResolvedValue({ data: ok({ runId: 'r-1', status: 'queued', cardCount: '3', chunkCount: 1 }) });

    const res = await api.startQaRun({ deckId: 7, scope: 'changed', cardIds: [1, 2] });
    expect(httpMock.post).toHaveBeenLastCalledWith('/api/v1/authoring/qa/runs', { deckId: 7, scope: 'changed' });
    expect(res.data).toEqual({ runId: 'r-1', status: 'queued', cardCount: 3, chunkCount: 1 });

    await api.startQaRun({ deckId: 7, scope: 'all' });
    expect(httpMock.post).toHaveBeenLastCalledWith('/api/v1/authoring/qa/runs', { deckId: 7, scope: 'all' });

    await api.startQaRun({ deckId: 7, scope: 'cards', cardIds: [101, 102] });
    expect(httpMock.post).toHaveBeenLastCalledWith('/api/v1/authoring/qa/runs', {
      deckId: 7,
      scope: 'cards',
      cardIds: [101, 102],
    });
  });

  it('reads the publish gate preview from GET /api/v1/authoring/qa/status', async () => {
    httpMock.get.mockResolvedValue({
      data: ok({
        enabled: true,
        required: true,
        changedCards: '4',
        reviewedCurrent: 1,
        missing: [{ cardId: 102, stableUid: 'aws-s3-cloudfront-oac' }],
        openBlockers: [
          { findingId: 9, cardId: 101, stableUid: 'aws-s3-storage-classes', category: 'incorrect_answer', message: 'm' },
        ],
        wouldBlock: true,
      }),
    });

    const res = await api.fetchQaStatus(7);
    expect(httpMock.get).toHaveBeenCalledWith('/api/v1/authoring/qa/status', { params: { deckId: 7 } });
    expect(res.data).toEqual({
      enabled: true,
      required: true,
      changedCards: 4,
      reviewedCurrent: 1,
      missing: [{ cardId: 102, stableUid: 'aws-s3-cloudfront-oac' }],
      openBlockers: [
        { findingId: 9, cardId: 101, stableUid: 'aws-s3-storage-classes', category: 'incorrect_answer', message: 'm' },
      ],
      wouldBlock: true,
      // Today's server does not send its run limits; the page then uses the
      // documented defaults.
      maxCards: null,
      dailyUsdCap: null,
      spentTodayUsd: null,
    });
  });

  it('reads the run limits and today\'s spend from the status response when present', async () => {
    httpMock.get.mockResolvedValue({
      data: ok({
        enabled: true,
        required: false,
        changedCards: 0,
        reviewedCurrent: 0,
        missing: [],
        openBlockers: [],
        wouldBlock: false,
        maxCards: '50',
        dailyUsdCap: 2.5,
        spentTodayUsd: 0,
      }),
    });
    const res = await api.fetchQaStatus(7);
    expect(res.data).toMatchObject({ maxCards: 50, dailyUsdCap: 2.5, spentTodayUsd: 0 });

    httpMock.get.mockResolvedValue({
      data: ok({ enabled: true, maxCards: 0, dailyUsdCap: 'x', spentTodayUsd: -1 }),
    });
    const bad = await api.fetchQaStatus(7);
    expect(bad.data).toMatchObject({ maxCards: null, dailyUsdCap: null, spentTodayUsd: null });
  });

  it('resolves a finding through POST /api/v1/authoring/qa/findings/:findingId/resolve', async () => {
    httpMock.post.mockResolvedValue({ data: ok({ id: 9, cardId: 101, severity: 'blocker', resolution: 'fixed' }) });

    const res = await api.resolveQaFinding(9, { resolution: 'fixed', note: 'Rewrote the answer.' });
    expect(httpMock.post).toHaveBeenCalledWith('/api/v1/authoring/qa/findings/9/resolve', {
      resolution: 'fixed',
      note: 'Rewrote the answer.',
    });
    expect(res.success).toBe(true);
    expect(res.data).toMatchObject({ findingId: 9, resolution: 'fixed' });
  });

  it('accepts id or runId and reports effectiveStatus', async () => {
    expect(api.normalizeQaRun({ id: 'r-1', status: 'running', cardCount: '5', estimatedCostUsd: 'x' })).toMatchObject({
      runId: 'r-1',
      status: 'running',
      effectiveStatus: 'running',
      cardCount: 5,
      estimatedCostUsd: 0,
    });
    expect(api.normalizeQaRun({ runId: 'r-2', id: 'ignored', status: 'running', effectiveStatus: 'failed' })).toMatchObject({
      runId: 'r-2',
      status: 'running',
      effectiveStatus: 'failed',
    });
    expect(api.normalizeQaRun({ status: 'done' })).toBeNull();
    expect(api.normalizeQaFinding({ id: '4', cardId: 101, severity: 'major' })).toMatchObject({ findingId: 4 });
    expect(api.normalizeQaFinding({ findingId: 5, id: 99, cardId: 101 })).toMatchObject({ findingId: 5 });
    expect(api.normalizeQaFinding({ cardId: 101 })).toBeNull();

    httpMock.get.mockResolvedValue({
      data: ok({ items: [{ id: 'r-3', status: 'queued' }, { status: 'done' }], nextCursor: 'c2' }),
    });
    const list = await api.listQaRuns({ deckId: 7, cursor: null, limit: 20 });
    expect(httpMock.get).toHaveBeenLastCalledWith('/api/v1/authoring/qa/runs', { params: { deckId: 7, limit: 20 } });
    expect(list.data?.items.map(r => r.runId)).toEqual(['r-3']);
    expect(list.data?.nextCursor).toBe('c2');

    httpMock.get.mockResolvedValue({
      data: ok({ run: { id: 'r/4', status: 'running', effectiveStatus: 'failed' }, items: [], findings: [] }),
    });
    const detail = await api.fetchQaRun('r/4');
    expect(httpMock.get).toHaveBeenLastCalledWith('/api/v1/authoring/qa/runs/r%2F4');
    expect(detail.data?.run.effectiveStatus).toBe('failed');
  });

  it('keeps the server error code when a request fails', async () => {
    httpMock.post.mockRejectedValue(
      axiosFailure(429, {
        success: false,
        data: null,
        error: { code: 'AI_QA_DAILY_CAP', message: 'Daily cap reached.' },
        traceId: 't-1',
      }),
    );

    const res = await api.startQaRun({ deckId: 7, scope: 'changed' });
    expect(res.success).toBe(false);
    expect(res.error).toMatchObject({ code: 'AI_QA_DAILY_CAP', message: 'Daily cap reached.', httpStatus: 429 });
  });

  it('reports BAD_RESPONSE when the run detail is malformed', async () => {
    httpMock.get.mockResolvedValue({ data: ok({ run: { status: 'done' }, items: [], findings: [] }) });
    const res = await api.fetchQaRun('r-1');
    expect(res.success).toBe(false);
    expect(res.error?.code).toBe('BAD_RESPONSE');

    httpMock.get.mockResolvedValue({ data: ok({ run: { id: 'r-1', status: 'done' } }) });
    expect((await api.fetchQaRun('r-1')).error?.code).toBe('BAD_RESPONSE');
  });
});
