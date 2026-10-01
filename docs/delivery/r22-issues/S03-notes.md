# S03 — Exam date caps every next review at the day before the exam

Contract: R22-00 §1.5, §2, §7. Issue #604.

## What changed (files)

- `mobile/src/features/gacha/session/sessionReviewHelpers.ts` — `buildRatedSessionState` takes an optional
  `examDate?: string | null` (default `null`). The one scheduler call site
  (`schedule = focusRun ? scheduleFocusReview : scheduleNextReview`) is wrapped:
  `capNextReviewToExam(schedule(progress, rating, now), examDate, now.getTime())`. The capped
  `nextReviewAt` lands in `updatedOne` / `updatedProgress`, so it reaches the server through `progressAfter`.
- `mobile/src/features/gacha/mcq/mcqVerdict.ts` — `describeScheduledRating(before, rating, now, schedule?, examDate = null)`
  applies the same cap to `after`, so the MCQ verdict line ("Scheduled as Good · back in N days") shows the capped day.
- `mobile/src/screens/SessionCardScreen.tsx` — `examDateRef` is reset at the start of each session load and set
  once from `getStudyGoal()` (after daily stats, before the session starts). `handleRating` passes it to
  `buildRatedSessionState`, and the MCQ submit passes it to `describeScheduledRating`.

The frozen `review/model.ts` and the shared `features/goal/studyGoal.ts` are not edited.

## Surface shipped

- With an exam date set, no rating (session or focus run) schedules a review after the start of the local day
  before the exam.
- No cap without a goal, without an exam date, or when that cap is not in the future (exam today, tomorrow or past),
  per `examReviewCapMs`.
- A review that already falls before the cap is unchanged; only `nextReviewAt` moves (stage, lapses, hardStreak stay
  the scheduler's).

## Tests

- `mobile/tests/unit/examCap.test.ts` (new): a Good that would land after the exam is pulled to the day before; an
  earlier one is unchanged; no goal / null date = unchanged for every rating; exam tomorrow (and today, and past) =
  unchanged; the focus-run scheduler is capped too.
- `mobile/tests/unit/mcqVerdict.spec.ts`: the MCQ preview shows the capped day ("back in 4 days" instead of 15),
  and stays unchanged for an earlier review, no date, or an exam tomorrow.
- `mobile/tests/integration/session-card-mcq.screen.test.tsx`: the screen reads the stored goal, the verdict line
  shows the capped day, and `buildRatedSessionState` receives `examDate`; with no goal it receives `null`.
- All new tests failed on the base before the change.

## Owner steps

None. JS-only (OTA-safe); no package, app config or native change.

## Deferred / known limits

- Replaying the event log with `foldProgress` does not re-apply the cap (accepted in contract §7).
- The goal is read once per session load; changing the exam date mid-session takes effect on the next session.
