// mobile/src/content/premiumDeckApi.ts
import { fetchAuthSession } from 'aws-amplify/auth';
import * as Updates from 'expo-updates';

const API_BASE =
  (process.env.EXPO_PUBLIC_API_BASE_URL || '').trim() ||
  (process.env.EXPO_PUBLIC_API_BASE || '').trim() ||
  '';

export type PremiumDeckUrlResp = {
  slug: string;
  buildId: string;
  url: string;
  expiresInSec?: number;
  devBypass?: boolean;
};

function tokenToString(t: any): string | null {
  if (!t) return null;
  if (typeof t === 'string') return t;
  if (typeof t?.toString === 'function') return String(t.toString());
  return null;
}

function isDevChannel(chRaw: string): boolean {
  const ch = String(chRaw || '').toLowerCase().trim();
  if (!ch) return false;
  if (ch === 'development' || ch === 'dev') return true;
  if (ch.startsWith('dev-') || ch.startsWith('development-')) return true;
  return false;
}

/**
 * SAFE routing:
 * - EXPO_PUBLIC_ENV=production  => prod route
 * - EXPO_PUBLIC_ENV=development => dev route
 * - else:
 *    - __DEV__ === true => dev route (dev-client/metro)
 *    - else if Updates.channel explicitly dev => dev route
 *    - else => prod route
 */
function resolvePremiumUrlPath(): string {
  const env = String(process.env.EXPO_PUBLIC_ENV || '').toLowerCase().trim();

  if (env === 'production') return '/api/v1/content/premium-url';
  if (env === 'development') return '/api/v1/content/premium-url-dev';

  // Metro / dev-client
  if (__DEV__) return '/api/v1/content/premium-url-dev';

  // Release builds: only trust explicit channel
  const ch = String((Updates as any).channel || '').trim();
  if (isDevChannel(ch)) return '/api/v1/content/premium-url-dev';

  // Default SAFE
  return '/api/v1/content/premium-url';
}

export async function fetchPremiumDeckUrl(slug: string): Promise<PremiumDeckUrlResp> {
  if (!API_BASE) throw new Error('Missing EXPO_PUBLIC_API_BASE_URL');

  const safeSlug = String(slug || '').trim();
  if (!safeSlug) throw new Error('Missing slug');

  const session: any = await fetchAuthSession();

  // Prefer access token (your API accepts it)
  const token =
    tokenToString(session?.tokens?.accessToken) ??
    tokenToString(session?.tokens?.idToken) ??
    null;

  if (!token) throw new Error('Missing auth token (not signed in)');

  const path = resolvePremiumUrlPath();
  const endpoint = `${API_BASE}${path}?slug=${encodeURIComponent(safeSlug)}`;

  const channel = String((Updates as any).channel || '').trim();

  if (__DEV__) {
    console.log('[premium-url] route', {
      path,
      channel: channel || null,
      env: process.env.EXPO_PUBLIC_ENV || null,
      dev: __DEV__,
    });
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    accept: 'application/json',
    'cache-control': 'no-cache',
  };

  // Optional hint: dev route send header (server 端已强制 dev=1，这只是额外保险)
  if (path.endsWith('-dev')) {
    headers['x-dev-bypass'] = '1';
  }

  const res = await fetch(endpoint, { method: 'GET', headers });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`premium-url failed (${res.status}): ${text}`);
  }

  const json: any = await res.json();
  const data = json?.data ?? json;

  const out: PremiumDeckUrlResp = {
    slug: String(data?.slug ?? safeSlug),
    buildId: String(data?.buildId ?? ''),
    url: String(data?.url ?? ''),
    expiresInSec: data?.expiresInSec != null ? Number(data.expiresInSec) : undefined,
    devBypass: data?.devBypass ?? undefined,
  };

  if (!out.buildId || !out.url) throw new Error('premium-url response missing buildId/url');

  if (__DEV__) {
    const u = out.url;
    console.log('[premium-url] ok', {
      slug: out.slug,
      buildId: out.buildId,
      urlLen: u.length,
      head: u.slice(0, 32),
      tail: u.slice(-24),
      expiresInSec: out.expiresInSec ?? null,
      devBypass: out.devBypass ?? null,
      path,
    });
  }

  return out;
}