// Wave E / E09: the pure host resolvers. Precedence, trimming and the fallback rule
// are pinned here; property #8 guards the "no trailing slash / no whitespace" invariant
// across arbitrary env combinations. See mobile/src/config/hosts.ts.
import { afterEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { DEFAULT_API_BASE, FALLBACK_API_BASE, resolveApiBase, resolveApiFallback } from '../../src/config/hosts';

afterEach(() => {
  delete process.env.EXPO_PUBLIC_API_BASE_URL;
  delete process.env.EXPO_PUBLIC_API_BASE;
  delete process.env.EXPO_PUBLIC_API_BASE_FALLBACK;
});

describe('hosts', () => {
  it('defaults to api.developercards.app when no env is set', () => {
    expect(resolveApiBase({})).toBe(DEFAULT_API_BASE);
    expect(DEFAULT_API_BASE).toBe('https://api.developercards.app');
    expect(resolveApiFallback({})).toBe(FALLBACK_API_BASE);
    expect(FALLBACK_API_BASE).toBe('https://ktbq1sie2c.execute-api.ap-southeast-2.amazonaws.com');
  });

  it('prefers EXPO_PUBLIC_API_BASE_URL over EXPO_PUBLIC_API_BASE', () => {
    expect(
      resolveApiBase({ EXPO_PUBLIC_API_BASE_URL: 'https://url.test', EXPO_PUBLIC_API_BASE: 'https://base.test' }),
    ).toBe('https://url.test');
    expect(resolveApiBase({ EXPO_PUBLIC_API_BASE: 'https://base.test' })).toBe('https://base.test');
  });

  it('trims whitespace and strips trailing slashes', () => {
    expect(resolveApiBase({ EXPO_PUBLIC_API_BASE_URL: '  https://x.test///  ' })).toBe('https://x.test');
    expect(resolveApiBase({ EXPO_PUBLIC_API_BASE: 'https://y.test/' })).toBe('https://y.test');
    // '/' cleans to '' and falls through to EXPO_PUBLIC_API_BASE.
    expect(
      resolveApiBase({ EXPO_PUBLIC_API_BASE_URL: '/', EXPO_PUBLIC_API_BASE: 'https://z.test' }),
    ).toBe('https://z.test');
  });

  it('treats a blank env value as unset', () => {
    expect(
      resolveApiBase({ EXPO_PUBLIC_API_BASE_URL: '   ', EXPO_PUBLIC_API_BASE: 'https://w.test' }),
    ).toBe('https://w.test');
    expect(resolveApiBase({ EXPO_PUBLIC_API_BASE_URL: '', EXPO_PUBLIC_API_BASE: '' })).toBe(DEFAULT_API_BASE);
    expect(resolveApiFallback({ EXPO_PUBLIC_API_BASE_FALLBACK: '   ' })).toBe(FALLBACK_API_BASE);
  });

  it('offers the legacy execute-api host as fallback only for the default base', () => {
    expect(resolveApiFallback({ EXPO_PUBLIC_API_BASE: 'https://custom.test' })).toBeNull();
    expect(resolveApiFallback({ EXPO_PUBLIC_API_BASE_URL: 'https://custom.test' })).toBeNull();
    expect(resolveApiFallback({ EXPO_PUBLIC_API_BASE: DEFAULT_API_BASE })).toBe(FALLBACK_API_BASE);
    expect(resolveApiFallback({ EXPO_PUBLIC_API_BASE: `${DEFAULT_API_BASE}/` })).toBe(FALLBACK_API_BASE);
  });

  it('honours EXPO_PUBLIC_API_BASE_FALLBACK verbatim (trimmed)', () => {
    expect(
      resolveApiFallback({ EXPO_PUBLIC_API_BASE: 'https://custom.test', EXPO_PUBLIC_API_BASE_FALLBACK: ' https://fb.test/ ' }),
    ).toBe('https://fb.test');
  });

  it('reads the bundled env through literal process.env members', () => {
    process.env.EXPO_PUBLIC_API_BASE = 'https://proc.test/';
    expect(resolveApiBase()).toBe('https://proc.test');
    expect(resolveApiFallback()).toBeNull();

    process.env.EXPO_PUBLIC_API_BASE_URL = 'https://procurl.test/';
    expect(resolveApiBase()).toBe('https://procurl.test');

    process.env.EXPO_PUBLIC_API_BASE_FALLBACK = ' https://procfb.test/ ';
    expect(resolveApiFallback()).toBe('https://procfb.test');
  });

  it('never returns a trailing slash or surrounding whitespace (property)', () => {
    const piece = fc.oneof(
      fc.constant(undefined),
      fc.constant(''),
      fc.constant('   '),
      fc.constant('/'),
      fc.webUrl().map((u) => `  ${u}///`),
      fc.string(),
    );
    fc.assert(
      fc.property(piece, piece, piece, (url, base, fb) => {
        const env = {
          EXPO_PUBLIC_API_BASE_URL: url,
          EXPO_PUBLIC_API_BASE: base,
          EXPO_PUBLIC_API_BASE_FALLBACK: fb,
        };
        const resolved = resolveApiBase(env);
        expect(resolved.length).toBeGreaterThan(0);
        expect(/^\s/.test(resolved)).toBe(false);
        expect(resolved.endsWith('/')).toBe(false);

        const fallback = resolveApiFallback(env);
        if (fallback !== null) {
          expect(fallback.length).toBeGreaterThan(0);
          expect(/^\s/.test(fallback)).toBe(false);
          expect(fallback.endsWith('/')).toBe(false);
        }
      }),
      { numRuns: 200 },
    );
  });
});
