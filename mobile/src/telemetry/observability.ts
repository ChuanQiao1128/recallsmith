// mobile/src/telemetry/observability.ts
//
// Sentry crash + performance reporting (1.9.0, M02; M00 §3.4). This is the only
// module that imports the Sentry SDK and the only reader of the bundled DSN.
// Every decision and scrubber lives in sentryPolicy.ts (pure).
//
// Sentry or the interim /client-errors handlers, never both: the choice is made
// once per launch in startObservability. Sentry installs its own ErrorUtils and
// Hermes rejection handlers, and only the last Hermes rejection tracker survives,
// so the interim handlers are installed only when Sentry stays inactive.

import type React from 'react';
import * as Sentry from '@sentry/react-native';

import { resolveApiBase, resolveApiFallback } from '../config/hosts';
import { getFeatureFlags, subscribeFeatureFlags } from '../config/featureFlags';
import { getExpoUpdatesModule } from '../updates/otaUpdateCheck';
import {
  SENTRY_KILL_SWITCH_TIMEOUT_MS,
  SENTRY_MAX_BREADCRUMBS,
  SENTRY_MAX_EVENTS_PER_SESSION,
  SENTRY_SAMPLE_RATE,
  SENTRY_TRACES_SAMPLE_RATE,
  buildOtaTags,
  buildTracePropagationTargets,
  decideSentry,
  isSentryKilled,
  scrubBreadcrumb,
  scrubEvent,
  shouldDropEvent,
  type SentryInactiveReason,
} from './sentryPolicy';

// Metro inlines only this literal member read; blank or absent until the DSN is
// set in the EAS production environment (M00 §9.2), which keeps Sentry off.
const BUNDLED_SENTRY_DSN = process.env.EXPO_PUBLIC_SENTRY_DSN;

export type ObservabilityReason = SentryInactiveReason | 'active' | 'pending';
export type ObservabilityStatus = { active: boolean; reason: ObservabilityReason };
export type ObservabilityDeps = {
  installInterimHandlers?: () => void;
  loadCachedConfig?: () => Promise<unknown>; // default: loadCachedRemoteConfig
  updates?: { channel?: unknown; updateId?: unknown; runtimeVersion?: unknown; isEmbeddedLaunch?: unknown } | null; // default: getExpoUpdatesModule()
  env?: { dsn?: unknown; isDev?: boolean }; // default: BUNDLED_SENTRY_DSN, __DEV__
  timeoutMs?: number; // default SENTRY_KILL_SWITCH_TIMEOUT_MS
};

type NavigationIntegration = ReturnType<typeof Sentry.reactNavigationIntegration>;

let status: ObservabilityStatus = { active: false, reason: 'pending' };
let started: Promise<ObservabilityStatus> | null = null;
let navigationIntegration: NavigationIntegration | null = null;
let passedEvents = 0;
let closed = false;
// onReady can fire inside the pending window; the ref is registered once init succeeds.
let pendingNavigationRef: { ref: unknown } | null = null;

/** Guarded, lazy read of the last-good remote config cache. remoteConfig.ts pulls
 *  AsyncStorage and expo modules, so it is required only when Sentry could start. */
function defaultLoadCachedConfig(): Promise<unknown> {
  try {
    const remoteConfig = require('../config/remoteConfig') as typeof import('../config/remoteConfig');
    return remoteConfig.loadCachedRemoteConfig();
  } catch {
    return Promise.resolve(null);
  }
}

function readCachedConfig(load: () => Promise<unknown>, timeoutMs: number): Promise<unknown> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });
  let read: Promise<unknown>;
  try {
    read = Promise.resolve(load()).catch(() => null);
  } catch {
    read = Promise.resolve(null);
  }
  return Promise.race([read, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

function closeForKillSwitch(): void {
  if (closed || !status.active) return;
  closed = true;
  status = { active: false, reason: 'kill-switch' };
  try {
    void Promise.resolve(Sentry.close()).catch(() => {});
  } catch {
    // never throw
  }
}

async function run(deps: ObservabilityDeps): Promise<ObservabilityStatus> {
  let interimInstalled = false;
  const installInterim = () => {
    if (interimInstalled) return;
    interimInstalled = true;
    try {
      deps.installInterimHandlers?.();
    } catch {
      // never throw
    }
  };

  const updates =
    deps.updates !== undefined
      ? deps.updates
      : (getExpoUpdatesModule() as ObservabilityDeps['updates']);
  const isDev = deps.env?.isDev ?? __DEV__;
  const dsn = deps.env && 'dsn' in deps.env ? deps.env.dsn : BUNDLED_SENTRY_DSN;

  // 1. Static gates: today's behaviour byte for byte when disabled.
  const gate = decideSentry({ isDev, channel: updates?.channel, dsn, killed: false });
  if (!gate.enabled) {
    installInterim();
    status = { active: false, reason: gate.reason };
    return status;
  }

  // 2. Kill switch from the last-good cached config, capped at timeoutMs.
  const config = await readCachedConfig(
    deps.loadCachedConfig ?? defaultLoadCachedConfig,
    deps.timeoutMs ?? SENTRY_KILL_SWITCH_TIMEOUT_MS,
  );
  if (isSentryKilled(config)) {
    installInterim();
    status = { active: false, reason: 'kill-switch' };
    return status;
  }

  // 3-4. JS init; a throw falls back to the interim handlers.
  try {
    const integration = Sentry.reactNavigationIntegration({ enableTimeToInitialDisplay: true });
    Sentry.init({
      dsn: gate.dsn,
      environment: gate.environment,
      sampleRate: SENTRY_SAMPLE_RATE,
      tracesSampleRate: SENTRY_TRACES_SAMPLE_RATE,
      sendDefaultPii: false,
      attachScreenshot: false,
      attachViewHierarchy: false,
      maxBreadcrumbs: SENTRY_MAX_BREADCRUMBS,
      enableAutoSessionTracking: true,
      enableUserInteractionTracing: false,
      tracePropagationTargets: buildTracePropagationTargets(resolveApiBase(), resolveApiFallback()),
      integrations: [integration],
      initialScope: { tags: { ...buildOtaTags(updates ?? null), 'app.env': 'production' } },
      beforeSend(event, hint) {
        if (shouldDropEvent(hint)) return null;
        if (passedEvents >= SENTRY_MAX_EVENTS_PER_SESSION) return null;
        passedEvents += 1;
        return scrubEvent(event);
      },
      beforeSendTransaction: scrubEvent,
      beforeBreadcrumb: scrubBreadcrumb,
    });
    navigationIntegration = integration;
  } catch {
    navigationIntegration = null;
    installInterim();
    status = { active: false, reason: 'init-failed' };
    return status;
  }

  // 5. Active; a same-launch remote flip to false closes the client once.
  status = { active: true, reason: 'active' };
  if (pendingNavigationRef) {
    const { ref } = pendingNavigationRef;
    pendingNavigationRef = null;
    registerNavigationContainer(ref);
  }
  subscribeFeatureFlags(() => {
    if (getFeatureFlags().sentry.enabled === false) closeForKillSwitch();
  });
  if (getFeatureFlags().sentry.enabled === false) closeForKillSwitch();
  return status;
}

/** Idempotent: later calls return the first promise. Never rejects. */
export function startObservability(deps: ObservabilityDeps = {}): Promise<ObservabilityStatus> {
  if (started) return started;
  started = run(deps).catch(() => {
    status = { active: false, reason: 'init-failed' };
    return status;
  });
  return started;
}

/** `{ active: false, reason: 'pending' }` until the first startObservability call settles. */
export function getObservabilityStatus(): ObservabilityStatus {
  return status;
}

export function captureException(error: unknown, ctx?: { screen?: string | null; kind?: string }): boolean {
  if (!status.active) return false;
  try {
    Sentry.captureException(error, {
      tags: { 'error.kind': ctx?.kind ?? 'js_error', 'error.screen': ctx?.screen ?? 'unknown' },
    });
    return true;
  } catch {
    return false;
  }
}

/** Non-fatal test event for the DebugMenu; there is no crash action. */
export function sendTestEvent(): { sent: boolean; eventId: string | null; reason: ObservabilityReason } {
  if (!status.active) return { sent: false, eventId: null, reason: status.reason };
  try {
    const eventId = Sentry.captureException(new Error('DeveloperCards Sentry test event'), {
      tags: { 'dc.test_event': 'true' },
    });
    return { sent: true, eventId: typeof eventId === 'string' ? eventId : null, reason: 'active' };
  } catch {
    return { sent: false, eventId: null, reason: status.reason };
  }
}

/** Inert when init never ran. */
export function wrapRootComponent<P extends object>(c: React.ComponentType<P>): React.ComponentType<P> {
  return Sentry.wrap(c as unknown as React.ComponentType<Record<string, unknown>>) as unknown as React.ComponentType<P>;
}

export function registerNavigationContainer(ref: unknown): void {
  if (status.reason === 'pending') {
    pendingNavigationRef = { ref };
    return;
  }
  if (!status.active) return;
  try {
    navigationIntegration?.registerNavigationContainer(ref);
  } catch {
    // never throw
  }
}
