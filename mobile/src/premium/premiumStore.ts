// mobile/src/premium/premiumStore.ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import React from 'react';
import { fetchAuthSession } from 'aws-amplify/auth';

const KEY_PREFIX = 'devcards:entitlements:isPremium:v1:';

// 内存缓存：按 userKey 分开存，避免串号
const memByUser = new Map<string, boolean>();

// ✅ listener 支持第二个参数 userKey（向后兼容：老 listener 只接收 v 也不会报错）
type Listener = (v: boolean, userKey?: string) => void;
const listeners = new Set<Listener>();

function parseBool(raw: string | null): boolean {
  if (!raw) return false;
  const s = raw.trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes';
}

function sanitizeUserKey(s: string): string {
  return (
    String(s || 'anon')
      .trim()
      .replace(/[^a-zA-Z0-9._-]+/g, '_')
      .slice(0, 80) || 'anon'
  );
}

async function getUserKeyFromAuth(): Promise<string> {
  try {
    const session: any = await fetchAuthSession();
    const sub =
      session?.userSub ??
      session?.tokens?.idToken?.payload?.sub ??
      session?.tokens?.accessToken?.payload?.sub ??
      null;
    return sanitizeUserKey(sub || 'anon');
  } catch {
    return 'anon';
  }
}

async function resolveUserKey(userKeyHint?: string | null): Promise<string> {
  const hint = String(userKeyHint ?? '').trim();
  if (hint) return sanitizeUserKey(hint);
  return await getUserKeyFromAuth();
}

function keyForUser(userKey: string) {
  return `${KEY_PREFIX}${sanitizeUserKey(userKey)}`;
}

/**
 * ✅ NOTE:
 * premiumStore 只是“缓存”，不应该作为安全放行的真相源。
 * 真相应该来自服务端 entitlement / RevenueCat。
 */
export async function getIsPremiumUser(userKeyHint?: string | null): Promise<boolean> {
  const userKey = await resolveUserKey(userKeyHint);

  if (memByUser.has(userKey)) return memByUser.get(userKey)!;

  try {
    const raw = await AsyncStorage.getItem(keyForUser(userKey));
    const v = parseBool(raw);
    memByUser.set(userKey, v);
    return v;
  } catch {
    memByUser.set(userKey, false);
    return false;
  }
}

export async function setIsPremiumUser(v: boolean, userKeyHint?: string | null): Promise<void> {
  const userKey = await resolveUserKey(userKeyHint);
  const value = !!v;

  memByUser.set(userKey, value);

  try {
    await AsyncStorage.setItem(keyForUser(userKey), value ? '1' : '0');
  } catch {
    // ignore
  }

  // notify
  for (const fn of listeners) fn(value, userKey);
}

/**
 * ✅ hard reset current user's premium cache
 * - 这对“你手动把自己改成 premium”这种情况非常有效
 */
export async function clearIsPremiumUser(userKeyHint?: string | null): Promise<void> {
  const userKey = await resolveUserKey(userKeyHint);
  memByUser.set(userKey, false);

  try {
    await AsyncStorage.removeItem(keyForUser(userKey));
  } catch {
    // ignore
  }

  for (const fn of listeners) fn(false, userKey);
}

export function subscribePremiumUser(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * ✅ Tri-state premium status.
 * 'unknown' while the async key + storage read is still resolving, then 'premium'
 * or 'free'. This avoids the false "Not subscribed" flash a subscriber saw while
 * the cache loaded (MGACHA-25).
 */
export type PremiumStatusState = 'unknown' | 'free' | 'premium';

/**
 * ✅ Hook: 支持传入 userSub / userKey hint（强烈建议传）
 * 这样切账号时会重新读取对应 key 的缓存，避免串号。
 * Starts 'unknown', resolves to 'premium'/'free', follows subscribePremiumUser
 * updates for the same key, and resets to 'unknown' when userKeyHint changes.
 */
export function usePremiumStatus(userKeyHint?: string | null): PremiumStatusState {
  const [status, setStatus] = React.useState<PremiumStatusState>('unknown');
  const currentKeyRef = React.useRef<string>('anon');

  React.useEffect(() => {
    let mounted = true;

    // reset to unknown for the new key until its cache resolves
    setStatus('unknown');

    // 1) load value for this userKey
    void (async () => {
      const key = await resolveUserKey(userKeyHint);
      currentKeyRef.current = key;

      const v = await getIsPremiumUser(key);
      if (mounted) setStatus(v ? 'premium' : 'free');
    })();

    // 2) subscribe updates, but only apply if same userKey
    const unsub = subscribePremiumUser((v, changedKey) => {
      const cur = currentKeyRef.current;
      const k = sanitizeUserKey(changedKey || 'anon');
      if (k !== cur) return;
      setStatus(v ? 'premium' : 'free');
    });

    return () => {
      mounted = false;
      unsub();
    };
    // ✅ dependency on userKeyHint: account switch triggers reload
  }, [userKeyHint]);

  return status;
}

/**
 * ✅ Boolean hook kept for its other callers (SessionCardScreen, DeckScreen,
 * HomeScreen and ~11 mocks). Now derived from the tri-state hook.
 */
export function usePremiumUser(userKeyHint?: string | null): boolean {
  return usePremiumStatus(userKeyHint) === 'premium';
}