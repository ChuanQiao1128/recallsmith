import AsyncStorage from '@react-native-async-storage/async-storage';

import { getUserScopedKey } from '../../../review/storage';
import { ANON_USER_SCOPE_PREFIX } from '../draw/drawStateStore';

/**
 * "Has this device seen the account's remote progress yet?" (C00 §6, 2026-09-21 addendum,
 * decision 2). The R1 ledger is seeded from LOCAL progress, so seeding before the first remote
 * pull lands would stamp only what this device happens to know, and every card the account had
 * already learned elsewhere would then pay when it is next rated here. Seeding and R1 therefore
 * wait for the partition to be settled:
 *
 * - anon partition: always settled (there is no remote progress to wait for);
 * - signed-in partition: settled once at least one successful remote progress pull for this
 *   user has landed on this device.
 *
 * progressSync.ts (frozen) exports no "last successful pull" getter: `_lastPullAtMs` is
 * module-private, `getProgressSyncDebugState()` reports `last` from the `sync:last:v1` key,
 * which is written at the end of EVERY completed sync cycle -- including one whose pull threw
 * (the pull is try/caught at progressSync.ts:1591-1599) or was skipped -- so that key would
 * settle an offline sign-in and re-open exactly the over-pay this gate exists to close. The keys
 * that are written ONLY after a pull page came back and was applied are, per user
 * (`devcards:u:{sub}:`, progressSync.ts:148-150, the same prefix getUserScopedKey builds):
 *
 * - `sync:remoteCache:v1:<slug>` (progressSync.ts:178-180, :1010-1012): written when rows for
 *   that deck were pulled -- this is the cache applyCachedRemoteProgress reads (:1798-1825);
 * - `sync:cursorMs:v1` / `sync:cursor:v2` (progressSync.ts:160-171): advanced "only after
 *   success" (:1438-1449), i.e. when a page of rows for ANY deck was cached and merged.
 *
 * Any of them present ⇒ a pull landed for this user on this device, and everything the server
 * held for this deck at that moment is in local progress (rows are cached for every deck and
 * merged into installed ones; SessionCardScreen applies the cache before loading progress).
 * The known under-pay: an account with NO rows on the server leaves no trace after an empty
 * pull, so its ratings stay unsettled until its own pushes come back on a later pull -- those
 * cards are then backfilled as paid(0) and never pay. Accepted (under-pay, never over-pay).
 *
 * Read-only: this module never writes any of these keys. It reads them by name because the
 * builders are private to the frozen file; the names are pinned by tests.
 */
export const REMOTE_PROGRESS_CACHE_KEY_PREFIX = 'sync:remoteCache:v1:';
export const REMOTE_PROGRESS_CURSOR_MS_KEY = 'sync:cursorMs:v1';
export const REMOTE_PROGRESS_CURSOR_TOKEN_KEY = 'sync:cursor:v2';

export type ProgressSettledReason = 'anon' | 'remote-cache' | 'remote-cursor';

export type ProgressSettledState =
  | { settled: true; reason: ProgressSettledReason }
  | { settled: false; reason: 'no-pull-landed' | 'storage-error' };

/** Never throws: a storage error reads as unsettled (fail closed: no seed, no R1). */
export async function readProgressSettled(slug: string): Promise<ProgressSettledState> {
  try {
    const scope = await getUserScopedKey('');
    if (scope.startsWith(ANON_USER_SCOPE_PREFIX)) return { settled: true, reason: 'anon' };

    const cacheKey = await getUserScopedKey(`${REMOTE_PROGRESS_CACHE_KEY_PREFIX}${slug}`);
    if ((await AsyncStorage.getItem(cacheKey)) != null) return { settled: true, reason: 'remote-cache' };

    const cursorMsKey = await getUserScopedKey(REMOTE_PROGRESS_CURSOR_MS_KEY);
    if ((await AsyncStorage.getItem(cursorMsKey)) != null) return { settled: true, reason: 'remote-cursor' };

    const cursorTokenKey = await getUserScopedKey(REMOTE_PROGRESS_CURSOR_TOKEN_KEY);
    if ((await AsyncStorage.getItem(cursorTokenKey)) != null) return { settled: true, reason: 'remote-cursor' };

    return { settled: false, reason: 'no-pull-landed' };
  } catch {
    return { settled: false, reason: 'storage-error' };
  }
}

export async function isProgressSettled(slug: string): Promise<boolean> {
  return (await readProgressSettled(slug)).settled;
}
