// 2026-10-14 three decks (owner): for now the app shows exactly three decks, in this order:
// aws-saa-fundamentals, aws-saa-c03, claude-ccdv-f. csharp-basics is hidden.
//
// The server drops a hidden deck from manifest.json (soft-deleted in the console, not
// availability=retired: a retire purges the deck's files and progress on the device). The app does
// not rely on that alone: a device can still hold a cached manifest that lists the deck, have it
// installed, have it as its active deck or study goal, or have recorded its starter lesson on it.
// Every deck list, the active deck, the study goal and the starter lesson read through this
// module, so a hidden deck is never listed, opened or offered. Nothing is deleted: its installed
// file, progress, owned cards and wallet stay on the device untouched.
//
// Pure (no imports): activeDeck, studyGoal and goalChoices read it without pulling the content
// stack into their module graph.
//
// To bring csharp-basics back:
//   1. remove it from HIDDEN_DECK_SLUGS below and add it to DECK_FALLBACK_ORDER;
//   2. add it back to STARTER_SLUGS in scripts/content/build-starter-packs.mjs and re-run the script
//      (it needs the deck back in the live manifest), so an offline first run can open it again.
// The goal step and Settings › Study goal offer it again on their own (goalChoices.ts keeps its label).

/** Decks the app never lists, opens or offers, whatever the manifest or the device says. */
export const HIDDEN_DECK_SLUGS: readonly string[] = ['csharp-basics'];

/**
 * The deck order wherever no manifest gives one (an offline shelf built from the installed decks, the
 * last known update map). Online, the manifest's own order wins (manifest_order on the server).
 * A deck not named here goes after these, by slug.
 */
export const DECK_FALLBACK_ORDER: readonly string[] = ['aws-saa-fundamentals', 'aws-saa-c03', 'claude-ccdv-f'];

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

function fallbackRank(slug: string): number {
  const index = DECK_FALLBACK_ORDER.indexOf(cleanSlug(slug));
  return index >= 0 ? index : DECK_FALLBACK_ORDER.length;
}

/** Sort comparator for DECK_FALLBACK_ORDER: the named decks first, in that order, then the rest by slug. */
export function compareByFallbackOrder(a: { slug: string }, b: { slug: string }): number {
  const byRank = fallbackRank(a.slug) - fallbackRank(b.slug);
  if (byRank !== 0) return byRank;
  const sa = cleanSlug(a.slug);
  const sb = cleanSlug(b.slug);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}
