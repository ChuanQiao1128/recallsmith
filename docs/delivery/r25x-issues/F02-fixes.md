# F02 — r25 review fixes: safe account deletion (fixes ledger)

Issue #702, round r25x wave k. Contract `R25-00-contracts.md` §2. Original notes: `docs/delivery/r25-issues/G02-notes.md`.

Tests were committed first (b1c3b9fa) and failed on the base: 5 of 16 in `accountDeletionSyncGuard.test.ts` and 1 of 5
in `reviewNotesChecklist.test.ts`. The fix commit makes them pass. Each new guard was also mutation-checked: removing it
turns at least one named test red (listed per finding).

Test-isolation fix found on the way: a successful deletion in one test left the module-level block on for the next
test, so every test after the first successful deletion ran with sync off. That is why the old in-flight test
passed with the wait removed. `beforeEach` now calls `unblockSync()`.

### k-security-1
Status: fixed
- Confirmed: `syncProgressOnce` never read `isSyncBlocked()`; a run in flight went on to the bootstrap POST, every push
  round and the pull after the block was set.
- Fix: `mobile/src/sync/progressSync.ts` — `syncProgressOnce` checks the block before the bootstrap POST, before each
  push round and before the pull, and returns without another request. `stopSyncForDeletion` fails the deletion if a
  sync is still running when the wait ends (see k-correctness-1).
- Tests (`mobile/tests/unit/accountDeletionSyncGuard.test.ts`): "a running sync sends no further push round and no pull
  once deletion starts" (60 queued reviews = 3 rounds; base sent 3 pushes), "a sync whose bootstrap is on the wire
  when deletion starts never pushes".

### k-correctness-1
Status: fixed
- Confirmed: `forceProgressSync` returns after 20 s with `_inFlight` still true and `deleteAccountNow` went on to the
  DELETE.
- Fix: `mobile/src/sync/stopSyncForDeletion.ts` no longer waits through `forceProgressSync`. It cancels an armed timer
  through `scheduleProgressSync` (a no-op while blocked), then polls `isProgressSyncInFlight()` (new export in
  `progressSync.ts`) and `isDrawStateSyncInFlight()`. If either is still true at 20 s it calls
  `resumeSyncAfterFailedDeletion()` and throws `AccountDeletionError('network')` (retryable copy). `authStore.ts`
  sets `lastError` and rethrows, so no DELETE is sent and the user stays signed in. The G02 notes' Deferred section
  now says this.
- Test: "deletion fails without sending the DELETE when a sync is still on the wire at the end of the wait" (only
  `Date` is faked to jump past 20 s; base resolved and sent the DELETE).

### k-correctness-2
Status: fixed
- Confirmed: both failure branches only called `unblockSync()`; the rating debounce cancelled by the deletion and the
  dropped `token_set` sync never ran.
- Fix: `resumeSyncAfterFailedDeletion()` in `mobile/src/sync/stopSyncForDeletion.ts` (unblock + schedule a
  'manual' sync at once; the progress run also runs the draw-state sync when it ends). `mobile/src/auth/authStore.ts`
  calls it in the server-DELETE and Cognito `deleteUser` catch branches.
- Tests: "when the server DELETE fails, the sync deletion suppressed runs again without a manual trigger" and
  "when Cognito deleteUser fails, ..." (base: only the DELETE in the log, no push).

### k-tests-1
Status: fixed
- Confirmed: the old test's sync finished before the DELETE (and, through the leaked block, often never ran at all).
- Test: "a progress push already on the wire finishes before the DELETE is sent" holds the push for 80 ms, starts
  deletion once the push is in the log, and asserts `done POST /api/v1/sync/push` comes before the DELETE and nothing
  comes after it. Mutation: dropping the progress wait in `stopSyncForDeletion` turns it (and 3 others) red.

### k-tests-2
Status: fixed
- Tests: "a draw-state run reading local state when deletion starts never posts" (slow AsyncStorage reads; red when the
  pre-POST `isSyncBlocked()` check in `drawStateSync.ts` is removed) and "a draw-state post already on the wire
  finishes before the DELETE is sent" (80 ms POST; red when the draw-state wait is removed).

### k-tests-3
Status: fixed
- Test: "a failed Cognito deleteUser lifts the block so normal sync resumes" (`deleteUser` rejects once; then a review
  and `forceProgressSync` must push). Red when the call in the `deleteUser` catch is removed.

### k-tests-4
Status: fixed
- Confirmed: the test checked review-notes files for "Delete account" only, and the README repeated the weaker rule.
- Fix: `mobile/tests/unit/reviewNotesChecklist.test.ts` checks every review-notes file after 2.0.0 for the full path
  "Me > Settings > Account > Delete account", with a fixture test that rejects "Delete account is under Settings";
  `mobile/scripts/release/README.md` now says the test fails without the full path (a README test pins that sentence).

### k-tests-5
Status: fixed
- `docs/delivery/r25-issues/G02-notes.md`: count corrected to 4 of 7; the claim that the original tests covered the
  in-flight sync is replaced by what each test now covers; the Deferred note says what happens after 20 s.

## Other files
- `mobile/tests/integration/account-deletion.test.tsx`: its `progressSync` mock gains `isProgressSyncInFlight`
  (idle), which `stopSyncForDeletion` now imports.

## Gates
- `cd mobile && npx tsc --noEmit && npx vitest run`: 296 files, 2323 tests pass.
