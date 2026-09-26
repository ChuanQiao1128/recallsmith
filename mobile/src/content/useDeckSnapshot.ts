// Shared entry point for reading a deck through the memoizing deckCache. Screens
// today each roll their own load-effect; this hook is the one later issues
// (G31, G36, G60) adopt so a deck read is one call: { deck, loading, error,
// reload }. Not force-adopted in any screen here — G30 only introduces it.

import { useCallback, useEffect, useState } from 'react';

import { getCachedDeck, invalidateDeckCache } from './deckCache';
import type { DeckContent } from './deckRepository';

export function useDeckSnapshot(slug: string | null): {
  deck: DeckContent | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
} {
  const [deck, setDeck] = useState<DeckContent | null>(null);
  const [loading, setLoading] = useState<boolean>(slug !== null);
  const [error, setError] = useState<string | null>(null);
  // Bumped by reload() to re-run the effect after invalidating the cache.
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    // A cancelled flag drops results that arrive after unmount or a slug change,
    // so a slow read for the old slug can never overwrite the new one.
    let cancelled = false;

    if (slug === null) {
      setDeck(null);
      setLoading(false);
      setError(null);
      return () => {
        cancelled = true;
      };
    }

    setLoading(true);
    setError(null);
    getCachedDeck(slug)
      .then((resolved) => {
        if (cancelled) return;
        setDeck(resolved);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof Error && err.message ? err.message : 'Failed to load deck.';
        setError(message);
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [slug, reloadTick]);

  const reload = useCallback(() => {
    if (slug !== null) invalidateDeckCache(slug);
    setReloadTick((tick) => tick + 1);
  }, [slug]);

  return { deck, loading, error, reload };
}
