// ceremonyHaptics — one haptic vocabulary with a rolling rate limit (≤ 3 events per
// 1000 ms across every kind), Success at most once per ceremony and a Reduce-Motion
// mode. Guarded require of expo-haptics; every call is a silent no-op without it.
import { useMemo } from 'react';

export type HapticImpact = 'light' | 'medium' | 'heavy' | 'soft' | 'rigid';
export const HAPTIC_RATE_LIMIT = Object.freeze({ maxEvents: 3, windowMs: 1000 });

/** Pure rolling-window limiter. allow() records the event when it returns true. */
export function createHapticLimiter(now: () => number = Date.now): { allow(): boolean; reset(): void } {
  const stamps: number[] = [];
  return {
    allow(): boolean {
      const t = now();
      while (stamps.length > 0 && t - stamps[0] >= HAPTIC_RATE_LIMIT.windowMs) stamps.shift();
      if (stamps.length >= HAPTIC_RATE_LIMIT.maxEvents) return false;
      stamps.push(t);
      return true;
    },
    reset(): void {
      stamps.length = 0;
    },
  };
}

/** Minimal surface of expo-haptics this module touches. */
export type ExpoHapticsLike = {
  impactAsync(style: unknown): Promise<void>;
  selectionAsync(): Promise<void>;
  notificationAsync(type: unknown): Promise<void>;
  ImpactFeedbackStyle: Record<string, unknown>;
  NotificationFeedbackType: Record<string, unknown>;
};

export type CeremonyHapticsController = {
  tick(): void;                                 // selectionAsync
  impact(style?: HapticImpact): void;           // impactAsync(ImpactFeedbackStyle[Capitalised]); default 'medium'
  success(): void;                              // notificationAsync(NotificationFeedbackType.Success) — at most ONCE per reset()
  reset(opts?: { reduceMotion?: boolean }): void;
  available: boolean;
};

// guarded require('expo-haptics') — a device mechanism only. Under vitest this is
// never redirected by vi.mock, which is why the controller is dependency-injected.
export function loadExpoHaptics(): ExpoHapticsLike | null {
  try {
    const mod = require('expo-haptics');
    return mod ? (mod as ExpoHapticsLike) : null;
  } catch {
    return null;
  }
}

export function createCeremonyHapticsController(deps: {
  haptics: ExpoHapticsLike | null;
  now?: () => number;
}): CeremonyHapticsController {
  const { haptics } = deps;
  const limiter = createHapticLimiter(deps.now);
  let successUsed = false;
  let rmLightUsed = false;
  let reduceMotion = false;

  function tick(): void {
    if (!haptics) return;
    if (reduceMotion) return;
    if (!limiter.allow()) return;
    try {
      Promise.resolve(haptics.selectionAsync()).catch(() => {});
    } catch {}
  }

  function impact(style: HapticImpact = 'medium'): void {
    if (!haptics) return;
    let markRmLight = false;
    if (reduceMotion) {
      if (style === 'light') {
        if (rmLightUsed) return;
        markRmLight = true;
      } else if (style !== 'soft') {
        return;
      }
    }
    if (!limiter.allow()) return;
    if (markRmLight) rmLightUsed = true;
    const key = style.charAt(0).toUpperCase() + style.slice(1);
    const mapped = haptics.ImpactFeedbackStyle[key] ?? haptics.ImpactFeedbackStyle.Medium;
    try {
      Promise.resolve(haptics.impactAsync(mapped)).catch(() => {});
    } catch {}
  }

  function success(): void {
    if (!haptics) return;
    if (successUsed) return;
    if (!limiter.allow()) return;
    successUsed = true;
    try {
      Promise.resolve(haptics.notificationAsync(haptics.NotificationFeedbackType.Success)).catch(() => {});
    } catch {}
  }

  function reset(opts?: { reduceMotion?: boolean }): void {
    limiter.reset();
    successUsed = false;
    rmLightUsed = false;
    reduceMotion = !!opts?.reduceMotion;
  }

  return { tick, impact, success, reset, available: haptics !== null };
}

export const ceremonyHapticsAvailable = loadExpoHaptics() !== null;

let singleton: CeremonyHapticsController | null = null;
export function getCeremonyHaptics(): CeremonyHapticsController {
  if (!singleton) singleton = createCeremonyHapticsController({ haptics: loadExpoHaptics() });
  return singleton;
}

export function useCeremonyHaptics(): CeremonyHapticsController {
  return useMemo(() => getCeremonyHaptics(), []);
}
