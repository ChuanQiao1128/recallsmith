import { loadDrawState, saveDrawState } from './drawStateStore';

// The owned set no longer owns a key of its own. It is one half of the
// per-deck draw state (see drawStateStore.ts) so that a draw can commit
// owned + pity in a single write. These helpers stay for callers that
// legitimately touch only one half outside of a draw; they read-modify-
// write the whole record so they can never drop the other half.

export async function loadOwnedSet(slug: string): Promise<Set<string>> {
  const state = await loadDrawState(slug);
  return new Set(state.owned);
}

export async function saveOwnedSet(slug: string, set: Set<string>): Promise<void> {
  const state = await loadDrawState(slug);
  await saveDrawState(slug, { owned: [...set], pity: state.pity });
}

export async function markCardsOwned(slug: string, stableUids: string[]): Promise<Set<string>> {
  const state = await loadDrawState(slug);
  const current = new Set(state.owned);
  for (const stableUid of stableUids) {
    current.add(stableUid);
  }
  await saveDrawState(slug, { owned: [...current], pity: state.pity });
  return current;
}

export async function isCardOwned(slug: string, stableUid: string): Promise<boolean> {
  const current = await loadOwnedSet(slug);
  return current.has(stableUid);
}

export async function clearOwnedSet(slug: string): Promise<void> {
  // Clears the collection only. Removing the whole record would also
  // wipe pity, which is a different piece of progress and not what the
  // caller asked for.
  const state = await loadDrawState(slug);
  await saveDrawState(slug, { owned: [], pity: state.pity });
}
