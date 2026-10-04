// What src/api/cardReports.ts sends and keeps (R20 contract §4, console routes),
// below every page-level mock. src/api/http is replaced wholesale, as in
// webhooksApi.test.ts, so nothing here can leave the process.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AxiosError, AxiosHeaders } from 'axios';

import { ok } from './support/apiResult';

const httpMock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
}));

vi.mock('../src/api/http', () => ({ http: httpMock }));

const api = await import('../src/api/cardReports');

const WIRE = {
  reportId: 41,
  deckId: 7,
  deckSlug: 'aws-saa-c03',
  cardId: 1203,
  stableUid: 'aws-saa-c03-0042',
  question: 'Which S3 storage class suits infrequent access?',
  reason: 'outdated',
  note: 'The answer names a retired tier.',
  status: 'open',
  resolution: null,
  resolutionNote: null,
  clientVersion: '1.10.0',
  createdAt: '2026-09-30T10:00:00Z',
  resolvedAt: null,
  anonymous: false,
};

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
  for (const fn of Object.values(httpMock)) fn.mockReset();
});

describe('src/api/cardReports', () => {
  it('lists reports from GET /api/v1/admin/card-reports with only the filters that are set', async () => {
    httpMock.get.mockResolvedValueOnce({ data: ok({ items: [WIRE], nextCursor: 'c2' }) });
    const res = await api.listCardReports({ status: 'open' });
    expect(httpMock.get).toHaveBeenCalledWith('/api/v1/admin/card-reports', {
      params: { status: 'open', limit: 50 },
    });
    expect(res.success).toBe(true);
    expect(res.data).toEqual({ items: [WIRE], nextCursor: 'c2' });

    httpMock.get.mockResolvedValueOnce({ data: ok({ items: [] }) });
    const next = await api.listCardReports({ status: 'all', deckId: 7, cursor: 'c2', limit: 20 });
    expect(httpMock.get).toHaveBeenLastCalledWith('/api/v1/admin/card-reports', {
      params: { status: 'all', deckId: 7, cursor: 'c2', limit: 20 },
    });
    expect(next.data).toEqual({ items: [], nextCursor: null });
  });

  it('normalises each row defensively and drops rows without a report id', async () => {
    httpMock.get.mockResolvedValueOnce({
      data: ok({
        items: [
          { ...WIRE, note: 'x'.repeat(900), reason: 42, status: 'weird', question: null, userSub: 'u-1', email: 'a@b.c' },
          { deckSlug: 'no-id' },
          'junk',
        ],
        nextCursor: '',
      }),
    });
    const res = await api.listCardReports({ status: 'open' });
    expect(res.success).toBe(true);
    const [row, ...rest] = res.data!.items;
    expect(rest).toEqual([]);
    expect(row.note).toHaveLength(api.CARD_REPORT_NOTE_MAX);
    expect(row.reason).toBe('other');
    expect(row.status).toBe('open');
    expect(row.question).toBe('');
    // The contract never returns a reporter; the console keeps nothing it did not ask for.
    expect(Object.keys(row)).not.toContain('userSub');
    expect(Object.keys(row)).not.toContain('email');
    expect(res.data!.nextCursor).toBeNull();
  });

  it('keeps the R28 anonymous marker only when the server says true', async () => {
    httpMock.get.mockResolvedValueOnce({
      data: ok({
        items: [
          { ...WIRE, reportId: 1, anonymous: true, note: null },
          { ...WIRE, reportId: 2, anonymous: 'true' },
          { ...WIRE, reportId: 3, anonymous: undefined },
        ],
      }),
    });
    const res = await api.listCardReports({ status: 'open' });
    expect(res.data!.items.map(r => [r.reportId, r.anonymous, r.note])).toEqual([
      [1, true, null],
      [2, false, WIRE.note],
      [3, false, WIRE.note],
    ]);
  });

  it('turns a payload without an items array into BAD_RESPONSE', async () => {
    httpMock.get.mockResolvedValueOnce({ data: ok({ rows: [] }) });
    const res = await api.listCardReports({ status: 'open' });
    expect(res.success).toBe(false);
    expect(res.error?.code).toBe('BAD_RESPONSE');
  });

  it('keeps the server envelope of a 503 NOT_READY without throwing', async () => {
    httpMock.get.mockRejectedValueOnce(
      httpError(503, { success: false, data: null, error: { code: 'NOT_READY', message: 'Run the database migration' }, traceId: 't-1' }),
    );
    const res = await api.listCardReports({ status: 'open' });
    expect(res.success).toBe(false);
    expect(res.error).toMatchObject({ code: 'NOT_READY', httpStatus: 503 });
    expect(res.traceId).toBe('t-1');
  });

  it('resolves on POST /api/v1/admin/card-reports/:id/resolve, sending the note only when set', async () => {
    httpMock.post.mockResolvedValueOnce({ data: ok({ reportId: 41, status: 'resolved', resolution: 'fixed' }) });
    const res = await api.resolveCardReport(41, { resolution: 'fixed', note: '  Rewrote the answer.  ' });
    expect(httpMock.post).toHaveBeenCalledWith('/api/v1/admin/card-reports/41/resolve', {
      resolution: 'fixed',
      note: 'Rewrote the answer.',
    });
    expect(res.data).toEqual({ reportId: 41, status: 'resolved', resolution: 'fixed' });

    httpMock.post.mockResolvedValueOnce({ data: ok({ reportId: 41, status: 'resolved', resolution: 'invalid' }) });
    await api.resolveCardReport(41, { resolution: 'invalid', note: '   ' });
    expect(httpMock.post).toHaveBeenLastCalledWith('/api/v1/admin/card-reports/41/resolve', { resolution: 'invalid' });
  });

  it('maps a malformed resolve answer to BAD_RESPONSE and a 409 to its server code', async () => {
    httpMock.post.mockResolvedValueOnce({ data: ok({ ok: true }) });
    expect((await api.resolveCardReport(41, { resolution: 'fixed' })).error?.code).toBe('BAD_RESPONSE');

    httpMock.post.mockRejectedValueOnce(
      httpError(409, { success: false, data: null, error: { code: 'ALREADY_RESOLVED', message: 'Already resolved' }, traceId: '' }),
    );
    const res = await api.resolveCardReport(41, { resolution: 'fixed' });
    expect(res.error).toMatchObject({ code: 'ALREADY_RESOLVED', httpStatus: 409 });
  });

  it('names the card editor deep link for a report', () => {
    expect(api.cardReportEditorHref({ deckId: 7, cardId: 1203 })).toBe('/decks/cards/edit?deckId=7&cardId=1203');
    expect(api.cardReportEditorHref({ deckId: null, cardId: 1203 })).toBeNull();
    expect(api.cardReportEditorHref({ deckId: 7, cardId: null })).toBeNull();
  });
});
