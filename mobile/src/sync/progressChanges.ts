// A view invalidation, emitted only after the corresponding progress write.
// userSub is used in memory to reject an account's late notification; it is not logged.
export type ProgressChange = { userSub: string; deckSlug: string };
const listeners = new Set<(change: ProgressChange) => void>();

export function subscribeProgressChanges(listener: (change: ProgressChange) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function notifyProgressChanged(change: ProgressChange): void {
  for (const listener of [...listeners]) {
    try { listener(change); } catch { /* A view cannot fail a completed sync. */ }
  }
}
