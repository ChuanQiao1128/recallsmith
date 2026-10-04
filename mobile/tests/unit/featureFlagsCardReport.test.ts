import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RemoteConfig } from '../../src/config/remoteConfig';
import {
  applyRemoteFeatures,
  DEFAULT_FEATURE_FLAGS,
  getFeatureFlags,
  subscribeFeatureFlags,
} from '../../src/config/featureFlags';

const asRemoteConfig = (value: unknown) => value as RemoteConfig;

describe('cardReport feature flag', () => {
  beforeEach(() => {
    applyRemoteFeatures(null);
  });

  afterEach(() => {
    applyRemoteFeatures(null);
  });

  it('defaults cardReport to disabled and frozen', () => {
    expect(DEFAULT_FEATURE_FLAGS.cardReport).toEqual({ enabled: false, anonymous: false });
    expect(Object.isFrozen(DEFAULT_FEATURE_FLAGS.cardReport)).toBe(true);
    expect(getFeatureFlags().cardReport).toEqual({ enabled: false, anonymous: false });
  });

  it('applies a remote cardReport.enabled override and ignores non-booleans', () => {
    expect(applyRemoteFeatures(asRemoteConfig({ features: { cardReport: { enabled: true } } })).cardReport).toEqual({
      enabled: true,
      anonymous: false,
    });
    expect(Object.isFrozen(getFeatureFlags().cardReport)).toBe(true);
    expect(applyRemoteFeatures(asRemoteConfig({ features: { cardReport: { enabled: false } } })).cardReport).toEqual({
      enabled: false,
      anonymous: false,
    });
    for (const enabled of ['true', 1, null, {}, undefined]) {
      expect(applyRemoteFeatures(asRemoteConfig({ features: { cardReport: { enabled } } })).cardReport).toEqual(
        DEFAULT_FEATURE_FLAGS.cardReport,
      );
    }
    for (const cardReport of ['on', true, [], null]) {
      expect(applyRemoteFeatures(asRemoteConfig({ features: { cardReport } })).cardReport).toEqual(
        DEFAULT_FEATURE_FLAGS.cardReport,
      );
    }
  });

  it('applies a remote cardReport.anonymous override (R28) only as a boolean, independently of enabled', () => {
    expect(
      applyRemoteFeatures(asRemoteConfig({ features: { cardReport: { enabled: true, anonymous: true } } })).cardReport,
    ).toEqual({ enabled: true, anonymous: true });
    expect(Object.isFrozen(getFeatureFlags().cardReport)).toBe(true);
    expect(applyRemoteFeatures(asRemoteConfig({ features: { cardReport: { anonymous: true } } })).cardReport).toEqual({
      enabled: false,
      anonymous: true,
    });
    for (const anonymous of ['true', 1, null, {}, undefined]) {
      expect(
        applyRemoteFeatures(asRemoteConfig({ features: { cardReport: { enabled: true, anonymous } } })).cardReport,
      ).toEqual({ enabled: true, anonymous: false });
    }
  });

  it('notifies subscribers when only cardReport.anonymous changes', () => {
    applyRemoteFeatures(asRemoteConfig({ features: { cardReport: { enabled: true } } }));
    const listener = vi.fn();
    const unsubscribe = subscribeFeatureFlags(listener);
    const on = applyRemoteFeatures(asRemoteConfig({ features: { cardReport: { enabled: true, anonymous: true } } }));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(on.cardReport).toEqual({ enabled: true, anonymous: true });
    expect(applyRemoteFeatures(asRemoteConfig({ features: { cardReport: { enabled: true, anonymous: true } } }))).toBe(on);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('notifies subscribers when only the cardReport flag changes', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeFeatureFlags(listener);
    const before = getFeatureFlags();

    const on = applyRemoteFeatures(asRemoteConfig({ features: { cardReport: { enabled: true } } }));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(on).not.toBe(before);
    expect(on.mcq).toEqual(before.mcq);
    expect(on.cardSource).toEqual(before.cardSource);

    // Same value again: same snapshot identity, no notification.
    expect(applyRemoteFeatures(asRemoteConfig({ features: { cardReport: { enabled: true } } }))).toBe(on);
    expect(listener).toHaveBeenCalledTimes(1);

    applyRemoteFeatures(null);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(getFeatureFlags().cardReport.enabled).toBe(false);
    unsubscribe();
  });
});
