import { describe, expect, it } from 'vitest';

import {
  FRIENDLY_ERROR_COPY,
  type AppErrorKind,
  classifyError,
  errorToMessage,
  friendlyErrorMessage,
  safeErrorText,
} from '../../src/api/errorKind';

describe('errorKind', () => {
  it('classifies fetch transport failures as offline', () => {
    expect(classifyError(new TypeError('Network request failed'))).toBe('offline');
    expect(classifyError(new Error('Failed to fetch'))).toBe('offline');
    expect(classifyError(new Error('getaddrinfo ENOTFOUND api.test'))).toBe('offline');
    expect(classifyError({ kind: 'offline' })).toBe('offline');
  });

  it('classifies aborted requests as timeout', () => {
    const aborted = new Error('The operation was aborted');
    aborted.name = 'AbortError';
    expect(classifyError(aborted)).toBe('timeout');
    expect(classifyError(new Error('Request timed out'))).toBe('timeout');
    expect(classifyError({ status: 408 })).toBe('timeout');
  });

  it('classifies 401 and 403 as auth', () => {
    expect(classifyError({ status: 401 })).toBe('auth');
    expect(classifyError({ status: 403 })).toBe('auth');
    const notAuth = new Error('no session');
    notAuth.name = 'NotAuthorizedException';
    expect(classifyError(notAuth)).toBe('auth');
  });

  it('classifies 5xx and deck download failures by status', () => {
    expect(classifyError({ status: 503 })).toBe('server');
    expect(classifyError(new Error('download_failed_http_404: <html>'))).toBe('content');
    expect(classifyError(new Error('download_failed_http_502'))).toBe('server');
    expect(classifyError({ status: 429 })).toBe('server');
  });

  it('classifies malformed deck content as content', () => {
    const syntax = new SyntaxError('Unexpected token < in JSON at position 0');
    expect(classifyError(syntax)).toBe('content');
    expect(classifyError(new Error('sha256 checksum mismatch'))).toBe('content');
    expect(classifyError(new Error('invalid deck payload'))).toBe('content');
  });

  it('never renders [object Object] for object errors', () => {
    const text = safeErrorText({ code: 'X' });
    expect(text).toContain('X');
    expect(text).not.toBe('[object Object]');
    expect(safeErrorText('plain string')).toBe('plain string');
    expect(safeErrorText(new Error('boom'))).toBe('boom');
    expect(safeErrorText(null)).toBe('');
    expect(safeErrorText(undefined)).toBe('');

    // A circular object cannot be JSON.stringify'd; safeErrorText must still
    // return a string via the guarded fallback rather than throwing.
    const circular: any = { code: 'X' };
    circular.self = circular;
    expect(typeof safeErrorText(circular)).toBe('string');
  });

  it('maps every kind to friendly copy', () => {
    const kinds: AppErrorKind[] = ['offline', 'timeout', 'auth', 'server', 'content', 'unknown'];
    for (const kind of kinds) {
      expect(friendlyErrorMessage(kind)).toBe(FRIENDLY_ERROR_COPY[kind]);
      expect(friendlyErrorMessage(kind).length).toBeGreaterThan(0);
    }
    expect(errorToMessage({})).toBe(FRIENDLY_ERROR_COPY.unknown);
    expect(errorToMessage(new TypeError('Network request failed'))).toBe(FRIENDLY_ERROR_COPY.offline);
  });
});
