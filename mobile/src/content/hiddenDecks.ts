// 2026-10-14 three decks (owner): for now the app shows exactly three decks, in this order:
// aws-saa-fundamentals, aws-saa-c03, claude-ccdv-f. csharp-basics is hidden.
//
// The plan was for the server to drop a hidden deck from manifest.json (soft-deleted in the
// console, not availability=retired). The app does not rely on that alone: a device can still hold a
// cached manifest that lists the deck, have it installed, have it as its active deck or study goal,
// or have recorded its starter lesson on it. Every deck list, the active deck, the study goal and the
// starter lesson read through this module, so a hidden deck is never listed, opened or offered.
// Hiding deletes nothing.
//
// The live manifest, however, lists csharp-basics as availability=retired (retiredAtMs 2026-10-14
// 10:37:54 UTC). A device that reads it purges that deck's local data (deckRepository.ts
// reconcileRetiredDecks): its installed file, progress and owned cards. The reward wallet's per-pack
// draws stay, and server-side progress is untouched.
//
// The order is held here too, not taken from the server's manifest_order: a manifest from before the
// console change (SAA-C03 and fundamentals both at 1000, SAA-C03 listed first) or a device's cached
// copy of it lists the decks in the same owner order, and every "first deck" fallback (Home, Library,
// Draw, SessionCard, the starter lesson) lands on aws-saa-fundamentals. Reordering these three takes
// an app update (DECK_ORDER below); manifest_order still orders any deck not named there.
//
// Pure (no imports): activeDeck, studyGoal and goalChoices read it without pulling the content
// stack into their module graph.
//
// To bring csharp-basics back:
//   0. set its availability back to live in the console first: while the manifest marks it retired,
//      every device keeps purging it;
//   1. remove it from HIDDEN_DECK_SLUGS below and add it to DECK_ORDER where it should be listed;
//   2. add it back to STARTER_SLUGS in scripts/content/build-starter-packs.mjs and re-run the script
//      (it needs the deck back in the live manifest), so an offline first run can open it again;
//   3. name it again in the Help FAQ (content/faq.ts: "What do I study?", the card sources and the
//      Microsoft trademark line in FAQ_DISCLAIMER).
// The goal step and Settings › Study goal offer it again on their own (goalChoices.ts keeps its label).

/** Decks the app never lists, opens or offers, whatever the manifest or the device says. */
export const HIDDEN_DECK_SLUGS: readonly string[] = ['csharp-basics'];

/**
 * The order the app lists decks in, everywhere: the manifest list online (visibleManifest.ts), the
 * last known update map, the offline shelf of installed decks. A deck not named here goes after
 * these: in the manifest's own order online, by slug where there is no manifest.
 */
export const DECK_ORDER: readonly string[] = ['aws-saa-fundamentals', 'aws-saa-c03', 'claude-ccdv-f'];

/**
 * The deck a learner lands on when the deck they had chosen is hidden and nothing else is chosen
 * (the starter lesson of a learner whose goal was csharp-basics).
 */
export const FIRST_DECK_SLUG: string = DECK_ORDER[0];

function cleanSlug(slug: string | null | undefined): string {
  return String(slug ?? '').trim();
}

/** True for a deck in HIDDEN_DECK_SLUGS. */
export function isHiddenDeck(slug: string | null | undefined): boolean {
  return HIDDEN_DECK_SLUGS.includes(cleanSlug(slug));
}

/** The slug when it names a deck the app may show, else null (an empty or hidden slug). */
export function visibleDeckSlug(slug: string | null | undefined): string | null {
  const safe = cleanSlug(slug);
  return safe && !isHiddenDeck(safe) ? safe : null;
}

/** The entries whose deck the app may show, in their original order. */
export function withoutHiddenDecks<T extends { slug: string }>(decks: readonly T[]): T[] {
  return decks.filter((deck) => !isHiddenDeck(deck.slug));
}

/** A deck's place in DECK_ORDER; every deck not named there shares the place after the last. */
export function deckOrderRank(slug: string | null | undefined): number {
  const index = DECK_ORDER.indexOf(cleanSlug(slug));
  return index >= 0 ? index : DECK_ORDER.length;
}

/**
 * The entries in DECK_ORDER: the named decks first, in that order, then every other deck in its
 * original order (the manifest's, online). Stable whatever the engine's sort.
 */
export function sortByDeckOrder<T extends { slug: string }>(decks: readonly T[]): T[] {
  return decks
    .map((deck, index) => ({ deck, index, rank: deckOrderRank(deck.slug) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map(({ deck }) => deck);
}

/** Sort comparator for DECK_ORDER where there is no manifest: the named decks first, in that order, then the rest by slug. */
export function compareByDeckOrder(a: { slug: string }, b: { slug: string }): number {
  const byRank = deckOrderRank(a.slug) - deckOrderRank(b.slug);
  if (byRank !== 0) return byRank;
  const sa = cleanSlug(a.slug);
  const sb = cleanSlug(b.slug);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}
