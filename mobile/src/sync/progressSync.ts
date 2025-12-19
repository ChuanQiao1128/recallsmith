// mobile/src/sync/progressSync.ts
import * as Crypto from 'expo-crypto';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { apiJson } from '../api/apiClient';
import {
  enqueueProgressEvent,
  peekProgressEvents,
  removeProgressEventsById,
  progressQueueSize,
  type ProgressEvent,
} from './progressQueue';

import { resolveDeckBySlug } from '../content/deckRepository';
import { loadDeckProgress, saveDeckProgress } from '../review/storage';
import type { CardProgress } from '../review/model';

/**
 * ============================
 *  Progress Sync 设计（面试讲法）
 * ============================
 *
 * 核心目标：Offline-first + Eventual Consistency
 *
 * 1) UI 只依赖本地进度（AsyncStorage）
 *    - 打分后立刻 saveDeckProgress() -> UI 马上正确
 *
 * 2) “同步”用事件队列（event queue），而不是“每次都直接写数据库”
 *    - recordReviewEvent() 把一次打分写入 devcards:sync:progressQueue:v1（AsyncStorage）
 *    - eventId(UUID) 做幂等：服务端返回 duplicateEventIds，客户端可以安全删除
 *
 * 3) 同步循环 = Push + Pull
 *    - Push: /api/v1/sync/push 发送队列事件（最多 25 条/批，最多 20 轮）
 *    - Pull: /api/v1/sync/progress?sinceMs=cursor 拉取增量
 *            拉到的数据先写 remoteCache（即使 deck 还没安装也缓存）
 *            如果 deck 已安装：merge 到本地 progress
 *
 * 4) 触发策略（省流量的关键）
 *    - rating：debounce（默认 10s），把连续刷题合成一次 push
 *    - home_focus/review_focus/app_start/manual/token_set：立即同步（0ms）
 *    - 注意：MIN_PULL_INTERVAL_MS 只是“防抖”，不是“2s 定时任务”
 *
 * 5) Crash-safety
 *    - ReviewScreen 要 await recordReviewEvent()，确保事件先落盘
 *    - app 被杀/无网：队列仍在，下次打开会继续 push
 */

type ApiOk<T> = {
  success: boolean;
  data: T;
  error: any;
  traceId: string;
  version: string;
};

type BootstrapResp = {
  created: boolean;
  userSub: string;
  serverTimeMs: number;
};

type PushResp = {
  serverTimeMs: number;
  receivedCount: number;
  acceptedCount: number;
  acceptedEventIds: string[];
  duplicateEventIds: string[];
};

type ProgressItem = {
  deckSlug: string;
  stableUid: string;
  status: number;
  reviewCount: number;
  lastRating: number | null;
  lastReviewedAtMs: number | string | null;

  // Phase 3
  nextReviewAtMs?: number | string | null;

  updatedAtMs: number | string | null;
};

type ProgressGetResp = {
  serverTimeMs: number;
  sinceMs: number | null;
  items: ProgressItem[];
};

const ACCESS_TOKEN_KEY = 'devcards:auth:accessToken:v1';

// cursor + remote cache
const SYNC_CURSOR_KEY = 'devcards:sync:cursorMs:v1';
const DEVICE_ID_KEY = 'devcards:deviceId:v1';

// debug
const LAST_SYNC_KEY = 'devcards:sync:last:v1';
const LAST_ERROR_KEY = 'devcards:sync:lastError:v1';

// cache remote progress even if deck not installed
const REMOTE_CACHE_PREFIX = 'devcards:sync:remoteCache:v1:'; // + deckSlug

let _accessTokenMem: string | null = null;

let _timer: ReturnType<typeof setTimeout> | null = null;
let _inFlight = false;
let _pending = false;

let _scheduledReason: string = 'unknown';

let _lastPullAtMs = 0;

/**
 * 这个不是“每 2s 拉一次”，只是防止短时间内重复 pull
 * （比如 app_start 触发一次 pull，紧接着 home_focus 又触发 pull）
 */
const MIN_PULL_INTERVAL_MS = 2_000;

// one-time heal guard
let _healedOnce = false;

function toMs(v: any): number | null {
  if (v == null) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  if (n <= 0) return null;
  return Math.floor(n);
}

async function getDeviceId(): Promise<string> {
  try {
    const raw = await AsyncStorage.getItem(DEVICE_ID_KEY);
    if (raw && raw.trim()) return raw.trim();
  } catch {}

  const id = Crypto.randomUUID();
  try {
    await AsyncStorage.setItem(DEVICE_ID_KEY, id);
  } catch {}
  return id;
}

function mapRatingToNumber(r: any): number {
  if (typeof r === 'number' && Number.isFinite(r)) {
    const n = Math.round(r);
    if (n < 1) return 1;
    if (n > 4) return 4;
    return n;
  }
  const s = String(r || '').trim().toLowerCase();
  if (s === 'again') return 1;
  if (s === 'hard') return 2;
  if (s === 'good') return 3;
  if (s === 'easy') return 4;
  return 3;
}

function pickDeckSlugFromAny(obj: any): string | null {
  const v =
    obj?.deckSlug ??
    obj?.slug ??
    obj?.deck?.Slug ??
    obj?.deck?.slug ??
    obj?.deck?.DeckSlug ??
    obj?.deck?.deckSlug ??
    null;
  return v ? String(v).trim() : null;
}

function pickStableUidFromAny(obj: any): string | null {
  const v =
    obj?.stableUid ??
    obj?.StableUid ??
    obj?.card?.StableUid ??
    obj?.card?.stableUid ??
    obj?.uid ??
    obj?.cardUid ??
    null;
  return v ? String(v).trim() : null;
}

async function getSyncAccessToken(): Promise<string | null> {
  if (_accessTokenMem && _accessTokenMem.trim()) return _accessTokenMem;

  try {
    const raw = await AsyncStorage.getItem(ACCESS_TOKEN_KEY);
    if (raw && raw.trim()) {
      _accessTokenMem = raw;
      return raw;
    }
  } catch {}

  return null;
}

/**
 * dev 模式注入 token
 */
export async function setSyncAccessToken(token: string | null): Promise<void> {
  const t = token && token.trim() ? token.trim() : null;
  _accessTokenMem = t;

  try {
    if (t) await AsyncStorage.setItem(ACCESS_TOKEN_KEY, t);
    else await AsyncStorage.removeItem(ACCESS_TOKEN_KEY);
  } catch {}

  // token 一旦可用，立刻触发 sync
  if (t) {
    scheduleProgressSync({ delayMs: 0, reason: 'token_set' });
  }
}

/**
 * ReviewScreen 调用这个入队：
 * - IMPORTANT: ReviewScreen 里应该 await 它（你已经这么做了）
 *   => 确保 event 已经写入 AsyncStorage queue，crash 也不丢
 */
export async function recordReviewEvent(...args: any[]): Promise<string | null> {
  let deckSlug: string | null = null;
  let stableUid: string | null = null;
  let rating: any = null;
  let reviewedAtMs: number = Date.now();

  let deckVersion: string | null | undefined = undefined;
  let progressAfter: any = undefined;
  let lastSeenRevision: number | null | undefined = undefined;

  if (typeof args[0] === 'string') {
    deckSlug = String(args[0]).trim();
    stableUid = args[1] != null ? String(args[1]).trim() : null;
    rating = args[2];
    if (args[3] != null && Number.isFinite(Number(args[3]))) reviewedAtMs = Number(args[3]);
  } else {
    const obj = args[0] ?? {};
    deckSlug = pickDeckSlugFromAny(obj);
    stableUid = pickStableUidFromAny(obj);
    rating = obj.rating ?? obj.uiRating ?? obj.reviewRating ?? obj.r ?? null;

    if (obj.reviewedAtMs != null && Number.isFinite(Number(obj.reviewedAtMs))) {
      reviewedAtMs = Number(obj.reviewedAtMs);
    }

    if (obj.deckVersion != null) deckVersion = String(obj.deckVersion);
    if (obj.progressAfter != null) progressAfter = obj.progressAfter;

    if (obj.lastSeenRevision != null && Number.isFinite(Number(obj.lastSeenRevision))) {
      lastSeenRevision = Number(obj.lastSeenRevision);
    }
  }

  if (!deckSlug || !stableUid) return null;

  const ev: ProgressEvent = {
    eventId: Crypto.randomUUID(),
    deckSlug,
    deckVersion: deckVersion ?? null,
    stableUid,
    rating: mapRatingToNumber(rating),
    reviewedAtMs,
    progressAfter,
    lastSeenRevision: lastSeenRevision ?? null,
  };

  await enqueueProgressEvent(ev);
  return ev.eventId;
}

async function getCursorMs(): Promise<number | null> {
  try {
    const raw = await AsyncStorage.getItem(SYNC_CURSOR_KEY);
    return toMs(raw);
  } catch {
    return null;
  }
}

async function setCursorMs(ms: number): Promise<void> {
  try {
    await AsyncStorage.setItem(SYNC_CURSOR_KEY, String(Math.floor(ms)));
  } catch {}
}

async function clearCursorMs(): Promise<void> {
  try {
    await AsyncStorage.removeItem(SYNC_CURSOR_KEY);
  } catch {}
}

function remoteCacheKey(deckSlug: string) {
  return `${REMOTE_CACHE_PREFIX}${deckSlug}`;
}

async function getRemoteCache(deckSlug: string): Promise<Record<string, ProgressItem>> {
  try {
    const raw = await AsyncStorage.getItem(remoteCacheKey(deckSlug));
    if (!raw) return {};
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== 'object') return {};
    return obj as Record<string, ProgressItem>;
  } catch {
    return {};
  }
}

async function setRemoteCache(deckSlug: string, cache: Record<string, ProgressItem>): Promise<void> {
  try {
    await AsyncStorage.setItem(remoteCacheKey(deckSlug), JSON.stringify(cache));
  } catch {
    // ignore
  }
}

async function writeLastSync(payload: any) {
  try {
    await AsyncStorage.setItem(LAST_SYNC_KEY, JSON.stringify(payload));
  } catch {}
}

async function writeLastError(msg: string | null) {
  try {
    if (!msg) await AsyncStorage.removeItem(LAST_ERROR_KEY);
    else await AsyncStorage.setItem(LAST_ERROR_KEY, msg);
  } catch {}
}

/**
 * 自愈：cursor 有值，但 remoteCache 全没了（常见：清缓存但没清 cursor）
 * => 清 cursor，下次 pull 会全量拉回历史
 */
async function healCursorIfCacheMissing(): Promise<void> {
  if (_healedOnce) return;
  _healedOnce = true;

  const cursor = await getCursorMs();
  if (cursor == null) return;

  try {
    const keys = await AsyncStorage.getAllKeys();
    const hasAnyCache = keys.some((k) => k.startsWith(REMOTE_CACHE_PREFIX));
    if (!hasAnyCache) {
      console.warn('[progressSync] heal: cursor exists but no remote cache keys; reset cursor', { cursor });
      await clearCursorMs();
    }
  } catch {
    // ignore
  }
}

function getDeckUidSet(deck: any): Set<string> {
  const set = new Set<string>();
  const cards = deck?.Cards ?? deck?.cards ?? [];
  if (!Array.isArray(cards)) return set;

  for (const c of cards) {
    const uid = c?.StableUid ?? c?.stableUid ?? null;
    if (uid) set.add(String(uid).trim());
  }
  return set;
}

/**
 * Merge remote progress items into local CardProgress[].
 * 规则：
 * - remote.updatedAtMs 越大越新
 * - remoteLastReviewedAt > localLastReviewedAt => remote 覆盖本地
 * - lastReviewedAt 相同：只有 remote.hasNext=true 才允许覆盖 nextReviewAt（防 Phase2 fallback 抖动）
 */
function mergeRemoteIntoLocalProgress(
  local: CardProgress[],
  remoteRows: ProgressItem[],
): { merged: CardProgress[]; changed: boolean; appliedCount: number } {
  const localByUid = new Map(local.map((p) => [p.stableUid, p]));

  type RemoteBest = {
    lastReviewedAt: number;
    updatedAt: number;
    hasNext: boolean;
    nextReviewAt: number;
    row: ProgressItem;
  };

  const bestRemote = new Map<string, RemoteBest>();

  for (const r of remoteRows) {
    const uid = (r?.stableUid ?? '').trim();
    if (!uid) continue;

    const lastReviewedAt = toMs(r.lastReviewedAtMs) ?? 0;
    const updatedAt = toMs(r.updatedAtMs) ?? 0;
    if (lastReviewedAt <= 0 || updatedAt <= 0) continue;

    const serverNext = toMs((r as any).nextReviewAtMs);
    const hasNext = serverNext != null;
    const nextReviewAt = hasNext ? (serverNext as number) : lastReviewedAt;

    const prev = bestRemote.get(uid);
    if (!prev || updatedAt > prev.updatedAt) {
      bestRemote.set(uid, { lastReviewedAt, updatedAt, hasNext, nextReviewAt, row: r });
    }
  }

  if (bestRemote.size === 0) {
    return { merged: local, changed: false, appliedCount: 0 };
  }

  let changed = false;
  let appliedCount = 0;

  const out: CardProgress[] = local.map((p: any) => {
    const remote = bestRemote.get(p.stableUid);
    if (!remote) return p;

    const localLast = toMs(p.lastReviewedAt) ?? 0;
    const localNext = toMs(p.nextReviewAt) ?? 0;

    const remoteLast = remote.lastReviewedAt;
    const remoteNext = remote.nextReviewAt > 0 ? remote.nextReviewAt : remote.lastReviewedAt;

    // Case A: 远端更“新”
    if (remoteLast > localLast) {
      changed = true;
      appliedCount += 1;
      return {
        ...p,
        lastReviewedAt: remoteLast,
        nextReviewAt: remoteNext,
      } as any;
    }

    // Case B: lastReviewedAt 相同，但远端带 nextReviewAtMs（Phase3）
    if (remote.hasNext && remoteLast === localLast && remoteNext > 0 && remoteNext !== localNext) {
      changed = true;
      appliedCount += 1;
      return {
        ...p,
        nextReviewAt: remoteNext,
      } as any;
    }

    return p;
  });

  // 兜底：补 local 不存在的 uid（一般不会发生，因为 loadDeckProgress 会按 deck 补齐）
  for (const [uid, remote] of bestRemote.entries()) {
    if (localByUid.has(uid)) continue;

    changed = true;
    appliedCount += 1;

    const next = remote.hasNext ? remote.nextReviewAt : remote.lastReviewedAt;

    out.push({
      stableUid: uid,
      lastReviewedAt: remote.lastReviewedAt,
      nextReviewAt: Math.max(next, remote.lastReviewedAt),
    } as any);
  }

  return { merged: out, changed, appliedCount };
}

async function pullProgressAndApply(accessToken: string): Promise<{ pulled: number; applied: number }> {
  await healCursorIfCacheMissing();

  const cursorBefore = await getCursorMs();

  const qs: string[] = ['limit=5000'];
  if (cursorBefore != null) qs.push(`sinceMs=${encodeURIComponent(String(cursorBefore))}`);
  const url = `/api/v1/sync/progress?${qs.join('&')}`;

  const resp = await apiJson<ApiOk<ProgressGetResp>>(url, {
    method: 'GET',
    accessToken,
    timeoutMs: 15000,
  });

  const items: ProgressItem[] = resp?.data?.items ?? [];
  if (!Array.isArray(items) || items.length === 0) {
    return { pulled: 0, applied: 0 };
  }

  const byDeck = new Map<string, ProgressItem[]>();
  let maxUpdatedAt = cursorBefore ?? 0;

  for (const it of items) {
    const slug = (it?.deckSlug ?? '').trim();
    if (!slug) continue;

    const u = toMs(it.updatedAtMs) ?? 0;
    if (u > maxUpdatedAt) maxUpdatedAt = u;

    const arr = byDeck.get(slug) ?? [];
    arr.push(it);
    byDeck.set(slug, arr);
  }

  // 1) cache ALL decks (even not installed)
  let cacheAllOk = true;

  for (const [deckSlug, rows] of byDeck.entries()) {
    try {
      const cache = await getRemoteCache(deckSlug);
      let cacheChanged = false;

      for (const r of rows) {
        const uid = (r?.stableUid ?? '').trim();
        if (!uid) continue;

        const newU = toMs(r.updatedAtMs) ?? 0;
        const oldU = toMs(cache[uid]?.updatedAtMs) ?? 0;

        if (!cache[uid] || newU > oldU) {
          cache[uid] = r;
          cacheChanged = true;
        }
      }

      if (cacheChanged) {
        await setRemoteCache(deckSlug, cache);
      }
    } catch {
      cacheAllOk = false;
    }
  }

  // 2) apply to installed decks only
  let applied = 0;

  for (const [deckSlug, rows] of byDeck.entries()) {
    const deck: any = await resolveDeckBySlug(deckSlug);
    if (!deck) continue;

    // 过滤 deck 不存在的 stableUid
    const uidSet = getDeckUidSet(deck);
    const filteredRows =
      uidSet.size > 0 ? rows.filter((r) => uidSet.has(String(r?.stableUid ?? '').trim())) : rows;

    const local = await loadDeckProgress(deck);
    const { merged, changed, appliedCount } = mergeRemoteIntoLocalProgress(local, filteredRows);

    if (changed) {
      await saveDeckProgress(deck, merged);
      applied += appliedCount;
    }
  }

  // 3) advance cursor only if caching succeeded
  if (cacheAllOk && maxUpdatedAt > (cursorBefore ?? 0)) {
    await setCursorMs(maxUpdatedAt);
  }

  _lastPullAtMs = Date.now();
  return { pulled: items.length, applied };
}

async function syncProgressOnce(
  accessToken: string,
  reason: string,
): Promise<{ pushed: number; pulled: number; applied: number; remaining: number }> {
  // best-effort bootstrap
  try {
    await apiJson<ApiOk<BootstrapResp>>('/api/v1/user/bootstrap', {
      method: 'POST',
      accessToken,
      body: {},
      timeoutMs: 12000,
    });
  } catch {}

  // 1) push
  const BATCH = 25;
  let pushed = 0;

  const deviceId = await getDeviceId();

  for (let round = 0; round < 20; round++) {
    const batch = await peekProgressEvents(BATCH);
    if (batch.length === 0) break;

    const resp = await apiJson<ApiOk<PushResp>>('/api/v1/sync/push', {
      method: 'POST',
      accessToken,
      body: {
        deviceId,
        events: batch.map((ev: any) => ({
          eventId: ev.eventId,
          type: 'review',
          deckSlug: ev.deckSlug,
          deckVersion: ev.deckVersion ?? null,
          stableUid: ev.stableUid,
          rating: ev.rating,

          reviewedAtMs: ev.reviewedAtMs,
          eventTimeMs: ev.reviewedAtMs,

          // Phase3：直接发 nextReviewAtMs（避免新设备把 future 卡当 due）
          nextReviewAtMs: toMs(ev.progressAfter?.nextReviewAt) ?? null,

          progressAfter: ev.progressAfter ?? null,
          lastSeenRevision: ev.lastSeenRevision ?? null,
        })),
      },
      timeoutMs: 15000,
    });

    const ackIds = [...(resp.data.acceptedEventIds || []), ...(resp.data.duplicateEventIds || [])];
    if (ackIds.length === 0) break;

    await removeProgressEventsById(ackIds);
    pushed += ackIds.length;

    if (batch.length < BATCH) break;
  }

  // 2) pull (throttled)
  let pulled = 0;
  let applied = 0;

  const now = Date.now();
  const msSinceLastPull = _lastPullAtMs > 0 ? now - _lastPullAtMs : Number.POSITIVE_INFINITY;
  const pullAllowed = msSinceLastPull >= MIN_PULL_INTERVAL_MS;

  /**
   * Pull 的目的：拿到别的设备的更新 + 填 remote cache
   * 但我们不希望每次 rating 都 pull（省流量）
   */
  const wantPull =
    reason === 'home_focus' ||
    reason === 'review_focus' ||
    reason === 'app_start' ||
    reason === 'manual' ||
    pushed === 0;

  if (wantPull && pullAllowed) {
    try {
      const r = await pullProgressAndApply(accessToken);
      pulled = r.pulled;
      applied = r.applied;
    } catch (e) {
      console.warn('[progressSync] pull failed:', (e as any)?.message ?? e);
    }
  }

  const remaining = await progressQueueSize();

  await writeLastSync({ atMs: Date.now(), reason, pushed, pulled, applied, remaining });
  await writeLastError(null);

  return { pushed, pulled, applied, remaining };
}

async function runSyncNow(reason: string): Promise<void> {
  if (_inFlight) {
    _pending = true;
    return;
  }

  _inFlight = true;
  _pending = false;

  try {
    const token = await getSyncAccessToken();
    if (!token) {
      await writeLastError('NO_TOKEN');
      return;
    }

    await syncProgressOnce(token, reason);
  } catch (e) {
    const msg = (e as any)?.message ?? String(e);
    await writeLastError(msg);
    console.warn('[progressSync] failed:', msg);
  } finally {
    _inFlight = false;

    // 如果 sync 过程中又被触发了一次，做一次短延迟 flush
    if (_pending) {
      _pending = false;
      scheduleProgressSync({ delayMs: 300, reason: 'pending_flush' });
    }
  }
}

/**
 * ✅ 省流量策略：
 * - rating 默认 10s debounce（连续打分合并成一次 push）
 * - home_focus/review_focus/app_start/manual/token_set 默认立即 sync
 *
 * 你也可以继续显式传 delayMs 来覆盖默认策略。
 */
export function scheduleProgressSync(arg?: any): void {
  // ✅ No token -> skip scheduling (avoid noisy warnings in Home before login)
  if (!_accessTokenMem || !_accessTokenMem.trim()) {
    return;
  }

  let delayMs: number | null = null;
  let reason = 'scheduled';

  if (typeof arg === 'number' && Number.isFinite(arg)) {
    delayMs = Math.max(0, Math.floor(arg));
  } else if (typeof arg === 'string') {
    reason = arg;
  } else if (arg && typeof arg === 'object') {
    const d = (arg as any).delayMs;
    if (Number.isFinite(Number(d))) delayMs = Math.max(0, Math.floor(Number(d)));
    if (typeof (arg as any).reason === 'string') reason = (arg as any).reason;
  }

  if (delayMs == null) {
    if (reason === 'rating') delayMs = 10_000;
    else if (reason === 'pending_flush') delayMs = 300;
    else if (
      reason === 'home_focus' ||
      reason === 'review_focus' ||
      reason === 'app_start' ||
      reason === 'manual' ||
      reason === 'token_set'
    ) {
      delayMs = 0;
    } else {
      delayMs = 650;
    }
  }

  _scheduledReason = reason;

  if (_timer) clearTimeout(_timer);
  _timer = setTimeout(() => {
    _timer = null;
    void runSyncNow(_scheduledReason);
  }, delayMs);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function forceProgressSync(reason: string = 'manual'): Promise<void> {
  // ✅ No token -> skip force sync entirely (avoid 20s timeout)
  const token = await getSyncAccessToken();
  if (!token || !token.trim()) return;

  scheduleProgressSync({ delayMs: 0, reason });

  const start = Date.now();
  const TIMEOUT_MS = 20000;

  while (true) {
    if (!_timer && !_inFlight && !_pending) return;

    if (Date.now() - start > TIMEOUT_MS) {
      console.warn('[progressSync] forceProgressSync timeout', { reason });
      return;
    }

    await sleep(50);
  }
}

export async function getProgressSyncDebugState(): Promise<any> {
  const [cursorMs, qSize, lastRaw, err, deviceId] = await Promise.all([
    getCursorMs(),
    progressQueueSize(),
    AsyncStorage.getItem(LAST_SYNC_KEY),
    AsyncStorage.getItem(LAST_ERROR_KEY),
    getDeviceId(),
  ]);

  let last = null;
  try {
    last = lastRaw ? JSON.parse(lastRaw) : null;
  } catch {}

  return {
    deviceId,
    cursorMs,
    queueSize: qSize,
    last,
    lastError: err || null,
  };
}

/**
 * 应用 remote cache 到本地（deck 安装后补进度用）
 * - 解决：cursor 已推进，但 deck 是后来才安装 => pull 时没法 apply 到本地
 */
export async function applyCachedRemoteProgress(deckSlug: string): Promise<number> {
  const deck: any = await resolveDeckBySlug(deckSlug);
  if (!deck) return 0;

  const cache = await getRemoteCache(deckSlug);
  const rowsAll = Object.values(cache || {});
  if (rowsAll.length === 0) return 0;

  const uidSet = getDeckUidSet(deck);
  const rows =
    uidSet.size > 0 ? rowsAll.filter((r) => uidSet.has(String(r?.stableUid ?? '').trim())) : rowsAll;

  if (rows.length === 0) return 0;

  const local = await loadDeckProgress(deck);
  const { merged, changed, appliedCount } = mergeRemoteIntoLocalProgress(local, rows);

  if (changed) {
    await saveDeckProgress(deck, merged);
  }

  return appliedCount;
}

/**
 * debug：一键清 sync 状态（下次会全量 pull）
 */
export async function resetProgressSyncState(): Promise<void> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const toRemove = keys.filter(
      (k) => k === SYNC_CURSOR_KEY || k === LAST_SYNC_KEY || k === LAST_ERROR_KEY || k.startsWith(REMOTE_CACHE_PREFIX),
    );
    if (toRemove.length > 0) {
      await AsyncStorage.multiRemove(toRemove);
    }
  } catch {}

  _lastPullAtMs = 0;
  _healedOnce = false;
}