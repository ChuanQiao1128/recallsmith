// mobile/src/config/remoteConfig.ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Application from 'expo-application';

// Last successfully parsed config. It exists so the version gate survives a
// launch with no network, which matters in both directions: a user who is
// offline is not silently un-gated, and a user who is offline is not made to
// wait for a timeout before the app appears.
//
// The cost, stated plainly: a config that once said "force update" keeps
// saying it while offline. That is the correct reading of a
// minSupportedVersion (the old client is broken against the server, and
// losing wifi does not fix it), but it does mean a mis-published gate is
// harder to walk back than a mis-served one. resolveIosUpdate compares
// against the *current* app version, so upgrading always clears it.
const REMOTE_CONFIG_CACHE_KEY = 'recallsmith:remote-config:last-good:v1';

export type IosRemoteConfig = {
  minSupportedVersion?: string;
  latestVersion?: string;
  updateUrl?: string;    // https://apps.apple.com/app/idxxxx
  appStoreId?: string;   // xxxx
  message?: string;
};

export type RemoteConfig = {
  ios?: IosRemoteConfig;
};

function parseSemver(v: string): [number, number, number] {
  const parts = v.trim().split('.').map(x => Number(x));
  const a = Number.isFinite(parts[0]) ? parts[0] : 0;
  const b = Number.isFinite(parts[1]) ? parts[1] : 0;
  const c = Number.isFinite(parts[2]) ? parts[2] : 0;
  return [a, b, c];
}

export function compareSemver(a: string, b: string): number {
  const A = parseSemver(a);
  const B = parseSemver(b);
  for (let i = 0; i < 3; i++) {
    if (A[i] < B[i]) return -1;
    if (A[i] > B[i]) return 1;
  }
  return 0;
}

export function getCurrentAppVersion(): string {
  const expoV = Constants.expoConfig?.version;
  const native = Application.nativeApplicationVersion;

  // 在 Expo Go / dev client 环境，nativeApplicationVersion 是 Expo 的版本（如 2.x），所以优先用项目 version
  if (Constants.appOwnership === 'expo') {
    if (expoV && typeof expoV === 'string') return expoV;
    if (native && typeof native === 'string') return native;
    return '0.0.0';
  }

  // 独立包：先看原生版本，再兜底 Expo 配置
  if (native && typeof native === 'string') return native;
  if (expoV && typeof expoV === 'string') return expoV;
  return '0.0.0';
}

export async function loadCachedRemoteConfig(): Promise<RemoteConfig | null> {
  try {
    const raw = await AsyncStorage.getItem(REMOTE_CONFIG_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed as RemoteConfig;
  } catch {
    return null;
  }
}

export async function fetchRemoteConfig(
  url: string,
  timeoutMs: number = 4500,
): Promise<RemoteConfig | null> {
  // No `?t=${Date.now()}`. A unique query string per launch makes every
  // request a cache miss all the way to the origin -- which is exactly the
  // latency this file was paying for on a cold start -- and it buys nothing
  // the 'cache-control: no-cache' header below does not already ask for.
  // Revalidation is what we want; a permanent cache bypass is not.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const resp = await fetch(url, {
      method: 'GET',
      headers: { 'cache-control': 'no-cache' },
      signal: controller.signal,
    });

    if (!resp.ok) return null;

    const json = (await resp.json()) as unknown;
    if (!json || typeof json !== 'object') return null;

    // Cache only what parsed. A 500 body or a truncated response must not
    // become the config this device believes in for the next month.
    try {
      await AsyncStorage.setItem(REMOTE_CONFIG_CACHE_KEY, JSON.stringify(json));
    } catch {
      // A config we could not persist is still valid for this launch.
    }

    return json as RemoteConfig;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Network first, last-good second. Returns null only when this device has
 * never successfully read the config.
 */
export async function loadRemoteConfig(
  url: string,
  timeoutMs: number = 4500,
): Promise<RemoteConfig | null> {
  const fresh = await fetchRemoteConfig(url, timeoutMs);
  if (fresh) return fresh;
  return loadCachedRemoteConfig();
}

export function resolveIosUpdate(config: RemoteConfig, currentVersion: string): {
  forceUpdate: boolean;
  updateUrl: string | null;
  message: string;
  minSupportedVersion: string | null;
  latestVersion: string | null;
} {
  const ios = config.ios ?? {};

  const minV = ios.minSupportedVersion?.trim() || null;
  const latestV = ios.latestVersion?.trim() || null;

  const url =
    ios.updateUrl?.trim()
      ? ios.updateUrl.trim()
      : ios.appStoreId?.trim()
      ? `https://apps.apple.com/app/id${ios.appStoreId.trim()}`
      : null;

  const message =
    ios.message?.trim() ||
    'A new version is required to continue. Please update from the App Store.';

  const forceUpdate =
    !!minV && compareSemver(currentVersion, minV) < 0;

  return {
    forceUpdate,
    updateUrl: url,
    message,
    minSupportedVersion: minV,
    latestVersion: latestV,
  };
}
