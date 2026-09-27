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
  // seamOfLight = remote kill switch: flips the renderer to fallback (timings unchanged) for a
  // post-release shader/GPU crash class without an OTA. forceFallback = diagnostic twin of the
  // DebugMenu's in-memory override, published remotely.
  ceremony: { seamOfLight: boolean; forceFallback: boolean };
  // K02: hides the Mistake Book entry points (recording continues regardless); relatedCount =
  // related cards added to a focus run, integer 0..5.
  mistakeBook: { enabled: boolean; relatedCount: number };
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
  ceremony: Object.freeze({ seamOfLight: true, forceFallback: false }),
  mistakeBook: Object.freeze({ enabled: true, relatedCount: 3 }),
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
    && left.ceremony.seamOfLight === right.ceremony.seamOfLight
    && left.ceremony.forceFallback === right.ceremony.forceFallback
    && left.mistakeBook.enabled === right.mistakeBook.enabled
    && left.mistakeBook.relatedCount === right.mistakeBook.relatedCount
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
  const remoteCeremony = features?.ceremony;
  const mcq = isRecord(remoteMcq) ? remoteMcq : undefined;
  const paywall = isRecord(remotePaywall) ? remotePaywall : undefined;
  const ceremony = isRecord(remoteCeremony) ? remoteCeremony : undefined;
  const remoteMistakeBook = features?.mistakeBook;
  const mistakeBook = isRecord(remoteMistakeBook) ? remoteMistakeBook : undefined;

  const maxPerRun = mcq?.maxPerRun;
  const relatedCount = mistakeBook?.relatedCount;
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
    ceremony: Object.freeze({
      seamOfLight:
        typeof ceremony?.seamOfLight === 'boolean'
          ? ceremony.seamOfLight
          : DEFAULT_FEATURE_FLAGS.ceremony.seamOfLight,
      forceFallback:
        typeof ceremony?.forceFallback === 'boolean'
          ? ceremony.forceFallback
          : DEFAULT_FEATURE_FLAGS.ceremony.forceFallback,
    }),
    mistakeBook: Object.freeze({
      enabled:
        typeof mistakeBook?.enabled === 'boolean'
          ? mistakeBook.enabled
          : DEFAULT_FEATURE_FLAGS.mistakeBook.enabled,
      relatedCount:
        typeof relatedCount === 'number'
          && Number.isInteger(relatedCount)
          && relatedCount >= 0
          && relatedCount <= 5
          ? relatedCount
          : DEFAULT_FEATURE_FLAGS.mistakeBook.relatedCount,
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
