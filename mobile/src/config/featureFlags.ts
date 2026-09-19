import { useSyncExternalStore } from 'react';

import type { RemoteConfig } from './remoteConfig';

export type FeatureFlags = {
  mcq: {
    enabled: boolean;
    recallFirst: boolean;
    maxPerRun: number;
    answerTelemetry: boolean;
  };
  paywall: {
    hidden: boolean;
  };
};

export const DEFAULT_FEATURE_FLAGS: FeatureFlags = Object.freeze({
  mcq: Object.freeze({
    enabled: true,
    recallFirst: true,
    maxPerRun: 2,
    answerTelemetry: false,
  }),
  paywall: Object.freeze({
    hidden: false,
  }),
});

let snapshot = DEFAULT_FEATURE_FLAGS;
const listeners = new Set<() => void>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function snapshotsEqual(left: FeatureFlags, right: FeatureFlags): boolean {
  return (
    left.mcq.enabled === right.mcq.enabled
    && left.mcq.recallFirst === right.mcq.recallFirst
    && left.mcq.maxPerRun === right.mcq.maxPerRun
    && left.mcq.answerTelemetry === right.mcq.answerTelemetry
    && left.paywall.hidden === right.paywall.hidden
  );
}

export function getFeatureFlags(): FeatureFlags {
  return snapshot;
}

/**
 * Written once per launch after useForceUpdateGate loads network-first config
 * or its last-good cache. A value published to S3 reaches a device on its
 * next cold start; nothing re-fetches, so flags never flip mid-session.
 * Consumers should read a flag once when they need it, not as live policy.
 */
export function applyRemoteFeatures(config: RemoteConfig | null | undefined): FeatureFlags {
  const remoteFeatures: unknown = config?.features;
  const features = isRecord(remoteFeatures) ? remoteFeatures : undefined;
  const remoteMcq = features?.mcq;
  const remotePaywall = features?.paywall;
  const mcq = isRecord(remoteMcq) ? remoteMcq : undefined;
  const paywall = isRecord(remotePaywall) ? remotePaywall : undefined;

  const maxPerRun = mcq?.maxPerRun;
  const nextSnapshot: FeatureFlags = Object.freeze({
    mcq: Object.freeze({
      enabled:
        typeof mcq?.enabled === 'boolean'
          ? mcq.enabled
          : DEFAULT_FEATURE_FLAGS.mcq.enabled,
      recallFirst:
        typeof mcq?.recallFirst === 'boolean'
          ? mcq.recallFirst
          : DEFAULT_FEATURE_FLAGS.mcq.recallFirst,
      maxPerRun:
        typeof maxPerRun === 'number' && Number.isInteger(maxPerRun) && maxPerRun >= 0
          ? maxPerRun
          : DEFAULT_FEATURE_FLAGS.mcq.maxPerRun,
      answerTelemetry:
        typeof mcq?.answerTelemetry === 'boolean'
          ? mcq.answerTelemetry
          : DEFAULT_FEATURE_FLAGS.mcq.answerTelemetry,
    }),
    paywall: Object.freeze({
      hidden:
        typeof paywall?.hidden === 'boolean'
          ? paywall.hidden
          : DEFAULT_FEATURE_FLAGS.paywall.hidden,
    }),
  });

  if (snapshotsEqual(snapshot, nextSnapshot)) return snapshot;

  snapshot = nextSnapshot;
  [...listeners].forEach((listener) => listener());
  return snapshot;
}

export function subscribeFeatureFlags(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useFeatureFlags(): FeatureFlags {
  return useSyncExternalStore(subscribeFeatureFlags, getFeatureFlags, getFeatureFlags);
}
