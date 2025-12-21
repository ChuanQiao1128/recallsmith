// mobile/src/premium/premiumStore.ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import React from 'react';
import { fetchAuthSession } from 'aws-amplify/auth';

const KEY_PREFIX = 'devcards:entitlements:isPremium:v1:';

// 内存缓存：按 userKey 分开存，避免串号
const memByUser = new Map<string, boolean>();

const listeners = new Set<(v: boolean) => void>();

function parseBool(raw: string | null): boolean {
  if (!raw) return false;
  const s = raw.trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes';
}

function sanitizeUserKey(s: string): string {
  return String(s || 'anon')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .slice(0, 80) || 'anon';
}

async function getUserKey(): Promise<string> {
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

function keyForUser(userKey: string) {
  return `${KEY_PREFIX}${sanitizeUserKey(userKey)}`;
}

export async function getIsPremiumUser(): Promise<boolean> {
  const userKey = await getUserKey();

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

export async function setIsPremiumUser(v: boolean): Promise<void> {
  const userKey = await getUserKey();
  const value = !!v;

  memByUser.set(userKey, value);

  try {
    await AsyncStorage.setItem(keyForUser(userKey), value ? '1' : '0');
  } catch {
    // ignore
  }

  for (const fn of listeners) fn(value);
}

export function subscribePremiumUser(fn: (v: boolean) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function usePremiumUser(): boolean {
  const [isPremium, setIsPremiumState] = React.useState(false);

  React.useEffect(() => {
    let mounted = true;

    void (async () => {
      const v = await getIsPremiumUser();
      if (mounted) setIsPremiumState(v);
    })();

    const unsub = subscribePremiumUser((v) => setIsPremiumState(v));
    return () => {
      mounted = false;
      unsub();
    };
  }, []);

  return isPremium;
}