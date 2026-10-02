// mobile/src/config/debugMenu.ts
//
// R25 G03: the Debug menu (and the 7-tap door on the Settings version label) exists
// only in __DEV__ builds and on update channels other than "production". The channel
// rule is sentryPolicy's isProductionChannel, so the two gates cannot drift apart.

import { isProductionChannel } from '../telemetry/sentryPolicy';
import { getExpoUpdatesModule } from '../updates/otaUpdateCheck';

function readUpdateChannel(): unknown {
  return (getExpoUpdatesModule() as { channel?: unknown } | null)?.channel;
}

/** __DEV__ || update channel !== "production". Inputs default to __DEV__ and expo-updates' channel. */
export function isDebugMenuAvailable(i: { isDev?: boolean; channel?: unknown } = {}): boolean {
  const isDev = i.isDev ?? __DEV__;
  const channel = 'channel' in i ? i.channel : readUpdateChannel();
  return isDev || !isProductionChannel(channel);
}
