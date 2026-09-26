import * as RN from 'react-native';

// Dynamic Type policy (MCORE-15 / MSHELL-09). Chrome text — buttons, chips,
// tab labels, headers, badges, dock hints — is capped so it cannot blow out
// fixed shapes; card *body* text (questions, answers, explanations, MCQ stems
// and options) is never capped and never clamped, per the brief.
export const CHROME_MAX_FONT_SCALE = 1.4;

// Above this OS font scale we switch some chrome to a roomier layout (the
// rating bar becomes a 2x2 grid). Chosen so the four rating labels still fit
// a 4-up row at the largest *standard* size and only reflow at accessibility
// sizes.
export const LARGE_FONT_SCALE_THRESHOLD = 1.3;

// Windows shorter than this (points) are treated as compact: the Draw pack
// shrinks so the pack + swipe affordance + CTA all stay on an iPhone SE.
export const COMPACT_WINDOW_HEIGHT = 700;

export function isLargeFontScale(fontScale: number): boolean {
  return Number.isFinite(fontScale) && fontScale > LARGE_FONT_SCALE_THRESHOLD;
}

export function packSizeForWindowHeight(height: number): { width: number; height: number } {
  if (Number.isFinite(height) && height < COMPACT_WINDOW_HEIGHT) {
    return { width: 192, height: 269 };
  }
  return { width: 240, height: 336 };
}

// `useWindowDimensions` is read through a guarded module-level lookup: vitest
// mocks `react-native` per file and a missing export throws on access, so we
// resolve the hook once, behind a try/catch, and fall back to a sane default
// when it is absent or hands back a non-finite value.
let windowDimensionsHook: undefined | (() => { fontScale?: number; height?: number });
try {
  const hook = (RN as any).useWindowDimensions;
  windowDimensionsHook = typeof hook === 'function' ? hook : undefined;
} catch {
  windowDimensionsHook = undefined;
}

export function useFontScale(): number {
  if (windowDimensionsHook) {
    const scale = windowDimensionsHook()?.fontScale;
    if (typeof scale === 'number' && Number.isFinite(scale)) {
      return scale;
    }
  }
  return 1;
}

export function useWindowHeight(): number {
  if (windowDimensionsHook) {
    const height = windowDimensionsHook()?.height;
    if (typeof height === 'number' && Number.isFinite(height)) {
      return height;
    }
  }
  return 800;
}
