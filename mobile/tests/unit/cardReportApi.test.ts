import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/api/apiClient', () => ({ apiJson: vi.fn() }));
vi.mock('../../src/auth/freshToken', () => ({ getFreshAccessToken: vi.fn() }));

import { apiJson } from '../../src/api/apiClient';
import { FRIENDLY_ERROR_COPY } from '../../src/api/errorKind';
import { getFreshAccessToken } from '../../src/auth/freshToken';
import {
  CARD_REPORT_COPY,
  CARD_REPORT_NOTE_MAX,
  CARD_REPORTS_PATH,
  CardReportSignedOutError,
  cardReportErrorMessage,
  listMyCardReports,
  submitCardReport,
} from '../../src/features/cardReport/cardReportApi';

function httpError(status: number, code: string | null = null) {
  const err: any = new Error(`HTTP ${status}`);
  err.status = status;
  err.apiErrorCode = code;
  err.kind = status >= 500 || status === 429 ? 'server' : 'content';
  return err;
}

beforeEach(() => {
  vi.mocked(apiJson).mockReset();
  vi.mocked(getFreshAccessToken).mockReset();
  vi.mocked(getFreshAccessToken).mockResolvedValue('tok-123');
});

describe('submitCardReport', () => {
  it('POSTs the learner route with the fresh token and the contract body', async () => {
    vi.mocked(apiJson).mockResolvedValue({ success: true, data: { reportId: 7, status: 'open', duplicate: false } });

    const out = await submitCardReport({
      deckSlug: 'csharp',
      stableUid: 'cs-1',
      reason: 'wrong_answer',
      note: '  The answer mixes up Dispose and Finalize.  ',
      clientVersion: '1.9.0',
    });

    expect(CARD_REPORTS_PATH).toBe('/api/v1/user/card-reports');
    expect(apiJson).toHaveBeenCalledTimes(1);
    expect(apiJson).toHaveBeenCalledWith('/api/v1/user/card-reports', {
      method: 'POST',
      accessToken: 'tok-123',
      body: {
        deckSlug: 'csharp',
        stableUid: 'cs-1',
        reason: 'wrong_answer',
        note: 'The answer mixes up Dispose and Finalize.',
        clientVersion: '1.9.0',
      },
      timeoutMs: 15000,
    });
    expect(out).toEqual({ reportId: 7, status: 'open', duplicate: false });
  });

  it('omits a blank note and caps a long one at 500 characters', async () => {
    vi.mocked(apiJson).mockResolvedValue({ reportId: 8, status: 'open', duplicate: true });

    const out = await submitCardReport({ deckSlug: 'd', stableUid: 'u', reason: 'typo', note: '   ' });
    expect(vi.mocked(apiJson).mock.calls[0][1].body).toEqual({ deckSlug: 'd', stableUid: 'u', reason: 'typo' });
    expect(out.duplicate).toBe(true);

    await submitCardReport({ deckSlug: 'd', stableUid: 'u', reason: 'other', note: 'x'.repeat(600) });
    expect(vi.mocked(apiJson).mock.calls[1][1].body.note).toHaveLength(CARD_REPORT_NOTE_MAX);
    expect(CARD_REPORT_NOTE_MAX).toBe(500);
  });

  it('throws CardReportSignedOutError without calling the API when there is no token', async () => {
    vi.mocked(getFreshAccessToken).mockResolvedValue(null);
    await expect(submitCardReport({ deckSlug: 'd', stableUid: 'u', reason: 'unclear' })).rejects.toBeInstanceOf(
      CardReportSignedOutError,
    );
    expect(apiJson).not.toHaveBeenCalled();
  });
});

describe('listMyCardReports', () => {
  it('GETs the learner route with limit=50 and the fresh token, and normalises items', async () => {
    vi.mocked(apiJson).mockResolvedValue({
      success: true,
      data: {
        items: [
          {
            reportId: 3,
            deckSlug: 'csharp',
            stableUid: 'cs-1',
            question: 'What does using do?',
            reason: 'outdated',
            status: 'resolved',
            resolution: 'fixed',
            resolutionNote: 'Updated for .NET 8',
            createdAt: '2026-09-30T10:00:00Z',
            resolvedAt: '2026-10-01T10:00:00Z',
          },
          { reportId: 'bad' },
        ],
      },
    });

    const items = await listMyCardReports();

    expect(apiJson).toHaveBeenCalledWith('/api/v1/user/card-reports?limit=50', {
      method: 'GET',
      accessToken: 'tok-123',
      timeoutMs: 15000,
    });
    expect(items).toEqual([
      {
        reportId: 3,
        deckSlug: 'csharp',
        stableUid: 'cs-1',
        question: 'What does using do?',
        reason: 'outdated',
        status: 'resolved',
        resolution: 'fixed',
        resolutionNote: 'Updated for .NET 8',
        createdAt: '2026-09-30T10:00:00Z',
        resolvedAt: '2026-10-01T10:00:00Z',
      },
    ]);
  });

  it('returns an empty list for an empty or unexpected payload', async () => {
    vi.mocked(apiJson).mockResolvedValue({ items: [] });
    expect(await listMyCardReports()).toEqual([]);
    vi.mocked(apiJson).mockResolvedValue(null);
    expect(await listMyCardReports()).toEqual([]);
  });

  it('throws CardReportSignedOutError when signed out', async () => {
    vi.mocked(getFreshAccessToken).mockResolvedValue(null);
    await expect(listMyCardReports()).rejects.toBeInstanceOf(CardReportSignedOutError);
    expect(apiJson).not.toHaveBeenCalled();
  });
});

describe('cardReportErrorMessage', () => {
  it('maps 429 and 503 to report copy', () => {
    expect(cardReportErrorMessage(httpError(429, 'REPORT_DAILY_LIMIT'))).toBe("You have reached today's report limit");
    expect(cardReportErrorMessage(httpError(503, 'CARD_REPORTS_DISABLED'))).toBe('Reporting is unavailable right now');
    expect(cardReportErrorMessage(httpError(503, 'NOT_READY'))).toBe(CARD_REPORT_COPY.unavailable);
  });

  it('maps offline and timeout through FRIENDLY_ERROR_COPY', () => {
    const offline: any = new Error('Network request failed');
    offline.kind = 'offline';
    const timeout: any = new Error('aborted');
    timeout.kind = 'timeout';
    expect(cardReportErrorMessage(offline)).toBe(FRIENDLY_ERROR_COPY.offline);
    expect(cardReportErrorMessage(timeout)).toBe(FRIENDLY_ERROR_COPY.timeout);
  });

  it('maps signed-out, missing card and other failures to friendly copy', () => {
    expect(cardReportErrorMessage(new CardReportSignedOutError())).toBe('Sign in to report a problem');
    expect(cardReportErrorMessage(httpError(404, 'CARD_NOT_FOUND'))).toBe(CARD_REPORT_COPY.notFound);
    expect(cardReportErrorMessage(httpError(500))).toBe(FRIENDLY_ERROR_COPY.server);
    expect(cardReportErrorMessage('weird')).toBe(FRIENDLY_ERROR_COPY.unknown);
  });
});
