// mobile/src/review/storage.ts

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { DeckExport } from '../types/deckExport';
import type { CardProgress } from './model';
import { formatDateKey } from './model';

/**
 * 根据 Deck（Slug + Version）生成唯一的 Storage key。
 */
function getProgressKey(deck: DeckExport): string {
  return `deck-progress:${deck.Slug}:${deck.Version}`;
}

/**
 * 单张卡片的复习进度。
 * 我们不保存整张卡的内容，只保存和记忆相关的信息。
 * （CardProgress 类型在 model.ts 里）
 */

/**
 * 初始化某个 Deck 的进度（第一次运行，或数据损坏时）。
 * 所有卡片的 stageIndex=0，nextReviewAt = now。
 */
function createInitialProgress(deck: DeckExport, now: Date): CardProgress[] {
  const iso = now.toISOString();
  return deck.Cards.map(card => ({
    stableUid: card.StableUid,
    stageIndex: 0,
    nextReviewAt: iso,
  }));
}

/**
 * 从 AsyncStorage 读取进度。
 * 如果不存在，就初始化一个新的并保存。
 * 如果 Deck 新增了卡片（StableUid 在 Deck 里有，但进度里没有），也会补一条初始记录。
 */
export async function loadDeckProgress(
  deck: DeckExport,
): Promise<CardProgress[]> {
  const key = getProgressKey(deck);
  const now = new Date();

  try {
    const raw = await AsyncStorage.getItem(key);

    if (!raw) {
      const initial = createInitialProgress(deck, now);
      await AsyncStorage.setItem(key, JSON.stringify(initial));
      return initial;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      const initial = createInitialProgress(deck, now);
      await AsyncStorage.setItem(key, JSON.stringify(initial));
      return initial;
    }

    if (!Array.isArray(parsed)) {
      const initial = createInitialProgress(deck, now);
      await AsyncStorage.setItem(key, JSON.stringify(initial));
      return initial;
    }

    const existing = (parsed as CardProgress[]).filter(
      p =>
        typeof p === 'object' &&
        p !== null &&
        typeof p.stableUid === 'string' &&
        typeof p.stageIndex === 'number' &&
        typeof p.nextReviewAt === 'string',
    );

    // 检查是否有新增的卡片（StableUid 还没进度）
    const knownUids = new Set(existing.map(p => p.stableUid));
    const additions: CardProgress[] = [];

    for (const card of deck.Cards) {
      if (!knownUids.has(card.StableUid)) {
        additions.push({
          stableUid: card.StableUid,
          stageIndex: 0,
          nextReviewAt: now.toISOString(),
        });
      }
    }

    const merged = [...existing, ...additions];
    if (additions.length > 0) {
      await AsyncStorage.setItem(key, JSON.stringify(merged));
    }

    return merged;
  } catch {
    const initial = createInitialProgress(deck, now);
    await AsyncStorage.setItem(key, JSON.stringify(initial));
    return initial;
  }
}

/**
 * 保存 Deck 的进度。
 */
export async function saveDeckProgress(
  deck: DeckExport,
  progress: CardProgress[],
): Promise<void> {
  const key = getProgressKey(deck);
  await AsyncStorage.setItem(key, JSON.stringify(progress));
}

/**
 * 每日统计：今天有多少张卡“原计划应该在今天复习”（用于进度条的总数）。
 */
export interface DailyStats {
  dateKey: string;      // yyyy-MM-dd
  plannedCount: number; // 当天计划卡片总数
}

function getDailyStatsKey(deck: DeckExport): string {
  return `deck-daily-stats:${deck.Slug}:${deck.Version}`;
}

/**
 * 读取或初始化当日的计划总数：
 *  - 如果已有并且 dateKey 是今天，直接返回；
 *  - 否则：根据 progress 统计「nextReviewAt 的日期 == 今天」的数量，写入并返回。
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
      if (parsed && parsed.dateKey === todayKey) {
        return parsed;
      }
    }
  } catch {
    // ignore and recalc
  }

  // 重新计算今天的 plannedCount
  let planned = 0;
  for (const p of progress) {
    const d = new Date(p.nextReviewAt);
    const key2 = formatDateKey(d);
    if (key2 === todayKey) {
      planned++;
    }
  }

  const stats: DailyStats = {
    dateKey: todayKey,
    plannedCount: planned,
  };

  await AsyncStorage.setItem(key, JSON.stringify(stats));
  return stats;
}