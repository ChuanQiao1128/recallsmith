import { describe, expect, it } from 'vitest';

import {
  SENTRY_KILL_SWITCH_TIMEOUT_MS,
  SENTRY_MAX_BREADCRUMBS,
  SENTRY_MAX_EVENTS_PER_SESSION,
  SENTRY_SAMPLE_RATE,
  SENTRY_TRACES_SAMPLE_RATE,
  buildOtaTags,
  buildTracePropagationTargets,
  decideSentry,
  isSentryKilled,
  scrubBreadcrumb,
  scrubEvent,
  scrubString,
  shouldDropEvent,
  stripQuery,
} from '../../src/telemetry/sentryPolicy';

const DSN = 'https://publickey@example.invalid/1';
const FAKE_JWT = 'eyJhbGciOiJub25lIn0.eyJzdWIiOiJ4In0.sig';
const API = 'https://api.developercards.app';
const EXECUTE_API = 'https://ktbq1sie2c.execute-api.ap-southeast-2.amazonaws.com';
const SIGNED_CDN_URL =
  'https://cdn.developercards.app/decks/aws.json?Expires=1790000000&Signature=abcDEF123~xyz&Key-Pair-Id=K2FAKEFAKEFAKE';

describe('constants', () => {
  it('pins the sampling and cap literals', () => {
    expect(SENTRY_SAMPLE_RATE).toBe(1.0);
    expect(SENTRY_TRACES_SAMPLE_RATE).toBe(0.2);
    expect(SENTRY_MAX_BREADCRUMBS).toBe(50);
    expect(SENTRY_MAX_EVENTS_PER_SESSION).toBe(25);
    expect(SENTRY_KILL_SWITCH_TIMEOUT_MS).toBe(300);
  });
});

describe('decideSentry', () => {
  const ok = { isDev: false, channel: 'production', dsn: DSN, killed: false };

  it('enables with a trimmed dsn and the production environment', () => {
    expect(decideSentry({ ...ok, dsn: `  ${DSN}  ` })).toEqual({ enabled: true, dsn: DSN, environment: 'production' });
    expect(decideSentry({ ...ok, channel: ' Production ' })).toEqual({ enabled: true, dsn: DSN, environment: 'production' });
  });

  it('returns each reason', () => {
    expect(decideSentry({ ...ok, isDev: true })).toEqual({ enabled: false, reason: 'dev' });
    expect(decideSentry({ ...ok, channel: 'preview' })).toEqual({ enabled: false, reason: 'channel' });
    expect(decideSentry({ ...ok, channel: undefined })).toEqual({ enabled: false, reason: 'channel' });
    expect(decideSentry({ ...ok, channel: null })).toEqual({ enabled: false, reason: 'channel' });
    expect(decideSentry({ ...ok, dsn: undefined })).toEqual({ enabled: false, reason: 'no-dsn' });
    expect(decideSentry({ ...ok, dsn: '   ' })).toEqual({ enabled: false, reason: 'no-dsn' });
    expect(decideSentry({ ...ok, dsn: 42 })).toEqual({ enabled: false, reason: 'no-dsn' });
    expect(decideSentry({ ...ok, killed: true })).toEqual({ enabled: false, reason: 'kill-switch' });
  });

  it.each([
    ['surrounding quotes', `"${DSN}"`],
    ['missing public key', 'https://example.invalid/1'],
    ['missing project id', 'https://publickey@example.invalid/'],
    ['http scheme', 'http://publickey@example.invalid/1'],
    ['space inside', 'https://public key@example.invalid/1'],
  ])('treats a malformed DSN (%s) as no-dsn (M02-R1)', (_label, dsn) => {
    expect(decideSentry({ ...ok, dsn })).toEqual({ enabled: false, reason: 'no-dsn' });
  });

  it('accepts a valid DSN with whitespace around it after trim (M02-R1)', () => {
    expect(decideSentry({ ...ok, dsn: `\n\t${DSN} \n` })).toEqual({ enabled: true, dsn: DSN, environment: 'production' });
  });

  it('applies the gates in order: dev, channel, no-dsn, kill-switch', () => {
    const allBad = { isDev: true, channel: 'dev', dsn: '', killed: true };
    expect(decideSentry(allBad)).toEqual({ enabled: false, reason: 'dev' });
    expect(decideSentry({ ...allBad, isDev: false })).toEqual({ enabled: false, reason: 'channel' });
    expect(decideSentry({ ...allBad, isDev: false, channel: 'production' })).toEqual({ enabled: false, reason: 'no-dsn' });
    expect(decideSentry({ ...allBad, isDev: false, channel: 'production', dsn: DSN })).toEqual({
      enabled: false,
      reason: 'kill-switch',
    });
  });
});

describe('isSentryKilled', () => {
  it.each([
    [{ features: { sentry: { enabled: false } } }, true],
    [{ features: { sentry: { enabled: true } } }, false],
    [{ features: { sentry: { enabled: 'false' } } }, false],
    [{ features: { sentry: { enabled: 0 } } }, false],
    [{ features: { sentry: { enabled: null } } }, false],
    [{ features: { sentry: {} } }, false],
    [{ features: { sentry: false } }, false],
    [{ features: { sentry: [false] } }, false],
    [{ features: [] }, false],
    [{ features: null }, false],
    [{}, false],
    [null, false],
    [undefined, false],
    ['features', false],
    [[{ features: { sentry: { enabled: false } } }], false],
  ])('%j => %s', (config, expected) => {
    expect(isSentryKilled(config)).toBe(expected);
  });
});

describe('scrubString', () => {
  it('redacts bearer tokens', () => {
    expect(scrubString('Authorization: Bearer abc.DEF-123_~+/=')).toBe('Authorization: Bearer [redacted]');
    expect(scrubString('bearer xyz')).toBe('Bearer [redacted]');
  });

  it('redacts JWT-shaped tokens', () => {
    expect(scrubString(`token was ${FAKE_JWT} here`)).toBe('token was [jwt] here');
    expect(scrubString('refresh eyJhbGciOiJub25lIn0.a.b.c.d')).toBe('refresh [jwt]');
  });

  it('redacts email addresses', () => {
    expect(scrubString('no account for someone@example.com')).toBe('no account for [email]');
  });

  it('redacts query strings and fragments of absolute URLs, including signed CloudFront URLs', () => {
    const out = scrubString(`GET ${SIGNED_CDN_URL} failed`);
    expect(out).toBe('GET https://cdn.developercards.app/decks/aws.json?[redacted] failed');
    expect(out).not.toMatch(/Expires|Signature|Key-Pair-Id/);
    expect(scrubString('https://api.developercards.app/x#frag')).toBe('https://api.developercards.app/x?[redacted]');
  });

  it('leaves ordinary text alone', () => {
    expect(scrubString('Cannot read property of undefined')).toBe('Cannot read property of undefined');
  });
});

describe('stripQuery', () => {
  it('cuts from the first ? or #', () => {
    expect(stripQuery(SIGNED_CDN_URL)).toBe('https://cdn.developercards.app/decks/aws.json');
    expect(stripQuery('https://api.developercards.app/api/v1/me#x?y')).toBe('https://api.developercards.app/api/v1/me');
    expect(stripQuery('/api/v1/me?email=someone@example.com')).toBe('/api/v1/me');
    expect(stripQuery('/plain/path')).toBe('/plain/path');
  });
});

describe('scrubEvent', () => {
  function makeEvent() {
    return {
      message: `failed for someone@example.com with ${FAKE_JWT}`,
      user: { id: 'u-1', email: 'someone@example.com' },
      request: {
        url: `${API}/api/v1/me?token=abc`,
        cookies: { session: 'x' },
        query_string: 'token=abc',
        data: { password: 'hunter2' },
        headers: { Authorization: 'Bearer abc', 'content-type': 'application/json' },
      },
      exception: { values: [{ type: 'Error', value: 'Bearer abc123 rejected for someone@example.com' }] },
      breadcrumbs: [
        {
          category: 'fetch',
          message: `GET ${SIGNED_CDN_URL}`,
          data: { url: SIGNED_CDN_URL, 'http.query': 'Expires=1', 'http.fragment': 'x', method: 'GET' },
        },
        { category: 'navigation', data: { from: '/a?x=1', to: '/b#y' } },
      ],
      spans: [{ description: `GET ${SIGNED_CDN_URL}`, data: { 'http.url': `${API}/x?y=1`, 'http.query': 'y=1' } }],
      contexts: { trace: { data: { url: `${EXECUTE_API}/v1?q=1` } }, app: { access_token: 'abc' } },
      tags: { note: 'someone@example.com' },
      extra: { refreshToken: 'abc', nested: { email: 'someone@example.com', IdToken: 'x' } },
    };
  }

  it('never mutates its input', () => {
    const event = makeEvent();
    const snapshot = JSON.parse(JSON.stringify(event));
    const out = scrubEvent(event);
    expect(event).toEqual(snapshot);
    expect(out).not.toBe(event);
  });

  it('deletes user and request cookies/query_string/data, strips request.url', () => {
    const out = scrubEvent(makeEvent()) as any;
    expect(out).not.toHaveProperty('user');
    expect(out.request).not.toHaveProperty('cookies');
    expect(out.request).not.toHaveProperty('query_string');
    expect(out.request).not.toHaveProperty('data');
    expect(out.request.url).toBe(`${API}/api/v1/me`);
    expect(out.request.headers.Authorization).toBe('[redacted]');
    expect(out.request.headers['content-type']).toBe('application/json');
  });

  it('redacts sensitive keys anywhere', () => {
    const out = scrubEvent(makeEvent()) as any;
    expect(out.contexts.app.access_token).toBe('[redacted]');
    expect(out.extra.refreshToken).toBe('[redacted]');
    expect(out.extra.nested.email).toBe('[redacted]');
    expect(out.extra.nested.IdToken).toBe('[redacted]');
  });

  it('strips query strings from breadcrumb, span and context URLs and deletes http.query / http.fragment', () => {
    const out = scrubEvent(makeEvent()) as any;
    expect(out.breadcrumbs[0].data).toEqual({ url: 'https://cdn.developercards.app/decks/aws.json', method: 'GET' });
    expect(out.breadcrumbs[1].data).toEqual({ from: '/a', to: '/b' });
    expect(out.spans[0].data).toEqual({ 'http.url': `${API}/x` });
    expect(out.contexts.trace.data.url).toBe(`${EXECUTE_API}/v1`);
  });

  it('scrubs every other string leaf', () => {
    const out = scrubEvent(makeEvent()) as any;
    expect(out.message).toBe('failed for [email] with [jwt]');
    expect(out.exception.values[0].value).toBe('Bearer [redacted] rejected for [email]');
    expect(out.breadcrumbs[0].message).toBe('GET https://cdn.developercards.app/decks/aws.json?[redacted]');
    expect(out.spans[0].description).toBe('GET https://cdn.developercards.app/decks/aws.json?[redacted]');
    expect(out.tags.note).toBe('[email]');
    expect(JSON.stringify(out)).not.toMatch(/someone@example\.com|eyJ|Signature=|hunter2/);
  });

  it('drops values deeper than the depth cap', () => {
    let deep: any = { leaf: 'bottom' };
    for (let i = 0; i < 15; i += 1) deep = { next: deep };
    const out = scrubEvent({ extra: deep }) as any;
    let cursor = out.extra;
    let depth = 1;
    while (cursor && typeof cursor === 'object' && 'next' in cursor) {
      cursor = cursor.next;
      depth += 1;
    }
    expect(depth).toBeLessThanOrEqual(11);
    expect(JSON.stringify(out)).not.toContain('bottom');
  });
});

describe('scrubBreadcrumb', () => {
  it('drops console breadcrumbs', () => {
    expect(scrubBreadcrumb({ category: 'console', message: 'log' })).toBeNull();
  });

  it('scrubs message and data without mutating the input', () => {
    const crumb = {
      category: 'xhr',
      message: 'user someone@example.com',
      data: { url: `${API}/api/v1/me?x=1`, 'http.query': 'x=1', Authorization: 'Bearer a' },
    };
    const copy = JSON.parse(JSON.stringify(crumb));
    expect(scrubBreadcrumb(crumb)).toEqual({
      category: 'xhr',
      message: 'user [email]',
      data: { url: `${API}/api/v1/me`, Authorization: '[redacted]' },
    });
    expect(crumb).toEqual(copy);
  });
});

describe('shouldDropEvent', () => {
  it('drops offline and timeout failures', () => {
    expect(shouldDropEvent({ originalException: Object.assign(new Error('Network request failed'), { kind: 'offline' }) })).toBe(true);
    expect(shouldDropEvent({ originalException: Object.assign(new Error('Request timed out'), { kind: 'timeout' }) })).toBe(true);
  });

  it('keeps everything else', () => {
    expect(shouldDropEvent(undefined)).toBe(false);
    expect(shouldDropEvent({})).toBe(false);
    expect(shouldDropEvent({ originalException: new Error('boom') })).toBe(false);
    expect(shouldDropEvent({ originalException: 'offline' })).toBe(false);
    expect(shouldDropEvent({ originalException: { kind: 'http' } })).toBe(false);
  });
});

describe('buildTracePropagationTargets', () => {
  const targets = buildTracePropagationTargets(API, EXECUTE_API);
  const matches = (url: string) => targets.some((re) => re.test(url));

  it('builds one anchored regex per distinct origin', () => {
    expect(targets).toHaveLength(2);
    expect(buildTracePropagationTargets(API, null)).toHaveLength(1);
    expect(buildTracePropagationTargets(API, `${API}/`)).toHaveLength(1);
    for (const re of targets) expect(re.source.startsWith('^')).toBe(true);
  });

  it('matches both API origins', () => {
    expect(matches('https://api.developercards.app/api/v1/me')).toBe(true);
    expect(matches(API)).toBe(true);
    expect(matches(`${EXECUTE_API}/api/v1/me`)).toBe(true);
  });

  it('rejects the CDN and look-alike hosts', () => {
    expect(matches('https://cdn.developercards.app/x')).toBe(false);
    expect(matches('https://api.developercards.app.evil.test/')).toBe(false);
    expect(matches('https://evil.test/?u=https://api.developercards.app/')).toBe(false);
  });
});

describe('buildOtaTags', () => {
  it('reports an embedded launch', () => {
    expect(buildOtaTags({ updateId: null, channel: 'production', runtimeVersion: '1.9.0', isEmbeddedLaunch: true })).toEqual({
      'ota.update_id': 'embedded',
      'ota.channel': 'production',
      'ota.runtime_version': '1.9.0',
      'ota.is_embedded': 'true',
    });
    expect(buildOtaTags({ updateId: '  ', channel: 'production', runtimeVersion: '1.9.0', isEmbeddedLaunch: true })['ota.update_id']).toBe('embedded');
  });

  it("reports 'embedded' when the launch is embedded even though expo-updates gives the embedded update's UUID (M02-R4)", () => {
    expect(
      buildOtaTags({
        updateId: '0f6d2c9e-6b8a-4b3e-9a51-3c2d1e0f9a8b',
        channel: 'production',
        runtimeVersion: '1.9.0',
        isEmbeddedLaunch: true,
      }),
    ).toEqual({
      'ota.update_id': 'embedded',
      'ota.channel': 'production',
      'ota.runtime_version': '1.9.0',
      'ota.is_embedded': 'true',
    });
  });

  it('reports an OTA launch', () => {
    expect(
      buildOtaTags({ updateId: 'a1b2c3', channel: 'production', runtimeVersion: '1.9.0', isEmbeddedLaunch: false }),
    ).toEqual({
      'ota.update_id': 'a1b2c3',
      'ota.channel': 'production',
      'ota.runtime_version': '1.9.0',
      'ota.is_embedded': 'false',
    });
  });

  it('uses unknown for missing inputs', () => {
    const unknown = {
      'ota.update_id': 'unknown',
      'ota.channel': 'unknown',
      'ota.runtime_version': 'unknown',
      'ota.is_embedded': 'unknown',
    };
    expect(buildOtaTags(null)).toEqual(unknown);
    expect(buildOtaTags({})).toEqual(unknown);
  });
});
