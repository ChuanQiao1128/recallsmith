// mobile/src/review/storage.ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { DeckExport } from '../types/deckExport';
import type { CardProgress } from './model';
import { formatDateKey, isDue } from './model';

function getProgressKey(deck: DeckExport): string {
  return `deck-progress:${deck.Slug}:${deck.Version}`;
}

/**
 * First install / reset:
 * - stage=0
 * - nextReviewAt=0   (NOT scheduled yet)
 * - lastReviewedAt omitted (new card)
 */
function createInitialProgress(deck: DeckExport): CardProgress[] {
  return deck.Cards.map(card => ({
    stableUid: card.StableUid,
    stage: 0,
    nextReviewAt: 0,
  }));
}

function getDailyStatsKey(deck: DeckExport): string {
  return `deck-daily-stats:${deck.Slug}:${deck.Version}`;
}

export interface DailyStats {
  dateKey: string;      // yyyy-MM-dd
  plannedCount: number; // cards due today (learned only)
}

function sanitizeProgress(
  deck: DeckExport,
  rawList: unknown,
  now: Date,
): { progress: CardProgress[]; changed: boolean } {
  const nowMs = now.getTime();

  const deckUids = new Set(deck.Cards.map(c => c.StableUid));
  const byUid = new Map<string, CardProgress>();
  let changed = false;

  if (Array.isArray(rawList)) {
    for (const item of rawList) {
      if (typeof item !== 'object' || item === null) continue;
      const maybe = item as Record<string, unknown>;

      const stableUid = typeof maybe.stableUid === 'string' ? maybe.stableUid : null;
      if (!stableUid || !deckUids.has(stableUid)) continue;

      const stage =
        typeof maybe.stage === 'number'
          ? maybe.stage
          : typeof (maybe as any).stageIndex === 'number'
            ? (maybe as any).stageIndex
            : 0;

      let nextReviewAt: number = 0;
      if (typeof maybe.nextReviewAt === 'number') {
        nextReviewAt = maybe.nextReviewAt;
      } else if (typeof maybe.nextReviewAt === 'string') {
        const parsedDate = Date.parse(maybe.nextReviewAt);
        if (!Number.isNaN(parsedDate)) nextReviewAt = parsedDate;
      }

      const lastReviewedAt =
        typeof maybe.lastReviewedAt === 'number' ? maybe.lastReviewedAt : undefined;

      // Normalize
      const stageNorm = Number.isFinite(stage) ? Math.max(0, Math.floor(stage)) : 0;
      const nextNorm = Number.isFinite(nextReviewAt) && nextReviewAt > 0 ? nextReviewAt : 0;

      // Migration rule:
      // - If lastReviewedAt exists -> learned.
      // - If missing AND stage>0 AND nextReviewAt>0 -> treat as learned, patch lastReviewedAt.
      // - Else -> treat as new (stage=0, nextReviewAt=0).
      let final: CardProgress;

      if (typeof lastReviewedAt === 'number' && Number.isFinite(lastReviewedAt) && lastReviewedAt > 0) {
        final = { stableUid, stage: stageNorm, nextReviewAt: nextNorm, lastReviewedAt };
      } else if (stageNorm > 0 && nextNorm > 0) {
        // Likely old data without lastReviewedAt saved
        final = { stableUid, stage: stageNorm, nextReviewAt: nextNorm, lastReviewedAt: nowMs };
        changed = true;
      } else {
        // New card
        final = { stableUid, stage: 0, nextReviewAt: 0 };
        if (stageNorm !== 0 || nextNorm !== 0) changed = true;
      }

      byUid.set(stableUid, final);
    }
  }

  // Add new cards (deck expanded)
  for (const card of deck.Cards) {
    if (!byUid.has(card.StableUid)) {
      byUid.set(card.StableUid, { stableUid: card.StableUid, stage: 0, nextReviewAt: 0 });
      changed = true;
    }
  }

  const progress = Array.from(byUid.values());
  return { progress, changed };
}

export async function loadDeckProgress(deck: DeckExport): Promise<CardProgress[]> {
  const key = getProgressKey(deck);
  const now = new Date();

  try {
    const raw = await AsyncStorage.getItem(key);

    if (!raw) {
      const initial = createInitialProgress(deck);
      await AsyncStorage.setItem(key, JSON.stringify(initial));
      return initial;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      const initial = createInitialProgress(deck);
      await AsyncStorage.setItem(key, JSON.stringify(initial));
      return initial;
    }

    const { progress, changed } = sanitizeProgress(deck, parsed, now);
    if (changed) {
      await AsyncStorage.setItem(key, JSON.stringify(progress));
    }
    return progress;
  } catch {
    const initial = createInitialProgress(deck);
    await AsyncStorage.setItem(key, JSON.stringify(initial));
    return initial;
  }
}

export async function saveDeckProgress(deck: DeckExport, progress: CardProgress[]): Promise<void> {
  const key = getProgressKey(deck);
  await AsyncStorage.setItem(key, JSON.stringify(progress));
}

/**
 * Due snapshot for today (learned only, day-based).
 * Keeps your original idea of "daily snapshot", but aligned with new isDue().
 */
export async function loadOrInitDailyStats(
  deck: DeckExport,
  progress: CardProgress[],
): Promise<DailyStats> {
  const key = getDailyStatsKey(deck);
  const now = new Date();
  const todayKey = formatDateKey(now);

  try {
    const raw = await AsyncStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw) as DailyStats;
      if (parsed && parsed.dateKey === todayKey && typeof parsed.plannedCount === 'number') {
        return parsed;
      }
    }
  } catch {
    // ignore and recalc
  }

  const planned = progress.filter(p => isDue(p, now)).length;

  const stats: DailyStats = {
    dateKey: todayKey,
    plannedCount: planned,
  };

  await AsyncStorage.setItem(key, JSON.stringify(stats));
  return stats;
}