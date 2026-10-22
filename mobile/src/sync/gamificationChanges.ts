// Invalidates account views after collection/wallet writes have completed.
// The account identifier stays in memory and is never logged.
export type GamificationChange = { userSub: string };
const listeners = new Set<(change: GamificationChange) => void>();

export function subscribeGamificationChanges(listener: (change: GamificationChange) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function notifyGamificationChanged(change: GamificationChange): void {
  for (const listener of [...listeners]) {
    try { listener(change); } catch { /* A view cannot fail a completed write. */ }
  }
}
