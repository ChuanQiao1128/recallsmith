import AsyncStorage from '@react-native-async-storage/async-storage';
import type { CardProgress } from '../../../review/model';
import type { CardExport } from '../../../types/deckExport';
import { getUserScopedKey } from '../../../review/storage';
import { isLearnedProgress } from '../selectors/progressSelectors';
import { STARTER_LESSON_KEY } from '../starter/starterGate';

export const ORDERED_DECK_SLUG = 'aws-saa-fundamentals';
export const isOrderedDeck = (slug: string): boolean => slug === ORDERED_DECK_SLUG;

export function orderedCards(cards: readonly CardExport[]): CardExport[] {
  const seen = new Set<string>();
  const orders = new Set<number>();
  const unique: CardExport[] = [];
  for (const card of cards) {
    if (!card.StableUid) throw new Error('Course card identity is missing');
    if (seen.has(card.StableUid)) continue;
    if (!Number.isInteger(card.OrderInDeck) || card.OrderInDeck <= 0 || orders.has(card.OrderInDeck)) {
      throw new Error('Course order is unavailable; retry after updating the pack');
    }
    seen.add(card.StableUid);
    orders.add(card.OrderInDeck);
    unique.push(card);
  }
  return unique.sort((a, b) => a.OrderInDeck - b.OrderInDeck);
}

// Exact canonical ordering fingerprint (no collision-prone abbreviated hash).
// Stored with the content version; replay requires the same frozen snapshot.
export function sortingHash(cards: readonly CardExport[]): string {
  return JSON.stringify(orderedCards(cards).map(card => [card.StableUid, card.OrderInDeck, card.Revision ?? 0]));
}

/** Strict qualification read: absence is new, unreadable or unmigrated is unknown. */
export async function orderedEffectiveOwned(slug: string, owned: readonly string[], userSub: string): Promise<Set<string>> {
  const progressBase = `deck-progress:${slug}`;
  const scoped = await getUserScopedKey(progressBase, userSub);
  const raw = await AsyncStorage.getItem(scoped);
  const progress: CardProgress[] = raw == null ? [] : JSON.parse(raw);
  if (!Array.isArray(progress) || progress.some(entry => !entry || typeof entry.stableUid !== 'string' || !entry.stableUid ||
      (entry.lastReviewedAt != null && (typeof entry.lastReviewedAt !== 'number' || !Number.isFinite(entry.lastReviewedAt))))) {
    throw new Error('Learning progress is corrupt');
  }
  const keys = await AsyncStorage.getAllKeys();
  if (raw == null && keys.some(key => key === progressBase || key.startsWith(`${progressBase}:`) || key.startsWith(`${scoped}:`))) {
    throw new Error('Open the library to finish migrating learning progress, then retry');
  }
  const result = new Set(owned);
  for (const entry of progress) {
    if (isLearnedProgress(entry)) result.add(entry.stableUid);
  }
  const stage = await AsyncStorage.getItem('recallsmith:onboarding:stage:v1');
  if (stage?.trim().toLowerCase() === 'starter') {
    const lessonRaw = await AsyncStorage.getItem(STARTER_LESSON_KEY);
    if (lessonRaw == null) throw new Error('Starter lesson is not ready; retry after opening the lesson');
    const lesson = JSON.parse(lessonRaw);
    if (typeof lesson?.slug !== 'string' || !Array.isArray(lesson.uids) || lesson.uids.some((uid: unknown) => typeof uid !== 'string' || !uid)) {
      throw new Error('Starter lesson is corrupt');
    }
    if (lesson.slug === slug) for (const uid of lesson.uids) result.add(uid);
  }
  return result;
}
