# G02 — Account deletion blocks every sync; review-notes checklist names the Delete account path

Issue #692, round r25 wave k. Contract `R25-00-contracts.md` §2.

## What changed (files)
- `mobile/src/sync/syncGuard.ts` (new): module-level `blockSync` / `unblockSync` / `isSyncBlocked`. No imports.
- `mobile/src/sync/stopSyncForDeletion.ts` (new): blocks sync, cancels an armed sync timer, then waits (max 20 s) for a
  progress sync or draw-state sync already in flight to finish. If one is still running when the wait ends, deletion
  fails with the retryable "could not reach our servers" error before any DELETE is sent (F02 fix round).
  `resumeSyncAfterFailedDeletion` lifts the block and schedules a sync again.
- `mobile/src/sync/progressSync.ts`: one early return in `scheduleProgressSync` while blocked (it also drops a timer
  armed earlier). Every progress path goes through it: `forceProgressSync`, `token_set` (the token refresh),
  `user_changed`, `pending_adopted`, the outbox `pending_flush`, rating debounce, App.tsx foreground/background.
  F02 fix round: `syncProgressOnce` also checks the block before the bootstrap POST, before each push round and before
  the pull, so a run that started before deletion stops before its next request; `isProgressSyncInFlight` is exported
  for the wait.
- `mobile/src/sync/drawStateSync.ts`: `syncDrawStateNow` returns the skipped result while blocked, at entry and again
  right before the POST (a run that started before the block never sends).
- `mobile/src/auth/authStore.ts`: `deleteAccountNow` calls `stopSyncForDeletion()` before the token refresh; a failed
  server DELETE or a failed Cognito `deleteUser` calls `resumeSyncAfterFailedDeletion()` (lifts the block and re-runs
  the token-refresh / rating sync the block suppressed, F02); `applySessionToState` calls `unblockSync()`
  when a new session has an access token (the next sign-in / cold start with a session).
- `mobile/scripts/release/README.md`: "Review-notes checklist" paragraph.
- Tests: `mobile/tests/unit/accountDeletionSyncGuard.test.ts`, `mobile/tests/unit/reviewNotesChecklist.test.ts`.

## Surface shipped
- During deletion and after it succeeds, every sync is a no-op until the next sign-in. The token refresh at the start
  of deletion no longer schedules a sync. A failed deletion lifts the block (the account still exists) and syncs again
  straight away.
- No learner-visible copy changed. JS-only; OTA-safe on runtime 2.0.0.

## How it is tested
- `accountDeletionSyncGuard.test.ts` runs the real progressSync, drawStateSync and authStore with one ordered
  network log (apiJson + the DELETE, plus a `done ...` entry when each response is back). G02 committed it first,
  failing on the base with 4 of 7 tests (refresh `token_set` sync, foreground/rating/draw-state during the DELETE,
  after-deletion paths). The original "sync already running" test did not exercise the wait (its sync finished before
  the DELETE, and the block left on by an earlier test kept it off the network); F02 fixed the test isolation and
  added tests that each fail when the guard they name is removed: a push on the wire finishes before the DELETE; a
  running sync sends no further push round or pull (and no push when caught at bootstrap); a sync still on the wire
  when the wait ends fails the deletion without a DELETE; a draw-state run reading local state never POSTs; a
  draw-state POST on the wire finishes before the DELETE; a failed Cognito `deleteUser` lifts the block; a failed
  server DELETE or `deleteUser` re-runs the suppressed rating sync with no manual trigger. 16 tests.
- `reviewNotesChecklist.test.ts`: version filter checked with a fixture list (only versions > 2.0.0); every real
  `review-notes-X.Y.Z.txt` after 2.0.0 must contain the full path "Me > Settings > Account > Delete account" (none
  exist yet, so it passes; a fixture shows a loose "Delete account is under Settings" is rejected); README names the
  path and the demo-account re-creation.
- `cd mobile && npx tsc --noEmit && npx vitest run`.

## Owner steps
- Ship by OTA (`scripts/release/ota.sh`) on runtime 2.0.0 after 2.0.0 is approved.
- When writing `review-notes-<next>.txt`, include the Delete account path and re-create the demo account after review.

## Deferred
- A request already on the wire when the user confirms is waited for (up to 20 s), not aborted. A running sync sends
  no further request once the block is on. If a request is still on the wire after 20 s, deletion fails with the
  retryable network error and nothing is deleted; the user can try again.
