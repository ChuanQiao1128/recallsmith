// Device-global feedback preferences (sound effects + haptics), both default ON.
// Device-global on purpose (no per-user prefix): whether the phone buzzes or plays
// draw sounds belongs to the phone, not the account — the same reasoning as
// features/gacha/draw/ceremonyPrefs.ts. Reads are async but never block rendering:
// an in-memory value starts at the defaults and callers use getFeedbackPrefsSync()
// on the hot path (study haptics, ceremony audio/haptics gates). loadFeedbackPrefs()
// refreshes that value from storage on mount and on the Settings focus load. Every
// read is fail-closed onto the current in-memory value so a broken storage never
// silences or un-silences the app unexpectedly.

import AsyncStorage from '@react-native-async-storage/async-storage';

export const FEEDBACK_PREFS_KEY = 'recallsmith:feedback-prefs:v1';

export type FeedbackPrefs = { soundEffects: boolean; haptics: boolean };

export const DEFAULT_FEEDBACK_PREFS: FeedbackPrefs = Object.freeze({
  soundEffects: true,
  haptics: true,
});

// The one in-memory copy. Starts at the defaults; loadFeedbackPrefs() and
// setFeedbackPref() are the only writers.
let current: FeedbackPrefs = { ...DEFAULT_FEEDBACK_PREFS };

/** A copy of the in-memory value (defaults until loadFeedbackPrefs() has run). */
export function getFeedbackPrefsSync(): FeedbackPrefs {
  return { ...current };
}

function coerce(raw: string | null): FeedbackPrefs {
  if (raw === null) return { ...DEFAULT_FEEDBACK_PREFS };
  const parsed = JSON.parse(raw) as unknown;
  const obj = (parsed && typeof parsed === 'object' ? parsed : {}) as Partial<Record<keyof FeedbackPrefs, unknown>>;
  return {
    soundEffects: typeof obj.soundEffects === 'boolean' ? obj.soundEffects : DEFAULT_FEEDBACK_PREFS.soundEffects,
    haptics: typeof obj.haptics === 'boolean' ? obj.haptics : DEFAULT_FEEDBACK_PREFS.haptics,
  };
}

/**
 * Reads FEEDBACK_PREFS_KEY, keeps only the two boolean fields (anything missing or
 * malformed falls back to the default), updates the in-memory value and returns it.
 * Any storage or JSON error returns the current in-memory value unchanged.
 */
export async function loadFeedbackPrefs(): Promise<FeedbackPrefs> {
  try {
    const raw = await AsyncStorage.getItem(FEEDBACK_PREFS_KEY);
    current = coerce(raw);
  } catch {
    // Storage or JSON error: keep whatever is already in memory.
  }
  return { ...current };
}

/**
 * Updates the in-memory value first (so getFeedbackPrefsSync() reflects the choice
 * immediately), then persists it. A storage error is swallowed — the in-memory value
 * still holds for this launch.
 */
export async function setFeedbackPref(key: keyof FeedbackPrefs, value: boolean): Promise<FeedbackPrefs> {
  current = { ...current, [key]: value };
  const next = { ...current };
  try {
    await AsyncStorage.setItem(FEEDBACK_PREFS_KEY, JSON.stringify(next));
  } catch {
    // Swallowed: the in-memory value stays authoritative for this launch.
  }
  return next;
}
