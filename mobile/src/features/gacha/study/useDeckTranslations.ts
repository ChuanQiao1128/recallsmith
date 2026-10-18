import { useEffect, useState } from 'react';

import type { CardTranslations } from '../../../content/cardTranslation';

type DeckTranslations = ReadonlyMap<string, CardTranslations>;

/**
 * What the screen knows about a deck's built-in translations: still reading them ('loading'), the
 * deck has none or the read failed ('none'), or the map by stableUid ('ready'). The screens hold
 * the card text back while a learner who chose 中文 waits on 'loading', so the English card never
 * flashes before the Chinese one; a learner reading English never waits.
 */
export type DeckTranslationsState =
  | { readonly status: 'loading' }
  | { readonly status: 'none' }
  | { readonly status: 'ready'; readonly map: DeckTranslations };

export const DECK_TRANSLATIONS_LOADING: DeckTranslationsState = Object.freeze({ status: 'loading' });
export const DECK_TRANSLATIONS_NONE: DeckTranslationsState = Object.freeze({ status: 'none' });

/**
 * The longest a read may keep the state at 'loading'. A read that has not settled by then reads as
 * 'none' (English), so a stalled file or auth read never leaves the card text held back; a result
 * that lands later still applies.
 */
export const DECK_TRANSLATIONS_MAX_WAIT_MS = 2000;

/** The translation entries of one card, or undefined while loading or for a deck without any. */
export function translationsForCard(state: DeckTranslationsState, stableUid: string): CardTranslations | undefined {
  return state.status === 'ready' ? state.map.get(stableUid) : undefined;
}

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

type Loaded = { slug: string; buildKey: string | null; state: DeckTranslationsState };

/**
 * The built-in translations of an installed deck, by stableUid. 'none' without a slug. `buildKey`
 * (the deck's Version) re-reads after an install or update; the reader caches by build, so a
 * repeat is cheap. A result for an earlier slug is never returned for a later one (that is
 * 'loading'). While another build of the same deck is read, a map already in hand stays in use,
 * and a deck that had none is 'loading' again: its first install may be the build that brings them.
 */
export function useDeckTranslations(deckSlug: string | null | undefined, buildKey?: string | null): DeckTranslationsState {
  const slug = typeof deckSlug === 'string' ? deckSlug.trim() : '';
  const build = typeof buildKey === 'string' ? buildKey : null;
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    if (!slug) return undefined;
    let cancelled = false;
    // The wait cap ends 'loading' only: a map already in hand for this deck stays in use.
    const timer = setTimeout(() => {
      if (cancelled) return;
      setLoaded((prev) =>
        prev && prev.slug === slug && (prev.buildKey === build || prev.state.status === 'ready')
          ? prev
          : { slug, buildKey: build, state: DECK_TRANSLATIONS_NONE },
      );
    }, DECK_TRANSLATIONS_MAX_WAIT_MS);
    void loadDeckTranslationsSafe(slug).then((map) => {
      clearTimeout(timer);
      if (cancelled) return;
      setLoaded((prev) => {
        if (prev && prev.slug === slug && prev.buildKey === build) {
          if (!map && prev.state.status === 'none') return prev;
          if (map && prev.state.status === 'ready' && prev.state.map === map) return prev;
        }
        return { slug, buildKey: build, state: map ? { status: 'ready', map } : DECK_TRANSLATIONS_NONE };
      });
    });
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [slug, build]);

  if (!slug) return DECK_TRANSLATIONS_NONE;
  if (!loaded || loaded.slug !== slug) return DECK_TRANSLATIONS_LOADING;
  if (loaded.buildKey === build) return loaded.state;
  return loaded.state.status === 'ready' ? loaded.state : DECK_TRANSLATIONS_LOADING;
}
