// What src/api/usage.ts sends and keeps (R20 contract §7: analytics/usage and
// automation/freshness), below every page-level mock. src/api/http is replaced
// wholesale, as in cardReportsApi.test.ts, so nothing here can leave the process.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AxiosError, AxiosHeaders } from 'axios';

import { ok } from './support/apiResult';

const httpMock = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock('../src/api/http', () => ({ http: httpMock }));

const api = await import('../src/api/usage');

function httpError(status: number, data: unknown): AxiosError {
  const config = { headers: new AxiosHeaders() };
  return new AxiosError('Request failed', 'ERR_BAD_RESPONSE', config, null, {
    status,
    statusText: '',
    headers: {},
    config,
    data,
  });
}

beforeEach(() => {
  httpMock.get.mockReset();
});

describe('fetchUsage', () => {
  it('reads GET /api/v1/admin/analytics/usage?days=30 and coerces every figure', async () => {
    httpMock.get.mockResolvedValueOnce({
      data: ok({
        days: [
          {
            day: '2026-09-30',
            dau: '12',
            wau: 30,
            mau: 55,
            reviews: '480',
            newUsers: 3,
            cardsLearned: 41,
            d1Retention: '0.3333',
            d7Retention: null,
          },
          { day: '2026-09-29', dau: 10 },
          { dau: 99 },
          'junk',
        ],
        decks: [
          { deckSlug: 'aws-saa-c03', activeUsers30d: '20', reviews30d: 900, newLearners30d: null },
          { activeUsers30d: 1 },
        ],
        excludedSubsCount: '2',
        lastComputedAt: '2026-10-01T00:05:00Z',
      }),
    });
    const res = await api.fetchUsage();
    expect(httpMock.get).toHaveBeenCalledWith('/api/v1/admin/analytics/usage', { params: { days: 30 } });
    expect(res.success).toBe(true);
    expect(res.data?.days).toEqual([
      {
        day: '2026-09-30',
        dau: 12,
        wau: 30,
        mau: 55,
        reviews: 480,
        newUsers: 3,
        cardsLearned: 41,
        d1Retention: 0.3333,
        d7Retention: null,
      },
      {
        day: '2026-09-29',
        dau: 10,
        wau: null,
        mau: null,
        reviews: null,
        newUsers: null,
        cardsLearned: null,
        d1Retention: null,
        d7Retention: null,
      },
    ]);
    expect(res.data?.decks).toEqual([
      { deckSlug: 'aws-saa-c03', activeUsers30d: 20, reviews30d: 900, newLearners30d: null },
    ]);
    expect(res.data?.excludedSubsCount).toBe(2);
    expect(res.data?.lastComputedAt).toBe('2026-10-01T00:05:00Z');
  });

  it('passes the window through and tolerates a missing deck list', async () => {
    httpMock.get.mockResolvedValueOnce({ data: ok({ days: [] }) });
    const res = await api.fetchUsage(7);
    expect(httpMock.get).toHaveBeenCalledWith('/api/v1/admin/analytics/usage', { params: { days: 7 } });
    expect(res.data).toEqual({ days: [], decks: [], excludedSubsCount: 0, lastComputedAt: null });
  });

  it('keeps the server code of a 503 NOT_READY and never throws', async () => {
    httpMock.get.mockRejectedValueOnce(
      httpError(503, { success: false, data: null, error: { code: 'NOT_READY', message: 'Run the database migration' }, traceId: 't' }),
    );
    const res = await api.fetchUsage();
    expect(res.success).toBe(false);
    expect(res.error?.code).toBe('NOT_READY');
    expect(res.error?.message).toBe('Run the database migration');
  });

  it('refuses a payload without a days array', async () => {
    httpMock.get.mockResolvedValueOnce({ data: ok({ days: 'soon' }) });
    const res = await api.fetchUsage();
    expect(res.success).toBe(false);
    expect(res.error?.code).toBe('BAD_RESPONSE');
  });
});

describe('fetchFreshness', () => {
  it('reads GET /api/v1/admin/automation/freshness?days=30 with its medians', async () => {
    httpMock.get.mockResolvedValueOnce({
      data: ok({
        items: [
          {
            kind: 'feed',
            refId: 88,
            title: 'Lambda adds a runtime',
            detectedAt: '2026-09-20T10:00:00Z',
            queuedAt: '2026-09-20T10:01:00Z',
            draftedAt: '2026-09-20T11:00:00Z',
            decidedAt: null,
            publishedAt: null,
          },
          { kind: 'page', refId: 'e-5', title: null },
          { kind: 'page' },
        ],
        medians: { minutesToDraft: '59', minutesToDecision: null, minutesToPublish: 180.5 },
        n: '4',
      }),
    });
    const res = await api.fetchFreshness();
    expect(httpMock.get).toHaveBeenCalledWith('/api/v1/admin/automation/freshness', { params: { days: 30 } });
    expect(res.data?.items).toEqual([
      {
        kind: 'feed',
        refId: '88',
        title: 'Lambda adds a runtime',
        detectedAt: '2026-09-20T10:00:00Z',
        queuedAt: '2026-09-20T10:01:00Z',
        draftedAt: '2026-09-20T11:00:00Z',
        decidedAt: null,
        publishedAt: null,
      },
      {
        kind: 'page',
        refId: 'e-5',
        title: null,
        detectedAt: null,
        queuedAt: null,
        draftedAt: null,
        decidedAt: null,
        publishedAt: null,
      },
    ]);
    expect(res.data?.medians).toEqual({ minutesToDraft: 59, minutesToDecision: null, minutesToPublish: 180.5 });
    expect(res.data?.n).toBe(4);
  });

  it('passes a refusal through and refuses a payload without items', async () => {
    httpMock.get.mockResolvedValueOnce({
      data: { success: false, data: null, error: { code: 'NOT_READY', message: 'x' }, traceId: 't' },
    });
    expect((await api.fetchFreshness()).error?.code).toBe('NOT_READY');

    httpMock.get.mockResolvedValueOnce({ data: ok({ medians: {} }) });
    expect((await api.fetchFreshness()).error?.code).toBe('BAD_RESPONSE');

    httpMock.get.mockRejectedValueOnce(new Error('offline'));
    const offline = await api.fetchFreshness();
    expect(offline.success).toBe(false);
  });
});

describe('latestUsageDay', () => {
  it('picks the latest day whatever the order, and null for none', () => {
    const day = (d: string) => ({
      day: d,
      dau: 1,
      wau: 1,
      mau: 1,
      reviews: 1,
      newUsers: 1,
      cardsLearned: 1,
      d1Retention: null,
      d7Retention: null,
    });
    expect(api.latestUsageDay([day('2026-09-28'), day('2026-09-30'), day('2026-09-29')])?.day).toBe('2026-09-30');
    expect(api.latestUsageDay([])).toBeNull();
  });
});
