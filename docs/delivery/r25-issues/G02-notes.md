# G02 — Account deletion blocks every sync; review-notes checklist names the Delete account path

Issue #692, round r25 wave k. Contract `R25-00-contracts.md` §2.

## What changed (files)
- `mobile/src/sync/syncGuard.ts` (new): module-level `blockSync` / `unblockSync` / `isSyncBlocked`. No imports.
- `mobile/src/sync/stopSyncForDeletion.ts` (new): blocks sync, cancels an armed sync timer, then waits (max 20 s) for a
  progress sync or draw-state sync already in flight to finish.
- `mobile/src/sync/progressSync.ts`: one early return in `scheduleProgressSync` while blocked (it also drops a timer
  armed earlier). Every progress path goes through it: `forceProgressSync`, `token_set` (the token refresh),
  `user_changed`, `pending_adopted`, the outbox `pending_flush`, rating debounce, App.tsx foreground/background.
  Nothing else in the file changed (plus the import).
- `mobile/src/sync/drawStateSync.ts`: `syncDrawStateNow` returns the skipped result while blocked, at entry and again
  right before the POST (a run that started before the block never sends).
- `mobile/src/auth/authStore.ts`: `deleteAccountNow` calls `stopSyncForDeletion()` before the token refresh; a failed
  server DELETE or a failed Cognito `deleteUser` calls `unblockSync()`; `applySessionToState` calls `unblockSync()`
  when a new session has an access token (the next sign-in / cold start with a session).
- `mobile/scripts/release/README.md`: "Review-notes checklist" paragraph.
- Tests: `mobile/tests/unit/accountDeletionSyncGuard.test.ts`, `mobile/tests/unit/reviewNotesChecklist.test.ts`.

## Surface shipped
- During deletion and after it succeeds, every sync is a no-op until the next sign-in. The token refresh at the start
  of deletion no longer schedules a sync. A failed deletion lifts the block (the account still exists).
- No learner-visible copy changed. JS-only; OTA-safe on runtime 2.0.0.

## How it is tested
- `accountDeletionSyncGuard.test.ts` runs the real progressSync, drawStateSync and authStore with one ordered
  network log (apiJson + the DELETE). Committed first and failing on the base (4 of 6 failed: refresh `token_set`
  sync, foreground/rating/draw-state during the DELETE, in-flight sync, after-deletion paths). Now: no network call
  after the DELETE in every path; normal sync unaffected; failed deletion lifts the block; next sign-in lifts it.
- `reviewNotesChecklist.test.ts`: version filter checked with a fixture list (only versions > 2.0.0); every real
  `review-notes-X.Y.Z.txt` after 2.0.0 must contain "Delete account" (none exist yet, so it passes); README names
  the path and the demo-account re-creation.
- `cd mobile && npx tsc --noEmit && npx vitest run`.

## Owner steps
- Ship by OTA (`scripts/release/ota.sh`) on runtime 2.0.0 after 2.0.0 is approved.
- When writing `review-notes-<next>.txt`, include the Delete account path and re-create the demo account after review.

## Deferred
- A progress push that is already on the wire when the user confirms is waited for (up to 20 s), not aborted.
