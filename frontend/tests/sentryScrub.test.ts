// src/lib/sentryScrub.ts: the M00 §3.3 rules, one row per case, plus the
// structural rules for events and breadcrumbs.
//
// Pure functions, so the node environment and no SDK. Every fixture is fake:
// tokens are made-up strings, emails use example.com, hosts use .invalid or
// example.com.

import { describe, expect, it } from 'vitest';

import { scrubBreadcrumb, scrubEvent, scrubString, stripQuery } from '../src/lib/sentryScrub';

const FAKE_JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.c2lnbmF0dXJl';

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

describe('scrubString', () => {
  it('redacts bearer tokens', () => {
    expect(scrubString('Authorization: Bearer abc.DEF-123_~+/=')).toBe('Authorization: Bearer [redacted]');
    expect(scrubString('sent bearer xyz789 to the API')).toBe('sent Bearer [redacted] to the API');
  });

  it('redacts JWTs', () => {
    expect(scrubString(`token was ${FAKE_JWT} here`)).toBe('token was [jwt] here');
    expect(scrubString(FAKE_JWT)).not.toContain('eyJ');
  });

  it('redacts email addresses', () => {
    expect(scrubString('no deck for someone@example.com today')).toBe('no deck for [email] today');
  });

  it('strips query strings and fragments from URLs inside text', () => {
    const signed =
      'GET https://cdn.example.invalid/decks/deck.json?Expires=1700000000&Signature=abcDEF123&Key-Pair-Id=K2EXAMPLE failed';
    const out = scrubString(signed);
    expect(out).toBe('GET https://cdn.example.invalid/decks/deck.json?[redacted] failed');
    expect(out).not.toMatch(/Expires|Signature|Key-Pair-Id/);
    expect(scrubString('see https://console.example.com/decks#section-2')).toBe(
      'see https://console.example.com/decks?[redacted]',
    );
    expect(scrubString('plain https://console.example.com/decks path')).toBe('plain https://console.example.com/decks path');
  });
});

describe('stripQuery', () => {
  it('stripQuery cuts at the first ? or #, relative URLs included', () => {
    expect(stripQuery('https://console.example.com/auth/callback?code=abc&state=x')).toBe(
      'https://console.example.com/auth/callback',
    );
    expect(stripQuery('https://console.example.com/decks#top?x=1')).toBe('https://console.example.com/decks');
    expect(stripQuery('/auth/callback?code=abc')).toBe('/auth/callback');
    expect(stripQuery('/decks#a')).toBe('/decks');
    expect(stripQuery('/decks')).toBe('/decks');
  });
});

describe('scrubEvent', () => {
  it('drops the Cognito code from /auth/callback URLs', () => {
    const out = scrubEvent({
      request: { url: 'https://console.example.com/auth/callback?code=abc123&state=s' },
      breadcrumbs: [
        {
          category: 'navigation',
          data: { from: '/auth/callback?code=abc123', to: '/decks?code=abc123#x' },
        },
        { category: 'fetch', data: { url: 'https://api.example.invalid/v1/me?code=abc123', method: 'GET' } },
      ],
      contexts: { trace: { data: { 'http.url': 'https://api.example.invalid/x?code=abc123' } } },
    });

    expect(out.request.url).toBe('https://console.example.com/auth/callback');
    expect(out.breadcrumbs[0].data).toEqual({ from: '/auth/callback', to: '/decks' });
    expect(out.breadcrumbs[1].data.url).toBe('https://api.example.invalid/v1/me');
    expect(JSON.stringify(out)).not.toContain('abc123');

    const crumb = scrubBreadcrumb({ category: 'navigation', data: { from: '/auth/callback?code=abc123', to: '/decks' } });
    expect(crumb?.data).toEqual({ from: '/auth/callback', to: '/decks' });
  });

  it('scrubEvent deletes user, cookies, query_string and request data without mutating its input', () => {
    const input = deepFreeze({
      message: 'failed for someone@example.com',
      user: { id: 'u-1', email: 'someone@example.com', ip_address: '127.0.0.1' },
      request: {
        url: 'https://console.example.com/decks?x=1',
        cookies: { session: 's' },
        query_string: 'x=1',
        data: { password: 'p' },
        headers: { Authorization: 'Bearer abc', Accept: 'application/json' },
      },
      exception: { values: [{ type: 'Error', value: `bad token ${FAKE_JWT}` }] },
    });
    const before = structuredClone(input);

    const out = scrubEvent(input);

    expect(input).toEqual(before);
    expect(out).not.toBe(input);
    expect(out).not.toHaveProperty('user');
    expect(out.request).not.toHaveProperty('cookies');
    expect(out.request).not.toHaveProperty('query_string');
    expect(out.request).not.toHaveProperty('data');
    expect(out.request.url).toBe('https://console.example.com/decks');
    expect(out.request.headers).toEqual({ Authorization: '[redacted]', Accept: 'application/json' });
    expect(out.message).toBe('failed for [email]');
    expect(out.exception.values[0].value).toBe('bad token [jwt]');
  });

  it('scrubEvent redacts sensitive keys at any depth', () => {
    const out = scrubEvent({
      extra: { a: { b: { Authorization: 'Bearer abc', keep: 'fine' } } },
      contexts: { x: { refresh_token: 'r', nested: { id_token: 'i', accessToken: 'a', EMAIL: 'someone@example.com' } } },
      tags: { 'http.query': 'code=abc', 'http.fragment': 'x', route: '/decks' },
      spans: [{ description: 'GET https://api.example.invalid/x?sig=1', data: { 'http.query': 'sig=1', url: '/x?sig=1' } }],
    });

    expect(out.extra.a.b).toEqual({ Authorization: '[redacted]', keep: 'fine' });
    expect(out.contexts.x.refresh_token).toBe('[redacted]');
    expect(out.contexts.x.nested).toEqual({ id_token: '[redacted]', accessToken: '[redacted]', EMAIL: '[redacted]' });
    expect(out.tags).toEqual({ route: '/decks' });
    expect(out.spans[0]).toEqual({ description: 'GET https://api.example.invalid/x?[redacted]', data: { url: '/x' } });
  });

  it('caps the copy at depth 10', () => {
    let deep: Record<string, unknown> = { leaf: 'someone@example.com' };
    for (let i = 0; i < 15; i += 1) deep = { next: deep };
    const out = JSON.stringify(scrubEvent({ extra: deep }));
    expect(out).toContain('[depth]');
    expect(out).not.toContain('someone@example.com');
  });
});

describe('scrubBreadcrumb', () => {
  it('drops console breadcrumbs and scrubs the rest', () => {
    expect(scrubBreadcrumb({ category: 'console', message: 'someone@example.com' })).toBeNull();

    const input = deepFreeze({
      category: 'fetch',
      message: `called with Bearer abc and ${FAKE_JWT}`,
      data: { url: 'https://api.example.invalid/v1/decks?token=t', token: 't', status_code: 500 },
    });
    const out = scrubBreadcrumb(input);

    expect(out).toEqual({
      category: 'fetch',
      message: 'called with Bearer [redacted] and [jwt]',
      data: { url: 'https://api.example.invalid/v1/decks', token: '[redacted]', status_code: 500 },
    });
    expect(input.data.url).toContain('?token=t');
  });
});
