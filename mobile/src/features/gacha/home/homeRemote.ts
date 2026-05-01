function isTruthyEnv(v: any): boolean {
  const s = String(v ?? '').trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}

const API_BASE_URL =
  (process.env.EXPO_PUBLIC_API_BASE_URL || '').trim() ||
  (process.env.EXPO_PUBLIC_API_BASE || '').trim() ||
  'https://ktbq1sie2c.execute-api.ap-southeast-2.amazonaws.com';

export async function fetchPremiumDeckUrl(slug: string, accessToken: string | null): Promise<{ url: string; buildId: string } | null> {
  const s = String(slug || '').trim();
  if (!s) return null;

  const u = new URL('/api/v1/content/premium-url', API_BASE_URL);
  u.searchParams.set('slug', s);

  const appEnv = String(process.env.EXPO_PUBLIC_ENV || '').trim().toLowerCase();
  const allowSandbox = appEnv === 'development' || isTruthyEnv(process.env.EXPO_PUBLIC_RC_ALLOW_SANDBOX);
  const bypassRaw = process.env.EXPO_PUBLIC_DEV_BYPASS_PREMIUM_URL;
  let allowDevBypass = false;

  if (allowSandbox) {
    if (appEnv === 'development') {
      allowDevBypass = bypassRaw ? isTruthyEnv(bypassRaw) : true;
    } else {
      allowDevBypass = isTruthyEnv(bypassRaw);
    }
  }

  if (allowDevBypass) u.searchParams.set('dev', '1');

  const headers: Record<string, string> = {
    'cache-control': 'no-cache',
    accept: 'application/json',
  };

  if (accessToken && accessToken.trim()) {
    headers.Authorization = `Bearer ${accessToken.trim()}`;
  }

  const resp = await fetch(u.toString(), { method: 'GET', headers });
  const json = await resp.json().catch(() => null);

  const ok = !!json?.success && !!json?.data?.url && !!json?.data?.buildId;
  if (!ok) {
    const msg = json?.error?.message || `Failed to get premium url (HTTP ${resp.status})`;
    throw new Error(msg);
  }

  return { url: String(json.data.url), buildId: String(json.data.buildId) };
}

export async function fetchServerPremium(accessToken: string | null): Promise<boolean> {
  if (!accessToken || !accessToken.trim()) return false;

  const u = new URL('/api/v1/entitlements', API_BASE_URL);
  const resp = await fetch(u.toString(), {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken.trim()}`,
      accept: 'application/json',
      'cache-control': 'no-cache',
    },
  });

  const json = await resp.json().catch(() => null);
  const tier = json?.data?.tier;
  return String(tier || '').toLowerCase() === 'premium';
}
