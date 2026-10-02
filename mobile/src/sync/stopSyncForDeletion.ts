// Stop every sync path before an account is deleted (R25 G02).
//
// Blocking (syncGuard.ts) keeps NEW syncs off the network, but a sync that
// started a moment before the user confirmed can still be mid-request. Deleting
// under it would let its push land after DELETE /api/v1/user/me, so this also
// waits for the running progress sync and draw-state sync to settle.
import { forceProgressSync } from './progressSync';
import { isDrawStateSyncInFlight } from './syncActivity';
import { blockSync } from './syncGuard';

const SETTLE_TIMEOUT_MS = 20_000;
const POLL_MS = 25;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function stopSyncForDeletion(opts?: { timeoutMs?: number }): Promise<void> {
  blockSync();
  // While blocked, forceProgressSync schedules nothing (and cancels an armed
  // timer); it only waits for a progress sync already in flight to finish.
  await forceProgressSync('account_deletion');
  const timeoutMs = opts?.timeoutMs ?? SETTLE_TIMEOUT_MS;
  const start = Date.now();
  while (isDrawStateSyncInFlight() && Date.now() - start < timeoutMs) {
    await sleep(POLL_MS);
  }
}
