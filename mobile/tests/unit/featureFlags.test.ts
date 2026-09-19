import React from 'react';
import renderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let configLoader: () => Promise<any> = async () => null;

vi.mock('../../src/config/remoteConfig', () => ({
  getCurrentAppVersion: () => '1.4.0',
  loadRemoteConfig: vi.fn(() => configLoader()),
  resolveIosUpdate: (config: any, currentVersion: string) => {
    const min = config?.ios?.minSupportedVersion ?? null;
    const [a, b, c] = String(currentVersion).split('.').map(Number);
    const [x, y, z] = String(min ?? '0.0.0').split('.').map(Number);
    const below = a !== x ? a < x : b !== y ? b < y : c < z;
    return {
      forceUpdate: !!min && below,
      updateUrl: config?.ios?.updateUrl ?? null,
      message: config?.ios?.message ?? 'A new version is required to continue.',
      minSupportedVersion: min,
      latestVersion: null,
    };
  },
}));

import {
  DEFAULT_FEATURE_FLAGS,
  applyRemoteFeatures,
  getFeatureFlags,
  subscribeFeatureFlags,
  useFeatureFlags,
  type FeatureFlags,
} from '../../src/config/featureFlags';
import { useForceUpdateGate, type ForceUpdateGate } from '../../src/config/forceUpdateGate';
import type { RemoteConfig } from '../../src/config/remoteConfig';

const gateRenders: Array<ForceUpdateGate | null> = [];

function asRemoteConfig(value: unknown): RemoteConfig {
  return value as RemoteConfig;
}

function FeatureFlagProbe({ renders }: { renders: FeatureFlags[] }) {
  renders.push(useFeatureFlags());
  return null;
}

function ForceUpdateProbe() {
  gateRenders.push(useForceUpdateGate('https://cdn.test/config.json'));
  return null;
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function unmount(tree: ReactTestRenderer) {
  await act(async () => {
    tree.unmount();
  });
}

describe('feature flags', () => {
  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    gateRenders.length = 0;
    configLoader = async () => null;
    applyRemoteFeatures(null);
  });

  it('starts with the frozen default snapshot', () => {
    expect(getFeatureFlags()).toEqual(DEFAULT_FEATURE_FLAGS);
    expect(getFeatureFlags()).toEqual({
      mcq: {
        enabled: true,
        recallFirst: true,
        maxPerRun: 2,
        answerTelemetry: false,
      },
      paywall: { hidden: false },
    });
    expect(Object.isFrozen(getFeatureFlags())).toBe(true);
    expect(Object.isFrozen(getFeatureFlags().mcq)).toBe(true);
    expect(Object.isFrozen(getFeatureFlags().paywall)).toBe(true);
  });

  it('applies and returns a full override', () => {
    const applied = applyRemoteFeatures({
      features: {
        mcq: {
          enabled: false,
          recallFirst: false,
          maxPerRun: 5,
          answerTelemetry: true,
        },
        paywall: { hidden: true },
      },
    });

    expect(applied).toBe(getFeatureFlags());
    expect(applied).toEqual({
      mcq: {
        enabled: false,
        recallFirst: false,
        maxPerRun: 5,
        answerTelemetry: true,
      },
      paywall: { hidden: true },
    });
  });

  it('fills omitted fields from defaults and accepts zero for maxPerRun', () => {
    expect(applyRemoteFeatures({ features: { paywall: { hidden: true } } })).toEqual({
      mcq: DEFAULT_FEATURE_FLAGS.mcq,
      paywall: { hidden: true },
    });

    expect(applyRemoteFeatures({ features: { mcq: { maxPerRun: 0 } } })).toEqual({
      mcq: {
        enabled: true,
        recallFirst: true,
        maxPerRun: 0,
        answerTelemetry: false,
      },
      paywall: DEFAULT_FEATURE_FLAGS.paywall,
    });
  });

  it('rejects malformed containers and invalid fields independently', () => {
    expect(applyRemoteFeatures(asRemoteConfig({ features: 'x' }))).toEqual(DEFAULT_FEATURE_FLAGS);
    expect(
      applyRemoteFeatures(
        asRemoteConfig({
          features: {
            mcq: [],
            paywall: { hidden: true },
          },
        }),
      ),
    ).toEqual({ mcq: DEFAULT_FEATURE_FLAGS.mcq, paywall: { hidden: true } });
    expect(
      applyRemoteFeatures(
        asRemoteConfig({
          features: {
            mcq: { enabled: false },
            paywall: 'closed',
          },
        }),
      ),
    ).toEqual({
      mcq: { ...DEFAULT_FEATURE_FLAGS.mcq, enabled: false },
      paywall: DEFAULT_FEATURE_FLAGS.paywall,
    });

    expect(
      applyRemoteFeatures(
        asRemoteConfig({
          features: {
            mcq: {
              enabled: 'no',
              recallFirst: 1,
              maxPerRun: '3',
              answerTelemetry: null,
            },
            paywall: { hidden: true },
          },
        }),
      ),
    ).toEqual({ mcq: DEFAULT_FEATURE_FLAGS.mcq, paywall: { hidden: true } });

    for (const maxPerRun of [null, 1.5, -1, Number.NaN]) {
      expect(
        applyRemoteFeatures(asRemoteConfig({ features: { mcq: { maxPerRun } } })).mcq.maxPerRun,
      ).toBe(DEFAULT_FEATURE_FLAGS.mcq.maxPerRun);
    }
  });

  it('resets overrides for null, undefined, and an empty config', () => {
    const emptyConfigs: Array<RemoteConfig | null | undefined> = [null, undefined, {}];

    for (const emptyConfig of emptyConfigs) {
      applyRemoteFeatures({
        features: {
          mcq: { enabled: false, maxPerRun: 7 },
          paywall: { hidden: true },
        },
      });
      expect(applyRemoteFeatures(emptyConfig)).toEqual(DEFAULT_FEATURE_FLAGS);
    }
  });

  it('notifies once per change, preserves identity for no-ops, and unsubscribes', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeFeatureFlags(listener);
    const config: RemoteConfig = {
      features: { mcq: { enabled: false }, paywall: { hidden: true } },
    };

    applyRemoteFeatures(config);
    expect(listener).toHaveBeenCalledTimes(1);

    const changedSnapshot = getFeatureFlags();
    expect(applyRemoteFeatures(config)).toBe(changedSnapshot);
    expect(getFeatureFlags()).toBe(changedSnapshot);
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    applyRemoteFeatures(null);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('useFeatureFlags reads defaults and re-renders for a new snapshot', async () => {
    const renders: FeatureFlags[] = [];
    let tree!: ReactTestRenderer;

    await act(async () => {
      tree = renderer.create(React.createElement(FeatureFlagProbe, { renders }));
    });

    expect(renders[0]).toEqual(DEFAULT_FEATURE_FLAGS);

    await act(async () => {
      applyRemoteFeatures({ features: { paywall: { hidden: true } } });
    });

    expect(renders.at(-1)).toEqual({
      mcq: DEFAULT_FEATURE_FLAGS.mcq,
      paywall: { hidden: true },
    });

    await unmount(tree);
  });

  it('applies a feature-only config before the non-gating return', async () => {
    configLoader = async () => ({
      features: {
        mcq: { enabled: false, maxPerRun: 4 },
        paywall: { hidden: true },
      },
    });
    let tree!: ReactTestRenderer;

    await act(async () => {
      tree = renderer.create(React.createElement(ForceUpdateProbe));
    });
    await flush();

    expect(gateRenders.every((gate) => gate === null)).toBe(true);
    expect(getFeatureFlags()).toEqual({
      mcq: {
        enabled: false,
        recallFirst: true,
        maxPerRun: 4,
        answerTelemetry: false,
      },
      paywall: { hidden: true },
    });

    await unmount(tree);
  });

  it('resets to defaults when the gate loader returns null', async () => {
    applyRemoteFeatures({
      features: { mcq: { enabled: false }, paywall: { hidden: true } },
    });
    configLoader = async () => null;
    let tree!: ReactTestRenderer;

    await act(async () => {
      tree = renderer.create(React.createElement(ForceUpdateProbe));
    });
    await flush();

    expect(gateRenders.every((gate) => gate === null)).toBe(true);
    expect(getFeatureFlags()).toEqual(DEFAULT_FEATURE_FLAGS);

    await unmount(tree);
  });
});
