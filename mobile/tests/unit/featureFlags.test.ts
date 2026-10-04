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
  isFsrsEnabled,
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
      ceremony: { seamOfLight: true, forceFallback: false },
      mistakeBook: DEFAULT_FEATURE_FLAGS.mistakeBook,
      cardSource: DEFAULT_FEATURE_FLAGS.cardSource,
      sentry: DEFAULT_FEATURE_FLAGS.sentry,
      cardReport: { enabled: false, anonymous: false },
      fsrs: { enabled: true },
      anonFunnel: { enabled: false },
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
      ceremony: DEFAULT_FEATURE_FLAGS.ceremony,
      mistakeBook: DEFAULT_FEATURE_FLAGS.mistakeBook,
      cardSource: DEFAULT_FEATURE_FLAGS.cardSource,
      sentry: DEFAULT_FEATURE_FLAGS.sentry,
      cardReport: DEFAULT_FEATURE_FLAGS.cardReport,
      fsrs: DEFAULT_FEATURE_FLAGS.fsrs,
      anonFunnel: DEFAULT_FEATURE_FLAGS.anonFunnel,
    });
  });

  it('fills omitted fields from defaults and accepts zero for maxPerRun', () => {
    expect(applyRemoteFeatures({ features: { paywall: { hidden: true } } })).toEqual({
      mcq: DEFAULT_FEATURE_FLAGS.mcq,
      paywall: { hidden: true },
      ceremony: DEFAULT_FEATURE_FLAGS.ceremony,
      mistakeBook: DEFAULT_FEATURE_FLAGS.mistakeBook,
      cardSource: DEFAULT_FEATURE_FLAGS.cardSource,
      sentry: DEFAULT_FEATURE_FLAGS.sentry,
      cardReport: DEFAULT_FEATURE_FLAGS.cardReport,
      fsrs: DEFAULT_FEATURE_FLAGS.fsrs,
      anonFunnel: DEFAULT_FEATURE_FLAGS.anonFunnel,
    });

    expect(applyRemoteFeatures({ features: { mcq: { maxPerRun: 0 } } })).toEqual({
      mcq: {
        enabled: true,
        recallFirst: true,
        maxPerRun: 0,
        answerTelemetry: false,
      },
      paywall: DEFAULT_FEATURE_FLAGS.paywall,
      ceremony: DEFAULT_FEATURE_FLAGS.ceremony,
      mistakeBook: DEFAULT_FEATURE_FLAGS.mistakeBook,
      cardSource: DEFAULT_FEATURE_FLAGS.cardSource,
      sentry: DEFAULT_FEATURE_FLAGS.sentry,
      cardReport: DEFAULT_FEATURE_FLAGS.cardReport,
      fsrs: DEFAULT_FEATURE_FLAGS.fsrs,
      anonFunnel: DEFAULT_FEATURE_FLAGS.anonFunnel,
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
    ).toEqual({ mcq: DEFAULT_FEATURE_FLAGS.mcq, paywall: { hidden: true }, ceremony: DEFAULT_FEATURE_FLAGS.ceremony, mistakeBook: DEFAULT_FEATURE_FLAGS.mistakeBook, cardSource: DEFAULT_FEATURE_FLAGS.cardSource, sentry: DEFAULT_FEATURE_FLAGS.sentry, cardReport: DEFAULT_FEATURE_FLAGS.cardReport, fsrs: DEFAULT_FEATURE_FLAGS.fsrs, anonFunnel: DEFAULT_FEATURE_FLAGS.anonFunnel });
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
      ceremony: DEFAULT_FEATURE_FLAGS.ceremony,
      mistakeBook: DEFAULT_FEATURE_FLAGS.mistakeBook,
      cardSource: DEFAULT_FEATURE_FLAGS.cardSource,
      sentry: DEFAULT_FEATURE_FLAGS.sentry,
      cardReport: DEFAULT_FEATURE_FLAGS.cardReport,
      fsrs: DEFAULT_FEATURE_FLAGS.fsrs,
      anonFunnel: DEFAULT_FEATURE_FLAGS.anonFunnel,
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
    ).toEqual({ mcq: DEFAULT_FEATURE_FLAGS.mcq, paywall: { hidden: true }, ceremony: DEFAULT_FEATURE_FLAGS.ceremony, mistakeBook: DEFAULT_FEATURE_FLAGS.mistakeBook, cardSource: DEFAULT_FEATURE_FLAGS.cardSource, sentry: DEFAULT_FEATURE_FLAGS.sentry, cardReport: DEFAULT_FEATURE_FLAGS.cardReport, fsrs: DEFAULT_FEATURE_FLAGS.fsrs, anonFunnel: DEFAULT_FEATURE_FLAGS.anonFunnel });

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
      ceremony: DEFAULT_FEATURE_FLAGS.ceremony,
      mistakeBook: DEFAULT_FEATURE_FLAGS.mistakeBook,
      cardSource: DEFAULT_FEATURE_FLAGS.cardSource,
      sentry: DEFAULT_FEATURE_FLAGS.sentry,
      cardReport: DEFAULT_FEATURE_FLAGS.cardReport,
      fsrs: DEFAULT_FEATURE_FLAGS.fsrs,
      anonFunnel: DEFAULT_FEATURE_FLAGS.anonFunnel,
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
      ceremony: DEFAULT_FEATURE_FLAGS.ceremony,
      mistakeBook: DEFAULT_FEATURE_FLAGS.mistakeBook,
      cardSource: DEFAULT_FEATURE_FLAGS.cardSource,
      sentry: DEFAULT_FEATURE_FLAGS.sentry,
      cardReport: DEFAULT_FEATURE_FLAGS.cardReport,
      fsrs: DEFAULT_FEATURE_FLAGS.fsrs,
      anonFunnel: DEFAULT_FEATURE_FLAGS.anonFunnel,
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

  it('ships the ceremony defaults frozen: seamOfLight on, forceFallback off', () => {
    expect(getFeatureFlags().ceremony).toEqual({ seamOfLight: true, forceFallback: false });
    expect(Object.isFrozen(getFeatureFlags().ceremony)).toBe(true);
    expect(DEFAULT_FEATURE_FLAGS.ceremony).toEqual({ seamOfLight: true, forceFallback: false });
  });

  it('applies boolean ceremony overrides and falls back per field on anything else', () => {
    const applied = applyRemoteFeatures(
      asRemoteConfig({ features: { ceremony: { seamOfLight: false, forceFallback: true } } }),
    );
    expect(applied.ceremony).toEqual({ seamOfLight: false, forceFallback: true });
    expect(applied.mcq).toEqual(DEFAULT_FEATURE_FLAGS.mcq);
    expect(applied.paywall).toEqual(DEFAULT_FEATURE_FLAGS.paywall);

    expect(
      applyRemoteFeatures(asRemoteConfig({ features: { ceremony: { seamOfLight: 'off', forceFallback: 1 } } })).ceremony,
    ).toEqual(DEFAULT_FEATURE_FLAGS.ceremony);
    expect(
      applyRemoteFeatures(asRemoteConfig({ features: { ceremony: [] } })).ceremony,
    ).toEqual(DEFAULT_FEATURE_FLAGS.ceremony);
    expect(
      applyRemoteFeatures(asRemoteConfig({ features: { ceremony: { seamOfLight: false } } })).ceremony,
    ).toEqual({ seamOfLight: false, forceFallback: false });
  });

  it('notifies subscribers when only a ceremony flag changes', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeFeatureFlags(listener);

    applyRemoteFeatures(asRemoteConfig({ features: { ceremony: { seamOfLight: false } } }));
    expect(listener).toHaveBeenCalledTimes(1);

    const changed = getFeatureFlags();
    expect(applyRemoteFeatures(asRemoteConfig({ features: { ceremony: { seamOfLight: false } } }))).toBe(changed);
    expect(listener).toHaveBeenCalledTimes(1);

    applyRemoteFeatures(null);
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
  });

  it('fsrs: on by default, remote false turns it off, non-boolean keeps the default', () => {
    expect(DEFAULT_FEATURE_FLAGS.fsrs).toEqual({ enabled: true });
    expect(Object.isFrozen(DEFAULT_FEATURE_FLAGS.fsrs)).toBe(true);
    expect(isFsrsEnabled()).toBe(true);

    expect(applyRemoteFeatures(asRemoteConfig({ features: { fsrs: { enabled: false } } })).fsrs).toEqual({
      enabled: false,
    });
    expect(isFsrsEnabled()).toBe(false);

    expect(applyRemoteFeatures(asRemoteConfig({ features: { fsrs: { enabled: true } } })).fsrs).toEqual({
      enabled: true,
    });
    expect(isFsrsEnabled()).toBe(true);

    expect(applyRemoteFeatures(asRemoteConfig({ features: { fsrs: { enabled: 'off' } } })).fsrs).toEqual({
      enabled: true,
    });
    expect(applyRemoteFeatures(asRemoteConfig({ features: { fsrs: [] } })).fsrs).toEqual({ enabled: true });
  });

  it('fsrs: notifies subscribers when only the fsrs flag changes', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeFeatureFlags(listener);

    applyRemoteFeatures(asRemoteConfig({ features: { fsrs: { enabled: false } } }));
    expect(listener).toHaveBeenCalledTimes(1);

    applyRemoteFeatures(null);
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
  });

  it('anonFunnel defaults off and only a boolean true turns it on (R24 §3.4)', () => {
    expect(DEFAULT_FEATURE_FLAGS.anonFunnel).toEqual({ enabled: false });
    expect(Object.isFrozen(DEFAULT_FEATURE_FLAGS.anonFunnel)).toBe(true);
    expect(getFeatureFlags().anonFunnel.enabled).toBe(false);

    for (const enabled of ['true', 1, null, [], {}]) {
      expect(applyRemoteFeatures(asRemoteConfig({ features: { anonFunnel: { enabled } } })).anonFunnel).toEqual({
        enabled: false,
      });
    }
    for (const anonFunnel of [true, 'on', [], null]) {
      expect(applyRemoteFeatures(asRemoteConfig({ features: { anonFunnel } })).anonFunnel).toEqual({ enabled: false });
    }

    const listener = vi.fn();
    const unsubscribe = subscribeFeatureFlags(listener);
    const on = applyRemoteFeatures(asRemoteConfig({ features: { anonFunnel: { enabled: true } } }));
    expect(on.anonFunnel).toEqual({ enabled: true });
    expect(Object.isFrozen(on.anonFunnel)).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(applyRemoteFeatures(asRemoteConfig({ features: { anonFunnel: { enabled: true } } }))).toBe(on);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });
});
