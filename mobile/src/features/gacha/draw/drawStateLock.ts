// One process-local boundary for ownership, migrations and destructive sweeps.
// Global rather than per deck because adoption and resets span several partitions.
// Lock order: draw state -> deck wallet. Never call a locked store helper from
// inside this boundary; use its explicit UnderLock variant. No network I/O here.
let tail: Promise<unknown> = Promise.resolve();

export function withDrawStateLock<T>(action: () => Promise<T>): Promise<T> {
  const run = tail.then(action, action);
  tail = run.catch(() => undefined);
  return run;
}

// Destructive sweeps invalidate snapshots captured before their deletion.
let generation = 0;
export const drawStateGeneration = (): number => generation;
/** Caller holds the draw-state lock. */
export function invalidateDrawStateOperations(): void { generation += 1; }
