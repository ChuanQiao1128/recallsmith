import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RemoteConfig } from '../../src/config/remoteConfig';

type FeatureFlagsModule = typeof import('../../src/config/featureFlags');

let flags: FeatureFlagsModule;

function asRemoteConfig(value: unknown): RemoteConfig {
  return value as RemoteConfig;
}

beforeEach(async () => {
  vi.resetModules();
  flags = await import('../../src/config/featureFlags');
});

describe('sentry kill-switch flag', () => {
  it('defaults to enabled and is frozen', () => {
    expect(flags.DEFAULT_FEATURE_FLAGS.sentry).toEqual({ enabled: true });
    expect(Object.isFrozen(flags.DEFAULT_FEATURE_FLAGS.sentry)).toBe(true);
    expect(flags.getFeatureFlags().sentry).toEqual({ enabled: true });
  });

  it('only a boolean false flips it', () => {
    const next = flags.applyRemoteFeatures(asRemoteConfig({ features: { sentry: { enabled: false } } }));
    expect(next.sentry).toEqual({ enabled: false });
    expect(Object.isFrozen(next.sentry)).toBe(true);
    expect(flags.applyRemoteFeatures(asRemoteConfig({ features: { sentry: { enabled: true } } })).sentry).toEqual({
      enabled: true,
    });
  });

  it.each([['false'], [0], [null], [[]], [{}], [undefined]])('enabled: %j keeps true', (enabled) => {
    expect(flags.applyRemoteFeatures(asRemoteConfig({ features: { sentry: { enabled } } })).sentry).toEqual({
      enabled: true,
    });
  });

  it.each([['off'], [false], [[]], [null], [[{ enabled: false }]]])('sentry: %j keeps true', (sentry) => {
    expect(flags.applyRemoteFeatures(asRemoteConfig({ features: { sentry } })).sentry).toEqual({ enabled: true });
  });

  it('leaves the other flags untouched', () => {
    const next = flags.applyRemoteFeatures(asRemoteConfig({ features: { sentry: { enabled: false } } }));
    const { DEFAULT_FEATURE_FLAGS } = flags;
    expect(next).toEqual({
      mcq: DEFAULT_FEATURE_FLAGS.mcq,
      paywall: DEFAULT_FEATURE_FLAGS.paywall,
      ceremony: DEFAULT_FEATURE_FLAGS.ceremony,
      mistakeBook: DEFAULT_FEATURE_FLAGS.mistakeBook,
      cardSource: DEFAULT_FEATURE_FLAGS.cardSource,
      sentry: { enabled: false },
      cardReport: DEFAULT_FEATURE_FLAGS.cardReport,
    });
  });

  it('notifies subscribers when only the sentry flag changes', () => {
    const listener = vi.fn();
    const unsubscribe = flags.subscribeFeatureFlags(listener);
    flags.applyRemoteFeatures(asRemoteConfig({ features: { sentry: { enabled: false } } }));
    expect(listener).toHaveBeenCalledTimes(1);
    flags.applyRemoteFeatures(asRemoteConfig({ features: { sentry: { enabled: false } } }));
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });
});
