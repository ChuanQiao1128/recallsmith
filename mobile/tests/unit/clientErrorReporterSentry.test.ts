import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => {
  const React = require('react');
  return {
    View: ({ children, ...props }: any) => React.createElement('View', props, children),
    Text: ({ children, ...props }: any) => React.createElement('Text', props, children),
    Pressable: ({ children, onPress, ...props }: any) =>
      React.createElement(
        'Pressable',
        { ...props, onPress },
        typeof children === 'function' ? children({ pressed: false }) : children,
      ),
    StyleSheet: { create: (styles: any) => styles },
  };
});

import {
  configureClientErrorReporting,
  createClientErrorReporter,
  reportClientError,
  type ClientErrorEnv,
} from '../../src/telemetry/clientErrorReporter';
import { RootErrorBoundary } from '../../src/components/RootErrorBoundary';
import { ScreenErrorBoundary } from '../../src/components/ScreenErrorBoundary';

const ENV: ClientErrorEnv = { appVersion: '1.9.0 (23)', updateId: null, platform: 'ios' };
const FAKE_TOKEN = 'eyJhbGciOiJub25lIn0.eyJzdWIiOiJ4In0.sig';

function makeFetch() {
  return vi.fn((_url: string, _init: RequestInit) => Promise.resolve({ ok: true, status: 200 } as unknown as Response));
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

function baseDeps(fetchImpl: ReturnType<typeof makeFetch>) {
  return {
    apiBase: 'https://api.developercards.app',
    getAccessToken: () => FAKE_TOKEN,
    getEnv: () => ENV,
    getCurrentScreen: () => 'Library',
    fetchImpl: fetchImpl as unknown as typeof fetch,
    now: () => 1000,
  };
}

describe('clientErrorReporter routing to an active Sentry', () => {
  afterEach(() => {
    configureClientErrorReporting({});
    vi.restoreAllMocks();
  });

  it('capture returning true: no POST even with a token, and the call reports success', async () => {
    const fetchImpl = makeFetch();
    const capture = vi.fn(() => true);
    const reporter = createClientErrorReporter({ ...baseDeps(fetchImpl), captureException: capture });
    const error = new Error('kaboom');

    expect(reporter.report(error)).toBe(true);
    await flush();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(capture).toHaveBeenCalledWith(error, { screen: 'Library', kind: 'js_error' });
  });

  it('capture returning true consumes no rate-limit slot and covers anonymous users', async () => {
    const fetchImpl = makeFetch();
    let captured = true;
    const capture = vi.fn(() => captured);
    const reporter = createClientErrorReporter({
      ...baseDeps(fetchImpl),
      getAccessToken: () => null,
      captureException: capture,
    });
    for (let i = 0; i < 30; i += 1) expect(reporter.report(new Error(`e${i}`))).toBe(true);
    expect(capture).toHaveBeenCalledTimes(30);
    expect(fetchImpl).not.toHaveBeenCalled();

    // Anonymous and not captured: the unchanged path posts nothing.
    captured = false;
    expect(reporter.report(new Error('anon'))).toBe(false);
  });

  it('capture returning false: the unchanged POST path runs', async () => {
    const fetchImpl = makeFetch();
    const capture = vi.fn(() => false);
    const reporter = createClientErrorReporter({ ...baseDeps(fetchImpl), captureException: capture });

    expect(reporter.report(new Error('kaboom'), { kind: 'other', screen: 'Deck' })).toBe(true);
    await flush();
    expect(capture).toHaveBeenCalledWith(expect.any(Error), { screen: 'Deck', kind: 'other' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.developercards.app/api/v1/user/client-errors');
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${FAKE_TOKEN}`);
    expect(JSON.parse(init.body as string)).toMatchObject({ kind: 'other', screen: 'Deck', message: 'kaboom' });
  });

  it('capture throwing: the unchanged POST path runs', async () => {
    const fetchImpl = makeFetch();
    const capture = vi.fn(() => {
      throw new Error('sdk');
    });
    const reporter = createClientErrorReporter({ ...baseDeps(fetchImpl), captureException: capture });

    expect(reporter.report(new Error('kaboom'))).toBe(true);
    await flush();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("reportClientError(err, { kind: 'boundary', screen: 'Home' }) reaches the capture", async () => {
    const fetchImpl = makeFetch();
    const capture = vi.fn(() => true);
    configureClientErrorReporting({ ...baseDeps(fetchImpl), captureException: capture });
    const err = new Error('boundary boom');

    reportClientError(err, { kind: 'boundary', screen: 'Home' });
    await flush();
    expect(capture).toHaveBeenCalledWith(err, { screen: 'Home', kind: 'boundary' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('error boundaries reach the capture', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  function Bomb(): React.ReactElement {
    throw new Error('render boom');
  }

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
    configureClientErrorReporting({});
  });

  it("RootErrorBoundary reports kind 'boundary' with screen 'root'", () => {
    const fetchImpl = makeFetch();
    const capture = vi.fn(() => true);
    configureClientErrorReporting({ ...baseDeps(fetchImpl), captureException: capture });
    act(() => {
      renderer.create(React.createElement(RootErrorBoundary, null, React.createElement(Bomb)));
    });
    expect(capture).toHaveBeenCalledWith(expect.objectContaining({ message: 'render boom' }), {
      screen: 'root',
      kind: 'boundary',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("ScreenErrorBoundary reports kind 'boundary' with its screen", () => {
    const fetchImpl = makeFetch();
    const capture = vi.fn(() => true);
    configureClientErrorReporting({ ...baseDeps(fetchImpl), captureException: capture });
    act(() => {
      renderer.create(
        React.createElement(ScreenErrorBoundary, { screen: 'Deck', onGoHome: () => {}, children: React.createElement(Bomb) }),
      );
    });
    expect(capture).toHaveBeenCalledWith(expect.objectContaining({ message: 'render boom' }), {
      screen: 'Deck',
      kind: 'boundary',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
