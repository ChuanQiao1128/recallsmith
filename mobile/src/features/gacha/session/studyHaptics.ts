// Light study-loop haptics: a selection tick on reveal / option pick and a light
// impact on rating. Distinct from ceremonyHaptics (the draw's rate-limited vocabulary)
// — the study loop fires at most one event per user action, so there is no limiter here.
// Every call is fire-and-forget, gated on the device-global haptics preference, and a
// no-op without the native module (tests and simulators must not throw).

import { loadExpoHaptics, type ExpoHapticsLike } from '../../../components/ceremonyHaptics';
import { getFeedbackPrefsSync } from '../settings/feedbackPrefs';

export type StudyHapticKind = 'reveal' | 'select' | 'rate';

export function studyHaptic(
  kind: StudyHapticKind,
  deps?: { haptics?: ExpoHapticsLike | null; enabled?: () => boolean },
): void {
  const enabled = deps?.enabled ?? (() => getFeedbackPrefsSync().haptics);
  if (!enabled()) return;
  const haptics = deps?.haptics === undefined ? loadExpoHaptics() : deps.haptics;
  if (!haptics) return;
  try {
    if (kind === 'rate') {
      const style = haptics.ImpactFeedbackStyle.Light;
      Promise.resolve(haptics.impactAsync(style)).catch(() => {});
    } else {
      Promise.resolve(haptics.selectionAsync()).catch(() => {});
    }
  } catch {
    // device mechanism only; never reaches a test or a user without the native module
  }
}
