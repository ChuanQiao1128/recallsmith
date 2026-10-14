// 2026-10-14 three decks: the manifest deck list every screen reads, with the hidden decks
// (hiddenDecks.ts) taken out and the rest in the app's DECK_ORDER (fundamentals, SAA-C03, Claude,
// then any other deck in manifest order). deckRepository.ts is frozen, so this sits here; a cached
// manifest from before a deck was hidden, or from before the console set manifest_order, is
// filtered and ordered the same way as a fresh one.

import { listManifestDecks, type ManifestDeckEntry } from './deckRepository';
import { sortByDeckOrder, withoutHiddenDecks } from './hiddenDecks';

export async function listVisibleManifestDecks(options?: { preferRemote?: boolean }): Promise<ManifestDeckEntry[]> {
  return sortByDeckOrder(withoutHiddenDecks(await listManifestDecks(options)));
}
