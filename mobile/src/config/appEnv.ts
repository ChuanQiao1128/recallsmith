// mobile/src/config/appEnv.ts
import * as Updates from 'expo-updates';

export type AppEnv = 'development' | 'production';

function norm(s: unknown): string {
  return String(s ?? '').trim().toLowerCase();
}

/**
 * ✅ Safety-first:
 * - If Updates.channel === 'production' => production (hard)
 * - else if EXPO_PUBLIC_ENV is set => use it
 * - else __DEV__ => development
 * - else default => production (hard)
 */
export function getAppEnv(): AppEnv {
  const ch = norm((Updates as any)?.channel);
  if (ch === 'production') return 'production';

  const env = norm(process.env.EXPO_PUBLIC_ENV);
  if (env === 'production') return 'production';
  if (env === 'development') return 'development';

  if (__DEV__) return 'development';
  return 'production';
}

export const APP_ENV: AppEnv = getAppEnv();
export const IS_PROD: boolean = APP_ENV === 'production';

export function premiumUrlPath(): string {
  return IS_PROD ? '/api/v1/content/premium-url' : '/api/v1/content/premium-url-dev';
}