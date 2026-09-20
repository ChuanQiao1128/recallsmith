// AsyncStorage-backed "how many ceremonies has this phone seen" counter.
// The key is device-global on purpose (no per-user prefix, unlike draw state) — familiarity
// with the ceremony belongs to the phone, not the account (the per-user helper is not used here).
// Fail-closed: any error, garbage or slow read counts as 0, i.e. "first ceremony" = no visible
// skip before settle. The 250 ms budget matters because the screen's timers start at mount and
// must not wait on storage. Nothing is memoised in memory: storage is the only source of truth,
// so a remembered count would leak across the integration file's cases. B09 reads on mount and
// marks on the table's Continue; B13 flips the __DEV__-only overrides.

import AsyncStorage from '@react-native-async-storage/async-storage';

export const CEREMONY_PREFS_KEY = 'recallsmith:ceremony:completed:v1';
export const CEREMONY_PREFS_READ_TIMEOUT_MS = 250;

function parseCount(raw: string | null): number {
  if (raw === null) return 0;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : 0;
}

export function readCeremoniesCompleted(): Promise<number> {
  return new Promise<number>((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const done = (n: number): void => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      resolve(n);
    };
    try {
      // Race the read against the budget; a hang resolves 0 rather than blocking mount.
      timer = setTimeout(() => done(0), CEREMONY_PREFS_READ_TIMEOUT_MS);
      AsyncStorage.getItem(CEREMONY_PREFS_KEY).then(
        (raw) => done(parseCount(raw)),
        () => done(0),
      );
    } catch {
      done(0);
    }
  });
}

export function markCeremonyCompleted(): Promise<number> {
  return (async () => {
    const next = (await readCeremoniesCompleted()) + 1;
    try {
      await AsyncStorage.setItem(CEREMONY_PREFS_KEY, String(next));
    } catch {
      /* swallowed: storage stays the source of truth; the next read sees whatever is stored */
    }
    // Accepted edge: a read that timed out (0) followed by a mark writes 1 over a larger
    // stored value — the count only gates "≥ 1", so the regression is invisible and self-heals
    // on the next mark. Nothing is retained in memory on either path.
    return next;
  })();
}

export type CeremonyDevOverrides = { forceRepeat: boolean; forceFallback: boolean };

const overrides: CeremonyDevOverrides = { forceRepeat: false, forceFallback: false };

function isDev(): boolean {
  return (globalThis as { __DEV__?: unknown }).__DEV__ === true;
}

export function getCeremonyDevOverrides(): CeremonyDevOverrides {
  return isDev() ? { ...overrides } : { forceRepeat: false, forceFallback: false };
}

export function setCeremonyDevOverride<K extends keyof CeremonyDevOverrides>(key: K, value: boolean): void {
  if (!isDev()) return;
  overrides[key] = value === true;
}

export function effectiveCeremoniesCompleted(stored: number): number {
  const base = Number.isInteger(stored) && stored >= 0 ? stored : 0;
  return getCeremonyDevOverrides().forceRepeat ? Math.max(base, 1) : base;
}
