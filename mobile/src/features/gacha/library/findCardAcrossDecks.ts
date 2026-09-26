import type { CardExport, DeckExport } from '../../../types/deckExport';

// Look a card up across every installed deck, active first. CardDetail used to
// read only the active deck, so a deep link (recallsmith://card/:cardId) into a
// card that lives in another installed deck rendered an empty page. This walks
// the active slug first (the common case, and cheapest — its deck is usually
// already cached), then every other installed slug in manifest order, skipping
// the active one and any duplicates. A rejection is not a failure of the whole
// lookup: listSlugs rejecting counts as no other decks, and a single deck that
// fails to load (or is missing) is skipped so the remaining decks still get a
// chance to hold the card.
export type CardLookupDeps = {
  activeSlug: string | null;
  listSlugs: () => Promise<string[]>;
  loadDeck: (slug: string) => Promise<DeckExport | null>;
};

export async function findCardAcrossDecks(
  cardId: string,
  deps: CardLookupDeps,
): Promise<{ deck: DeckExport; card: CardExport } | null> {
  const tried = new Set<string>();

  const tryslug = async (slug: string): Promise<{ deck: DeckExport; card: CardExport } | null> => {
    if (!slug || tried.has(slug)) return null;
    tried.add(slug);
    let deck: DeckExport | null;
    try {
      deck = await deps.loadDeck(slug);
    } catch {
      return null;
    }
    if (!deck) return null;
    const card = deck.Cards?.find((c) => c.StableUid === cardId) ?? null;
    return card ? { deck, card } : null;
  };

  if (deps.activeSlug) {
    const hit = await tryslug(deps.activeSlug);
    if (hit) return hit;
  }

  let slugs: string[];
  try {
    slugs = await deps.listSlugs();
  } catch {
    slugs = [];
  }

  for (const slug of slugs) {
    const hit = await tryslug(slug);
    if (hit) return hit;
  }

  return null;
}
