/**
 * The one card number the app prints. OrderInDeck is the authoring key — a
 * sparse integer with gaps (5, 780, 3700…) that only has to sort — and showing
 * it raw gave "#780" on a 371-card deck. The rank is the card's 1-based
 * position in OrderInDeck order over the whole deck, so the Library tile, the
 * session header badge, CardDetail and DrawResult all say "#011" for the same
 * card. Identity stays stableUid everywhere; the rank is display only.
 *
 * Dependency-free on purpose: drawCommit ranks the drawn cards and must not
 * pull the Library mapper (and through it review/model) into the draw path.
 */
export function rankCardsByOrder(
  cards: ReadonlyArray<{ StableUid: string; OrderInDeck: number }>,
): Map<string, number> {
  const ranks = new Map<string, number>();
  // Ties keep array order (Array.prototype.sort is stable); a duplicate uid keeps its first rank.
  [...cards]
    .sort((a, b) => a.OrderInDeck - b.OrderInDeck)
    .forEach((card, index) => {
      if (!ranks.has(card.StableUid)) ranks.set(card.StableUid, index + 1);
    });
  return ranks;
}

/** "011" style: three digits minimum, wider when the deck is. 0 (unranked) prints as "000". */
export function formatRank(rank: number): string {
  return String(Math.max(0, Math.floor(Number(rank) || 0))).padStart(3, '0');
}
