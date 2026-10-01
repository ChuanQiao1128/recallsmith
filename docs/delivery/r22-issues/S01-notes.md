# S01 — Teach before testing: a study view first, the recall check at the end of the session

Round r22, wave s. Contract: `R22-00-contracts.md` §1.3, §6. Built on S02 (#602, two rating buttons), which is
already on `delivery/r22-s`.

## What changed (files)

- `mobile/src/features/gacha/components/LearningStudyView.tsx` (new): `LearningStudyView`, the study body. It
  shows a "NEW CARD" caption, the rank badge, the full question, the answer sections (the shared
  `CardAnswerSections`), and the card source when `cardSource` is on. It also exports
  `LearningGotItDock`, the pinned dock with a one-line hint and the single **Got it** button. The source is
  loaded the same lazy, guarded way CardDetail loads it (`content/cardSource`, https-only open).
- `mobile/src/screens/SessionCardScreen.tsx`: the learning step.
  - `applyCurrent` now sets a `learningPhase`. It is `'study'` for a Q/A card (`resolveMcq` null) whose
    progress is not learned (`lastReviewedAt` missing or 0, the same rule as `isLearnedProgress`), outside
    a Mistake Book focus run. It is `'check'` for a re-queued card and `null` otherwise.
  - `handleGotIt`: no rating, no `recordReviewEvent`, no Mistake Book call, no progress save, no reward.
    It adds the uid to `studiedUidsRef`, queues the card in `pendingChecksRef`, adds one check slot, and
    then deals the planner's next card. That deal passes `excludeUids` so a studied card is never dealt
    again. When the planned slots are used up or the planner has nothing left, it deals the first check.
  - `handleRating` on a check: the UI rating is mapped with `mapLearningCheckRating`. Remembered (the dock
    sends `good`) becomes `hard`, and Forgot stays `again`. The event is the one existing
    `card_reviewed` sent through `recordReviewEvent`, with `reviewStage: 'learning_check'`. The Mistake Book
    call carries `learningCheck: true`, and the book ignores it. Once a run reaches its checks it serves
    only checks, in study order, and then ends.
  - Counts: `totalLimit = sessionLimit + learningCheckSlots`. It drives the header VM, the guard that
    stops ratings past the end, the MCQ dock's last-node flag, and the `sessionLimit` passed to
    SessionSummary. `sessionDone` counts every step: planner cards, studies and checks.
    `buildRatedSessionState` gets planner-only numbers (`sessionDone - checksDone`, `sessionLimit`).
  - The check dock always shows Forgot / Remembered, even with the four-button study setting on.
- `mobile/src/features/gacha/planner/sessionPlanner.ts`: `pickNextCard` takes an optional
  `excludeUids`. It is folded into `owns`, so every pick path (due, updated, new, sweep) skips those cards
  and the avoidUid fallback never returns them.
- `mobile/src/features/gacha/session/sessionReviewHelpers.ts`: `buildRatedSessionState` forwards
  `excludeUids` to its next pick.
- `mobile/src/features/gacha/mistakes/mistakeBook.ts`: `MistakeOutcome.learningCheck?: boolean`.
  `applyOutcome` returns the book unchanged for a learning-check outcome, so a failed check never creates
  an entry and a passed one never counts toward resolving an entry.

Not touched: `progressSync.ts`, `review/model.ts`, `deckRepository.ts`, `studyGoal.ts`, `RatingBar.tsx`,
and every package, app, eas or native file.

## Shipped surface

- First exposure of a never-reviewed Q/A card: a study card with NEW CARD, the question, the answer, and the
  SOURCE row (when the flag is on and the card has one). The dock shows *"Read it once. You will try to
  recall it at the end of this session."* and one **Got it** button. TestIDs: `learning-study-view`,
  `learning-study-question`, `learning-study-source(-host|-quote)`, `learning-study-dock`,
  `learning-study-got-it`.
- At the end of the run, each studied card comes back as an ordinary question → *Reveal answer* →
  **Forgot / Remembered** card.
  - Remembered: rating `hard`. Stage stays 0, due in 1 day, `hardStreak` 1. It pays R1 as `hard` does
    today (`settleRatingReward` unchanged).
  - Forgot: rating `again`. Due in 10 minutes, no Mistake Book entry.
- Header: a run of N planned cards with k new Q/A cards reads `Card X of (N+k)` (S04's words). Y
  counts the check slots from the first card (F02 s-correctness-3: projected when the run is planned,
  exact once the planner's slots are used up). SessionSummary gets `sessionDone`/`sessionLimit` with
  the check slots included.
- Recall-check dock (F02 s-correctness-1): **Forgot** *Show soon* / **Remembered** *See it tomorrow*,
  sending `again` / `hard` (`LEARNING_CHECK_ITEMS` in `RatingBar.tsx`). The route role badge
  (Elite recall / Boss check) is not shown on a study card or a check (F02 s-correctness-2).
- MCQ cards, learned Q/A cards and focus runs are unchanged. Under the MCQ kill switch an MCQ card renders
  as Q/A, so it gets the study step like any Q/A card.

## Tests

- `mobile/tests/integration/session-card-learning.screen.test.tsx` (new). It runs the real planner picks,
  the real rating helper and the real Mistake Book over in-memory storage. Cases:
  - a new Q/A card opens on the study view (question, answer, source, one Got it, no reveal, no rating
    buttons), and with the flag off there is no source;
  - Got it sends no event, no mistake, no save, no reward, re-queues the card as a check, and the
    subtitle goes from `Card 1 of 2` to `Card 2 of 2` (it read `Card 1 of 1` → `Card 2 of 2` before F02);
  - two new cards: the planner deals the second card (not the studied one, `excludeUids`), and the checks
    come last in study order, `Card 1 of 4` … `Card 4 of 4`, and the summary gets 4/4;
  - each check sends one event with `reviewStage: 'learning_check'`: Remembered → `hard` (stage 0,
    +1 day) and Forgot → `again` (+10 min); the reward and the saved progress follow the mapped rating;
  - a failed check calls the book with `learningCheck: true` and nothing is stored;
  - the check stays two-button with the four-button setting on;
  - a learned card is unchanged (`repeat_review`, Remembered → `good`, and Forgot is stored as a mistake);
  - a new MCQ card is unchanged (no study view, `first_review`, no extra slot);
  - a mixed run goes learned → study → check.
- `mobile/tests/unit/mistakeBook.test.ts`: a learning-check outcome never writes the book and never
  resolves an entry.
- `mobile/tests/unit/learningStepPlanner.test.ts` (new): `pickNextCard` `excludeUids` (including the
  avoidUid fallback), no change when it is empty or absent in every mode, and the forward through
  `buildRatedSessionState`.
- Updated flows. These existing tests are about the ordinary rating path, so their dealt card is now
  a reviewed card (`lastReviewedAt` set):
  - `session-card.screen.test.tsx`, `sessionCardReport.test.tsx`, and `session-card-mistakes.screen.test.tsx`
    (Q/A only; its MCQ card stays new).
  - `session-card-mcq.screen.test.tsx` (kill-switch case) and `owned-gate-entry-points.spec.tsx` now walk
    Got it → Reveal → Remembered. The kill-switch summary is 2/2.
- Gates: `npx tsc --noEmit`, `npm run test:unit` (187 files, 1360 tests) and `npm run test:integration`
  (72 files, 466 tests) all pass. `npm run test:smoke` fails with the same 32 TS errors as the untouched
  base. They come from the symlinked `node_modules` typings and from `deckRepository.ts`,
  `chunkedInstall.ts` and `premiumStore.ts`, all outside S01.

## Owner steps

- None. The change is JS-only (OTA-safe). Spot-check on a device:
  1. A fresh deck's first Q/A card opens on the study card.
  2. Got it moves on to the next card.
  3. The studied cards come back at the end with Forgot / Remembered.
  4. After a Forgot on a check, the Mistake Book stays empty.

## Deferred / notes

- Header words are S04's "Card X of Y"; the counts include the check slots (see Shipped surface).
- ~~The check dock reuses S02's two-button RatingBar with Remembered labelled "Normal gap".~~ Fixed in
  F02 (s-correctness-1): the check has its own wording, Remembered — *See it tomorrow*.
- Pausing mid-run drops the pending checks. Studied cards stay new (nothing was saved for them), so they
  come back as study cards next session.
- A route with no limit (`sessionLimit <= 0`) serves checks only once the planner has nothing left.
- The study view has no Report button. The report entry point stays tied to the revealed answer, and the
  check card shows it after reveal.
