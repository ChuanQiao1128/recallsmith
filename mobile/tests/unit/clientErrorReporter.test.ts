import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CLIENT_ERROR_STACK_MAX_CHARS,
  buildClientErrorPayload,
  createClientErrorReporter,
  installGlobalErrorHandlers,
  type ClientErrorEnv,
} from '../../src/telemetry/clientErrorReporter';

const ENV: ClientErrorEnv = { appVersion: '1.6.1 (7)', updateId: 'update-abc', platform: 'ios' };

function makeFetch() {
  return vi.fn((_url: string, _init: RequestInit) =>
    Promise.resolve({ ok: true, status: 200 } as unknown as Response),
  );
}

describe('clientErrorReporter', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('posts message, stack, screen, appVersion, updateId and platform to /api/v1/user/client-errors with the bearer token', async () => {
    const fetchImpl = makeFetch();
    const reporter = createClientErrorReporter({
      apiBase: 'https://api.example.com',
      getAccessToken: () => 'tok-123',
      getEnv: () => ENV,
      getCurrentScreen: () => 'Home',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => 1000,
    });

    const error = new Error('kaboom');
    expect(reporter.report(error)).toBe(true);
    await Promise.resolve();
    await Promise.resolve();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.example.com/api/v1/user/client-errors');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok-123');
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json');
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      kind: 'js_error',
      message: 'kaboom',
      screen: 'Home',
      appVersion: '1.6.1 (7)',
      updateId: 'update-abc',
      platform: 'ios',
    });
    expect(typeof body.stack).toBe('string');

    // kind passed through ctx overrides the default.
    expect(reporter.report(error, { kind: 'other', screen: 'Deck' })).toBe(true);
    await Promise.resolve();
    const secondBody = JSON.parse((fetchImpl.mock.calls[1][1] as RequestInit).body as string);
    expect(secondBody.kind).toBe('other');
    expect(secondBody.screen).toBe('Deck');
  });

  it('sends nothing when the user is anonymous', async () => {
    const fetchImpl = makeFetch();
    const reporter = createClientErrorReporter({
      apiBase: 'https://api.example.com',
      getAccessToken: () => null,
      getEnv: () => ENV,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => 1000,
    });

    expect(reporter.report(new Error('nope'))).toBe(false);
    // blank token is also anonymous
    const reporter2 = createClientErrorReporter({
      apiBase: 'https://api.example.com',
      getAccessToken: () => '   ',
      getEnv: () => ENV,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => 1000,
    });
    expect(reporter2.report(new Error('nope'))).toBe(false);
    await Promise.resolve();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('truncates the stack to 4096 characters', async () => {
    const fetchImpl = makeFetch();
    const reporter = createClientErrorReporter({
      apiBase: 'https://api.example.com',
      getAccessToken: () => 'tok',
      getEnv: () => ENV,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => 1000,
    });

    const error = new Error('big');
    error.stack = 'x'.repeat(10_000);
    reporter.report(error);
    await Promise.resolve();

    const body = JSON.parse((fetchImpl.mock.calls[0][1] as RequestInit).body as string);
    expect(body.stack).toHaveLength(CLIENT_ERROR_STACK_MAX_CHARS);

    // buildClientErrorPayload directly, too.
    const payload = buildClientErrorPayload(error, 'Home', ENV);
    expect(payload.stack).toHaveLength(CLIENT_ERROR_STACK_MAX_CHARS);
  });

  it('drops reports beyond 10 per minute', async () => {
    const fetchImpl = makeFetch();
    let t = 1000;
    const reporter = createClientErrorReporter({
      apiBase: 'https://api.example.com',
      getAccessToken: () => 'tok',
      getEnv: () => ENV,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => t,
    });

    for (let i = 0; i < 10; i += 1) {
      expect(reporter.report(new Error(`e${i}`))).toBe(true);
    }
    // 11th within the same window is dropped.
    expect(reporter.report(new Error('e11'))).toBe(false);
    await Promise.resolve();
    expect(fetchImpl).toHaveBeenCalledTimes(10);

    // Advance past the rolling window; sending resumes.
    t += 60_001;
    expect(reporter.report(new Error('later'))).toBe(true);
    await Promise.resolve();
    expect(fetchImpl).toHaveBeenCalledTimes(11);
  });

  it('swallows fetch failures and never throws', async () => {
    const throwingFetch = vi.fn(() => {
      throw new Error('sync fetch boom');
    });
    const reporter = createClientErrorReporter({
      apiBase: 'https://api.example.com',
      getAccessToken: () => 'tok',
      getEnv: () => ENV,
      fetchImpl: throwingFetch as unknown as typeof fetch,
      now: () => 1000,
    });

    expect(() => reporter.report(new Error('x'))).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();

    const rejectingFetch = vi.fn(async () => {
      throw new Error('async fetch boom');
    });
    const reporter2 = createClientErrorReporter({
      apiBase: 'https://api.example.com',
      getAccessToken: () => 'tok',
      getEnv: () => ENV,
      fetchImpl: rejectingFetch as unknown as typeof fetch,
      now: () => 1000,
    });
    expect(() => reporter2.report(new Error('y'))).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
  });

  it('global handler reports and then chains the previous handler', async () => {
    const fetchImpl = makeFetch();
    const previous = vi.fn();
    const setGlobalHandler = vi.fn();
    const target = {
      ErrorUtils: {
        getGlobalHandler: () => previous,
        setGlobalHandler,
      },
    };

    const { configureClientErrorReporting } = await import(
      '../../src/telemetry/clientErrorReporter'
    );
    configureClientErrorReporting({
      apiBase: 'https://api.example.com',
      getAccessToken: () => 'tok',
      getEnv: () => ENV,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => 1000,
    });

    installGlobalErrorHandlers(target, { trackRejections: false });
    expect(setGlobalHandler).toHaveBeenCalledTimes(1);

    const installed = setGlobalHandler.mock.calls[0][0] as (e: unknown, f?: boolean) => void;
    const err = new Error('global boom');
    installed(err, true);
    await Promise.resolve();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const body = JSON.parse((fetchImpl.mock.calls[0][1] as RequestInit).body as string);
    expect(body.kind).toBe('js_error');
    expect(previous).toHaveBeenCalledWith(err, true);

    // Idempotent per target.
    installGlobalErrorHandlers(target, { trackRejections: false });
    expect(setGlobalHandler).toHaveBeenCalledTimes(1);
  });

  it('reports unhandled promise rejections through the Hermes tracker', async () => {
    const fetchImpl = makeFetch();
    let captured: ((id: number, rejection: unknown) => void) | null = null;
    const enablePromiseRejectionTracker = vi.fn((opts: any) => {
      captured = opts.onUnhandled;
    });
    const target = { HermesInternal: { enablePromiseRejectionTracker } };

    const { configureClientErrorReporting } = await import(
      '../../src/telemetry/clientErrorReporter'
    );
    configureClientErrorReporting({
      apiBase: 'https://api.example.com',
      getAccessToken: () => 'tok',
      getEnv: () => ENV,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => 1000,
    });

    installGlobalErrorHandlers(target, { trackRejections: true });
    expect(enablePromiseRejectionTracker).toHaveBeenCalledTimes(1);
    expect(captured).toBeTypeOf('function');

    captured!(1, new Error('rejected'));
    await Promise.resolve();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const body = JSON.parse((fetchImpl.mock.calls[0][1] as RequestInit).body as string);
    expect(body.kind).toBe('unhandled_rejection');
    expect(body.message).toBe('rejected');
  });
});
