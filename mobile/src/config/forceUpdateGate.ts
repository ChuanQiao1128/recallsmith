import { useEffect, useState } from 'react';

import { getCurrentAppVersion, loadRemoteConfig, resolveIosUpdate } from './remoteConfig';

export type ForceUpdateGate = {
  message: string;
  updateUrl: string | null;
  currentVersion: string;
  minSupportedVersion: string | null;
};

/**
 * Resolves the minimum-supported-version gate without holding the app hostage
 * to it.
 *
 * The previous shape of this was a three-state machine in App.tsx --
 * checking / ready / forceUpdate -- and `checking` rendered a full-screen
 * spinner instead of the Navigator. That put a network round trip in front of
 * every cold start, including every offline one, where it cost the full
 * timeout before anything appeared. The gate is rare (it fires for one
 * version range, for the minority of users still on it); the wait was
 * universal.
 *
 * Two states instead of three, and the missing one is the point: `null` means
 * "no gate is being applied right now", which is both the initial value and
 * the answer for the overwhelming majority of launches. The caller renders
 * the app for null and an overlay for non-null, so the app is on screen
 * before the request finishes and stays there if it fails.
 *
 * What this gives up is honest: between mount and the config arriving, a user
 * who *should* be blocked can use the app. That window is one request long
 * and ends by itself; a blocked cold start is not what a version gate is for.
 */
export function useForceUpdateGate(url: string): ForceUpdateGate | null {
  const [gate, setGate] = useState<ForceUpdateGate | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const currentVersion = getCurrentAppVersion();
      const config = await loadRemoteConfig(url);
      if (cancelled || !config) return;

      const ios = resolveIosUpdate(config, currentVersion);
      // Only ever raises the gate. Nothing here lowers it: once this device
      // knows it is below the floor, a later config that fails to load must
      // not quietly let it back in.
      if (!ios.forceUpdate) return;

      setGate({
        message: ios.message,
        updateUrl: ios.updateUrl,
        currentVersion,
        minSupportedVersion: ios.minSupportedVersion,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [url]);

  return gate;
}
