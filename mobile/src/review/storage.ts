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

const PROGRESS_PREFIX = 'deck-progress:';
const DAILY_PREFIX = 'deck-daily-stats:';
const META_PREFIX = 'deck-meta:';

function progressKey(slug: string) {
  // Phase 0: progress only binds to slug (not Version)
  return `${PROGRESS_PREFIX}${slug}`;
}
function legacyProgressKey(slug: string, version: string) {
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

    // ✅ infer stage (conservative: only bump stage upward when stage==0 but interval implies bigger)
    if (isLearned(p) && typeof p.lastReviewedAt === 'number' && p.lastReviewedAt > 0) {
      const intervalMs = (p.nextReviewAt ?? 0) - p.lastReviewedAt;
      const inferred = inferStageFromIntervalMs(intervalMs);

      const cur = clampStage(p.stage ?? 0);

      // Only fix the most common broken case:
      // new device created initial progress with stage=0, then remote merge only wrote times.
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
  await writeJson(deckMetaKey(deck.Slug), meta);
}

async function tryLoadLegacyProgress(deck: DeckExport): Promise<CardProgress[] | null> {
  // 1) old schema + current version
  const direct = await readJson<CardProgress[]>(legacyProgressKey(deck.Slug, deck.Version));
  if (direct && Array.isArray(direct)) return direct;

  // 2) scan all legacy keys
  const allKeys = await AsyncStorage.getAllKeys();
  const prefix = `${PROGRESS_PREFIX}${deck.Slug}:`;
  const legacyKeys = allKeys.filter((k) => k.startsWith(prefix));
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
    } catch {}
  }

  if (sets.length === 0) return null;
  return mergeProgressSets(sets);
}

export async function loadDeckProgress(deck: DeckExport): Promise<CardProgress[]> {
  const now = new Date();
  const key = progressKey(deck.Slug);

  let progress = await readJson<CardProgress[]>(key);

  // migration: new key missing => move from legacy or init
  if (!progress || !Array.isArray(progress)) {
    const legacy = await tryLoadLegacyProgress(deck);
    progress = legacy && Array.isArray(legacy) ? legacy : createInitialProgress(deck);
    await writeJson(key, progress);
  }

  const { progress: reconciled, changed } = reconcileProgressWithDeck(deck, progress, now);

  // ✅ 防御：只保留 deck 当前 Cards 内的 progress（trial 用 preview deck 时会自动裁剪）
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

  await writeJson(progressKey(deck.Slug), filtered);
  await upsertDeckMeta(deck, new Date());
}

export async function resetDeckProgress(deck: DeckExport): Promise<void> {
  await AsyncStorage.removeItem(progressKey(deck.Slug));

  // remove legacy keys too
  const allKeys = await AsyncStorage.getAllKeys();
  const prefix = `${PROGRESS_PREFIX}${deck.Slug}:`;
  const legacyKeys = allKeys.filter((k) => k.startsWith(prefix));
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

  // daily migration
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

  // new day => reset doneCount
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

  // new schema: deck-progress:{slug} (no ':' inside slug part)
  const keys = allKeys.filter(
    (k) => k.startsWith(PROGRESS_PREFIX) && !k.slice(PROGRESS_PREFIX.length).includes(':'),
  );

  if (keys.length === 0) return {};

  const pairs = await AsyncStorage.multiGet(keys);
  const out: Record<string, CardProgress[]> = {};

  for (const [k, raw] of pairs) {
    if (!raw) continue;
    const slug = k.slice(PROGRESS_PREFIX.length);
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) out[slug] = parsed;
    } catch {}
  }

  return out;
}