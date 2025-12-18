// mobile/src/auth/authStore.ts
import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { setSyncAccessToken, resetProgressSyncState } from '../sync/progressSync';
import { clearProgressQueue } from '../sync/progressQueue';

const ACCESS_TOKEN_KEY = 'devcards:auth:accessToken:v1';

// 这些是“用户相关本地数据”，登出后建议清掉避免串号
const LOCAL_USER_PREFIXES = [
  'deck-progress:',
  'deck-daily-stats:',
  'deck-meta:',
];

export type AuthState = {
  ready: boolean;
  accessToken: string | null;
};

let _state: AuthState = { ready: false, accessToken: null };
const _listeners = new Set<(s: AuthState) => void>();
let _initPromise: Promise<AuthState> | null = null;

function emit(next: AuthState) {
  _state = next;
  for (const fn of _listeners) fn(_state);
}

export function getAuthState(): AuthState {
  return _state;
}

export function subscribeAuth(fn: (s: AuthState) => void): () => void {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

/**
 * 初始化：从 AsyncStorage 读 token，并同步给 progressSync（内存缓存）
 */
export async function initAuthOnce(): Promise<AuthState> {
  if (_state.ready) return _state;
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    let token: string | null = null;

    try {
      const raw = await AsyncStorage.getItem(ACCESS_TOKEN_KEY);
      token = raw && raw.trim() ? raw.trim() : null;
    } catch {
      token = null;
    }

    // ✅ 让 progressSync 的内存 token 与存储保持一致
    await setSyncAccessToken(token);

    const next: AuthState = { ready: true, accessToken: token };
    emit(next);
    return next;
  })();

  return _initPromise;
}

export async function setAuthToken(token: string | null): Promise<void> {
  const t = token && token.trim() ? token.trim() : null;

  // ✅ 仍然使用 progressSync 的 setSyncAccessToken 来写入同一个 storage key
  await setSyncAccessToken(t);

  emit({ ready: true, accessToken: t });
}

export async function signOutBasic(): Promise<void> {
  await setAuthToken(null);
}

/**
 * 登出并清除本地“用户相关”数据，防止换号后看到旧进度
 */
export async function signOutAndWipeLocal(): Promise<void> {
  // 1) 先清 token（避免后续误 push）
  await setAuthToken(null);

  // 2) 清 sync 队列 & sync 状态（cursor/cache/lastError 等）
  try { await clearProgressQueue(); } catch {}
  try { await resetProgressSyncState(); } catch {}

  // 3) 清本地 deck progress/daily/meta
  try {
    const keys = await AsyncStorage.getAllKeys();
    const toRemove = keys.filter((k) => LOCAL_USER_PREFIXES.some((p) => k.startsWith(p)));
    if (toRemove.length > 0) {
      await AsyncStorage.multiRemove(toRemove);
    }
  } catch {}
}

/**
 * React hook：给导航层使用
 */
export function useAuthState(): AuthState {
  const [st, setSt] = useState<AuthState>(getAuthState());

  useEffect(() => {
    const unsub = subscribeAuth(setSt);
    void initAuthOnce();
    return unsub;
  }, []);

  return st;
}