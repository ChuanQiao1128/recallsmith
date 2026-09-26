// AppState → progress-sync policy, extracted from App.tsx so it can be tested
// (App.tsx is not imported by any test). Push on `background` only; `inactive`
// (Control Center, notification shade) must NOT sync (MSHELL-24); pull on
// `active` at most once per minimum interval, but always on the first `active`.
export const FOREGROUND_SYNC_MIN_INTERVAL_MS = 60_000;

export function createAppStateSyncHandler(deps: {
  schedule: (opts: { delayMs: number; reason: 'app_background' | 'app_foreground' }) => void;
  now?: () => number;
  minForegroundIntervalMs?: number;
}): (state: string) => void {
  const now = deps.now ?? (() => Date.now());
  const minInterval = deps.minForegroundIntervalMs ?? FOREGROUND_SYNC_MIN_INTERVAL_MS;
  let lastForegroundSyncAt: number | undefined;

  return (state: string) => {
    if (state === 'background') {
      deps.schedule({ delayMs: 0, reason: 'app_background' });
      return;
    }
    if (state === 'active') {
      const at = now();
      if (lastForegroundSyncAt !== undefined && at - lastForegroundSyncAt < minInterval) return;
      lastForegroundSyncAt = at;
      deps.schedule({ delayMs: 0, reason: 'app_foreground' });
    }
    // `inactive` (and any other transient state) intentionally does nothing.
  };
}
