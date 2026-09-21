// debugTapCounter — the production door to the Debug menu: DEBUG_MENU_TAP_COUNT taps on
// the Settings version label inside DEBUG_MENU_TAP_WINDOW_MS. Pure and injectable so the
// rule is unit-testable; SettingsScreen keeps one instance in a ref.

export const DEBUG_MENU_TAP_COUNT = 7;
export const DEBUG_MENU_TAP_WINDOW_MS = 3000;

export type DebugTapCounter = {
  /** Records a tap; returns true (and resets) on the tap that completes the sequence. */
  tap(): boolean;
  /** Taps currently inside the window (for tests / a hint). */
  count(): number;
  reset(): void;
};

export function createDebugTapCounter(
  now: () => number = Date.now,
  opts: { taps?: number; windowMs?: number } = {},
): DebugTapCounter {
  const required = Math.max(1, Math.floor(opts.taps ?? DEBUG_MENU_TAP_COUNT));
  const windowMs = Math.max(1, opts.windowMs ?? DEBUG_MENU_TAP_WINDOW_MS);
  let stamps: number[] = [];

  function prune(t: number): void {
    // The whole sequence must fit in the window: drop taps older than windowMs from now.
    stamps = stamps.filter((s) => t - s < windowMs);
  }

  return {
    tap(): boolean {
      const t = now();
      prune(t);
      stamps.push(t);
      if (stamps.length >= required) {
        stamps = [];
        return true;
      }
      return false;
    },
    count(): number {
      prune(now());
      return stamps.length;
    },
    reset(): void {
      stamps = [];
    },
  };
}
