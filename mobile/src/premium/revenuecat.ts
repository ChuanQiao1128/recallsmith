// mobile/src/premium/revenuecat.ts
import Purchases, { type CustomerInfo, type PurchasesPackage } from 'react-native-purchases';
import { fetchAuthSession } from 'aws-amplify/auth';
import { APP_ENV, IS_PROD, premiumUrlPath } from '../config/appEnv';

// ---------- Env ----------
const RC_IOS_API_KEY = (process.env.EXPO_PUBLIC_RC_IOS_API_KEY || '').trim();
const ENTITLEMENT_ID = (process.env.EXPO_PUBLIC_RC_ENTITLEMENT_ID || '').trim(); // MUST be Identifier
const MONTHLY_PRODUCT_ID = (process.env.EXPO_PUBLIC_RC_MONTHLY_PRODUCT_ID || '').trim();

const API_BASE_URL =
  (process.env.EXPO_PUBLIC_API_BASE_URL || '').trim() ||
  (process.env.EXPO_PUBLIC_API_BASE || '').trim() ||
  '';

/**
 * ✅ Hard safety:
 * - production build: NEVER allow sandbox as Premium
 * - dev build: allow sandbox by default
 */
const _allowSandboxRaw = String(process.env.EXPO_PUBLIC_RC_ALLOW_SANDBOX || '1') === '1';
export const ALLOW_SANDBOX: boolean = IS_PROD ? false : _allowSandboxRaw;

if (IS_PROD && _allowSandboxRaw) {
  console.warn('[rc] EXPO_PUBLIC_RC_ALLOW_SANDBOX=1 ignored because build is production.');
}

// Dangerous fallback (dev-only): if entitlement id mismatch but there are active entitlements, treat as premium.
// ✅ hard-disabled on production build
const _allowAnyEntRaw = String(process.env.EXPO_PUBLIC_RC_ALLOW_ANY_ENTITLEMENT || '0') === '1';
const ALLOW_ANY_ACTIVE_ENTITLEMENT_FALLBACK: boolean = IS_PROD ? false : _allowAnyEntRaw;

export const PREMIUM_URL_PATH = premiumUrlPath(); // '/api/v1/content/premium-url' or '-dev'

export type PremiumEnv = 'production' | 'sandbox' | 'none';

export type PremiumStatus = {
  active: boolean; // effective (after sandbox gate)
  activeProduction: boolean;
  activeSandbox: boolean;

  env: PremiumEnv; // effective env for `active`
  entitlementId: string | null;

  productId: string | null;
  expiresAtMs: number | null;
  isSandbox: boolean | null;

  source:
    | 'entitlement_strict'
    | 'any_entitlement_fallback'
    | 'activeSubscriptions_fallback'
    | 'none';
};

let _configurePromise: Promise<void> | null = null;
let _loginPromise: Promise<string | null> | null = null;
let _lastLoggedInSub: string | null = null;

function tokenToString(t: any): string | null {
  if (!t) return null;
  if (typeof t === 'string') return t;
  if (typeof t?.toString === 'function') return String(t.toString());
  return null;
}

function toMsDate(v: any): number | null {
  if (v == null) return null;
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) return Math.floor(v);
  if (v instanceof Date) {
    const ms = v.getTime();
    return Number.isFinite(ms) && ms > 0 ? ms : null;
  }
  const s = String(v).trim();
  if (!s) return null;
  const ms = Date.parse(s);
  return Number.isFinite(ms) && ms > 0 ? ms : null;
}

function pickBool(v: any): boolean | null {
  if (typeof v === 'boolean') return v;
  if (v === 1) return true;
  if (v === 0) return false;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (s === 'true') return true;
    if (s === 'false') return false;
  }
  return null;
}

function entitlementIsSandbox(ent: any): boolean | null {
  // RN SDK uses camelCase (isSandbox). Some payloads might expose is_sandbox.
  return pickBool(ent?.isSandbox ?? ent?.is_sandbox);
}

function entitlementIsActive(ent: any): boolean {
  const v = ent?.isActive;
  if (typeof v === 'boolean') return v;
  const exp = toMsDate(ent?.expirationDate ?? ent?.expiresDate ?? ent?.expiration_date ?? ent?.expires_date);
  if (exp == null) return true;
  return exp > Date.now();
}

function entitlementProductId(ent: any): string | null {
  const v = ent?.productIdentifier ?? ent?.product_identifier ?? ent?.productId ?? ent?.product_id ?? null;
  return v ? String(v).trim() : null;
}

function entitlementExpiresAtMs(ent: any): number | null {
  return toMsDate(ent?.expirationDate ?? ent?.expiresDate ?? ent?.expiration_date ?? ent?.expires_date);
}

function getActiveEntitlementMap(info: CustomerInfo | null | undefined): Record<string, any> {
  const m = (info as any)?.entitlements?.active;
  return m && typeof m === 'object' ? (m as Record<string, any>) : {};
}

function getAllEntitlementMap(info: CustomerInfo | null | undefined): Record<string, any> {
  const m = (info as any)?.entitlements?.all;
  return m && typeof m === 'object' ? (m as Record<string, any>) : {};
}

function pickEntitlementById(info: CustomerInfo, id: string): any | null {
  const active = getActiveEntitlementMap(info);
  if (active[id]) return active[id];
  const all = getAllEntitlementMap(info);
  if (all[id]) return all[id];
  return null;
}

function pickAnyActiveEntitlementProductionFirst(info: CustomerInfo): any | null {
  const active = getActiveEntitlementMap(info);
  const ents = Object.values(active || {});
  if (ents.length === 0) return null;

  const prod = ents.find((e) => entitlementIsSandbox(e) === false);
  return prod ?? ents[0] ?? null;
}

/**
 * ✅ Production-first + sandbox-fallback decision
 */
export function getPremiumStatus(info: CustomerInfo | null | undefined): PremiumStatus {
  if (!info) {
    return {
      active: false,
      activeProduction: false,
      activeSandbox: false,
      env: 'none',
      entitlementId: ENTITLEMENT_ID || null,
      productId: null,
      expiresAtMs: null,
      isSandbox: null,
      source: 'none',
    };
  }

  // 1) Strict entitlement id
  if (ENTITLEMENT_ID) {
    const ent = pickEntitlementById(info, ENTITLEMENT_ID);
    if (ent && entitlementIsActive(ent)) {
      const isSb = entitlementIsSandbox(ent);

      const activeProduction = isSb === false || isSb == null; // treat unknown as prod (defensive)
      const activeSandbox = isSb === true;

      // ✅ production build: sandbox never counts
      const effectiveActive = activeProduction || (!IS_PROD && ALLOW_SANDBOX && activeSandbox);

      const env: PremiumEnv = activeProduction ? 'production' : effectiveActive ? 'sandbox' : 'none';

      return {
        active: effectiveActive,
        activeProduction,
        activeSandbox,
        env,
        entitlementId: ENTITLEMENT_ID,
        productId: entitlementProductId(ent),
        expiresAtMs: entitlementExpiresAtMs(ent),
        isSandbox: isSb,
        source: 'entitlement_strict',
      };
    }
  }

  // 2) Dev-only fallback: any active entitlement (production-first)
  if (ALLOW_ANY_ACTIVE_ENTITLEMENT_FALLBACK) {
    const ent = pickAnyActiveEntitlementProductionFirst(info);
    if (ent && entitlementIsActive(ent)) {
      const isSb = entitlementIsSandbox(ent);

      const activeProduction = isSb === false || isSb == null;
      const activeSandbox = isSb === true;

      const effectiveActive = activeProduction || (!IS_PROD && ALLOW_SANDBOX && activeSandbox);
      const env: PremiumEnv = activeProduction ? 'production' : effectiveActive ? 'sandbox' : 'none';

      return {
        active: effectiveActive,
        activeProduction,
        activeSandbox,
        env,
        entitlementId: ENTITLEMENT_ID || null,
        productId: entitlementProductId(ent),
        expiresAtMs: entitlementExpiresAtMs(ent),
        isSandbox: isSb,
        source: 'any_entitlement_fallback',
      };
    }
  }

  // 3) Last resort fallback: activeSubscriptions (no env info) — only use for UI hinting.
  const subs = (info as any)?.activeSubscriptions;
  if (!IS_PROD && Array.isArray(subs) && subs.length > 0) {
    return {
      active: true,
      activeProduction: true,
      activeSandbox: false,
      env: 'production',
      entitlementId: ENTITLEMENT_ID || null,
      productId: String(subs[0] ?? '').trim() || null,
      expiresAtMs: null,
      isSandbox: null,
      source: 'activeSubscriptions_fallback',
    };
  }

  return {
    active: false,
    activeProduction: false,
    activeSandbox: false,
    env: 'none',
    entitlementId: ENTITLEMENT_ID || null,
    productId: null,
    expiresAtMs: null,
    isSandbox: null,
    source: 'none',
  };
}

export function isPremiumActive(info: CustomerInfo): boolean {
  return getPremiumStatus(info).active;
}

async function ensureConfigured(): Promise<void> {
  if (_configurePromise) return _configurePromise;

  _configurePromise = (async () => {
    if (!RC_IOS_API_KEY) throw new Error('Missing EXPO_PUBLIC_RC_IOS_API_KEY');
    if (!MONTHLY_PRODUCT_ID) throw new Error('Missing EXPO_PUBLIC_RC_MONTHLY_PRODUCT_ID');
    if (!ENTITLEMENT_ID) {
      console.warn('[rc] Missing EXPO_PUBLIC_RC_ENTITLEMENT_ID (Identifier). UI may not unlock correctly.');
    }

    try {
      Purchases.setLogLevel(__DEV__ ? Purchases.LOG_LEVEL.DEBUG : Purchases.LOG_LEVEL.WARN);
    } catch {}

    Purchases.configure({ apiKey: RC_IOS_API_KEY });

    try {
      // @ts-ignore
      if (typeof Purchases.invalidateCustomerInfoCache === 'function') {
        // @ts-ignore
        await Purchases.invalidateCustomerInfoCache();
      }
    } catch {}

    if (__DEV__) {
      console.log('[rc] configured', { APP_ENV, IS_PROD, ALLOW_SANDBOX, PREMIUM_URL_PATH });
    }
  })();

  try {
    await _configurePromise;
  } catch (e) {
    _configurePromise = null;
    throw e;
  }
}

async function getCognitoSubSafe(): Promise<string | null> {
  try {
    const session: any = await fetchAuthSession();
    const idToken: any = session?.tokens?.idToken;
    const accessToken: any = session?.tokens?.accessToken;
    const sub = idToken?.payload?.sub ?? accessToken?.payload?.sub ?? null;
    return sub ? String(sub).trim() : null;
  } catch {
    return null;
  }
}

async function getCognitoAccessTokenSafe(): Promise<string | null> {
  try {
    const session: any = await fetchAuthSession();
    const at = tokenToString(session?.tokens?.accessToken);
    return at ? at.trim() : null;
  } catch {
    return null;
  }
}

export async function rcLoginWithCognitoSub(): Promise<string | null> {
  await ensureConfigured();

  const sub = await getCognitoSubSafe();
  if (!sub) return null;

  if (_lastLoggedInSub === sub) return sub;

  if (_loginPromise) {
    try {
      await _loginPromise;
    } catch {}
    if (_lastLoggedInSub === sub) return sub;
  }

  _loginPromise = (async () => {
    try {
      const res: any = await Purchases.logIn(String(sub));
      _lastLoggedInSub = String(sub);

      if (__DEV__) {
        console.log('[rc] logIn ok', { sub: String(sub), created: !!res?.created });
      }
      return String(sub);
    } catch (e) {
      console.warn('[rc] logIn failed (non-fatal):', (e as any)?.message ?? e);
      return String(sub);
    } finally {
      _loginPromise = null;
    }
  })();

  return await _loginPromise;
}

export async function rcLogout(): Promise<void> {
  await ensureConfigured();
  try {
    await Purchases.logOut();
  } catch (e) {
    console.warn('[rc] logOut failed (non-fatal):', (e as any)?.message ?? e);
  } finally {
    _lastLoggedInSub = null;
  }
}

function pickMonthlyPackage(offerings: any): PurchasesPackage {
  const current = offerings?.current ?? null;
  if (!current) throw new Error('No offerings.current (check RevenueCat Offering setup)');

  const byId =
    current.availablePackages?.find((p: any) => p?.product?.identifier === MONTHLY_PRODUCT_ID) ?? null;

  const monthly = current.monthly ?? null;
  const fallback = current.availablePackages?.[0] ?? null;

  const pkg = byId || monthly || fallback;
  if (!pkg) throw new Error('No purchasable package found');

  return pkg;
}

export async function rcGetCustomerInfoSafe(): Promise<CustomerInfo> {
  await ensureConfigured();

  try {
    await rcLoginWithCognitoSub();
  } catch {}

  try {
    // @ts-ignore
    if (typeof Purchases.invalidateCustomerInfoCache === 'function') {
      // @ts-ignore
      await Purchases.invalidateCustomerInfoCache();
    }
  } catch {}

  const info = await Purchases.getCustomerInfo();

  if (__DEV__) {
    console.log('[rc] premiumStatus', getPremiumStatus(info));
  }

  return info;
}

export async function rcPurchaseMonthly(): Promise<CustomerInfo> {
  await ensureConfigured();
  await rcLoginWithCognitoSub();

  const offerings = await Purchases.getOfferings();
  const pkg = pickMonthlyPackage(offerings);

  const { customerInfo } = await Purchases.purchasePackage(pkg);
  const fresh = await Purchases.getCustomerInfo();

  if (__DEV__) {
    console.log('[rc] AFTER purchase status', getPremiumStatus(fresh));
  }

  return fresh;
}

/** Paywall display only: current monthly package, or null when RC is not configured / no offering / network error. Never throws. */
export async function rcGetMonthlyPackageSafe(): Promise<PurchasesPackage | null> {
  try {
    await ensureConfigured();
    const offerings = await Purchases.getOfferings();
    return pickMonthlyPackage(offerings);
  } catch (e) {
    if (__DEV__) console.warn('[rc] getOfferings failed (non-fatal):', (e as any)?.message ?? e);
    return null;
  }
}

export async function rcRestore(): Promise<CustomerInfo> {
  await ensureConfigured();
  await rcLoginWithCognitoSub();

  const info = await Purchases.restorePurchases();

  if (__DEV__) {
    console.log('[rc] AFTER restore status', getPremiumStatus(info));
  }

  return info;
}

export async function rcSyncPremiumToServer(reason: string = 'manual'): Promise<any | null> {
  if (!API_BASE_URL) return null;

  const at = await getCognitoAccessTokenSafe();
  if (!at) return null;

  try {
    const resp = await fetch(new URL('/api/v1/premium/sync', API_BASE_URL).toString(), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${at}`,
        'cache-control': 'no-cache',
      },
      body: JSON.stringify({ reason, platform: 'ios', ts: Date.now(), clientEnv: APP_ENV }),
    });

    const json = await resp.json().catch(() => null);
    if (!resp.ok) {
      console.warn('[rc] premium sync failed', resp.status, json);
      return null;
    }
    return json;
  } catch (e) {
    console.warn('[rc] premium sync error', (e as any)?.message ?? e);
    return null;
  }
}
