// mobile/src/config/debugMenu.ts
//
// R25 G03: the Debug menu (and the 7-tap door on the Settings version label) exists
// only in __DEV__ builds and on a named update channel other than "production". The
// "production" rule is sentryPolicy's isProductionChannel, so the two gates cannot drift
// apart on a named channel. F03: a missing, blank or non-string channel is NOT treated as
// "not production" here — outside __DEV__ it keeps the menu off (fail closed), just as it
// keeps Sentry off. isProductionChannel itself is unchanged.

import { isProductionChannel } from '../telemetry/sentryPolicy';
import { getExpoUpdatesModule } from '../updates/otaUpdateCheck';

function readUpdateChannel(): unknown {
  return (getExpoUpdatesModule() as { channel?: unknown } | null)?.channel;
}

/** __DEV__ || (channel is a non-blank string && channel !== "production"). Inputs default to __DEV__ and expo-updates' channel. */
export function isDebugMenuAvailable(i: { isDev?: boolean; channel?: unknown } = {}): boolean {
  const isDev = i.isDev ?? __DEV__;
  if (isDev) return true;
  const channel = 'channel' in i ? i.channel : readUpdateChannel();
  const named = typeof channel === 'string' && channel.trim() !== '';
  return named && !isProductionChannel(channel);
}
