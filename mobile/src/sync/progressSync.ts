// mobile/src/sync/progressSync.ts
import * as Crypto from 'expo-crypto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { apiJson } from '../api/apiClient';
import { resolveDeckBySlug } from '../content/deckRepository';
import { loadDeckProgress, saveDeckProgress, setActiveUserSubForStorage } from '../review/storage';
import { syncDrawStateNow } from './drawStateSync';
import { invalidateDrawStateCache } from '../features/gacha/draw/drawStateCache';
import {
  getCachedQueue,
  setCachedQueue,
  invalidateProgressQueueCache,
} from './progressQueueCache';
import { clampStage, MAX_NEXT_REVIEW_HORIZON_MS } from '../review/model';
import type { CardProgress } from '../review/model';

/**
 * Progress Sync 的设计
 *
 * 核心目标：Offline-first + Eventual Consistency
 *
 * 1) UI 只依赖本地进度（AsyncStorage）
 *    - 打分后立刻 saveDeckProgress() -> UI 马上正确
 *
 * 2) “同步”用事件队列（event queue），而不是“每次都直接写数据库”
 *    - recordReviewEvent() 把一次打分写入 queue（AsyncStorage）
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
 *    - app_foreground/draw_committed/manual/token_set/user_changed：立即同步（0ms）
 *    - 注意：MIN_PULL_INTERVAL_MS 只是“防抖”，不是“2s 定时任务”
 *
 * 5) Crash-safety
 *    - SessionCardScreen 要 await recordReviewEvent()，确保事件先落盘
 *    - app 被杀/无网：队列仍在，下次打开会继续 push
 *
 * ✅ 额外：多账号隔离
 * - sync 的队列 / cursor / remote cache 全部按 userSub 分区（不会串号）
 * - 且在 userSub 变化时，同步刷新 review/storage.ts 的内存缓存（避免 TTL 内读旧 scope）
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

  // The scheduler ladder position the server kept from the winning review.
  // Absent/null on rows merged before the server stored stage (and on old
  // servers), which is what keeps inferStageFromIntervalMs alive as a fallback.
  srsStage?: number | string | null;

  updatedAtMs: number | string | null;
};

type ProgressGetResp = {
  serverTimeMs: number;
  sinceMs: number | null;
  items: ProgressItem[];

  // ✅ Keyset pagination (additive; absent on old servers — feature-detect)
  nextCursor?: string | null;
  hasMore?: boolean;
};

export type ProgressEvent = {
  eventId: string;
  schemaVersion?: number;
  eventType?: 'card_reviewed';
  deckSlug: string;
  deckVersion: string | null;
  stableUid: string;
  rating: number;
  reviewedAtMs: number;
  progressAfter?: any;
  lastSeenRevision: number | null;
  sessionId?: string | null;
  cardRevision?: number | null;
  statedDifficulty?: number | null;
  reviewStage?: 'first_review' | 'repeat_review' | string | null;
  reviewCountForCard?: number | null;
  dwellTimeMs?: number | null;
  offlineQueueDelayMs?: number | null;
  schedulerVersion?: string | null;
};

/**
 * Which scheduler produced progressAfter.stage / nextReviewAt.
 *
 * A name, not a number: the server stores this without interpreting it, so the
 * only thing it has to support is "tell old rows from new ones". A version
 * number invites arithmetic (`>= 2`), and arithmetic on a label nobody
 * compares is how a compatibility bug gets written. Change the name when the
 * ladder changes meaning, never bump it for a bugfix.
 */
const SCHEDULER_VERSION = 'ladder-v1';

/**
 * ----------------------------
 * Auth / user scope
 * ----------------------------
 */
const ACCESS_TOKEN_KEY = 'devcards:auth:accessToken:v1';
const ACTIVE_USER_SUB_KEY = 'devcards:auth:activeUserSub:v1';

/**
 * ✅ 全部 sync 状态按 userSub 分区
 * 这样同一台设备切换账号不会互相污染 sync cursor / remote cache / queue
 */
function userPrefix(userSub: string) {
  return `devcards:u:${userSub}:`;
}

let _userSubMem: string | null = null;
let _accessTokenMem: string | null = null;

/**
 * ----------------------------
 * Cursor + remote cache (per user)
 * ----------------------------
 */
function kCursor(userSub: string) {
  return `${userPrefix(userSub)}sync:cursorMs:v1`;
}
/**
 * ✅ v2 cursor: opaque server-issued keyset cursor (base64url tuple).
 * Stored in a NEW key — the v1 key must stay a plain ms number, because
 * getCursorMs() parses it with toMs() and a base64 string would silently
 * read back as null (full re-pull).
 */
function kCursorToken(userSub: string) {
  return `${userPrefix(userSub)}sync:cursor:v2`;
}
function kLastSync(userSub: string) {
  return `${userPrefix(userSub)}sync:last:v1`;
}
function kLastError(userSub: string) {
  return `${userPrefix(userSub)}sync:lastError:v1`;
}
function remoteCachePrefix(userSub: string) {
  return `${userPrefix(userSub)}sync:remoteCache:v1:`; // + deckSlug
}

/**
 * ----------------------------
 * Device id (global per install)
 * ----------------------------
 */
const DEVICE_ID_KEY = 'devcards:deviceId:v1';

let _timer: ReturnType<typeof setTimeout> | null = null;
let _inFlight = false;
let _pending = false;
let _scheduledReason: string = 'unknown';
let _lastPullAtMs = 0;

/**
 * 这个不是“每 2s 拉一次”，只是防止短时间内重复 pull
 */
const MIN_PULL_INTERVAL_MS = 2_000;

// one-time heal guard (per user, but in-memory guard即可)
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

function optionalFiniteNumber(v: any): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function optionalPositiveInt(v: any): number | null {
  const n = optionalFiniteNumber(v);
  if (n == null) return null;
  const i = Math.floor(n);
  return i > 0 ? i : null;
}

function optionalNonNegativeInt(v: any): number | null {
  const n = optionalFiniteNumber(v);
  if (n == null) return null;
  const i = Math.floor(n);
  return i >= 0 ? i : null;
}

/**
 * A remote stage, or null when the server has none for that row.
 *
 * null and 0 are different answers and must stay different: 0 is a real rung
 * (a card that keeps getting `again`), while null means "this row predates the
 * server storing stage, infer it from the interval". Collapsing them would
 * quietly reset those cards to the bottom of the ladder.
 */
function optionalRemoteStage(v: any): number | null {
  if (v == null) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return clampStage(n);
}

function optionalString(v: any): string | null {
  const s = v == null ? '' : String(v).trim();
  return s ? s : null;
}

function getClientVersion(): string {
  return Constants.expoConfig?.version ?? 'unknown';
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

/**
 * ----------------------------
 * JWT decode (best-effort)
 * ----------------------------
 */
function b64UrlToUtf8(s: string): string | null {
  try {
    const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
    const pad = '='.repeat((4 - (b64.length % 4)) % 4);
    const full = b64 + pad;

    // Expo / RN 通常有 atob（但不保证），Buffer 也不保证，所以都做兜底
    // @ts-ignore
    if (typeof globalThis.atob === 'function') {
      // atob 返回 binary string；JWT payload 基本都是 ASCII JSON，直接用即可
      // @ts-ignore
      return globalThis.atob(full);
    }
    // @ts-ignore
    if (typeof Buffer !== 'undefined') {
      // @ts-ignore
      return Buffer.from(full, 'base64').toString('utf8');
    }
    return null;
  } catch {
    return null;
  }
}

function tryGetUserSubFromAccessToken(token: string): string | null {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    const jsonStr = b64UrlToUtf8(parts[1]);
    if (!jsonStr) return null;
    const payload = JSON.parse(jsonStr);

    const sub =
      payload?.sub ??
      payload?.username ??
      payload?.['cognito:username'] ??
      payload?.user_id ??
      payload?.uid ??
      null;

    return sub ? String(sub).trim() : null;
  } catch {
    return null;
  }
}

/**
 * ----------------------------
 * Namespaced queue (per user)
 * ----------------------------
 */
function kQueue(userSub: string) {
  return `${userPrefix(userSub)}sync:progressQueue:v1`;
}

/**
 * The queue partition used while nobody is signed in.
 *
 * A review done signed out is still a fact, and facts are not allowed to depend
 * on whether an account happened to be attached at the time. There is no real
 * userSub to namespace the queue with, so the events go to a reserved one and
 * get adopted by the next account that signs in on this device (see
 * adoptPendingProgressEvents). The name is deliberately not a legal Cognito sub,
 * so it can never collide with a real user's partition.
 */
const PENDING_SUB = '__pending__';

/**
 * Queue cap, shared by the rating path and the adoption path.
 *
 * Both append to a queue, so both need the same ceiling: adopting an unbounded
 * pending queue into a user queue would otherwise be the one way past it.
 */
const MAX_QUEUE_EVENTS = 3000;

/**
 * How many events this partition has dropped at the cap, ever.
 *
 * The cap itself is fine (an unbounded queue would eventually break
 * AsyncStorage), but until now it discarded the OLDEST reviews with no counter,
 * no log line and no UI: the events the server never received were exactly the
 * ones nobody could find out about. Every layer reported success. A number that
 * survives restarts is the cheapest thing that turns "we think this never
 * happens" into something checkable, and it is per partition (the __pending__
 * signed-out queue included) because a cap hit there means something different
 * from a cap hit on a signed-in queue.
 *
 * Stored separately from the queue so a drop is still counted when the queue is
 * later flushed to empty.
 */
function kDropped(userSub: string) {
  return `${userPrefix(userSub)}sync:droppedEvents:v1`;
}

async function readDroppedCount(userSub: string): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(kDropped(userSub));
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  } catch {
    return 0;
  }
}

async function addDroppedCount(userSub: string, n: number): Promise<void> {
  if (!Number.isFinite(n) || n <= 0) return;
  try {
    const prev = await readDroppedCount(userSub);
    await AsyncStorage.setItem(kDropped(userSub), String(prev + Math.floor(n)));
  } catch {}
}

/**
 * ----------------------------
 * Write-through queue cache
 * ----------------------------
 *
 * The parsed queue, per partition. Absent means "not read from storage yet in
 * this process", which is a different statement from "empty".
 *
 * The waste it removes: every queue mutation used to be a full round trip
 * through JSON. Enqueue read the whole queue back from AsyncStorage, JSON.parse
 * of every event ever queued, pushed ONE event, and JSON.stringify the whole
 * thing again. That put an O(depth) parse on the rating path, where depth grows
 * with everything the user does offline, so the cost of grading a card depended
 * on how long they had been out of signal. Measured on this laptop with
 * scripts/bench-hot-paths.ts, a single enqueue cost ~1.5 ms at depth 1000 and
 * ~4.5 ms at depth 3000 (the cap), against ~38 µs of fixed cost. That is a
 * frame budget spent re-reading data the process just wrote.
 *
 * Why a cache is safe here, specifically:
 *   1. readQueue and writeQueue are the ONLY doors to the queue key, and every
 *      caller of both runs inside withQueueLock. That promise chain is a single
 *      writer, so there is no interleaving that could observe a half-updated
 *      cache, and no second writer whose disk write the cache could miss.
 *   2. AsyncStorage is process-local. Nothing outside this module writes the
 *      queue key, so "storage changed behind our back" is not a case that
 *      exists, with the two exceptions handled by invalidateQueueCache below
 *      (the debug reset and the disabled wipe, both of which delete keys
 *      directly rather than through writeQueue).
 *
 * What it deliberately does NOT change: the event is still serialised and
 * handed to AsyncStorage on the rating path, awaited, before recordReviewEvent
 * resolves. See the durability note on writeQueue.
 */
// The cache itself lives in ./progressQueueCache so the debug reset can
// invalidate it without importing this module (and expo along with it).

/**
 * The cold read: the one JSON.parse of a partition per app launch.
 *
 * The parse did not become free, it became once. On a cold start with a full
 * queue the first enqueue still pays it (~4.5 ms at depth 3000 in the bench),
 * and that is the honest shape of this optimisation: the cost moved off the
 * per-rating path and onto the launch path, where it happens once and competes
 * with app startup rather than with a tap.
 */
async function loadQueueFromStorage(userSub: string): Promise<ProgressEvent[]> {
  try {
    const raw = await AsyncStorage.getItem(kQueue(userSub));
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr as ProgressEvent[];
  } catch {
    return [];
  }
}

/**
 * The cached array itself is returned, not a copy.
 *
 * Copying would put an O(depth) allocation back on the path this change exists
 * to make O(1). The contract for callers is therefore: treat the result as
 * owned by the cache. Mutate it only if you write it back through writeQueue in
 * the same critical section (enqueueProgressEvent does exactly that), and
 * otherwise derive a new array (slice/filter, as peek/remove/adopt do).
 * Everything here runs under withQueueLock, so "the same critical section" is a
 * real boundary and not a hope.
 */
async function readQueue(userSub: string): Promise<ProgressEvent[]> {
  const cached = getCachedQueue(userSub);
  if (cached) return cached;

  const loaded = await loadQueueFromStorage(userSub);
  setCachedQueue(userSub, loaded);
  return loaded;
}

/**
 * Durability vs latency, written down because it is a deliberate choice and not
 * an oversight.
 *
 * The cache removes the READ. The WRITE stays exactly where it was: one
 * serialise plus one awaited AsyncStorage.setItem, on the rating path, before
 * recordReviewEvent resolves and the UI moves on. It would be easy to make
 * enqueue look ~40x faster again by batching writes or deferring them to an
 * idle callback, and it would be wrong: this queue is the durable log of facts,
 * the local deck progress is only a projection of it, and an event that exists
 * solely in memory is lost to a crash, an OS kill or a battery pull. The system
 * is offline-first, so "the network will have it" is not a fallback either.
 *
 * The same trade-off with a different name is fsync policy in a trading or
 * database system: write-behind buys throughput and pays with a window of
 * acknowledged-but-lost writes. Here the window is set to zero on purpose. What
 * this change eliminated is pure waste, work whose removal costs no durability
 * at all, which is the only kind of optimisation that needs no justification.
 *
 * Cache before disk, not after: both are inside the lock, so no reader can ever
 * see them disagree.
 *
 * A failed write drops the cache instead of keeping the value that never
 * landed. The cache's whole claim is "this is what the queue key holds", and
 * after a rejected setItem this process does not know what the key holds, so
 * the only safe answer is to forget and re-read. That restores exactly the
 * pre-cache behaviour, where every read reflected storage, including the bad
 * cases (a rejected enqueue write loses that event, as it always did).
 */
async function writeQueue(userSub: string, arr: ProgressEvent[]): Promise<void> {
  setCachedQueue(userSub, arr);
  try {
    await AsyncStorage.setItem(kQueue(userSub), JSON.stringify(arr));
  } catch {
    invalidateProgressQueueCache(userSub);
  }
}

// Every queue mutation below is a read-modify-write over one AsyncStorage key,
// and single-threaded JS does not make that safe: a race needs two awaits, not
// two threads. The push-ack path (removeProgressEventsById, inside a sync round)
// and the rating path (enqueueProgressEvent) routinely overlap, and whoever read
// first writes last, silently deleting the other's event. That loss is invisible
// locally because deck progress was already saved, so it only surfaces as a
// missing review on another device. This promise chain is the mutex: each
// critical section runs to completion before the next one gets to read.
let _queueLockTail: Promise<unknown> = Promise.resolve();

function withQueueLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = _queueLockTail.then(fn);
  // The tail must never carry a rejection forward, or one failed section would
  // reject every later one. Callers still see the real outcome through `run`.
  _queueLockTail = run.catch(() => undefined);
  return run;
}

// The lock deliberately does NOT span peek -> push -> remove: holding it across
// a network call would block rating for the length of a request. Re-delivering
// an already-pushed event is safe (eventId is the server-side idempotency key);
// dropping a never-pushed one is not.
async function enqueueProgressEvent(userSub: string, ev: ProgressEvent): Promise<void> {
  return withQueueLock(async () => {
    // Append in place on the cached array and write that same array back. This
    // is the one caller allowed to mutate what readQueue returned (see its
    // contract note), and it is why the common case is an O(1) push instead of
    // parse-copy-serialise.
    const q = await readQueue(userSub);
    q.push(ev);

    // 保护上限：最多保留 3000 条（避免极端情况下 AsyncStorage 膨胀）
    const out = q.length > MAX_QUEUE_EVENTS ? q.slice(q.length - MAX_QUEUE_EVENTS) : q;

    await writeQueue(userSub, out);
    // Count what the slice above threw away. Written inside the lock with the
    // queue, so the counter can never disagree with what was actually dropped.
    await addDroppedCount(userSub, q.length - out.length);
  });
}

/**
 * Move every signed-out event into the queue of the account that just signed in.
 *
 * Merge policy (this is the decision the old known-limitation comment was
 * waiting on): the next account to sign in on this device adopts ALL pending
 * events. Rationale: on a personal device, the person who reviewed before
 * signing in and the person who then signs in are the same person. The shared
 * device case can mis-attribute reviews, and that risk is accepted and recorded
 * here: events are UUID-keyed idempotent facts, so a mis-adoption cannot break
 * a server invariant, it only files those reviews under the adopter.
 *
 * Local progress from the anonymous period is NOT migrated: only the events
 * move. The adopter's projection realigns through push, server merge and pull,
 * which is this system's whole thesis in one code path, facts come first and the
 * projection is rebuildable from them.
 *
 * Crash safety: copy first, clear second, never the other way around. A crash
 * between the two leaves duplicates, not losses, and duplicates are absorbed
 * twice over: this function skips eventIds already in the user queue, and the
 * server keys events by event_id (already-pushed ones come back in
 * duplicateEventIds). The reverse order would trade a recoverable duplicate for
 * an unrecoverable loss.
 */
async function adoptPendingProgressEvents(userSub: string): Promise<number> {
  if (!userSub || userSub === PENDING_SUB) return 0;

  const adopted = await withQueueLock(async () => {
    const pending = await readQueue(PENDING_SUB);
    if (pending.length === 0) return 0;

    const own = await readQueue(userSub);
    const seen = new Set(own.map((ev) => String(ev?.eventId ?? '')));

    // Append rather than interleave: order inside each partition is preserved,
    // and the server orders by reviewedAtMs anyway, so queue order only decides
    // push batching.
    const merged = own.slice();
    let added = 0;

    for (const ev of pending) {
      const id = String(ev?.eventId ?? '');
      if (!id || seen.has(id)) continue;
      seen.add(id);
      merged.push(ev);
      added += 1;
    }

    const out =
      merged.length > MAX_QUEUE_EVENTS ? merged.slice(merged.length - MAX_QUEUE_EVENTS) : merged;

    await writeQueue(userSub, out);
    // Adoption is the other way past the cap, so it counts its losses too, and
    // it counts them against the account that ended up owning the events.
    await addDroppedCount(userSub, merged.length - out.length);
    await writeQueue(PENDING_SUB, []);

    return added;
  });

  if (adopted > 0) {
    // The adopted events are only durable locally so far, so ask for a push now
    // instead of waiting for the next focus event.
    scheduleProgressSync({ delayMs: 0, reason: 'pending_adopted' });
  }

  return adopted;
}

async function peekProgressEvents(userSub: string, limit: number): Promise<ProgressEvent[]> {
  return withQueueLock(async () => {
    const q = await readQueue(userSub);
    return q.slice(0, Math.max(0, limit));
  });
}

async function removeProgressEventsById(userSub: string, ids: string[]): Promise<void> {
  if (!ids || ids.length === 0) return;
  const idSet = new Set(ids.map(String));
  return withQueueLock(async () => {
    const q = await readQueue(userSub);
    const out = q.filter((ev) => !idSet.has(String(ev?.eventId)));
    if (out.length !== q.length) {
      await writeQueue(userSub, out);
    }
  });
}

async function progressQueueSize(userSub: string): Promise<number> {
  return withQueueLock(async () => {
    const q = await readQueue(userSub);
    return q.length;
  });
}

/**
 * ----------------------------
 * Sync access token
 * ----------------------------
 */
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
 * ✅ 这里同时会尝试解析 userSub，用来做 “按用户分区”
 */
export async function setSyncAccessToken(token: string | null): Promise<void> {
  const t = token && token.trim() ? token.trim() : null;
  _accessTokenMem = t;

  try {
    if (t) await AsyncStorage.setItem(ACCESS_TOKEN_KEY, t);
    else await AsyncStorage.removeItem(ACCESS_TOKEN_KEY);
  } catch {}

  if (!t) {
    await setActiveUserSub(null);
    // Sign-out is a session boundary, so nothing from the previous session is
    // answered out of memory afterwards. setActiveUserSub already drops the
    // cache when the sub actually changes, but signing out with no sub resolved
    // yet (token expired before the sub was ever read) takes its no-op branch,
    // and that is precisely the case where signed-out events are queued.
    invalidateProgressQueueCache();
    // token 被清除 -> 取消任何 pending 的 sync
    if (_timer) clearTimeout(_timer);
    _timer = null;
    return;
  }

  // token 一旦可用，立刻触发 sync
  scheduleProgressSync({ delayMs: 0, reason: 'token_set' });
}

/**
 * ✅ 主动设置当前 userSub（推荐你在登录成功后调用一次，最稳）
 * - 如果你不调用，这里也会从 accessToken 尽力解析 sub
 */
export async function setActiveUserSub(userSub: string | null): Promise<void> {
  const next = userSub && userSub.trim() ? userSub.trim() : null;

  const prev = _userSubMem ?? (await AsyncStorage.getItem(ACTIVE_USER_SUB_KEY).catch(() => null));
  const prevNorm = prev && prev.trim() ? prev.trim() : null;

  if (next === prevNorm) {
    _userSubMem = next;

    // ✅ 关键：同步刷新 review/storage.ts 的内存缓存（绕过 TTL）
    setActiveUserSubForStorage(next);

    // Not a no-op branch any more: re-signing in as the sub already stored from
    // a previous session lands here (the token expired, reviews went pending,
    // the user signed back in as themselves), which is precisely when there is
    // something to adopt. Adoption is idempotent, so running it on every
    // same-sub call is cheap and cannot double-count.
    if (next) await adoptPendingProgressEvents(next);
    return;
  }

  _userSubMem = next;

  try {
    if (next) await AsyncStorage.setItem(ACTIVE_USER_SUB_KEY, next);
    else await AsyncStorage.removeItem(ACTIVE_USER_SUB_KEY);
  } catch {}

  // ✅ 关键：同步刷新 review/storage.ts 的内存缓存（绕过 TTL）
  setActiveUserSubForStorage(next);

  // user 发生变化：重置 in-memory sync 状态（不再 wipe 本地进度）
  await onUserChanged(prevNorm, next);

  // user 切换后立即做一次同步
  if (next) scheduleProgressSync({ delayMs: 0, reason: 'user_changed' });
}

/**
 * 如果你没有显式调用 setActiveUserSub，这里会在第一次 sync 时自动解析 token 来设置
 */
async function ensureUserSubReady(accessToken: string): Promise<string | null> {
  if (_userSubMem && _userSubMem.trim()) return _userSubMem.trim();

  try {
    const stored = await AsyncStorage.getItem(ACTIVE_USER_SUB_KEY);
    if (stored && stored.trim()) {
      _userSubMem = stored.trim();
      return _userSubMem;
    }
  } catch {}

  const sub = tryGetUserSubFromAccessToken(accessToken);
  if (sub) {
    await setActiveUserSub(sub);
    return sub;
  }

  return null;
}

/**
 * ----------------------------
 * Local wipe on user change (fallback)
 * ----------------------------
 *
 * ✅ 现在 review/storage.ts 已经按 ACTIVE_USER_SUB_KEY 做了分区，因此默认不需要 wipe。
 * 但保留一键兜底开关，方便调试。
 */
const ENABLE_WIPE_ON_USER_CHANGE = false;

const WIPE_PREFIX_CANDIDATES: string[] = [
  // 你现在这份 progressSync 旧 key（未分 user）：
  'devcards:sync:',
  // 很多项目会用这些前缀存 progress（你把 review/storage.ts 贴我，我可以精确化）
  'devcards:review:',
  'devcards:progress:',
];

function shouldWipeKey(k: string): boolean {
  if (!k) return false;

  // 不要动 auth / content / deck files 元数据
  if (k.startsWith('devcards:auth:')) return false;

  // 命中强前缀
  if (WIPE_PREFIX_CANDIDATES.some((p) => k.startsWith(p))) return true;

  // 兜底：只清和 progress 强相关的 key
  const low = k.toLowerCase();
  if (low.includes('progress') || low.includes('review') || low.includes('cursor')) return true;

  return false;
}

/**
 * ⚠️ 兜底清理（默认关闭）
 */
async function wipeLocalStudyStateBestEffort(): Promise<void> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const toRemove = keys.filter(shouldWipeKey);
    if (toRemove.length > 0) {
      await AsyncStorage.multiRemove(toRemove);
    }
  } catch {}
  // shouldWipeKey matches the queue keys (they contain "progress"), so this
  // deletes queue data without going through writeQueue. Every partition is
  // dropped because the filter is a prefix/substring match, not a per-user one.
  invalidateProgressQueueCache();
}

async function onUserChanged(prevSub: string | null, nextSub: string | null): Promise<void> {
  // 清掉内存状态
  _lastPullAtMs = 0;
  _healedOnce = false;

  // The queue cache is per partition, so a switch cannot mix two accounts'
  // events even without this line. It is dropped anyway for two reasons: the
  // signed-out partition is about to be rewritten by adoption below, and an
  // account the user has left has no claim on this process's memory. Dropping
  // it costs one re-parse on the next enqueue and removes a whole class of
  // "stale partition" reasoning from the account-switch path.
  invalidateProgressQueueCache();

  // 清掉 pending timer
  if (_timer) clearTimeout(_timer);
  _timer = null;

  // 如果正在 inFlight，允许它结束；但之后会触发 pending_flush
  _pending = false;

  // ✅ 默认不 wipe（多账号共存）
  if (ENABLE_WIPE_ON_USER_CHANGE) {
    await wipeLocalStudyStateBestEffort();
  }

  // Sign-in / account switch: the arriving account takes the signed-out events.
  if (nextSub) await adoptPendingProgressEvents(nextSub);
}

/**
 * ----------------------------
 * Record review event
 * ----------------------------
 */
export async function recordReviewEvent(...args: any[]): Promise<string | null> {
  // No token (signed out), or a token we cannot read a sub out of: the event is
  // still produced, it just goes to the PENDING_SUB partition instead of a
  // user's. It rides the same withQueueLock serializer and the same cap, because
  // the lock is one global chain rather than one per sub, so pending and user
  // queues can never be mid-write at the same time. Adoption on sign-in
  // (adoptPendingProgressEvents) is what eventually gets these to the server.
  const accessToken = await getSyncAccessToken();
  const resolvedSub = accessToken ? await ensureUserSubReady(accessToken) : null;
  const queueSub = resolvedSub ?? PENDING_SUB;

  let deckSlug: string | null = null;
  let stableUid: string | null = null;
  let rating: any = null;
  let reviewedAtMs: number = Date.now();

  let deckVersion: string | null | undefined = undefined;
  let progressAfter: any = undefined;
  let lastSeenRevision: number | null | undefined = undefined;
  let sessionId: string | null | undefined = undefined;
  let cardRevision: number | null | undefined = undefined;
  let statedDifficulty: number | null | undefined = undefined;
  let reviewStage: string | null | undefined = undefined;
  let reviewCountForCard: number | null | undefined = undefined;
  let dwellTimeMs: number | null | undefined = undefined;

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

    sessionId = optionalString(obj.sessionId);
    cardRevision = optionalPositiveInt(obj.cardRevision);
    statedDifficulty = optionalPositiveInt(obj.statedDifficulty);
    reviewStage = optionalString(obj.reviewStage);
    reviewCountForCard = optionalPositiveInt(obj.reviewCountForCard);
    dwellTimeMs = optionalNonNegativeInt(obj.dwellTimeMs);
  }

  if (!deckSlug || !stableUid) return null;

  const resolvedRevision = cardRevision ?? lastSeenRevision ?? optionalPositiveInt(progressAfter?.lastSeenRevision);

  const ev: ProgressEvent = {
    eventId: Crypto.randomUUID(),
    schemaVersion: 1,
    eventType: 'card_reviewed',
    deckSlug,
    deckVersion: deckVersion ?? null,
    stableUid,
    rating: mapRatingToNumber(rating),
    reviewedAtMs,
    progressAfter,
    lastSeenRevision: lastSeenRevision ?? null,
    sessionId: sessionId ?? null,
    cardRevision: resolvedRevision ?? null,
    statedDifficulty: statedDifficulty ?? null,
    reviewStage: reviewStage ?? null,
    reviewCountForCard: reviewCountForCard ?? null,
    dwellTimeMs: dwellTimeMs ?? null,
    offlineQueueDelayMs: 0,
    // Stamped at record time, not at push time: an event that sat in the queue
    // across an app upgrade was still produced by the scheduler that was
    // running when the user rated the card.
    schedulerVersion: SCHEDULER_VERSION,
  };

  await enqueueProgressEvent(queueSub, ev);
  return ev.eventId;
}

/**
 * ----------------------------
 * Cursor / remote cache (per user)
 * ----------------------------
 */
async function getCursorMs(userSub: string): Promise<number | null> {
  try {
    const raw = await AsyncStorage.getItem(kCursor(userSub));
    return toMs(raw);
  } catch {
    return null;
  }
}

async function setCursorMs(userSub: string, ms: number): Promise<void> {
  try {
    await AsyncStorage.setItem(kCursor(userSub), String(Math.floor(ms)));
  } catch {}
}

async function clearCursorMs(userSub: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(kCursor(userSub));
  } catch {}
}

async function getCursorToken(userSub: string): Promise<string | null> {
  try {
    const raw = await AsyncStorage.getItem(kCursorToken(userSub));
    const t = raw && raw.trim() ? raw.trim() : null;
    return t;
  } catch {
    return null;
  }
}

async function setCursorToken(userSub: string, token: string): Promise<void> {
  try {
    await AsyncStorage.setItem(kCursorToken(userSub), token);
  } catch {}
}

async function clearCursorToken(userSub: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(kCursorToken(userSub));
  } catch {}
}

function remoteCacheKey(userSub: string, deckSlug: string) {
  return `${remoteCachePrefix(userSub)}${deckSlug}`;
}

async function getRemoteCache(userSub: string, deckSlug: string): Promise<Record<string, ProgressItem>> {
  try {
    const raw = await AsyncStorage.getItem(remoteCacheKey(userSub, deckSlug));
    if (!raw) return {};
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== 'object') return {};
    return obj as Record<string, ProgressItem>;
  } catch {
    return {};
  }
}

async function setRemoteCache(
  userSub: string,
  deckSlug: string,
  cache: Record<string, ProgressItem>,
): Promise<void> {
  try {
    await AsyncStorage.setItem(remoteCacheKey(userSub, deckSlug), JSON.stringify(cache));
  } catch {
    // ignore
  }
}

async function writeLastSync(userSub: string, payload: any) {
  try {
    await AsyncStorage.setItem(kLastSync(userSub), JSON.stringify(payload));
  } catch {}
}

async function writeLastError(userSub: string, msg: string | null) {
  try {
    if (!msg) await AsyncStorage.removeItem(kLastError(userSub));
    else await AsyncStorage.setItem(kLastError(userSub), msg);
  } catch {}
}

/**
 * 自愈：cursor 有值，但 remoteCache 全没了（常见：清缓存但没清 cursor）
 */
async function healCursorIfCacheMissing(userSub: string): Promise<void> {
  if (_healedOnce) return;
  _healedOnce = true;

  const cursor = await getCursorMs(userSub);
  const cursorToken = await getCursorToken(userSub);
  if (cursor == null && cursorToken == null) return;

  try {
    const keys = await AsyncStorage.getAllKeys();
    const prefix = remoteCachePrefix(userSub);
    const hasAnyCache = keys.some((k) => k.startsWith(prefix));
    if (!hasAnyCache) {
      console.warn('[progressSync] heal: cursor exists but no remote cache keys; reset cursor', { cursor, userSub });
      // heal 的语义是“重新全量拉取”，v1 ms cursor 和 v2 keyset cursor 必须一起清
      await clearCursorMs(userSub);
      await clearCursorToken(userSub);
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
 *
 * Exported only so the multi-device simulator
 * (tests/unit/multiDeviceSync.sim.test.ts) can drive the real merge instead of
 * a copy of it. A re-implementation in the test would assert that the copy
 * converges, which is exactly the claim nobody needs.
 */
export function mergeRemoteIntoLocalProgress(
  local: CardProgress[],
  remoteRows: ProgressItem[],
): { merged: CardProgress[]; changed: boolean; appliedCount: number } {
  const localByUid = new Map(local.map((p: any) => [p.stableUid, p]));

  type RemoteBest = {
    lastReviewedAt: number;
    updatedAt: number;
    hasNext: boolean;
    nextReviewAt: number;
    srsStage: number | null;
    row: ProgressItem;
  };

  /** Total order on remote snapshots of one card. See the tie note below. */
  function compareRemoteBest(a: RemoteBest, b: RemoteBest): number {
    if (a.updatedAt !== b.updatedAt) return a.updatedAt - b.updatedAt;
    if (a.lastReviewedAt !== b.lastReviewedAt) return a.lastReviewedAt - b.lastReviewedAt;
    if (a.nextReviewAt !== b.nextReviewAt) return a.nextReviewAt - b.nextReviewAt;
    // stage entered the payload, so it has to enter the order too: two rows
    // alike on the timestamps but differing on the rung would otherwise be a
    // tie, and a tie is exactly where "first row in the array wins" comes back.
    // -1 sorts a missing stage below every real rung (0..6).
    if ((a.srsStage ?? -1) !== (b.srsStage ?? -1)) return (a.srsStage ?? -1) - (b.srsStage ?? -1);
    const au = String(a.row?.stableUid ?? '');
    const bu = String(b.row?.stableUid ?? '');
    return au < bu ? -1 : au > bu ? 1 : 0;
  }

  const bestRemote = new Map<string, RemoteBest>();

  for (const r of remoteRows) {
    const uid = (r?.stableUid ?? '').trim();
    if (!uid) continue;

    const lastReviewedAt = toMs(r.lastReviewedAtMs) ?? 0;
    const updatedAt = toMs(r.updatedAtMs) ?? 0;
    if (lastReviewedAt <= 0 || updatedAt <= 0) continue;

    const serverNext = toMs((r as any).nextReviewAtMs);
    const hasNext = serverNext != null;
    // Mirror of the ingest clamp in src_C/Vpc/Runtime/ProgressEvents.cs. It is
    // not redundant with it: this device may be talking to a server that has
    // not shipped that clamp, or reading a row stored before it existed (those
    // are repaired by migration 015, but only once the migration has run). A
    // due date past the horizon removes the card from the product with no error
    // anywhere, and the client is the last place that can refuse it.
    const nextReviewAt = hasNext
      ? Math.min(serverNext as number, lastReviewedAt + MAX_NEXT_REVIEW_HORIZON_MS)
      : lastReviewedAt;

    const srsStage = optionalRemoteStage((r as any).srsStage);

    const prev = bestRemote.get(uid);
    const candidate: RemoteBest = { lastReviewedAt, updatedAt, hasNext, nextReviewAt, srsStage, row: r };

    // remoteRows is a BAG, not a sequence: pages of one drain, a replay of the
    // remote cache, a retried request. A strict `updatedAt > prev.updatedAt`
    // means "the first row seen wins the tie", so the answer depended on array
    // order and the merge was not commutative.
    //
    // Counterexample, from tests/unit/multiDeviceSync.sim.test.ts:
    //   rows = [ {uid, updatedAt: T, lastReviewedAt: T-300},
    //            {uid, updatedAt: T, lastReviewedAt: T} ]
    //   merge(local, rows) kept T-300, merge(local, reversed) kept T.
    // updatedAt ties are not exotic: the server stamps updated_at from a single
    // now() per transaction and toMs() floors it to milliseconds, the same
    // ms-granularity collision the keyset cursor already had to fix at
    // microsecond precision.
    //
    // So compare a tuple that totally orders the rows instead. stableUid is the
    // documented last component and is included for completeness, but it is
    // constant inside a group (it is the map key), which is why the timestamps
    // have to carry the tiebreak.
    if (!prev || compareRemoteBest(candidate, prev) > 0) {
      bestRemote.set(uid, candidate);
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

    // The client mirror of the server's atomic group: wherever we accept the
    // remote due date we accept the remote stage in the same assignment, so a
    // card's rung and its next review always come from one device's review.
    // A null remote stage is left alone rather than written: that is a legacy
    // row, and storage.ts still infers its stage from the interval.
    const remoteStagePatch = remote.srsStage != null ? { stage: remote.srsStage } : {};

    // A deck revision pulled this card back to due (see reconcileProgressWithDeck
    // in review/storage.ts) AFTER the review the remote row describes. The
    // server is not wrong, it is just answering an older question: its due date
    // was computed from content the user has since not seen. Adopting it undoes
    // the relearn, and it undoes it silently, on every pull, so the content
    // update never reaches the user at all.
    //
    // While the mark stands, the local schedule wins. Both nextReviewAt and
    // stage stay local, because the demotion is one verdict about one card and
    // splitting it would leave the rung from one device next to the due date
    // from another, the same stitched state the server-side merge comment warns
    // about. lastReviewedAt is still taken from the remote row: that review did
    // happen, and pinning it forward is what stops this branch from re-running
    // forever. The local intent expires the moment a real review arrives, since
    // scheduleNextReview clears the mark.
    const demotedAt = toMs((p as any).revisionDemotedAt) ?? 0;
    const keepLocalSchedule = demotedAt > remoteLast;

    // Case A: 远端更“新”
    if (remoteLast > localLast) {
      changed = true;
      appliedCount += 1;
      if (keepLocalSchedule) {
        return { ...p, lastReviewedAt: remoteLast } as any;
      }
      return {
        ...p,
        lastReviewedAt: remoteLast,
        nextReviewAt: remoteNext,
        ...remoteStagePatch,
      } as any;
    }

    // Case B: lastReviewedAt 相同，但远端带 nextReviewAtMs（Phase3）
    if (
      !keepLocalSchedule &&
      remote.hasNext &&
      remoteLast === localLast &&
      remoteNext > 0 &&
      remoteNext !== localNext
    ) {
      changed = true;
      appliedCount += 1;
      return {
        ...p,
        nextReviewAt: remoteNext,
        ...remoteStagePatch,
      } as any;
    }

    return p;
  });

  // 兜底：补 local 不存在的 uid
  for (const [uid, remote] of bestRemote.entries()) {
    if (localByUid.has(uid)) continue;

    changed = true;
    appliedCount += 1;

    const next = remote.hasNext ? remote.nextReviewAt : remote.lastReviewedAt;

    out.push({
      stableUid: uid,
      lastReviewedAt: remote.lastReviewedAt,
      nextReviewAt: Math.max(next, remote.lastReviewedAt),
      // Same rule as above: adopt the server's rung when it has one, and stay
      // silent when it does not, so the interval fallback keeps its job.
      ...(remote.srsStage != null ? { stage: remote.srsStage } : {}),
    } as any);
  }

  return { merged: out, changed, appliedCount };
}

/**
 * ----------------------------
 * Pull
 * ----------------------------
 */

/**
 * ✅ 排水环硬上限（安全阀）：
 * - 正常情况下 hasMore=false 会提前 break；
 * - 上限用来兜底“服务端 bug / cursor 不前进 / 恶意 hasMore=true”导致的死循环。
 * - 20 页 × 5000 行 = 单次 sync 最多 10 万行，远超真实 backlog；
 *   剩余数据（如有）会在下一次 sync 继续收敛，不会丢。
 */
const MAX_PULL_PAGES_PER_SYNC = 20;

async function pullProgressAndApply(
  userSub: string,
  accessToken: string,
): Promise<{ pulled: number; applied: number }> {
  await healCursorIfCacheMissing(userSub);

  let pulled = 0;
  let applied = 0;

  // while(hasMore) 排水环：每页走完整的 fetch -> cache -> merge -> advance-cursor 流程，
  // cursor 只在该页成功应用后才持久化（沿用原“advance only after success”原则）。
  for (let page = 0; page < MAX_PULL_PAGES_PER_SYNC; page++) {
    const r = await pullProgressPageAndApply(userSub, accessToken);
    pulled += r.pulled;
    applied += r.applied;
    if (!r.hasMore) break;
  }

  _lastPullAtMs = Date.now();
  return { pulled, applied };
}

/**
 * 拉取并应用“一页”进度。
 * - 老服务端（无 nextCursor/hasMore 字段）：行为与历史版本完全一致（单页、legacy ms cursor）。
 * - 新服务端：请求带上 opaque keyset cursor（v2），响应的 nextCursor 在本页成功应用后持久化。
 */
async function pullProgressPageAndApply(
  userSub: string,
  accessToken: string,
): Promise<{ pulled: number; applied: number; hasMore: boolean }> {
  const cursorBefore = await getCursorMs(userSub);
  const cursorToken = await getCursorToken(userSub);

  const qs: string[] = ['limit=5000'];
  // 新 keyset cursor（服务端签发的 base64url 元组）。老服务端会忽略未知参数并回退用 sinceMs。
  if (cursorToken != null) qs.push(`cursor=${encodeURIComponent(cursorToken)}`);
  // legacy ms cursor 继续发送：兼容老服务端 / 服务端回滚的场景。
  if (cursorBefore != null) qs.push(`sinceMs=${encodeURIComponent(String(cursorBefore))}`);
  const url = `/api/v1/sync/progress?${qs.join('&')}`;

  let resp: ApiOk<ProgressGetResp>;
  try {
    resp = await apiJson<ApiOk<ProgressGetResp>>(url, {
      method: 'GET',
      accessToken,
      timeoutMs: 15000,
    });
  } catch (e: any) {
    // 自愈：v2 keyset cursor 被服务端 400 拒绝（畸形/版本不认——AsyncStorage 损坏或
    // 未来 cursor 版本演进）。若不清除，之后每次 sync 都会原样重发同一个坏 cursor，
    // pull 将永久瘫痪。处置：清掉 v2 cursor，本页立即用 legacy sinceMs 重试一次。
    if (cursorToken != null && e?.status === 400) {
      console.warn('[progressSync] pull cursor rejected (400); clearing v2 cursor, retrying with sinceMs', {
        userSub,
        message: e?.message ?? String(e),
      });
      await clearCursorToken(userSub);
      const legacyQs: string[] = ['limit=5000'];
      if (cursorBefore != null) legacyQs.push(`sinceMs=${encodeURIComponent(String(cursorBefore))}`);
      resp = await apiJson<ApiOk<ProgressGetResp>>(`/api/v1/sync/progress?${legacyQs.join('&')}`, {
        method: 'GET',
        accessToken,
        timeoutMs: 15000,
      });
    } else {
      throw e;
    }
  }

  const data = resp?.data;
  const items: ProgressItem[] = data?.items ?? [];

  // 特性探测：老服务端没有 nextCursor/hasMore -> hasMore=false -> 单页，与今天完全一致。
  const nextCursor =
    typeof data?.nextCursor === 'string' && data.nextCursor.trim() ? data.nextCursor.trim() : null;
  const hasMore = data?.hasMore === true && nextCursor != null;

  if (!Array.isArray(items) || items.length === 0) {
    return { pulled: 0, applied: 0, hasMore: false };
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
      const cache = await getRemoteCache(userSub, deckSlug);
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
        await setRemoteCache(userSub, deckSlug, cache);
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
  if (cacheAllOk) {
    if (maxUpdatedAt > (cursorBefore ?? 0)) {
      await setCursorMs(userSub, maxUpdatedAt);
    }
    // ✅ 无论 hasMore 与否都持久化 nextCursor：
    // 最后一页的 cursor 是精确的 keyset 元组，下一次 sync 从它续拉，
    // 才能修复“同一 updated_at 跨页/跨 sync 边界被 strict > 永久跳过”的 bug。
    if (nextCursor != null) {
      await setCursorToken(userSub, nextCursor);
    }
  }

  // 缓存失败时不推进 cursor，也不要继续排水（否则会在同一页上打转）。
  return { pulled: items.length, applied, hasMore: cacheAllOk ? hasMore : false };
}

/**
 * ----------------------------
 * Sync once (push + pull)
 * ----------------------------
 */
async function syncProgressOnce(
  userSub: string,
  accessToken: string,
  reason: string,
): Promise<{ pushed: number; pulled: number; applied: number; remaining: number }> {
  // best-effort bootstrap（也可以顺便用它来拿 userSub）
  try {
    const boot = await apiJson<ApiOk<BootstrapResp>>('/api/v1/user/bootstrap', {
      method: 'POST',
      accessToken,
      body: {},
      timeoutMs: 12000,
    });

    const serverSub = boot?.data?.userSub ? String(boot.data.userSub).trim() : null;
    if (serverSub && serverSub !== userSub) {
      // token 解析不到 / 解析错时，bootstrap 是最终真相
      await setActiveUserSub(serverSub);
      userSub = serverSub;
    }
  } catch {}

  // 1) push
  const BATCH = 25;
  let pushed = 0;

  const deviceId = await getDeviceId();

  for (let round = 0; round < 20; round++) {
    const batch = await peekProgressEvents(userSub, BATCH);
    if (batch.length === 0) break;

    const resp = await apiJson<ApiOk<PushResp>>('/api/v1/sync/push', {
      method: 'POST',
      accessToken,
      body: {
        deviceId,
        clientPlatform: Platform.OS,
        clientVersion: getClientVersion(),
        events: batch.map((ev: any) => ({
          eventId: ev.eventId,
          schemaVersion: ev.schemaVersion ?? 1,
          eventType: ev.eventType ?? 'card_reviewed',
          type: 'review',
          deckSlug: ev.deckSlug,
          deckVersion: ev.deckVersion ?? null,
          stableUid: ev.stableUid,
          rating: ev.rating,
          sessionId: ev.sessionId ?? null,
          cardRevision: ev.cardRevision ?? ev.lastSeenRevision ?? null,
          statedDifficulty: ev.statedDifficulty ?? null,
          reviewStage: ev.reviewStage ?? null,
          reviewCountForCard: ev.reviewCountForCard ?? null,
          dwellTimeMs: ev.dwellTimeMs ?? null,
          offlineQueueDelayMs: Math.max(0, Date.now() - Number(ev.reviewedAtMs ?? Date.now())),

          reviewedAtMs: ev.reviewedAtMs,
          eventTimeMs: ev.reviewedAtMs,

          // Phase3：直接发 nextReviewAtMs（避免新设备把 future 卡当 due）
          nextReviewAtMs: toMs(ev.progressAfter?.nextReviewAt) ?? null,

          // Events queued before this field existed carry no version; the
          // current one is the honest guess for them (they came from this
          // install, running this ladder).
          schedulerVersion: ev.schedulerVersion ?? SCHEDULER_VERSION,

          progressAfter: ev.progressAfter ?? null,
          lastSeenRevision: ev.lastSeenRevision ?? null,
        })),
      },
      timeoutMs: 15000,
    });

    const ackIds = [...(resp.data.acceptedEventIds || []), ...(resp.data.duplicateEventIds || [])];
    if (ackIds.length === 0) break;

    await removeProgressEventsById(userSub, ackIds);
    pushed += ackIds.length;

    if (batch.length < BATCH) break;
  }

  // 2) pull (throttled)
  let pulled = 0;
  let applied = 0;

  const now = Date.now();
  const msSinceLastPull = _lastPullAtMs > 0 ? now - _lastPullAtMs : Number.POSITIVE_INFINITY;
  const pullAllowed = msSinceLastPull >= MIN_PULL_INTERVAL_MS;

  // Every name in this list must have a caller. The previous version
  // listed 'home_focus', 'review_focus' and 'app_start', none of which is
  // passed anywhere in the repo, and omitted 'app_foreground', which
  // App.tsx fires on every AppState 'active' transition. The list was
  // therefore documentation of an intent, not a description of behaviour.
  //
  // The hole it left is narrow but is exactly the multi-device case:
  // `pushed === 0` below already forces a pull when the outbox is empty,
  // so the only sync that skipped the pull was a foreground sync that had
  // local work to send. Study on phone A, open phone B while B still has
  // queued ratings, and B pushes its own work without ever learning about
  // A's — self-healing only on some later foreground that finds an empty
  // queue.
  //
  // Of the two fixes the issue offered, this takes "whitelist the trigger
  // that actually fires" over "wire the documented focus triggers up".
  // Screen focus fires many times per session (every tab swap through
  // Home or Review), and MIN_PULL_INTERVAL_MS is only 2s, so per-screen
  // triggers would buy a pull rate the server has not been asked for.
  // Foreground is both rarer and better correlated with the thing we are
  // trying to notice: time has passed during which another device could
  // have written. It also covers cold start, because AppState settles to
  // 'active' shortly after mount, which is what 'app_start' was for.
  //
  // 'draw_committed' is a gacha commit landing (see DrawScreen). A draw
  // queues no review events, so it would reach the pull through
  // `pushed === 0` today; it is named explicitly because a future traffic
  // policy would key on the reason string, and because a draw is exactly
  // when the user most wants their other devices reconciled.
  const wantPull =
    reason === 'app_foreground' ||
    reason === 'draw_committed' ||
    reason === 'manual' ||
    reason === 'token_set' ||
    reason === 'user_changed' ||
    pushed === 0;

  if (wantPull && pullAllowed) {
    try {
      const r = await pullProgressAndApply(userSub, accessToken);
      pulled = r.pulled;
      applied = r.applied;
    } catch (e) {
      console.warn('[progressSync] pull failed:', (e as any)?.message ?? e);
    }
  }

  const remaining = await progressQueueSize(userSub);

  await writeLastSync(userSub, { atMs: Date.now(), reason, pushed, pulled, applied, remaining });
  await writeLastError(userSub, null);

  return { pushed, pulled, applied, remaining };
}

/**
 * ----------------------------
 * Scheduler / runner
 * ----------------------------
 */
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
      // 没 token 就不报 noisy error
      return;
    }

    const userSub = await ensureUserSubReady(token);
    if (!userSub) {
      console.warn('[progressSync] NO_USER_SUB (cannot namespace sync keys). Call setActiveUserSub() after login.');
      return;
    }

    await syncProgressOnce(userSub, token, reason);
  } catch (e) {
    const msg = (e as any)?.message ?? String(e);

    try {
      const token = await getSyncAccessToken();
      if (token) {
        const userSub = await ensureUserSubReady(token);
        if (userSub) await writeLastError(userSub, msg);
      }
    } catch {}

    console.warn('[progressSync] failed:', msg);
  } finally {
    _inFlight = false;

    // 如果 sync 过程中又被触发了一次，做一次短延迟 flush
    if (_pending) {
      _pending = false;
      scheduleProgressSync({ delayMs: 300, reason: 'pending_flush' });
    }

    // Gamification state rides the same trigger points (app_foreground /
    // draw_committed / manual / token_set / user_changed / rating flush) instead
    // of growing a scheduler of its own: one thing decides when this device
    // talks to the server.
    //
    // It runs in `finally`, after the flags are cleared, for two reasons. A
    // failed review sync (offline, 5xx) must not skip it, because the two have
    // independent failure modes and the draw state may be the half that can get
    // through. And nothing above may wait on it: syncDrawStateNow swallows its
    // own errors, and the review sync's success, error record and in-flight
    // state are all already settled by the time it starts.
    try {
      const drawToken = await getSyncAccessToken();
      if (drawToken) await syncDrawStateNow(drawToken);
    } catch {
      // Unreachable by contract (syncDrawStateNow never throws); belt and
      // braces, because the one thing this call may never do is fail a review.
    }
  }
}

/**
 * ✅ 省流量策略：
 * - rating 默认 10s debounce（连续打分合并成一次 push）
 * - app_foreground/draw_committed/manual/token_set/user_changed 默认立即 sync
 */
export function scheduleProgressSync(arg?: any): void {
  // ✅ No token -> skip scheduling
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
      // Same rule as the wantPull list below: only reasons with real
      // callers are named. The three focus reasons that used to sit here
      // never reached this function, so the branch was unreachable and
      // read as if the app had per-screen sync triggers it does not have.
      reason === 'app_foreground' ||
      reason === 'draw_committed' ||
      reason === 'manual' ||
      reason === 'token_set' ||
      reason === 'user_changed'
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
  const token = await getSyncAccessToken();
  const userSub = token ? await ensureUserSubReady(token) : null;

  const [cursorMs, lastRaw, err, deviceId, qSize, dropped, pendingSize, pendingDropped] =
    await Promise.all([
      userSub ? getCursorMs(userSub) : Promise.resolve(null),
      userSub ? AsyncStorage.getItem(kLastSync(userSub)) : Promise.resolve(null),
      userSub ? AsyncStorage.getItem(kLastError(userSub)) : Promise.resolve(null),
      getDeviceId(),
      userSub ? progressQueueSize(userSub) : Promise.resolve(0),
      userSub ? readDroppedCount(userSub) : Promise.resolve(0),
      // The signed-out partition is reported whether or not anyone is signed in:
      // events stranded there are precisely the ones no account can see.
      progressQueueSize(PENDING_SUB),
      readDroppedCount(PENDING_SUB),
    ]);

  let last = null;
  try {
    last = lastRaw ? JSON.parse(lastRaw) : null;
  } catch {}

  return {
    deviceId,
    userSub: userSub ?? null,
    cursorMs,
    queueSize: qSize,
    // Reviews this device threw away at the queue cap and can never send. Not
    // folded into one total: the two partitions fail for different reasons.
    droppedCount: dropped,
    pendingQueueSize: pendingSize,
    pendingDroppedCount: pendingDropped,
    last,
    lastError: err || null,
  };
}

/**
 * 应用 remote cache 到本地（deck 安装后补进度用）
 */
export async function applyCachedRemoteProgress(deckSlug: string): Promise<number> {
  const token = await getSyncAccessToken();
  if (!token) return 0;

  const userSub = await ensureUserSubReady(token);
  if (!userSub) return 0;

  const deck: any = await resolveDeckBySlug(deckSlug);
  if (!deck) return 0;

  const cache = await getRemoteCache(userSub, deckSlug);
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
 * debug：一键清 sync 状态（只清当前用户）
 */
export async function resetProgressSyncState(): Promise<void> {
  const token = await getSyncAccessToken();
  if (!token) return;

  const userSub = await ensureUserSubReady(token);
  if (!userSub) return;

  // Held under the queue lock so this cannot land between another section's
  // read and its write: that section would otherwise write its snapshot back
  // and resurrect the queue this call just deleted. Before the cache the same
  // race existed against the snapshot in flight; now it would also leave a
  // cache entry describing keys that no longer exist, so the deletion and the
  // invalidation belong in one critical section.
  await withQueueLock(async () => {
    try {
      const keys = await AsyncStorage.getAllKeys();
      const prefix = userPrefix(userSub);

      const toRemove = keys.filter((k) => k.startsWith(prefix));
      if (toRemove.length > 0) {
        await AsyncStorage.multiRemove(toRemove);
      }
    } catch {}

    // Only this user's partition: the signed-out queue lives outside userPrefix
    // and was not deleted, so dropping its cache would be a pointless re-parse.
    invalidateProgressQueueCache(userSub);

    // The prefix sweep above is wider than its name suggests: `devcards:u:{sub}:`
    // also covers this account's draw state, so this debug reset deletes the
    // collection along with the sync bookkeeping. Whether it should is a
    // separate question; while it does, the in-memory read model has to be
    // dropped too, or the next draw would rebuild the deleted collection from
    // memory. Cleared wholesale because this cache is keyed by storage key,
    // not by sub -- filtering here would duplicate the key layout that
    // drawStateStore owns.
    invalidateDrawStateCache();
  });

  _lastPullAtMs = 0;
  _healedOnce = false;
}
