// mobile/src/config/hosts.ts
// Wave E / E09: the API hostnames every non-frozen caller resolves. Pure: no react,
// no storage, no clock, no fetch. deckRepository.ts (frozen, E00 §0) keeps its own
// CloudFront + execute-api defaults; the EAS env at OTA-bundle time moves those.
//
// Metro (babel-preset-expo) inlines ONLY literal `process.env.EXPO_PUBLIC_*` member
// expressions; a dynamic read such as `env[name]` is undefined in a release bundle.
// The three reads below are therefore spelled out literally, once, and the resolvers
// take an explicit env object only so tests can drive precedence.

export const DEFAULT_API_BASE = 'https://api.developercards.app';
export const FALLBACK_API_BASE = 'https://ktbq1sie2c.execute-api.ap-southeast-2.amazonaws.com';

export type HostEnv = {
  EXPO_PUBLIC_API_BASE_URL?: string;
  EXPO_PUBLIC_API_BASE?: string;
  EXPO_PUBLIC_API_BASE_FALLBACK?: string;
};

function bundledEnv(): HostEnv {
  return {
    EXPO_PUBLIC_API_BASE_URL: process.env.EXPO_PUBLIC_API_BASE_URL,
    EXPO_PUBLIC_API_BASE: process.env.EXPO_PUBLIC_API_BASE,
    EXPO_PUBLIC_API_BASE_FALLBACK: process.env.EXPO_PUBLIC_API_BASE_FALLBACK,
  };
}

/** trim, drop trailing slashes; '' when unset or blank. */
function cleanHost(v: string | undefined): string {
  return String(v ?? '').trim().replace(/\/+$/, '');
}

/** EXPO_PUBLIC_API_BASE_URL || EXPO_PUBLIC_API_BASE || DEFAULT_API_BASE, trimmed, no trailing slash. */
export function resolveApiBase(env: HostEnv = bundledEnv()): string {
  return cleanHost(env.EXPO_PUBLIC_API_BASE_URL) || cleanHost(env.EXPO_PUBLIC_API_BASE) || DEFAULT_API_BASE;
}

/** EXPO_PUBLIC_API_BASE_FALLBACK || (the base is the default hostname ? the legacy execute-api host : null). */
export function resolveApiFallback(env: HostEnv = bundledEnv()): string | null {
  return cleanHost(env.EXPO_PUBLIC_API_BASE_FALLBACK) || (resolveApiBase(env) === DEFAULT_API_BASE ? FALLBACK_API_BASE : null);
}
