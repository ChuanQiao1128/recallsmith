// mobile/src/review/storage.ts

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { DeckExport } from '../types/deckExport';
import type { CardProgress } from './model.ts';

/**
 * 根据 Deck（Slug + Version）生成唯一的 Storage key。
 */
function getStorageKey(deck: DeckExport): string {
  return `deck-progress:${deck.Slug}:${deck.Version}`;
}

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
  const key = getStorageKey(deck);
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
      // 数据坏掉了，重新初始化
      const initial = createInitialProgress(deck, now);
      await AsyncStorage.setItem(key, JSON.stringify(initial));
      return initial;
    }

    if (!Array.isArray(parsed)) {
      const initial = createInitialProgress(deck, now);
      await AsyncStorage.setItem(key, JSON.stringify(initial));
      return initial;
    }

    // 尝试把 parsed 视为 CardProgress[]
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
    // 任何异常都回退到初始化状态
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
  const key = getStorageKey(deck);
  await AsyncStorage.setItem(key, JSON.stringify(progress));
}