// @vitest-environment jsdom
//
// Drives a real non-2xx response through the real `http` axios instance, so it
// exercises the exact rejection axios produces (an AxiosError built by
// settle()) rather than a hand-shaped stand-in. Both api modules must convert
// that rejection with apiResultFromError, keeping the server's envelope (code +
// traceId + httpStatus) for 4xx/5xx and classifying transport failures.
//
// The adapter must REJECT for a 4xx/5xx: axios only rejects a non-2xx status
// when the adapter does, and every recovery this fix unblocks
// (VERSION_CONFLICT, the import re-run hint, trace ids on failure screens) lives
// on the rejection path.

import { afterEach, describe, expect, it } from 'vitest';
import { AxiosError, type InternalAxiosRequestConfig } from 'axios';

import { http } from '../src/api/http';
import { updateCard, fetchAdminDecksPage } from '../src/api/authoring';
import { listAdminDecks } from '../src/api/admin';
import { apiResultFromError } from '../src/api/httpFailure';

const realAdapter = http.defaults.adapter;

/**
 * Reject with the AxiosError axios's own settle() builds for a non-2xx
 * response — the shape every caller sees in production.
 */
function rejectWithResponse(status: number, statusText: string, data: unknown) {
  http.defaults.adapter = (config: InternalAxiosRequestConfig) =>
    Promise.reject(
      new AxiosError(
        `Request failed with status code ${status}`,
        AxiosError.ERR_BAD_REQUEST,
        config,
        null,
        { data, status, statusText, headers: {}, config },
      ),
    );
}

/** Reject with a transport-level AxiosError that carries no response. */
function rejectWithoutResponse(message: string, code: string) {
  http.defaults.adapter = (config: InternalAxiosRequestConfig) =>
    Promise.reject(new AxiosError(message, code, config));
}

afterEach(() => {
  http.defaults.adapter = realAdapter;
});

describe('apiResultFromError through the real http instance', () => {
  it('keeps VERSION_CONFLICT and the traceId when updateCard is refused with HTTP 400', async () => {
    rejectWithResponse(400, 'Bad Request', {
      success: false,
      data: null,
      error: { code: 'VERSION_CONFLICT', message: 'This card changed since you opened it.' },
      traceId: 'trace-vc-400',
      version: '1',
    });

    const result = await updateCard({ id: 7, deckId: 3, expectedVersion: 1 });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('VERSION_CONFLICT');
    expect(result.error?.message).toBe('This card changed since you opened it.');
    expect(result.traceId).toBe('trace-vc-400');
    expect(result.error?.httpStatus).toBe(400);
  });

  it('keeps FORBIDDEN and the traceId when an admin request is refused with HTTP 403', async () => {
    rejectWithResponse(403, 'Forbidden', {
      success: false,
      data: null,
      error: { code: 'FORBIDDEN', message: 'You do not have access to this deck.' },
      traceId: 'trace-forbidden-403',
    });

    const result = await listAdminDecks();

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('FORBIDDEN');
    expect(result.error?.message).toBe('You do not have access to this deck.');
    expect(result.traceId).toBe('trace-forbidden-403');
    expect(result.error?.httpStatus).toBe(403);
  });

  it('keeps PAYLOAD_TOO_LARGE from a 413 envelope', async () => {
    rejectWithResponse(413, 'Payload Too Large', {
      success: false,
      data: null,
      error: { code: 'PAYLOAD_TOO_LARGE', message: 'The request body is too large.' },
      traceId: 'trace-413',
    });

    const result = await updateCard({ id: 7, deckId: 3, expectedVersion: 1 });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('PAYLOAD_TOO_LARGE');
    expect(result.error?.message).toBe('The request body is too large.');
    expect(result.traceId).toBe('trace-413');
    expect(result.error?.httpStatus).toBe(413);
  });

  it('reports a non-envelope HTTP 502 as HTTP_502 with its status', async () => {
    rejectWithResponse(502, 'Bad Gateway', '<html><body>502 Bad Gateway</body></html>');

    const result = await updateCard({ id: 7, deckId: 3, expectedVersion: 1 });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('HTTP_502');
    expect(result.error?.httpStatus).toBe(502);
    expect(result.traceId).toBe('');
  });

  it('reports a timeout as TIMEOUT', async () => {
    rejectWithoutResponse('timeout of 15000ms exceeded', 'ECONNABORTED');

    const result = await updateCard({ id: 7, deckId: 3, expectedVersion: 1 });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('TIMEOUT');
    expect(result.error?.message).toBe('The request timed out.');
  });

  it('reports a dropped connection as NETWORK_ERROR', async () => {
    rejectWithoutResponse('Network Error', AxiosError.ERR_NETWORK);

    const result = await updateCard({ id: 7, deckId: 3, expectedVersion: 1 });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('NETWORK_ERROR');
  });

  it('still maps a 404 from the paged deck endpoint to ENDPOINT_NOT_FOUND', async () => {
    rejectWithResponse(404, 'Not Found', '<html><body>404 Not Found</body></html>');

    const result = await fetchAdminDecksPage();

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('ENDPOINT_NOT_FOUND');
  });

  it('keeps the message of a plain Error as NETWORK_ERROR', () => {
    const result = apiResultFromError(new Error('Your session expired. Please sign in again.'));

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('NETWORK_ERROR');
    expect(result.error?.message).toBe('Your session expired. Please sign in again.');
  });
});
