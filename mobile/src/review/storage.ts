// mobile/src/review/storage.ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { DeckExport } from '../types/deckExport';
import type { CardProgress } from './model';
import { formatDateKey } from './model';

export type DailyStats = {
  dateKey: string;
  plannedCount: number;
  doneCount: number;
};

const PROGRESS_PREFIX = 'deck-progress:';
const DAILY_PREFIX = 'deck-daily-stats:';
const META_PREFIX = 'deck-meta:';

function progressKey(slug: string) {
  // ✅ Phase 0: 进度只跟 slug 绑定（不再跟 Version 绑定）
  return `${PROGRESS_PREFIX}${slug}`;
}
function legacyProgressKey(slug: string, version: string) {
  // legacy: deck-progress:${slug}:${version}
  return `${PROGRESS_PREFIX}${slug}:${version}`;
}

function dailyKey(slug: string) {
  return `${DAILY_PREFIX}${slug}`;
}
function legacyDailyKey(slug: string, version: string) {
  return `${DAILY_PREFIX}${slug}:${version}`;
}

function deckMetaKey(slug: string) {
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

  const stage = normalizeNumber(raw.stage, 0);

  const lastReviewedAt =
    typeof raw.lastReviewedAt === 'number' && Number.isFinite(raw.lastReviewedAt) && raw.lastReviewedAt > 0
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
  return typeof r === 'number' && Number.isFinite(r) ? r : 1; // default = 1
}

function createInitialProgress(deck: DeckExport): CardProgress[] {
  const cards = deck.Cards ?? [];
  return cards.map(c => ({
    stableUid: c.StableUid,
    stage: 0,
    lastReviewedAt: undefined,
    nextReviewAt: 0,      // ✅ 未学过：不安排复习
    lastSeenRevision: 0,  // ✅ 未看过任何 revision
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
      } else if (b === a) {
        if ((p.nextReviewAt ?? 0) > (existing.nextReviewAt ?? 0)) map.set(uid, p);
        else if ((p.stage ?? 0) > (existing.stage ?? 0)) map.set(uid, p);
      }
    }
  }
  return Array.from(map.values());
}

/**
 * ✅ Phase 0:
 * - 只保留当前 deck 里存在的 stableUid（避免删卡后 learnedCount/due 统计错）
 * - 补齐缺失卡（新增卡）
 * - 补齐 lastSeenRevision（老 schema 迁移）
 * - 如果 deck 卡 Revision 变大：把它“拉回今天复习”，但不清空历史
 */
function reconcileProgressWithDeck(
  deck: DeckExport,
  rawProgress: CardProgress[],
  now: Date,
): { progress: CardProgress[]; changed: boolean } {
  const cards = deck.Cards ?? [];
  const deckUidSet = new Set(cards.map(c => c.StableUid));
  const nowMs = now.getTime();

  const map = new Map<string, CardProgress>();
  for (const raw of rawProgress) {
    if (!deckUidSet.has(raw.stableUid)) continue;
    const p = normalizeProgressEntry(raw);
    if (!p) continue;

    const existing = map.get(p.stableUid);
    if (!existing) map.set(p.stableUid, p);
    else {
      const a = existing.lastReviewedAt ?? 0;
      const b = p.lastReviewedAt ?? 0;
      if (b > a) map.set(p.stableUid, p);
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

    // 补齐 lastSeenRevision（从老 schema 升级）
    const hasLSR = typeof p.lastSeenRevision === 'number' && Number.isFinite(p.lastSeenRevision);
    if (!hasLSR) {
      p = {
        ...p,
        // ✅ 已学过的卡：默认认为“已经看过当前版本”，避免升级后全被当成更新卡
        lastSeenRevision: isLearned(p) ? deckRev : 0,
      };
      changed = true;
    }

    // 内容更新：Revision 变大 => 提前安排复习（仅当它原本排在未来，避免反复降级）
    if (isLearned(p) && (p.lastSeenRevision ?? 0) < deckRev) {
      if (typeof p.nextReviewAt === 'number' && p.nextReviewAt > nowMs) {
        p = {
          ...p,
          nextReviewAt: nowMs,
          stage: Math.max((p.stage ?? 0) - 1, 0),
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
  await writeJson(deckMetaKey(deck.Slug), meta);
}

async function tryLoadLegacyProgress(deck: DeckExport): Promise<CardProgress[] | null> {
  // 1) 先试 “旧 schema + 当前 version”
  const direct = await readJson<CardProgress[]>(legacyProgressKey(deck.Slug, deck.Version));
  if (direct && Array.isArray(direct)) return direct;

  // 2) 再扫所有旧 key：deck-progress:${slug}:*
  const allKeys = await AsyncStorage.getAllKeys();
  const prefix = `${PROGRESS_PREFIX}${deck.Slug}:`;
  const legacyKeys = allKeys.filter(k => k.startsWith(prefix));
  if (legacyKeys.length === 0) return null;

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
    } catch {
      // ignore
    }
  }

  if (sets.length === 0) return null;
  return mergeProgressSets(sets);
}

export async function loadDeckProgress(deck: DeckExport): Promise<CardProgress[]> {
  const now = new Date();
  const key = progressKey(deck.Slug);

  let progress = await readJson<CardProgress[]>(key);

  // ✅ Phase 0 migration：新 key 不存在 => 从旧 key 迁移
  if (!progress || !Array.isArray(progress)) {
    const legacy = await tryLoadLegacyProgress(deck);
    progress = legacy && Array.isArray(legacy) ? legacy : createInitialProgress(deck);
    await writeJson(key, progress);
  }

  const { progress: reconciled, changed } = reconcileProgressWithDeck(deck, progress, now);
  if (changed) await writeJson(key, reconciled);

  await upsertDeckMeta(deck, now);
  return reconciled;
}

export async function saveDeckProgress(deck: DeckExport, progress: CardProgress[]): Promise<void> {
  await writeJson(progressKey(deck.Slug), progress);
  await upsertDeckMeta(deck, new Date());
}

export async function resetDeckProgress(deck: DeckExport): Promise<void> {
  await AsyncStorage.removeItem(progressKey(deck.Slug));

  // 可选：顺手清掉旧 schema key，避免未来误读
  const allKeys = await AsyncStorage.getAllKeys();
  const prefix = `${PROGRESS_PREFIX}${deck.Slug}:`;
  const legacyKeys = allKeys.filter(k => k.startsWith(prefix));
  if (legacyKeys.length) await AsyncStorage.multiRemove(legacyKeys);
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
  const key = dailyKey(deck.Slug);

  let stats = await readJson<DailyStats>(key);

  // ✅ Phase 0 migration：daily stats 也从旧 schema 迁移
  if (!stats) {
    const legacy = await readJson<DailyStats>(legacyDailyKey(deck.Slug, deck.Version));
    if (legacy) {
      stats = legacy;
      await writeJson(key, legacy);
    }
  }

  if (!stats) {
    stats = createDefaultDailyStats(deck, progress, now);
    await writeJson(key, stats);
    return stats;
  }

  // 新的一天：清 doneCount
  if (stats.dateKey !== todayKey) {
    stats = { ...stats, dateKey: todayKey, doneCount: 0 };
    await writeJson(key, stats);
  }

  return stats;
}

export async function saveDailyStats(deck: DeckExport, stats: DailyStats): Promise<void> {
  await writeJson(dailyKey(deck.Slug), stats);
}

export async function loadAllProgress(): Promise<Record<string, CardProgress[]>> {
  const allKeys = await AsyncStorage.getAllKeys();

  // 新 schema：deck-progress:{slug}（slug 后面不再有 ":"）
  const keys = allKeys.filter(
    k => k.startsWith(PROGRESS_PREFIX) && !k.slice(PROGRESS_PREFIX.length).includes(':'),
  );

  if (keys.length === 0) return {};

  const pairs = await AsyncStorage.multiGet(keys);
  const out: Record<string, CardProgress[]> = {};

  for (const [k, raw] of pairs) {
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) out[k] = parsed;
    } catch {
      // ignore
    }
  }

  return out;
}