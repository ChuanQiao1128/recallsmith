// mobile/src/review/storage.ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { DeckExport } from '../types/deckExport';
import type { CardProgress } from './model';
import { formatDateKey, clampStage, inferStageFromIntervalMs } from './model';

export type DailyStats = {
  dateKey: string;
  plannedCount: number;
  doneCount: number;
};

const PROGRESS_PREFIX = 'deck-progress:'; // base (non-user) prefix
const DAILY_PREFIX = 'deck-daily-stats:';
const META_PREFIX = 'deck-meta:';

/**
 * ✅ 关键：按 userSub 分区（解决“换账号还是旧进度”）
 * 这个 userSub 来自 progressSync 里 setActiveUserSub() 写入的 key。
 *
 * - 如果没有 userSub（未登录），我们用 "anon" 作为隔离空间，避免串号。
 */
const ACTIVE_USER_SUB_KEY = 'devcards:auth:activeUserSub:v1';
const USER_SCOPE_PREFIX = 'devcards:u:'; // devcards:u:{sub}:

let _cachedUserSub: string | null = null;
let _cachedUserSubAt = 0;
const USER_SUB_CACHE_TTL_MS = 1500;

function normalizeSub(v: any): string | null {
  const s = typeof v === 'string' ? v.trim() : '';
  return s ? s : null;
}

/**
 * ✅ 给 auth/sync 层调用：当 activeUserSub 变化时，立即更新内存缓存。
 * 解决 TTL 期间 Home 还在用旧 scope（sign out / switch account 后仍显示旧进度）。
 */
export function setActiveUserSubForStorage(userSub: string | null): void {
  _cachedUserSub = normalizeSub(userSub);
  _cachedUserSubAt = Date.now();
}

export function invalidateActiveUserSubCache(): void {
  _cachedUserSubAt = 0;
}

async function getActiveUserSub(): Promise<string | null> {
  const now = Date.now();
  if (now - _cachedUserSubAt < USER_SUB_CACHE_TTL_MS) return _cachedUserSub;

  try {
    const raw = await AsyncStorage.getItem(ACTIVE_USER_SUB_KEY);
    _cachedUserSub = normalizeSub(raw);
    _cachedUserSubAt = now;
    return _cachedUserSub;
  } catch {
    _cachedUserSub = null;
    _cachedUserSubAt = now;
    return null;
  }
}

async function getUserScopePrefix(): Promise<string> {
  const sub = (await getActiveUserSub()) ?? 'anon';
  return `${USER_SCOPE_PREFIX}${sub}:`;
}

/**
 * Builds a storage key inside the current user's partition.
 *
 * Exported so subsystems outside review (gacha draw state, reward
 * wallet) partition against the exact same notion of "who is signed in"
 * instead of deriving their own. One definition is what makes
 * setActiveUserSubForStorage() able to switch the whole app's storage
 * scope in one call: a second copy of this rule would keep serving the
 * previous account's data for the length of its own cache.
 */
export async function getUserScopedKey(baseKey: string): Promise<string> {
  return `${await getUserScopePrefix()}${baseKey}`;
}

/**
 * ---- Key builders (user-scoped) ----
 */
async function progressKey(slug: string): Promise<string> {
  // Phase 0: progress binds to slug (not Version)
  return `${await getUserScopePrefix()}${PROGRESS_PREFIX}${slug}`;
}
async function legacyProgressKey(slug: string, version: string): Promise<string> {
  return `${await getUserScopePrefix()}${PROGRESS_PREFIX}${slug}:${version}`;
}

async function dailyKey(slug: string): Promise<string> {
  return `${await getUserScopePrefix()}${DAILY_PREFIX}${slug}`;
}
async function legacyDailyKey(slug: string, version: string): Promise<string> {
  return `${await getUserScopePrefix()}${DAILY_PREFIX}${slug}:${version}`;
}

async function deckMetaKey(slug: string): Promise<string> {
  return `${await getUserScopePrefix()}${META_PREFIX}${slug}`;
}

/**
 * ---- Legacy/global (unscoped) keys (migration only) ----
 * 旧版本没有 user 分区，会导致串号；现在只在“第一次迁移到新 schema”时读取一次。
 */
function globalProgressKey(slug: string) {
  return `${PROGRESS_PREFIX}${slug}`;
}
function globalLegacyProgressKey(slug: string, version: string) {
  return `${PROGRESS_PREFIX}${slug}:${version}`;
}
function globalDailyKey(slug: string) {
  return `${DAILY_PREFIX}${slug}`;
}
function globalLegacyDailyKey(slug: string, version: string) {
  return `${DAILY_PREFIX}${slug}:${version}`;
}
function globalDeckMetaKey(slug: string) {
  return `${META_PREFIX}${slug}`;
}

type DeckMeta = {
  slug: string;
  contentVersion: string;
  lastSeenAtISO: string;
};

function isLearned(p: CardProgress): boolean {
  return typeof p.lastReviewedAt === 'number' && p.lastReviewedAt > 0;
}

function normalizeNumber(v: any, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function normalizeProgressEntry(raw: any): CardProgress | null {
  const stableUid = raw?.stableUid;
  if (typeof stableUid !== 'string' || stableUid.length === 0) return null;

  const stage = clampStage(normalizeNumber(raw.stage, 0));

  const lastReviewedAt =
    typeof raw.lastReviewedAt === 'number' &&
    Number.isFinite(raw.lastReviewedAt) &&
    raw.lastReviewedAt > 0
      ? raw.lastReviewedAt
      : undefined;

  const nextReviewAt = normalizeNumber(raw.nextReviewAt, 0);

  const lastSeenRevision =
    typeof raw.lastSeenRevision === 'number' && Number.isFinite(raw.lastSeenRevision)
      ? raw.lastSeenRevision
      : undefined;

  return { stableUid, stage, lastReviewedAt, nextReviewAt, lastSeenRevision };
}

function cardRevision(card: any): number {
  const r = card?.Revision;
  return typeof r === 'number' && Number.isFinite(r) ? r : 1;
}

function createInitialProgress(deck: DeckExport): CardProgress[] {
  const cards = deck.Cards ?? [];
  return cards.map((c) => ({
    stableUid: c.StableUid,
    stage: 0,
    lastReviewedAt: undefined,
    nextReviewAt: 0,
    lastSeenRevision: 0,
  }));
}

function mergeProgressSets(sets: CardProgress[][]): CardProgress[] {
  const map = new Map<string, CardProgress>();

  for (const set of sets) {
    for (const p of set) {
      const uid = p.stableUid;
      const existing = map.get(uid);

      if (!existing) {
        map.set(uid, p);
        continue;
      }

      const a = existing.lastReviewedAt ?? 0;
      const b = p.lastReviewedAt ?? 0;

      if (b > a) {
        map.set(uid, p);
        continue;
      }

      if (b === a) {
        const an = existing.nextReviewAt ?? 0;
        const bn = p.nextReviewAt ?? 0;
        if (bn > an) {
          map.set(uid, p);
          continue;
        }
        if (bn === an && (p.stage ?? 0) > (existing.stage ?? 0)) {
          map.set(uid, p);
          continue;
        }
      }
    }
  }

  return Array.from(map.values());
}

/**
 * Phase 0 reconcile:
 * - keep only uids existing in deck
 * - add missing cards
 * - learned but nextReviewAt missing => fill nextReviewAt = lastReviewedAt
 * - learned but lastSeenRevision missing/0 => set to deckRev (avoid endless "updated" loop)
 * - infer stage (conservative) to avoid new device stage all 0
 * - if deck revision increased => pull nextReviewAt to now (only if it was in future)
 */
function reconcileProgressWithDeck(
  deck: DeckExport,
  rawProgress: CardProgress[],
  now: Date,
): { progress: CardProgress[]; changed: boolean } {
  const cards = deck.Cards ?? [];
  const deckUidSet = new Set(cards.map((c) => c.StableUid));
  const nowMs = now.getTime();

  // dedupe by uid (keep best)
  const map = new Map<string, CardProgress>();

  for (const raw of rawProgress) {
    if (!deckUidSet.has(raw.stableUid)) continue;

    const p0 = normalizeProgressEntry(raw);
    if (!p0) continue;

    const existing = map.get(p0.stableUid);
    if (!existing) {
      map.set(p0.stableUid, p0);
      continue;
    }

    const a = existing.lastReviewedAt ?? 0;
    const b = p0.lastReviewedAt ?? 0;

    if (b > a) {
      map.set(p0.stableUid, p0);
    } else if (b === a) {
      const an = existing.nextReviewAt ?? 0;
      const bn = p0.nextReviewAt ?? 0;
      if (bn > an) map.set(p0.stableUid, p0);
      else if (bn === an && (p0.stage ?? 0) > (existing.stage ?? 0)) map.set(p0.stableUid, p0);
    }
  }

  let changed = false;
  const out: CardProgress[] = [];

  for (const c of cards) {
    const uid = c.StableUid;
    const deckRev = cardRevision(c);

    let p = map.get(uid);
    if (!p) {
      p = {
        stableUid: uid,
        stage: 0,
        lastReviewedAt: undefined,
        nextReviewAt: 0,
        lastSeenRevision: 0,
      };
      changed = true;
    }

    // stage clamp (defensive)
    const clampedStage = clampStage(p.stage ?? 0);
    if (clampedStage !== (p.stage ?? 0)) {
      p = { ...p, stage: clampedStage };
      changed = true;
    }

    // learned must have nextReviewAt
    if (isLearned(p)) {
      const okNext =
        typeof p.nextReviewAt === 'number' && Number.isFinite(p.nextReviewAt) && p.nextReviewAt > 0;
      if (!okNext) {
        p = { ...p, nextReviewAt: p.lastReviewedAt! };
        changed = true;
      }
    }

    // learned lastSeenRevision should not be 0
    {
      const lsr =
        typeof p.lastSeenRevision === 'number' && Number.isFinite(p.lastSeenRevision)
          ? p.lastSeenRevision
          : null;

      const needFix = lsr == null || (isLearned(p) && lsr <= 0) || (!isLearned(p) && lsr < 0);

      if (needFix) {
        p = {
          ...p,
          // learned: assume user has seen current revision to avoid all learned marked "updated"
          lastSeenRevision: isLearned(p) ? deckRev : 0,
        };
        changed = true;
      }
    }

    // ✅ infer stage (conservative)
    if (isLearned(p) && typeof p.lastReviewedAt === 'number' && p.lastReviewedAt > 0) {
      const intervalMs = (p.nextReviewAt ?? 0) - p.lastReviewedAt;
      const inferred = inferStageFromIntervalMs(intervalMs);

      const cur = clampStage(p.stage ?? 0);

      // Only fix the most common broken case:
      if (cur === 0 && inferred != null && inferred > cur) {
        p = { ...p, stage: inferred };
        changed = true;
      }
    }

    // content updated: revision increased => pull nextReviewAt to now (only if it was in future)
    if (isLearned(p) && (p.lastSeenRevision ?? 0) < deckRev) {
      if (typeof p.nextReviewAt === 'number' && p.nextReviewAt > nowMs) {
        p = {
          ...p,
          nextReviewAt: nowMs,
          stage: Math.max(clampStage(p.stage ?? 0) - 1, 0),
        };
        changed = true;
      }
    }

    out.push(p);
  }

  return { progress: out, changed };
}

async function readJson<T>(key: string): Promise<T | null> {
  const raw = await AsyncStorage.getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function writeJson(key: string, value: any): Promise<void> {
  await AsyncStorage.setItem(key, JSON.stringify(value));
}

async function upsertDeckMeta(deck: DeckExport, now: Date): Promise<void> {
  const meta: DeckMeta = {
    slug: deck.Slug,
    contentVersion: deck.Version,
    lastSeenAtISO: now.toISOString(),
  };
  await writeJson(await deckMetaKey(deck.Slug), meta);
}

/**
 * ✅ 迁移策略（非常重要）：
 * - 新版本：先读 user-scoped key
 * - 如果 user-scoped 不存在：只在“第一次”尝试从 old global keys 迁移一次
 *   然后把 global keys 删除（避免未来其他账号误迁移进来）
 */
async function tryLoadLegacyProgress(
  deck: DeckExport,
): Promise<{ progress: CardProgress[] | null; usedGlobal: boolean }> {
  let usedGlobal = false;

  // 1) old schema + current version (user-scoped legacy)
  {
    const direct = await readJson<CardProgress[]>(await legacyProgressKey(deck.Slug, deck.Version));
    if (direct && Array.isArray(direct)) return { progress: direct, usedGlobal };
  }

  // 2) scan all user-scoped legacy keys
  {
    const allKeys = await AsyncStorage.getAllKeys();
    const userScopedPrefix = `${await getUserScopePrefix()}${PROGRESS_PREFIX}${deck.Slug}:`;
    const legacyKeys = allKeys.filter((k) => k.startsWith(userScopedPrefix));
    if (legacyKeys.length > 0) {
      const pairs = await AsyncStorage.multiGet(legacyKeys);
      const sets: CardProgress[][] = [];

      for (const [, raw] of pairs) {
        if (!raw) continue;
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            const normalized = parsed.map(normalizeProgressEntry).filter(Boolean) as CardProgress[];
            if (normalized.length) sets.push(normalized);
          }
        } catch {}
      }

      if (sets.length) return { progress: mergeProgressSets(sets), usedGlobal };
    }
  }

  // 3) global legacy migration (unscoped) — only if scoped not found
  // 3.1 direct global legacy current version
  {
    const direct = await readJson<CardProgress[]>(globalLegacyProgressKey(deck.Slug, deck.Version));
    if (direct && Array.isArray(direct)) {
      usedGlobal = true;
      return { progress: direct, usedGlobal };
    }
  }

  // 3.2 scan all global legacy keys
  {
    const allKeys = await AsyncStorage.getAllKeys();
    const prefix = `${PROGRESS_PREFIX}${deck.Slug}:`;
    const legacyKeys = allKeys.filter((k) => k.startsWith(prefix));
    if (legacyKeys.length === 0) return { progress: null, usedGlobal };

    const pairs = await AsyncStorage.multiGet(legacyKeys);
    const sets: CardProgress[][] = [];

    for (const [, raw] of pairs) {
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          const normalized = parsed.map(normalizeProgressEntry).filter(Boolean) as CardProgress[];
          if (normalized.length) sets.push(normalized);
        }
      } catch {}
    }

    if (sets.length === 0) return { progress: null, usedGlobal };
    usedGlobal = true;
    return { progress: mergeProgressSets(sets), usedGlobal };
  }
}

/**
 * 删除 old global keys（避免未来其他账号误迁移）
 */
async function removeGlobalProgressKeysForDeck(deck: DeckExport): Promise<void> {
  try {
    const allKeys = await AsyncStorage.getAllKeys();

    const toRemove: string[] = [];

    // new schema global (Phase0) key
    toRemove.push(globalProgressKey(deck.Slug));

    // legacy global keys
    const legacyPrefix = `${PROGRESS_PREFIX}${deck.Slug}:`;
    for (const k of allKeys) {
      if (k.startsWith(legacyPrefix)) toRemove.push(k);
    }

    // daily/global
    toRemove.push(globalDailyKey(deck.Slug));
    const legacyDailyPrefix = `${DAILY_PREFIX}${deck.Slug}:`;
    for (const k of allKeys) {
      if (k.startsWith(legacyDailyPrefix)) toRemove.push(k);
    }

    // meta/global
    toRemove.push(globalDeckMetaKey(deck.Slug));

    const uniq = Array.from(new Set(toRemove));
    if (uniq.length) await AsyncStorage.multiRemove(uniq);
  } catch {
    // ignore
  }
}

export async function loadDeckProgress(deck: DeckExport): Promise<CardProgress[]> {
  const now = new Date();
  const key = await progressKey(deck.Slug);

  let progress = await readJson<CardProgress[]>(key);

  // migration: new key missing => move from legacy/global or init
  if (!progress || !Array.isArray(progress)) {
    // 0) try global Phase0 key (unscoped) — only for migration
    const globalPhase0 = await readJson<CardProgress[]>(globalProgressKey(deck.Slug));

    // 1) try legacy (scoped first, then global)
    const { progress: legacy, usedGlobal } = await tryLoadLegacyProgress(deck);

    const chosen =
      (legacy && Array.isArray(legacy) ? legacy : null) ??
      (globalPhase0 && Array.isArray(globalPhase0) ? globalPhase0 : null) ??
      createInitialProgress(deck);

    progress = chosen;
    await writeJson(key, progress);

    // ✅ 如果本次迁移用到了任何 global 数据，把 global keys 清掉，避免未来账号误迁移
    if (usedGlobal || (globalPhase0 && Array.isArray(globalPhase0))) {
      await removeGlobalProgressKeysForDeck(deck);
    }
  }

  const { progress: reconciled, changed } = reconcileProgressWithDeck(deck, progress, now);

  // ✅ 防御：只保留 deck 当前 Cards 内的 progress
  const allowed = new Set((deck.Cards ?? []).map((c: any) => String(c?.StableUid)));
  const filtered = reconciled.filter((p) => allowed.has(p.stableUid));

  const needWrite = changed || filtered.length !== reconciled.length;
  if (needWrite) await writeJson(key, filtered);

  await upsertDeckMeta(deck, now);
  return filtered;
}

export async function saveDeckProgress(deck: DeckExport, progress: CardProgress[]): Promise<void> {
  // do not reconcile here (avoid side-effects while writing)
  const allowed = new Set((deck.Cards ?? []).map((c: any) => String(c?.StableUid)));
  const filtered = progress.filter((p) => allowed.has(p.stableUid));

  await writeJson(await progressKey(deck.Slug), filtered);
  await upsertDeckMeta(deck, new Date());
}

export async function resetDeckProgress(deck: DeckExport): Promise<void> {
  await AsyncStorage.removeItem(await progressKey(deck.Slug));

  // remove user-scoped legacy keys too
  try {
    const allKeys = await AsyncStorage.getAllKeys();
    const scopedPrefix = `${await getUserScopePrefix()}${PROGRESS_PREFIX}${deck.Slug}:`;
    const legacyKeys = allKeys.filter((k) => k.startsWith(scopedPrefix));
    if (legacyKeys.length) await AsyncStorage.multiRemove(legacyKeys);
  } catch {}

  // remove global keys too (safety)
  await removeGlobalProgressKeysForDeck(deck);
}

function createDefaultDailyStats(deck: DeckExport, progress: CardProgress[], now: Date): DailyStats {
  const dateKey = formatDateKey(now);
  const totalCards = deck.TotalCards ?? deck.Cards?.length ?? progress.length;
  return {
    dateKey,
    plannedCount: Math.min(20, totalCards || 0),
    doneCount: 0,
  };
}

export async function loadOrInitDailyStats(deck: DeckExport, progress: CardProgress[]): Promise<DailyStats> {
  const now = new Date();
  const todayKey = formatDateKey(now);
  const key = await dailyKey(deck.Slug);

  let stats = await readJson<DailyStats>(key);

  // daily migration (scoped legacy)
  if (!stats) {
    const legacy = await readJson<DailyStats>(await legacyDailyKey(deck.Slug, deck.Version));
    if (legacy) {
      stats = legacy;
      await writeJson(key, legacy);
    }
  }

  // global daily migration (unscoped) — only if scoped not found
  if (!stats) {
    const global = await readJson<DailyStats>(globalDailyKey(deck.Slug));
    if (global) {
      stats = global;
      await writeJson(key, global);
      await removeGlobalProgressKeysForDeck(deck);
    }
  }

  if (!stats) {
    stats = createDefaultDailyStats(deck, progress, now);
    await writeJson(key, stats);
    return stats;
  }

  // new day => reset doneCount
  if (stats.dateKey !== todayKey) {
    stats = { ...stats, dateKey: todayKey, doneCount: 0 };
    await writeJson(key, stats);
  }

  return stats;
}

export async function saveDailyStats(deck: DeckExport, stats: DailyStats): Promise<void> {
  await writeJson(await dailyKey(deck.Slug), stats);
}

export async function loadAllProgress(): Promise<Record<string, CardProgress[]>> {
  const allKeys = await AsyncStorage.getAllKeys();
  const scope = await getUserScopePrefix();

  // new schema: {scope}deck-progress:{slug} (no ':' inside slug part)
  const keys = allKeys.filter(
    (k) =>
      k.startsWith(`${scope}${PROGRESS_PREFIX}`) &&
      !k.slice((`${scope}${PROGRESS_PREFIX}`).length).includes(':'),
  );

  if (keys.length === 0) return {};

  const pairs = await AsyncStorage.multiGet(keys);
  const out: Record<string, CardProgress[]> = {};

  for (const [k, raw] of pairs) {
    if (!raw) continue;

    const slug = k.slice((`${scope}${PROGRESS_PREFIX}`).length);
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) out[slug] = parsed;
    } catch {}
  }

  return out;
}

export async function resetAllReviewSchedules(now: Date = new Date()): Promise<void> {
  const allKeys = await AsyncStorage.getAllKeys();
  const scope = await getUserScopePrefix();
  const progressKeys = allKeys.filter(
    (k) =>
      k.startsWith(`${scope}${PROGRESS_PREFIX}`) &&
      !k.slice((`${scope}${PROGRESS_PREFIX}`).length).includes(':'),
  );

  const nowMs = now.getTime();
  const progressPairs = await AsyncStorage.multiGet(progressKeys);
  const progressWrites: [string, string][] = [];

  for (const [key, raw] of progressPairs) {
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) continue;
      const reset = parsed.map((item: any) => {
        const learned = typeof item?.lastReviewedAt === 'number' && item.lastReviewedAt > 0;
        if (!learned) return item;
        return {
          ...item,
          nextReviewAt: nowMs,
        };
      });
      progressWrites.push([key, JSON.stringify(reset)]);
    } catch {}
  }

  if (progressWrites.length) {
    await AsyncStorage.multiSet(progressWrites);
  }

  const dailyKeys = allKeys.filter((k) => k.startsWith(`${scope}${DAILY_PREFIX}`));
  const todayKey = formatDateKey(now);
  const dailyPairs = await AsyncStorage.multiGet(dailyKeys);
  const dailyWrites: [string, string][] = [];

  for (const [key, raw] of dailyPairs) {
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') continue;
      dailyWrites.push([
        key,
        JSON.stringify({
          ...parsed,
          dateKey: todayKey,
          doneCount: 0,
        }),
      ]);
    } catch {}
  }

  if (dailyWrites.length) {
    await AsyncStorage.multiSet(dailyWrites);
  }
}