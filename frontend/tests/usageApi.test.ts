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

// The exact payload AnonFunnel.HandleFunnel sends (src_C/Vpc/Analytics/AnonFunnel.cs, pinned by
// AnonFunnelTests): property names camelCase, count/conversion keys the snake_case event names, every
// event present (0 when none), and byDeck holding only rows with a deck slug (the query filters nulls).
function serverCounts(events: readonly string[], values: Record<string, number> = {}): Record<string, number> {
  return Object.fromEntries(events.map(e => [e, values[e] ?? 0]));
}

function serverFunnel() {
  const events = api.FUNNEL_EVENTS;
  const deckEvents = api.FUNNEL_DECK_EVENTS;
  return {
    days: 90,
    fromCohortDay: '2026-07-04',
    events: [...events],
    overall: {
      counts: serverCounts(events, { first_open: 40, goal_chosen: 30, starter_started: 20 }),
      conversion: { goal_chosen: 0.75, starter_started: 0.5 },
    },
    weeks: [
      { weekStart: '2026-09-21', counts: serverCounts(events, { first_open: 10, goal_chosen: 8 }), conversion: {} },
      { weekStart: '2026-09-28', counts: serverCounts(events, { first_open: 4, returned_day_1: 2 }), conversion: {} },
    ],
    byDeck: [
      { deckSlug: 'aws-saa-c03', counts: serverCounts(deckEvents, { goal_chosen: 12, starter_started: 9 }) },
      { deckSlug: 'csharp-basics', counts: serverCounts(deckEvents, { goal_chosen: 3, starter_completed: 1 }) },
    ],
  };
}

describe('fetchFunnel', () => {
  it('reads GET /api/v1/admin/analytics/funnel?days=90 in the exact shape the server sends', async () => {
    httpMock.get.mockResolvedValueOnce({ data: ok(serverFunnel()) });
    const res = await api.fetchFunnel();
    expect(httpMock.get).toHaveBeenCalledWith('/api/v1/admin/analytics/funnel', { params: { days: 90 } });
    expect(res.success).toBe(true);
    expect(res.data?.days).toBe(90);
    expect(res.data?.overall).toEqual({
      first_open: 40,
      goal_chosen: 30,
      starter_started: 20,
      starter_completed: 0,
      first_pack_opened: 0,
      returned_day_1: 0,
      returned_day_7: 0,
      signup_started: 0,
      signup_completed: 0,
    });
    expect(res.data?.weeks.map(w => [w.weekStart, w.counts.first_open, w.counts.goal_chosen, w.counts.returned_day_1])).toEqual([
      ['2026-09-21', 10, 8, 0],
      ['2026-09-28', 4, 0, 2],
    ]);
    expect(res.data?.decks).toEqual([
      { deckSlug: 'aws-saa-c03', counts: { goal_chosen: 12, starter_started: 9, starter_completed: 0, first_pack_opened: 0 } },
      { deckSlug: 'csharp-basics', counts: { goal_chosen: 3, starter_started: 0, starter_completed: 1, first_pack_opened: 0 } },
    ]);
  });

  it('coerces numeric strings and keeps a null count as null', async () => {
    const payload = serverFunnel();
    payload.overall.counts = { ...payload.overall.counts, first_open: '40', signup_completed: null } as never;
    httpMock.get.mockResolvedValueOnce({ data: ok(payload) });
    const res = await api.fetchFunnel(30);
    expect(httpMock.get).toHaveBeenCalledWith('/api/v1/admin/analytics/funnel', { params: { days: 30 } });
    expect(res.data?.overall.first_open).toBe(40);
    expect(res.data?.overall.signup_completed).toBeNull();
  });

  it('reads an empty table as an empty funnel', async () => {
    const payload = { ...serverFunnel(), weeks: [], byDeck: [] };
    payload.overall = { counts: serverCounts(api.FUNNEL_EVENTS), conversion: {} as never };
    httpMock.get.mockResolvedValueOnce({ data: ok(payload) });
    const res = await api.fetchFunnel();
    expect(res.success).toBe(true);
    expect(res.data?.overall.first_open).toBe(0);
    expect(res.data?.weeks).toEqual([]);
    expect(res.data?.decks).toEqual([]);
  });

  it.each([
    ['camelCase count keys', { overall: { counts: { firstOpen: 40, goalChosen: 30 } } }],
    ['flat counts on overall', { overall: serverCounts(api.FUNNEL_EVENTS, { first_open: 40 }) }],
    ['an [{event,count}] list for overall', { overall: [{ event: 'first_open', count: 40 }] }],
    ['no overall', { overall: undefined }],
    ['no weeks', { weeks: undefined }],
    ['no byDeck', { byDeck: undefined }],
    ['decks instead of byDeck', { byDeck: undefined, decks: serverFunnel().byDeck }],
    ['a week keyed cohortWeek', { weeks: [{ cohortWeek: '2026-09-21', counts: serverCounts(api.FUNNEL_EVENTS) }] }],
    ['a week with flat counts', { weeks: [{ weekStart: '2026-09-21', ...serverCounts(api.FUNNEL_EVENTS) }] }],
    ['a deck without a slug', { byDeck: [{ deckSlug: null, counts: serverCounts(api.FUNNEL_DECK_EVENTS) }] }],
    ['a deck with camelCase counts', { byDeck: [{ deckSlug: 'aws-saa-c03', counts: { goalChosen: 1 } }] }],
  ])('refuses a payload with %s as BAD_RESPONSE, never an empty funnel', async (_label, patch) => {
    httpMock.get.mockResolvedValueOnce({ data: ok({ ...serverFunnel(), ...patch }) });
    const res = await api.fetchFunnel();
    expect(res.success).toBe(false);
    expect(res.data).toBeNull();
    expect(res.error?.code).toBe('BAD_RESPONSE');
  });

  it('keeps the server code of a 503 NOT_READY and of a 404, refuses a shapeless payload and never throws', async () => {
    httpMock.get.mockRejectedValueOnce(
      httpError(503, { success: false, data: null, error: { code: 'NOT_READY', message: 'Run migration 043' }, traceId: 't' }),
    );
    const notReady = await api.fetchFunnel();
    expect(notReady.success).toBe(false);
    expect(notReady.error?.code).toBe('NOT_READY');

    httpMock.get.mockRejectedValueOnce(
      httpError(404, { success: false, data: null, error: { code: 'NOT_FOUND', message: 'Route not found' }, traceId: 't' }),
    );
    const missing = await api.fetchFunnel();
    expect(missing.error?.code).toBe('NOT_FOUND');
    expect(missing.error?.message).toBe('Route not found');

    httpMock.get.mockResolvedValueOnce({ data: ok({ weeks: 'soon' }) });
    expect((await api.fetchFunnel()).error?.code).toBe('BAD_RESPONSE');

    httpMock.get.mockRejectedValueOnce(new Error('offline'));
    expect((await api.fetchFunnel()).success).toBe(false);
  });
});
