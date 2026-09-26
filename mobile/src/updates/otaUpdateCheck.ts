// Pure in-app OTA update checker (MSHELL-05). No React, no static expo-updates
// import: the module is loaded under Node in unit tests, where a static import of
// expo-updates would fail on its native/Flow surface. The App wires
// createOtaUpdateChecker into the AppState 'active' branch so a published OTA
// takes effect on the first return to the foreground instead of the next cold
// start — but only ever while the user is on a safe screen, never mid-review.

export const OTA_CHECK_THROTTLE_MS = 10 * 60 * 1000;

export const OTA_SAFE_RELOAD_ROUTES: readonly string[] = ['Home', 'Library', 'More', 'Welcome'];

export type UpdatesLike = {
  isEnabled?: boolean;
  checkForUpdateAsync(): Promise<{ isAvailable: boolean }>;
  fetchUpdateAsync(): Promise<{ isNew: boolean }>;
  reloadAsync(): Promise<void>;
};

export type OtaCheckOutcome = 'disabled' | 'throttled' | 'no-update' | 'reloaded' | 'deferred' | 'error';

/** Guarded require of expo-updates (copy of the ceremonyPerf pattern). Returns
 *  null under Node / when the module is unavailable, so callers stay pure. */
export function getExpoUpdatesModule(): UpdatesLike | null {
  try {
    return require('expo-updates') as UpdatesLike;
  } catch {
    return null;
  }
}

export function createOtaUpdateChecker(deps: {
  updates: UpdatesLike | null;
  now?: () => number;
  log?: (event: string, detail?: Record<string, unknown>) => void;
}): { onForeground(getRouteName: () => string | undefined): Promise<OtaCheckOutcome> } {
  const { updates } = deps;
  const now = deps.now ?? (() => Date.now());
  const log = deps.log ?? (() => {});

  let lastCheckAt = Number.NEGATIVE_INFINITY;
  let pending = false;

  function isSafe(getRouteName: () => string | undefined): boolean {
    const route = getRouteName();
    return route != null && OTA_SAFE_RELOAD_ROUTES.includes(route);
  }

  async function onForeground(getRouteName: () => string | undefined): Promise<OtaCheckOutcome> {
    let outcome: OtaCheckOutcome;
    try {
      if (!updates || updates.isEnabled === false) {
        outcome = 'disabled';
      } else if (pending) {
        // A prior foreground already fetched an update; apply it as soon as the
        // user is on a safe screen. No new network check while one is pending.
        if (isSafe(getRouteName)) {
          await updates.reloadAsync();
          outcome = 'reloaded';
        } else {
          outcome = 'deferred';
        }
      } else if (now() - lastCheckAt < OTA_CHECK_THROTTLE_MS) {
        outcome = 'throttled';
      } else {
        // Stamp before awaiting so overlapping foregrounds are throttled.
        lastCheckAt = now();
        const { isAvailable } = await updates.checkForUpdateAsync();
        if (!isAvailable) {
          outcome = 'no-update';
        } else {
          const { isNew } = await updates.fetchUpdateAsync();
          if (!isNew) {
            outcome = 'no-update';
          } else {
            pending = true;
            // Re-read the route AFTER the fetch: the user may have navigated
            // away (e.g. into a review) while the bundle downloaded.
            if (isSafe(getRouteName)) {
              await updates.reloadAsync();
              outcome = 'reloaded';
            } else {
              outcome = 'deferred';
            }
          }
        }
      }
    } catch {
      outcome = 'error';
    }
    log(outcome);
    return outcome;
  }

  return { onForeground };
}
