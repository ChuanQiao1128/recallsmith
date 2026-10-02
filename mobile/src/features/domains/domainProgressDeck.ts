// Which deck the More tab's "Progress by domain" row opens (F01, R24 review fixes).
//
// The active deck, but only while its content is installed for the current user; else the first
// installed deck; else null, and the row stays hidden. A slug that does not resolve would open
// DomainProgress on its empty state with nowhere to go.
//
// Read through guarded dynamic imports, like deckCache's scope read: MoreScreen is rendered by many
// suites that mock neither deckRepository nor AsyncStorage, and a static edge would drag both into
// their module graph. A failed import or read means "no deck", so the row is hidden.

export async function resolveDomainProgressSlug(): Promise<string | null> {
  try {
    const [{ loadActiveDeckSlug }, { getCachedDeck }, { listInstalledDeckEntries }] = await Promise.all([
      import('../../content/activeDeck'),
      import('../../content/deckCache'),
      import('../../content/starterOffline'),
    ]);
    const active = await loadActiveDeckSlug();
    if (active) {
      try {
        if (await getCachedDeck(active)) return active;
      } catch {
        // An unreadable active deck falls through to the installed list.
      }
    }
    const installed = await listInstalledDeckEntries();
    return installed[0]?.slug ?? null;
  } catch {
    return null;
  }
}
