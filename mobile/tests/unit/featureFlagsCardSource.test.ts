import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RemoteConfig } from '../../src/config/remoteConfig';
import {
  applyRemoteFeatures,
  DEFAULT_FEATURE_FLAGS,
  getFeatureFlags,
  subscribeFeatureFlags,
} from '../../src/config/featureFlags';

const asRemoteConfig = (value: unknown) => value as RemoteConfig;

describe('cardSource feature flag', () => {
  beforeEach(() => {
    applyRemoteFeatures(null);
  });

  afterEach(() => {
    applyRemoteFeatures(null);
  });

  it('defaults cardSource to enabled', () => {
    expect(DEFAULT_FEATURE_FLAGS.cardSource).toEqual({ enabled: true });
    expect(Object.isFrozen(DEFAULT_FEATURE_FLAGS.cardSource)).toBe(true);
    expect(getFeatureFlags().cardSource).toEqual({ enabled: true });
  });

  it('applies a remote cardSource.enabled override and ignores non-booleans', () => {
    expect(applyRemoteFeatures(asRemoteConfig({ features: { cardSource: { enabled: false } } })).cardSource).toEqual({
      enabled: false,
    });
    expect(Object.isFrozen(getFeatureFlags().cardSource)).toBe(true);
    expect(applyRemoteFeatures(asRemoteConfig({ features: { cardSource: { enabled: true } } })).cardSource).toEqual({
      enabled: true,
    });
    for (const enabled of ['false', 0, null, {}, undefined]) {
      expect(applyRemoteFeatures(asRemoteConfig({ features: { cardSource: { enabled } } })).cardSource).toEqual(
        DEFAULT_FEATURE_FLAGS.cardSource,
      );
    }
    for (const cardSource of ['off', false, [], null]) {
      expect(applyRemoteFeatures(asRemoteConfig({ features: { cardSource } })).cardSource).toEqual(
        DEFAULT_FEATURE_FLAGS.cardSource,
      );
    }
  });

  it('notifies subscribers when only the cardSource flag changes', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeFeatureFlags(listener);
    const before = getFeatureFlags();

    const off = applyRemoteFeatures(asRemoteConfig({ features: { cardSource: { enabled: false } } }));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(off).not.toBe(before);
    expect(off.mcq).toEqual(before.mcq);
    expect(off.mistakeBook).toEqual(before.mistakeBook);

    // Same value again: same snapshot identity, no notification.
    expect(applyRemoteFeatures(asRemoteConfig({ features: { cardSource: { enabled: false } } }))).toBe(off);
    expect(listener).toHaveBeenCalledTimes(1);

    applyRemoteFeatures(null);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(getFeatureFlags().cardSource.enabled).toBe(true);
    unsubscribe();
  });
});
