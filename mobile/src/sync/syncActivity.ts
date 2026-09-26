// syncActivity — a tiny module-level flag mirroring whether a draw-state sync is
// running. drawStateSync owns the private `_inFlight`; this exposes a read-only
// view so the ceremony perf recorder can note if a post-draw sync was in flight
// at the tear, without reaching into drawStateSync's internals. No imports, no
// behaviour: setting the flag has no effect on the sync itself.

let inFlight = false;

export function setDrawStateSyncInFlight(active: boolean): void {
  inFlight = active;
}

export function isDrawStateSyncInFlight(): boolean {
  return inFlight;
}
