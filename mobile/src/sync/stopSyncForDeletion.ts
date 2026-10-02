// Stop every sync path before an account is deleted (R25 G02).
//
// Blocking (syncGuard.ts) keeps NEW syncs off the network, and a progress or
// draw-state run that started a moment before the user confirmed checks the
// block before each request it sends. One request may still be on the wire,
// though, and deleting under it would let it land after DELETE
// /api/v1/user/me, so this also waits for both runs to settle. If one is still
// running when the wait ends, deletion fails (retryable) instead of sending the
// DELETE: the block is lifted and the sync it suppressed is scheduled again.
import { AccountDeletionError } from '../auth/deleteServerAccount';
import { isProgressSyncInFlight, scheduleProgressSync } from './progressSync';
import { isDrawStateSyncInFlight } from './syncActivity';
import { blockSync, unblockSync } from './syncGuard';

const SETTLE_TIMEOUT_MS = 20_000;
const POLL_MS = 25;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function syncInFlight(): boolean {
  return isProgressSyncInFlight() || isDrawStateSyncInFlight();
}

/**
 * Lift the block after a deletion that did not go through (the account still
 * exists) and run the sync the block suppressed: the token refresh's sync and
 * any rating debounce that stopSyncForDeletion cancelled. The progress run
 * also runs the draw-state sync when it ends.
 */
export function resumeSyncAfterFailedDeletion(): void {
  unblockSync();
  scheduleProgressSync({ delayMs: 0, reason: 'manual' });
}

export async function stopSyncForDeletion(opts?: { timeoutMs?: number }): Promise<void> {
  blockSync();
  // While blocked this schedules nothing; it only drops a timer armed earlier
  // (a rating debounce, a foreground sync).
  scheduleProgressSync({ delayMs: 0, reason: 'account_deletion' });
  const timeoutMs = opts?.timeoutMs ?? SETTLE_TIMEOUT_MS;
  const start = Date.now();
  while (syncInFlight()) {
    if (Date.now() - start >= timeoutMs) {
      resumeSyncAfterFailedDeletion();
      throw new AccountDeletionError('network');
    }
    await sleep(POLL_MS);
  }
}
