// mobile/src/content/activeDeck.ts
// Active deck selection persisted in AsyncStorage (no mock dependency)

import AsyncStorage from '@react-native-async-storage/async-storage';

import { visibleDeckSlug } from './hiddenDecks';

const ACTIVE_DECK_KEY = 'active-deck-slug';

let activeDeckSlug: string | null = null;

// 2026-10-14 three decks: a hidden deck (hiddenDecks.ts) reads as no active deck, so every screen
// falls back to the first deck it lists (aws-saa-fundamentals online) instead of opening it. The
// stored value is kept, not deleted; the next deck the learner opens overwrites it.
export async function loadActiveDeckSlug(): Promise<string | null> {
  if (activeDeckSlug) return visibleDeckSlug(activeDeckSlug);
  try {
    const stored = await AsyncStorage.getItem(ACTIVE_DECK_KEY);
    activeDeckSlug = stored ?? null;
    return visibleDeckSlug(activeDeckSlug);
  } catch {
    return visibleDeckSlug(activeDeckSlug);
  }
}

export function getActiveDeckSlugSync(): string | null {
  return visibleDeckSlug(activeDeckSlug);
}

export async function setActiveDeckSlug(slug: string | null): Promise<void> {
  activeDeckSlug = slug;
  try {
    if (slug) {
      await AsyncStorage.setItem(ACTIVE_DECK_KEY, slug);
    } else {
      await AsyncStorage.removeItem(ACTIVE_DECK_KEY);
    }
  } catch {
    // ignore storage errors; keep in-memory value
  }
}
