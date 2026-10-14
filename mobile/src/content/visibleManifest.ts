// 2026-10-14 three decks: the manifest deck list every screen reads, with the hidden decks
// (hiddenDecks.ts) taken out. deckRepository.ts is frozen, so the filter sits here; a cached
// manifest from before a deck was hidden is filtered the same way as a fresh one. The manifest's
// own order is kept.

import { listManifestDecks, type ManifestDeckEntry } from './deckRepository';
import { withoutHiddenDecks } from './hiddenDecks';

export async function listVisibleManifestDecks(options?: { preferRemote?: boolean }): Promise<ManifestDeckEntry[]> {
  return withoutHiddenDecks(await listManifestDecks(options));
}
