// useCeremonyHaptics — exposes 3 vibration helpers wrapping expo-haptics.
//
// `expo-haptics` is OPTIONAL. Without it, every call is a no-op. Same wrapping
// pattern as useCeremonyAudio.
//
// To activate:
//   npx expo install expo-haptics
//   npx expo prebuild
//   # rebuild dev client
//
// Mapping recommendation:
//   'tick'    — small selection feedback (per-card flip)
//   'impact'  — pack rip moment
//   'success' — Legendary card revealed

import { useCallback } from 'react';

function loadHapticsModule(): { Haptics: any | null } {
  let Haptics: any = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    Haptics = require('expo-haptics');
  } catch {
    Haptics = null;
  }
  return { Haptics };
}

const { Haptics } = loadHapticsModule();
export const ceremonyHapticsAvailable = !!Haptics;

export function useCeremonyHaptics() {
  const tick = useCallback(() => {
    if (!Haptics) return;
    try {
      Haptics.selectionAsync?.();
    } catch {
      /* noop */
    }
  }, []);

  const impact = useCallback((style: 'light' | 'medium' | 'heavy' = 'medium') => {
    if (!Haptics) return;
    try {
      const styles = Haptics.ImpactFeedbackStyle ?? {};
      const mapped = styles[style.charAt(0).toUpperCase() + style.slice(1)] ?? styles.Medium;
      Haptics.impactAsync?.(mapped);
    } catch {
      /* noop */
    }
  }, []);

  const success = useCallback(() => {
    if (!Haptics) return;
    try {
      const types = Haptics.NotificationFeedbackType ?? {};
      Haptics.notificationAsync?.(types.Success);
    } catch {
      /* noop */
    }
  }, []);

  return { tick, impact, success, available: ceremonyHapticsAvailable };
}
