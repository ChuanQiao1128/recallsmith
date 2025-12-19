// mobile/src/premium/premiumStore.ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import React from 'react';

/**
 * Premium entitlement (LOCAL stub)
 *
 * Why a store?
 * - Home / Deck / Paywall 都要读同一个 "是否订阅" 状态
 * - Paywall 改状态后，其他页面可以立即响应（订阅者能打开 premium deck）
 * - 目前先本地存一个布尔值，未来接 IAP 或后端 entitlement 时替换 set/get 即可
 */

const KEY = 'devcards:entitlements:isPremium:v1';

// 内存缓存：减少 AsyncStorage 读次数（性能更好）
let _mem: boolean | null = null;

// 简单订阅机制：Paywall 改状态后，Home/Deck 能实时更新
const listeners = new Set<(v: boolean) => void>();

function parseBool(raw: string | null): boolean {
  if (!raw) return false;
  const s = raw.trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes';
}

export async function getIsPremiumUser(): Promise<boolean> {
  if (_mem !== null) return _mem;

  try {
    const raw = await AsyncStorage.getItem(KEY);
    _mem = parseBool(raw);
    return _mem;
  } catch {
    _mem = false;
    return false;
  }
}

export async function setIsPremiumUser(v: boolean): Promise<void> {
  _mem = !!v;

  try {
    await AsyncStorage.setItem(KEY, v ? '1' : '0');
  } catch {
    // ignore: 即使写失败，也不应该崩溃；只是下次启动可能丢失这个 stub 状态
  }

  for (const fn of listeners) fn(_mem);
}

export function subscribePremiumUser(fn: (v: boolean) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * React hook：页面里直接用 const isPremium = usePremiumUser()
 * - 首次渲染先 false，然后异步读取 AsyncStorage 后再更新
 * - 同时订阅变化（Paywall 解锁/重置后立即更新）
 */
export function usePremiumUser(): boolean {
  const [isPremium, setIsPremium] = React.useState(false);

  React.useEffect(() => {
    let mounted = true;

    void (async () => {
      const v = await getIsPremiumUser();
      if (mounted) setIsPremium(v);
    })();

    const unsub = subscribePremiumUser((v) => setIsPremium(v));
    return () => {
      mounted = false;
      unsub();
    };
  }, []);

  return isPremium;
}