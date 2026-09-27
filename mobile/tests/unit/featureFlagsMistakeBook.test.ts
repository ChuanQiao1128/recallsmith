import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RemoteConfig } from '../../src/config/remoteConfig';
import {
  applyRemoteFeatures,
  DEFAULT_FEATURE_FLAGS,
  getFeatureFlags,
  subscribeFeatureFlags,
} from '../../src/config/featureFlags';

const asRemoteConfig = (value: unknown) => value as RemoteConfig;

describe('mistakeBook feature flag', () => {
  beforeEach(() => {
    applyRemoteFeatures(null);
  });

  afterEach(() => {
    applyRemoteFeatures(null);
  });

  it('defaults to enabled with three related cards', () => {
    expect(DEFAULT_FEATURE_FLAGS.mistakeBook).toEqual({ enabled: true, relatedCount: 3 });
    expect(Object.isFrozen(DEFAULT_FEATURE_FLAGS.mistakeBook)).toBe(true);
    expect(getFeatureFlags().mistakeBook).toEqual({ enabled: true, relatedCount: 3 });
  });

  it('applies remote mistakeBook overrides and falls back per field', () => {
    expect(applyRemoteFeatures(asRemoteConfig({ features: { mistakeBook: { enabled: false, relatedCount: 5 } } })).mistakeBook).toEqual({
      enabled: false,
      relatedCount: 5,
    });
    expect(applyRemoteFeatures(asRemoteConfig({ features: { mistakeBook: { relatedCount: 0 } } })).mistakeBook).toEqual({
      enabled: true,
      relatedCount: 0,
    });
    expect(
      applyRemoteFeatures(asRemoteConfig({ features: { mistakeBook: { enabled: 'no', relatedCount: 1 } } })).mistakeBook,
    ).toEqual({ enabled: true, relatedCount: 1 });
    expect(applyRemoteFeatures(asRemoteConfig({ features: { mistakeBook: [] } })).mistakeBook).toEqual(
      DEFAULT_FEATURE_FLAGS.mistakeBook,
    );
    expect(applyRemoteFeatures(asRemoteConfig({ features: { mistakeBook: 'off' } })).mistakeBook).toEqual(
      DEFAULT_FEATURE_FLAGS.mistakeBook,
    );
    expect(Object.isFrozen(getFeatureFlags().mistakeBook)).toBe(true);
  });

  it('rejects a relatedCount outside 0..5 or not an integer', () => {
    for (const relatedCount of [-1, 6, 2.5, Number.NaN, Number.POSITIVE_INFINITY, '2', null, true]) {
      expect(
        applyRemoteFeatures(asRemoteConfig({ features: { mistakeBook: { enabled: false, relatedCount } } })).mistakeBook,
      ).toEqual({ enabled: false, relatedCount: 3 });
    }
  });

  it('notifies subscribers when only the mistakeBook flag changes', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeFeatureFlags(listener);
    const before = getFeatureFlags();

    const same = applyRemoteFeatures(asRemoteConfig({ features: { mistakeBook: { enabled: true, relatedCount: 3 } } }));
    expect(same).toBe(before);
    expect(listener).not.toHaveBeenCalled();

    const disabled = applyRemoteFeatures(asRemoteConfig({ features: { mistakeBook: { enabled: false } } }));
    expect(disabled).not.toBe(before);
    expect(listener).toHaveBeenCalledTimes(1);

    applyRemoteFeatures(asRemoteConfig({ features: { mistakeBook: { enabled: false, relatedCount: 1 } } }));
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
  });
});
