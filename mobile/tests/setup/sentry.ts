// Global vitest stand-in for the Sentry SDK (M02, M00 §3.9). No real SDK code runs
// in any test: observability.ts (the only importer) gets these vi.fn stand-ins, and
// every case starts from reset mocks. Tests reach them through
// `vi.mocked(await import('@sentry/react-native'))` or `globalThis.__sentryMock`.

import { beforeEach, vi } from 'vitest';

const sentryMock = vi.hoisted(() => {
  const makeIntegration = () => ({ name: 'ReactNavigation', registerNavigationContainer: vi.fn() });
  const mock = {
    init: vi.fn(),
    wrap: vi.fn((component: unknown) => component),
    captureException: vi.fn(() => '0123456789abcdef0123456789abcdef'),
    close: vi.fn(async () => {}),
    reactNavigationIntegration: vi.fn(makeIntegration),
    getActiveSpan: vi.fn(() => undefined),
    getCurrentScope: vi.fn(() => ({ setTag: vi.fn(), setContext: vi.fn() })),
    makeIntegration,
  };
  (globalThis as any).__sentryMock = mock;
  return mock;
});

vi.mock('@sentry/react-native', () => ({
  init: sentryMock.init,
  wrap: sentryMock.wrap,
  captureException: sentryMock.captureException,
  close: sentryMock.close,
  reactNavigationIntegration: sentryMock.reactNavigationIntegration,
  getActiveSpan: sentryMock.getActiveSpan,
  getCurrentScope: sentryMock.getCurrentScope,
}));

beforeEach(() => {
  sentryMock.init.mockReset();
  sentryMock.wrap.mockReset();
  sentryMock.wrap.mockImplementation((component: unknown) => component);
  sentryMock.captureException.mockReset();
  sentryMock.captureException.mockImplementation(() => '0123456789abcdef0123456789abcdef');
  sentryMock.close.mockReset();
  sentryMock.close.mockImplementation(async () => {});
  sentryMock.reactNavigationIntegration.mockReset();
  sentryMock.reactNavigationIntegration.mockImplementation(sentryMock.makeIntegration);
  sentryMock.getActiveSpan.mockReset();
  sentryMock.getActiveSpan.mockImplementation(() => undefined);
  sentryMock.getCurrentScope.mockReset();
  sentryMock.getCurrentScope.mockImplementation(() => ({ setTag: vi.fn(), setContext: vi.fn() }));
});

declare global {
  var __sentryMock: {
    init: ReturnType<typeof vi.fn>;
    wrap: ReturnType<typeof vi.fn>;
    captureException: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    reactNavigationIntegration: ReturnType<typeof vi.fn>;
    getActiveSpan: ReturnType<typeof vi.fn>;
    getCurrentScope: ReturnType<typeof vi.fn>;
  };
}

export {};
