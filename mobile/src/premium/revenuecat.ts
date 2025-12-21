// mobile/src/premium/revenuecat.ts
import Purchases, { type CustomerInfo, type PurchasesPackage } from 'react-native-purchases';
import { fetchAuthSession } from 'aws-amplify/auth';

const RC_IOS_API_KEY = (process.env.EXPO_PUBLIC_RC_IOS_API_KEY || '').trim();

// 你的 RevenueCat entitlement identifier（从日志看就是这个）
const ENTITLEMENT_ID = 'DeveloperCards Pro';

// 你的 App Store 产品 id
const MONTHLY_PRODUCT_ID = 'devcards_premium_monthly';

let configured = false;

async function ensureConfigured() {
  if (!RC_IOS_API_KEY) throw new Error('Missing EXPO_PUBLIC_RC_IOS_API_KEY');

  if (!configured) {
    Purchases.setLogLevel(Purchases.LOG_LEVEL.DEBUG);
    Purchases.configure({ apiKey: RC_IOS_API_KEY });

    // ✅ 直接查 StoreKit 是否能拿到这个 product
    try {
      const products = await Purchases.getProducts(
        ['developercards_premium_monthly'],
        Purchases.PRODUCT_CATEGORY.SUBSCRIPTION
      );
      console.log(
        '[rc] getProducts',
        products.map(p => ({
          id: p.identifier,
          price: p.priceString,
          title: p.title,
        }))
      );
    } catch (e) {
      console.log('[rc] getProducts error', e);
    }

    const info = await rcGetCustomerInfo();
    console.log('[rc] active entitlements', info.entitlements.active);

    configured = true;
  }
}

/**
 * 用 Cognito 的 user sub 绑定 RevenueCat appUserId，保证换机/重装可恢复。
 * 这里直接从 Amplify token 里拿 sub，避免依赖你 authStore 的结构。
 */
export async function rcLoginWithCognitoSub(): Promise<string | null> {
  await ensureConfigured();

  // ✅ In dev/Test Store you might not be logged in yet.
  // If Amplify has no session, just stay anonymous in RevenueCat.
  let session: any;
  try {
    session = await fetchAuthSession();
  } catch (e) {
    // Not logged in / no auth configured yet — non-fatal
    return null;
  }

  const idToken: any = session?.tokens?.idToken;
  const accessToken: any = session?.tokens?.accessToken;

  const sub = idToken?.payload?.sub ?? accessToken?.payload?.sub ?? null;
  if (!sub) return null;

  try {
    await Purchases.logIn(String(sub));
  } catch (e) {
    // logIn can fail due to already-logged-in / anonymous merge, etc. Non-fatal.
    console.warn('[rc] logIn failed (non-fatal):', (e as any)?.message ?? e);
  }

  return String(sub);
}

function pickMonthlyPackage(offerings: any): PurchasesPackage {
  const current = offerings?.current ?? null;
  if (!current) throw new Error('No offerings.current (check RevenueCat Offering setup)');

  const byId =
    current.availablePackages?.find((p: any) => p?.product?.identifier === MONTHLY_PRODUCT_ID) ??
    null;

  const monthly = current.monthly ?? null;

  const fallback = current.availablePackages?.[0] ?? null;

  const pkg = byId || monthly || fallback;
  if (!pkg) throw new Error('No purchasable package found');

  return pkg;
}

export function isPremiumActive(info: CustomerInfo): boolean {
  return !!(info as any)?.entitlements?.active?.[ENTITLEMENT_ID];
}

/**
 * DEV helper: log out from RevenueCat (useful for Test Store repeat testing).
 * This does NOT affect Cognito; it only resets RevenueCat to anonymous.
 */
export async function rcLogoutForDebug(): Promise<void> {
  await ensureConfigured();
  try {
    await Purchases.logOut();
  } catch (e) {
    console.warn('[rc] logOut failed (non-fatal):', (e as any)?.message ?? e);
  }
}

/**
 * Convenience: get CustomerInfo without requiring auth login.
 * (It will attempt Cognito login if available, otherwise stays anonymous.)
 */
export async function rcGetCustomerInfoSafe(): Promise<CustomerInfo> {
  await ensureConfigured();
  await rcLoginWithCognitoSub();
  const info = await Purchases.getCustomerInfo();
  console.log('[rc] active entitlements', info.entitlements.active);
  return info;
}

export async function rcPurchaseMonthly(): Promise<CustomerInfo> {
  await rcLoginWithCognitoSub();

  const offerings = await Purchases.getOfferings();
  const pkg = pickMonthlyPackage(offerings);

  const { customerInfo } = await Purchases.purchasePackage(pkg);
  return customerInfo;
}

export async function rcRestore(): Promise<CustomerInfo> {
  await rcLoginWithCognitoSub();
  return await Purchases.restorePurchases();
}

export async function rcGetCustomerInfo(): Promise<CustomerInfo> {
  return await rcGetCustomerInfoSafe();
}