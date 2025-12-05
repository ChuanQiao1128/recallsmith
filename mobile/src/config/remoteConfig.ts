// mobile/src/config/remoteConfig.ts
import Constants from 'expo-constants';
import * as Application from 'expo-application';

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
  // iOS/Android native version first
  const native = Application.nativeApplicationVersion;
  if (native && typeof native === 'string') return native;

  // Expo config fallback
  const expoV = Constants.expoConfig?.version;
  if (expoV && typeof expoV === 'string') return expoV;

  return '0.0.0';
}

export async function fetchRemoteConfig(
  url: string,
  timeoutMs: number = 4500,
): Promise<RemoteConfig | null> {
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

    return json as RemoteConfig;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
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