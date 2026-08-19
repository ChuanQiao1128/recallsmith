import AsyncStorage from '@react-native-async-storage/async-storage';

import { invalidateDrawStateCache } from '../gacha/draw/drawStateCache';
import { invalidateProgressQueueCache } from '../../sync/progressQueueCache';

// Progress-only keys (always wiped). Auth tokens, premium cache,
// onboarding stage are NOT in this list by default.
const PROGRESS_KEY_PREFIXES = [
  'devcards:draw-owned:', // owned card sets per slug
  'devcards:draw-pity:', // pity counter per slug
  'devcards:u:', // user-scoped deck progress + daily stats + meta
  'recallsmith:reward-wallet', // wallet (matches both v1 + future)
  'recallsmith:reward-session:', // session reward dedupe keys
  'recallsmith:streaks:', // session streaks + daily snapshot
];

// Extended keys — only wiped when caller passes resetOnboarding=true.
// Lets testers truly simulate a fresh-install onboarding flow when
// needed, without that being the default destructive path.
const ONBOARDING_KEY_PREFIXES = [
  'recallsmith:onboarding:stage', // onboarding stage marker
  'recallsmith:audience-preference', // audience preference
  'devcards:active-deck-slug', // currently selected deck slug
  'recallsmith:active-deck', // legacy active deck key
];

export type ResetProgressResult = {
  removedKeyCount: number;
  matchedKeys: string[];
};

export type ResetOptions = {
  /** When true, also wipes onboarding stage + audience preference +
   *  active deck slug — gives a true fresh-install experience. Default
   *  false: keeps the user on Home post-reset (no re-onboarding). */
  resetOnboarding?: boolean;
};

/**
 * DEV-only utility to wipe progress-related AsyncStorage so the
 * tester can simulate a fresh install without re-onboarding (default)
 * or with full onboarding (resetOnboarding=true).
 */
export async function resetAllProgress(opts: ResetOptions = {}): Promise<ResetProgressResult> {
  const prefixes = opts.resetOnboarding
    ? [...PROGRESS_KEY_PREFIXES, ...ONBOARDING_KEY_PREFIXES]
    : PROGRESS_KEY_PREFIXES;
  const allKeys = await AsyncStorage.getAllKeys();
  const matchedKeys = allKeys.filter((key) =>
    prefixes.some((prefix) => key.startsWith(prefix)),
  );
  if (matchedKeys.length > 0) {
    await AsyncStorage.multiRemove(matchedKeys);
  }
  // The `devcards:u:` prefix covers both sync queue partitions, and progressSync
  // keeps the parsed queue in memory. Without this, the next rating would
  // serialise that in-memory copy back to storage and undo the reset.
  invalidateProgressQueueCache();
  // Same reason, different cache: `devcards:u:` also covers every deck's draw
  // state, which drawStateStore keeps in memory. Skipping this would let the
  // next draw read the pre-reset collection out of memory and write it
  // straight back -- the reset would appear to work and then undo itself.
  invalidateDrawStateCache();
  return {
    removedKeyCount: matchedKeys.length,
    matchedKeys,
  };
}
