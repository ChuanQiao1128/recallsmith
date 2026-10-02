// Device-global privacy preference (R24 M01): Settings › Privacy "Share anonymous usage counts",
// default ON. Device-global on purpose, like feedbackPrefs.ts: the anonymous funnel
// (telemetry/funnel.ts) belongs to the install, not an account, and works signed out.
// getPrivacyPrefsSync() returns the in-memory value (defaults until loadPrivacyPrefs() has run);
// every storage or JSON error keeps the current in-memory value.

import AsyncStorage from '@react-native-async-storage/async-storage';

export const PRIVACY_PREFS_KEY = 'recallsmith:privacy-prefs:v1';

export type PrivacyPrefs = { shareUsageCounts: boolean };

export const DEFAULT_PRIVACY_PREFS: PrivacyPrefs = Object.freeze({ shareUsageCounts: true });

let current: PrivacyPrefs = { ...DEFAULT_PRIVACY_PREFS };

/** A copy of the in-memory value (defaults until loadPrivacyPrefs() has run). */
export function getPrivacyPrefsSync(): PrivacyPrefs {
  return { ...current };
}

function coerce(raw: string | null): PrivacyPrefs {
  if (raw === null) return { ...DEFAULT_PRIVACY_PREFS };
  const parsed = JSON.parse(raw) as unknown;
  const obj = (parsed && typeof parsed === 'object' ? parsed : {}) as Partial<Record<keyof PrivacyPrefs, unknown>>;
  return {
    shareUsageCounts:
      typeof obj.shareUsageCounts === 'boolean' ? obj.shareUsageCounts : DEFAULT_PRIVACY_PREFS.shareUsageCounts,
  };
}

/** Reads PRIVACY_PREFS_KEY into memory and returns it. Never throws. */
export async function loadPrivacyPrefs(): Promise<PrivacyPrefs> {
  try {
    current = coerce(await AsyncStorage.getItem(PRIVACY_PREFS_KEY));
  } catch {
    // Storage or JSON error: keep whatever is already in memory.
  }
  return { ...current };
}

/** Updates memory first (so the funnel sees the choice at once), then persists. Never throws. */
export async function setPrivacyPref(key: keyof PrivacyPrefs, value: boolean): Promise<PrivacyPrefs> {
  current = { ...current, [key]: value };
  const next = { ...current };
  try {
    await AsyncStorage.setItem(PRIVACY_PREFS_KEY, JSON.stringify(next));
  } catch {
    // Swallowed: the in-memory value stays authoritative for this launch.
  }
  return next;
}
