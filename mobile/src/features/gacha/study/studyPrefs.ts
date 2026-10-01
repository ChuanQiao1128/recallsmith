// Device-global study preferences (R22 contract §1.4, §6). Today one field:
// `fourButtons` — whether the rating dock shows Again/Hard/Good/Easy instead of
// the two-button default (Forgot / Remembered).
//
// The default is not a constant. When the key has never been written, a learner
// who already has a learned card gets `true` (they keep the four buttons they
// know) and a new learner gets `false`. That first answer is then stored, so it
// is decided once: a new learner who goes on to learn cards stays on two buttons
// until they opt in from Settings.
//
// Same shape as feedbackPrefs.ts: an in-memory value read synchronously on the
// hot path (getStudyPrefsSync), refreshed by loadStudyPrefs(). Every storage
// error is fail-closed onto the current in-memory value.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { isLearnedProgress } from '../selectors/progressSelectors';

export const STUDY_PREFS_KEY = 'recallsmith:study-prefs:v1';

export type StudyPrefs = { fourButtons: boolean };

// The one in-memory copy. Starts at the new-learner default; loadStudyPrefs()
// and setStudyPrefs() are the only writers.
let current: StudyPrefs = { fourButtons: false };

/** A copy of the in-memory value (the new-learner default until loadStudyPrefs() has run). */
export function getStudyPrefsSync(): StudyPrefs {
  return { ...current };
}

// Every deck-progress key on the device, whoever owns it: the scoped keys
// 'devcards:u:{sub}:deck-progress:{slug}', their legacy versioned form '…:{slug}:{version}' and the
// unscoped global keys 'deck-progress:{slug}[:{version}]'. The key this decides is device-global
// and decided once, so it cannot read only the current scope: a learner who upgrades while signed
// out (scope 'anon') or whose progress is still in legacy keys would lose their four buttons.
const PROGRESS_KEY_RE = /^(devcards:u:[^:]+:)?deck-progress:[^:]+(:[^:]+)?$/;

/** True when any deck progress stored on this device (any user scope, legacy keys too) has a reviewed card. */
export async function hasAnyLearnedCard(): Promise<boolean> {
  const keys = (await AsyncStorage.getAllKeys()).filter((key) => PROGRESS_KEY_RE.test(key));
  if (keys.length === 0) return false;
  const pairs = await AsyncStorage.multiGet(keys);
  return pairs.some(([, raw]) => {
    if (!raw) return false;
    try {
      const rows = JSON.parse(raw) as unknown;
      return Array.isArray(rows) && rows.some((row) => !!row && typeof row === 'object' && isLearnedProgress(row));
    } catch {
      return false;
    }
  });
}

/**
 * Reads STUDY_PREFS_KEY. When the key is absent, asks `probe` whether the learner
 * already has a learned card, uses that as the default and stores it. A malformed
 * value is treated like an absent one. A storage or probe error leaves the
 * in-memory value unchanged and stores nothing (the next read decides again).
 */
export async function loadStudyPrefs(probe: () => Promise<boolean> = hasAnyLearnedCard): Promise<StudyPrefs> {
  try {
    const raw = await AsyncStorage.getItem(STUDY_PREFS_KEY);
    const stored = parse(raw);
    if (stored) {
      current = stored;
    } else {
      const next: StudyPrefs = { fourButtons: (await probe()) === true };
      current = next;
      await AsyncStorage.setItem(STUDY_PREFS_KEY, JSON.stringify(next));
    }
  } catch {
    // Storage, JSON or probe error: keep whatever is already in memory.
  }
  return { ...current };
}

/**
 * Updates the in-memory value first (so getStudyPrefsSync() reflects the choice
 * immediately), then persists it. A storage error is swallowed — the in-memory
 * value still holds for this launch.
 */
export async function setStudyPrefs(next: StudyPrefs): Promise<StudyPrefs> {
  current = { fourButtons: next.fourButtons === true };
  const saved = { ...current };
  try {
    await AsyncStorage.setItem(STUDY_PREFS_KEY, JSON.stringify(saved));
  } catch {
    // Swallowed: the in-memory value stays authoritative for this launch.
  }
  return saved;
}

function parse(raw: string | null): StudyPrefs | null {
  if (raw == null) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && typeof (parsed as { fourButtons?: unknown }).fourButtons === 'boolean') {
      return { fourButtons: (parsed as { fourButtons: boolean }).fourButtons };
    }
  } catch {
    // Malformed JSON reads as absent.
  }
  return null;
}
