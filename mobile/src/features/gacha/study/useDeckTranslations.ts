import { useEffect, useState } from 'react';

import type { CardTranslations } from '../../../content/cardTranslation';

type DeckTranslations = ReadonlyMap<string, CardTranslations>;

// Same lazy, guarded read as the card source (CardSourceLine, CardDetail): the reader reaches
// expo-file-system and aws-amplify, so it is imported only when a screen asks, and an environment
// that cannot load it simply has no translations.
async function loadDeckTranslationsSafe(slug: string): Promise<DeckTranslations | null> {
  try {
    const mod = await import('../../../content/installedDeckIndex');
    const map = await mod?.getDeckTranslations?.(slug);
    return map && map.size > 0 ? map : null;
  } catch {
    return null;
  }
}

/**
 * The built-in translations of an installed deck, by stableUid; null while loading, for a deck
 * with none, or when the read fails. `buildKey` (the deck's Version) re-reads after an install or
 * update; the reader caches by build, so a repeat is cheap. A result for an earlier slug is never
 * returned for a later one.
 */
export function useDeckTranslations(deckSlug: string | null | undefined, buildKey?: string | null): DeckTranslations | null {
  const slug = typeof deckSlug === 'string' ? deckSlug.trim() : '';
  const [loaded, setLoaded] = useState<{ slug: string; map: DeckTranslations } | null>(null);

  useEffect(() => {
    if (!slug) return undefined;
    let cancelled = false;
    void loadDeckTranslationsSafe(slug).then((map) => {
      if (cancelled) return;
      setLoaded((prev) => (!map ? null : prev && prev.slug === slug && prev.map === map ? prev : { slug, map }));
    });
    return () => {
      cancelled = true;
    };
  }, [slug, buildKey]);

  return loaded && loaded.slug === slug ? loaded.map : null;
}
