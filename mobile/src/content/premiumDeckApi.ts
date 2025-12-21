// mobile/src/content/premiumDeckApi.ts
import { fetchAuthSession } from 'aws-amplify/auth';

const API_BASE = (process.env.EXPO_PUBLIC_API_BASE_URL || '').trim();

export type PremiumDeckUrlResp = {
  slug: string;
  buildId: string;
  url: string;
  expiresInSec?: number;
};

export async function fetchPremiumDeckUrl(slug: string): Promise<PremiumDeckUrlResp> {
  if (!API_BASE) throw new Error('Missing EXPO_PUBLIC_API_BASE_URL');

  // 取 token（如果你项目里用别的方式取，也可以换成你现成的）
  const session = await fetchAuthSession();
  const token =
    session.tokens?.idToken?.toString() ??
    session.tokens?.accessToken?.toString() ??
    null;

  const qs = `slug=${encodeURIComponent(slug)}${__DEV__ ? '&dev=1' : ''}`;
  const endpoint = `${API_BASE}/api/v1/content/premium-url?${qs}`;

  const res = await fetch(endpoint, {
    method: 'GET',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`premium-url failed (${res.status}): ${text}`);
  }

  const json: any = await res.json();
  return {
    slug: String(json.slug ?? slug),
    buildId: String(json.buildId),
    url: String(json.url),
    expiresInSec: json.expiresInSec ? Number(json.expiresInSec) : undefined,
  };
}