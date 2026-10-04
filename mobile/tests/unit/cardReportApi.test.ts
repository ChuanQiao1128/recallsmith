import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/api/apiClient', () => ({ apiJson: vi.fn() }));
vi.mock('../../src/auth/freshToken', () => ({ getFreshAccessToken: vi.fn() }));
const authState = vi.hoisted(() => ({ status: 'signed_in' as string }));
vi.mock('../../src/auth/authStore', () => ({ useAuthStore: { getState: () => authState } }));

import { apiJson } from '../../src/api/apiClient';
import { FRIENDLY_ERROR_COPY } from '../../src/api/errorKind';
import { getFreshAccessToken } from '../../src/auth/freshToken';
import { applyRemoteFeatures } from '../../src/config/featureFlags';
import { DEFAULT_API_BASE, FALLBACK_API_BASE } from '../../src/config/hosts';
import type { RemoteConfig } from '../../src/config/remoteConfig';
import {
  ANONYMOUS_CARD_REPORTS_PATH,
  CARD_REPORT_COPY,
  CARD_REPORT_NOTE_MAX,
  CARD_REPORTS_PATH,
  CardReportSignedOutError,
  anonymousCardReportErrorMessage,
  anonymousCardReportsEnabled,
  cardReportErrorMessage,
  getCardReportAuth,
  listMyCardReports,
  submitAnonymousCardReport,
  submitCardReport,
} from '../../src/features/cardReport/cardReportApi';
import { scrubBreadcrumb } from '../../src/telemetry/sentryPolicy';
import { installFakeXhr } from '../setup/fakeXhr';

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
  authState.status = 'signed_in';
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
    authState.status = 'anonymous';
    vi.mocked(getFreshAccessToken).mockResolvedValue(null);
    await expect(submitCardReport({ deckSlug: 'd', stableUid: 'u', reason: 'unclear' })).rejects.toBeInstanceOf(
      CardReportSignedOutError,
    );
    expect(apiJson).not.toHaveBeenCalled();
  });
});

describe('submitCardReport without a token', () => {
  it('rejects with offline copy when signed in but the token refresh failed', async () => {
    vi.mocked(getFreshAccessToken).mockResolvedValue(null);
    const err = await submitCardReport({ deckSlug: 'd', stableUid: 'u', reason: 'typo' }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).not.toBeInstanceOf(CardReportSignedOutError);
    expect(cardReportErrorMessage(err)).toBe(FRIENDLY_ERROR_COPY.offline);
    expect(apiJson).not.toHaveBeenCalled();
  });

  it('is signed out when the refresh itself ended the session', async () => {
    vi.mocked(getFreshAccessToken).mockImplementation(async () => {
      authState.status = 'anonymous';
      return null;
    });
    await expect(submitCardReport({ deckSlug: 'd', stableUid: 'u', reason: 'typo' })).rejects.toBeInstanceOf(
      CardReportSignedOutError,
    );
  });
});

describe('getCardReportAuth', () => {
  it('tells a token, signed out and unavailable apart', async () => {
    expect(await getCardReportAuth()).toEqual({ kind: 'token', token: 'tok-123' });
    vi.mocked(getFreshAccessToken).mockResolvedValue(null);
    expect(await getCardReportAuth()).toEqual({ kind: 'unavailable' });
    authState.status = 'anonymous';
    expect(await getCardReportAuth()).toEqual({ kind: 'signed_out' });
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
    authState.status = 'anonymous';
    vi.mocked(getFreshAccessToken).mockResolvedValue(null);
    await expect(listMyCardReports()).rejects.toBeInstanceOf(CardReportSignedOutError);
    expect(apiJson).not.toHaveBeenCalled();
  });

  it('treats a signed-in learner whose token refresh failed as offline, not signed out', async () => {
    vi.mocked(getFreshAccessToken).mockResolvedValue(null);
    const err = await listMyCardReports().then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).not.toBeInstanceOf(CardReportSignedOutError);
    expect(cardReportErrorMessage(err)).toBe(FRIENDLY_ERROR_COPY.offline);
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

describe('anonymous card reports (R28 ANONREPORT)', () => {
  let xhr: ReturnType<typeof installFakeXhr>;

  beforeEach(() => {
    xhr = installFakeXhr();
    authState.status = 'anonymous';
    vi.mocked(getFreshAccessToken).mockResolvedValue(null);
  });

  afterEach(() => {
    xhr.restore();
    applyRemoteFeatures(null);
  });

  it('is off unless features.cardReport.anonymous is true', () => {
    expect(anonymousCardReportsEnabled()).toBe(false);
    applyRemoteFeatures({ features: { cardReport: { enabled: true } } } as unknown as RemoteConfig);
    expect(anonymousCardReportsEnabled()).toBe(false);
    applyRemoteFeatures({ features: { cardReport: { enabled: true, anonymous: true } } } as unknown as RemoteConfig);
    expect(anonymousCardReportsEnabled()).toBe(true);
  });

  it('POSTs exactly the four structured fields to the public route, with no token, trace or Sentry header', async () => {
    await submitAnonymousCardReport({ deckSlug: 'csharp-basics', stableUid: 'cs-1', reason: 'wrong_answer', appVersion: '2.0.0' });

    expect(ANONYMOUS_CARD_REPORTS_PATH).toBe('/api/v1/public/card-reports');
    expect(xhr.sent).toHaveLength(1);
    const [request] = xhr.sent;
    expect(request.method).toBe('POST');
    expect(request.url).toBe(`${DEFAULT_API_BASE}/api/v1/public/card-reports`);
    expect(request.headers).toEqual({ 'content-type': 'application/json' });
    // Sentry's XHR instrumentation skips a request with this flag: no span, no sentry-trace/baggage.
    expect(request.sentryOwnRequest).toBe(true);
    // The flag does not stop Sentry's xhr breadcrumb; beforeBreadcrumb (scrubBreadcrumb) drops it (ANONREPORT-R1).
    expect(scrubBreadcrumb({ category: 'xhr', data: { method: request.method, url: request.url, status_code: 202 } })).toBeNull();
    expect(request.timeout).toBe(15000);
    expect(JSON.parse(request.body)).toEqual({ deckSlug: 'csharp-basics', stableUid: 'cs-1', reason: 'wrong_answer', appVersion: '2.0.0' });
    // Never the signed-in client, never a token lookup.
    expect(apiJson).not.toHaveBeenCalled();
    expect(getFreshAccessToken).not.toHaveBeenCalled();
  });

  it('sends nothing but those fields even when handed more', async () => {
    const input = { deckSlug: 'd', stableUid: 'u', reason: 'typo', appVersion: '2.0.0', note: 'free text', userSub: 'sub-1' } as const;
    await submitAnonymousCardReport(input as unknown as Parameters<typeof submitAnonymousCardReport>[0]);
    expect(Object.keys(JSON.parse(xhr.sent[0].body)).sort()).toEqual(['appVersion', 'deckSlug', 'reason', 'stableUid']);
  });

  it('moves to the fallback host only after a network failure', async () => {
    xhr.queue('offline', 202);
    await submitAnonymousCardReport({ deckSlug: 'd', stableUid: 'u', reason: 'typo', appVersion: '2.0.0' });
    expect(xhr.sent.map((r) => r.url)).toEqual([
      `${DEFAULT_API_BASE}/api/v1/public/card-reports`,
      `${FALLBACK_API_BASE}/api/v1/public/card-reports`,
    ]);

    xhr.sent.length = 0;
    xhr.queue(429);
    const err = await submitAnonymousCardReport({ deckSlug: 'd', stableUid: 'u', reason: 'typo', appVersion: '2.0.0' }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(xhr.sent).toHaveLength(1);
    expect(anonymousCardReportErrorMessage(err)).toBe(CARD_REPORT_COPY.anonymousBusy);
  });

  it('maps failures to copy that never blames the learner for a global cap', () => {
    expect(anonymousCardReportErrorMessage(httpError(429, null))).toBe('Too many reports right now. Please try again later.');
    expect(anonymousCardReportErrorMessage(httpError(503, null))).toBe(CARD_REPORT_COPY.unavailable);
    // The public route not live yet: the gateway's signed-in catch-all answers 401.
    expect(anonymousCardReportErrorMessage(httpError(401, null))).toBe(CARD_REPORT_COPY.unavailable);
    expect(anonymousCardReportErrorMessage(httpError(404, null))).toBe(CARD_REPORT_COPY.notFound);
    expect(anonymousCardReportErrorMessage(httpError(400, null))).toBe(CARD_REPORT_COPY.rejected);
    expect(anonymousCardReportErrorMessage(httpError(413, null))).toBe(CARD_REPORT_COPY.rejected);
    expect(anonymousCardReportErrorMessage(Object.assign(new Error('Network request failed'), { kind: 'offline' }))).toBe(
      FRIENDLY_ERROR_COPY.offline,
    );
    expect(anonymousCardReportErrorMessage(Object.assign(new Error('Request timed out'), { kind: 'timeout' }))).toBe(
      FRIENDLY_ERROR_COPY.timeout,
    );
  });
});
