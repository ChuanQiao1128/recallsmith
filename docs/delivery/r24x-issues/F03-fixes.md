# F03 — r24x review fixes: FSRS (#656)

Fix round for F03 (#636). Each finding was reproduced against `delivery/r24x-f` before it was changed.

### f-correctness-1
Status: fixed

Reproduced. A card at S 34.5776 / D 5.2635, anchored and due on day 35, practised Good on day 30 in a focus
run, then rated Good on day 35: the stale-anchor path rebuilt S 5 / D 5 with 5 days elapsed. That gives
S 17.47 and 17 days, where `nextState(stored, good, 35)` gives S 100.75 and 90 days. Moving only the
anchor (the first suggestion) keeps S/D but measures 5 days elapsed, which gives 45 days. That is still
wrong, so elapsed now runs from the real review.

Fix:
- `CardProgress` gains the optional `fsrsReviewedAt`, the review the stored state was computed at.
  `storage.ts` keeps it (finite number, else dropped).
- `scheduleWithFsrs` writes `fsrsReviewedAt = now` next to `fsrsAnchorAt`. When the stored state is trusted
  (anchor = `lastReviewedAt`, check unchanged), elapsed runs from `fsrsReviewedAt` if it is set and not
  after `lastReviewedAt`, else from `lastReviewedAt` as before. Rows written before this fix have no
  `fsrsReviewedAt` and behave exactly as before.
- `scheduleFocusReview` practice branch: when the state was trusted, `fsrsAnchorAt` moves with
  `lastReviewedAt` and `fsrsReviewedAt` keeps the real review. A state that was already stale stays stale.
  The schedule, S and D are untouched as before.
- A review from another device (sync merge moves `lastReviewedAt`) or a ladder review with the flag off
  still makes the anchor mismatch, so the stale derivation still applies.

Files: `mobile/src/features/gacha/mistakes/focusSession.ts`, `mobile/src/review/fsrsScheduler.ts`,
`mobile/src/review/model.ts` (one optional field, types only), `mobile/src/review/storage.ts`.

Tests: `mobile/tests/unit/focusPracticeFsrs.test.ts` (5 of its 8 cases fail on the base). It covers:
- practice keeps the schedule and S/D;
- Hard, Good or Easy practice, then Good when due, equals `nextState(stored, good, 35)` (90 days);
- two practice taps;
- a stale row stays stale;
- a remote review and a ladder review after practice still go stale.

`mobile/tests/unit/progressStorageSchema.test.ts` checks that `fsrsReviewedAt` survives a save and load, and
that a bad value is dropped.

### f-tests-1
Status: fixed

Same defect as f-correctness-1, found from the test side. Fixed by the same change. The test the reviewer
asked for is `focusPracticeFsrs.test.ts`: a practice tap on a card that is not due, with an anchored state,
then a due review, must equal `nextState(storedState, grade, elapsedSinceRealReview)`. The F03 notes said
practice was "unchanged: only lastReviewedAt moves". They now describe the fix.

Files: as f-correctness-1, plus `docs/delivery/r24-issues/F03-notes.md` and
`docs/delivery/r24-issues/F02-notes.md` (the elapsed rule).

### f-tests-2
Status: fixed

Confirmed in `src_C/Vpc/Runtime/ProgressEvents.cs`. The server reads only `nextReviewAt` (l.191),
`lastSeenRevision` (l.215) and `stage` (l.248) from `progressAfter`. It persists `schedulerVersion`,
the due date and `srs_stage`, and there is no column for the FSRS fields. The notes now say the server
ignores and drops them, and that the memory state lives only on the device.

Files: `docs/delivery/r24-issues/F03-notes.md`. Test: none (docs only).

### f-tests-3
Status: fixed

Confirmed: with the `Math.min(nextAt, nowMs + MAX_NEXT_REVIEW_HORIZON_MS)` line deleted, all of
`fsrsScheduler.test.ts` still passes, because `fsrs.ts` clamps to `MAX_INTERVAL_DAYS = 90`, which equals the
horizon. The new `mobile/tests/unit/fsrsSchedulerHorizon.test.ts` mocks the model to ask for 400 days and
asserts that the result is exactly now + horizon, for a reviewed card and for a first review. With the guard
line deleted, both tests fail. The existing horizon tests stay, as end-to-end checks, with a comment saying
they cannot catch a missing guard.

Files: `mobile/tests/unit/fsrsSchedulerHorizon.test.ts` (new), `mobile/tests/unit/fsrsScheduler.test.ts`
(comment only).
