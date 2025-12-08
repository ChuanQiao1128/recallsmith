// mobile/src/content/activeDeck.ts
// Active deck selection persisted in AsyncStorage (no mock dependency)

import AsyncStorage from '@react-native-async-storage/async-storage';

const ACTIVE_DECK_KEY = 'active-deck-slug';

let activeDeckSlug: string | null = null;

export async function loadActiveDeckSlug(): Promise<string | null> {
  if (activeDeckSlug) return activeDeckSlug;
  try {
    const stored = await AsyncStorage.getItem(ACTIVE_DECK_KEY);
    activeDeckSlug = stored ?? null;
    return activeDeckSlug;
  } catch {
    return activeDeckSlug;
  }
}

export function getActiveDeckSlugSync(): string | null {
  return activeDeckSlug;
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
