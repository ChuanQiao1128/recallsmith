# Z07 — Mobile round 3 (OTA): per-finding fixes ledger

Release 1.8.0 fix wave, round 3 (r18z-k). Every change is pure JS/TS under `mobile/src` and
`mobile/tests`, plus the release-notes text file. It ships as an OTA on runtime 1.8.0. There is no
change to native code, `app.json`, `package.json`, the lockfile or `eas.json`. The frozen files
(`deckRepository.ts`, `progressSync.ts`, `review/model.ts`) are untouched. There is no schema,
migration or server change.

Every test named below was written first and failed against the pre-fix source. Each one passes
after the fix.

### mobile-16

Status: fixed

In a focus run, the MCQ verdict line now previews the rating with the scheduler that will save it.
It no longer shows a ladder step that is never applied.

- `mobile/src/features/gacha/mcq/mcqVerdict.ts:79,99`: `describeScheduledRating(before, rating,
  now, schedule = scheduleNextReview)` takes an optional `RatingScheduler`. If a non-Again rating
  leaves `stage` and `nextReviewAt` unchanged (focus practice), the line reads
  `Practice · schedule unchanged · back in <gap>` (`:108`). The gap is measured to the unchanged
  `nextReviewAt`, in minutes, hours or days, so a card due in 9 minutes reads "9 minutes" and not
  a fresh "2 days". The wording of normal and due-card lines is unchanged.
- `mobile/src/features/gacha/mistakes/focusSession.ts:72`: new `isFocusPractice(p, rating, now)`,
  which returns true for a non-Again rating on a card that is not due. `scheduleFocusReview`
  (`:84`) uses it, so the preview, the saved schedule and the event flag (mobile-18) all apply
  the same rule.
- `mobile/src/screens/SessionCardScreen.tsx:816-821`: `settleMcq` passes `scheduleFocusReview`
  when `focusIndexRef.current` is set. The on-screen line (McqReviewBody) and the VoiceOver
  announcement both use this `scheduleLine`.
- Tests:
  - `mobile/tests/integration/session-card-focus.screen.test.tsx` › "previews a not-due MCQ card
    in a focus run with the schedule it actually saves (mobile-16)". A stage-3 MCQ card due in 7
    days is answered correctly in a focus run. The line and the announcement read "Practice ·
    schedule unchanged · back in 7 days". The saved progress keeps `stage` and `nextReviewAt`,
    and the previewed gap matches the saved `nextReviewAt`. Before the fix the line read
    "Scheduled as Easy · back in 30 days".
  - `mobile/tests/unit/mcqVerdict.spec.ts` › "previews a focus-run rating with the scheduler that
    saves it (mobile-16)". Covers not-due Hard/Good/Easy, the 9-minute and 5-hour gaps, and Again
    or a due card still reading "Scheduled as …" and matching `scheduleNextReview`.

### mobile-17

Status: fixed

- `mobile/src/features/gacha/mistakes/mistakeBook.ts:146`: new pure
  `mergeMistakeBooks(user, anon)`. If both books hold a card, the entry with the newer
  `lastWrongAt` wins, and the account's entry wins a tie. The 500-entry LRU cap then applies
  (`capEntries`, `:92`, which `applyOutcome` now shares). Neither input is mutated.
- `:271`: `withMistakeBookLock(fn)` exposes the module's serialised chain, and
  `recordMistakeOutcome` now runs through it with unchanged behaviour.
- `:316`: `adoptAnonMistakeBook()` runs on that chain. It does nothing while signed out. It reads
  the `devcards:u:anon:` book and the account book, writes the merge, and then removes the anon
  key (copy, then clear, so replaying it is idempotent). If the account book cannot be read, it
  keeps the anon key and writes nothing, so a failed read never wipes the account's entries. It
  never throws.
- `mobile/src/sync/drawStateSync.ts:290`: `adoptAnonGachaState` calls it after the deck wallets.
  The sign-in path in `authStore` (comment at `mobile/src/auth/authStore.ts:171`) and the sync
  path therefore both adopt the book. The `AnonGachaAdoption` result type is unchanged, because
  the book is local-only and never pushed.
- Tests:
  - `mobile/tests/unit/mistakeBook.test.ts` › "anonymous book adoption (Z07 mobile-17)":
    "merges two books keeping the entry with the newer lastWrongAt, then applies the LRU cap",
    "adopts the signed-out book into the account at sign-in and removes the anon key" (also
    checks that a second run is a no-op and that a later sign-out does not revive the book),
    "does nothing while signed out", "keeps the anon book when the account book cannot be read,
    and never throws", "runs on the same chain as recordMistakeOutcome, so a rating racing
    sign-in is not lost".
  - `mobile/tests/unit/drawStateAdoption.test.ts` › "carries the signed-out Mistake Book into the
    account at sign-in (Z07 mobile-17)".

### mobile-18

Status: fixed

- `mobile/src/screens/SessionCardScreen.tsx:652-658`: a focus-run rating where
  `isFocusPractice(current.progress, rating, now)` is true now sends
  `reviewStage: 'focus_practice'`. A due card, or an Again, in a focus run still sends
  `repeat_review` or `first_review` as before. `progressAfter` was already the unchanged
  schedule, and the tests pin it.
- No server or frozen-file change was needed. `progressSync.ts` types `reviewStage` as
  `'first_review' | 'repeat_review' | string | null`, and the server stores any string of at
  most 64 characters. The MCQ path's `McqReviewStage` feeds only `mapMcqVerdictToRating` and
  is not changed.
- Server follow-up (out of scope for this OTA): the Content Intelligence live query should
  exclude `review_stage = 'focus_practice'` from `response_score`, `first_success` and
  `easy_rate`. Until then these events are tagged but still counted.
- Tests:
  - `mobile/tests/integration/mistake-loop.screen.test.tsx` › "gives no scheduler credit to cards
    that are not due and deals nothing twice on the same day". New assertions: the due mistake
    sends `repeat_review`, and the two not-due related cards send `focus_practice` with
    `progressAfter` = the unchanged `stage`/`nextReviewAt` and `lastReviewedAt` = now.
  - `mobile/tests/integration/session-card-focus.screen.test.tsx` › "marks a focus-practice
    rating as focus_practice on the review event, and a due card as a real review (mobile-18)".

### mobile-19

Status: fixed

- `mobile/scripts/release/whats-new-1.8.0.txt:1` now reads "…and a card leaves the book once you
  get it right on two different days." This matches `applyOutcome` (a second correct answer on
  the same local day does not count) and the in-app subtitle.
- The What's New text already submitted with build 22 cannot be edited while the build is in App
  Store review. The corrected file is for the next App Store Connect metadata edit.
- Tests: `mobile/tests/unit/whatsNew180.test.ts` › "says a card leaves the Mistake Book after
  correct answers on two different days" (fails on the old "twice in a row" text) and › "fits the
  App Store What's New limit".

### mobile-20

Status: fixed

- `mobile/src/screens/MistakeBookScreen.tsx:106`: `loadGroups` computes `openToday` for each
  deck with the same `isOpenToday` rule (`:65`) that `startFocus` uses (`:154`). If it is 0, the
  done line ("Done for today, come back tomorrow.") shows as soon as the list loads (`:228`), and
  the review button switches to the new `secondaryAction` style (`:391`): white fill with inkSoft
  text at 13.46:1. The tap still starts no run and announces the done line, as Y08 mobile-12
  decided.
- `:73`: `clearProgress(entry, now)` adds a meta item to rows one correct answer from clearing:
  "1 of 2 correct · next tomorrow" if today's answer already counted, otherwise "1 of 2
  correct · 1 more clears it" (`:254`). `mistakeRowLabel` speaks the same thing (`:86`). Other
  rows and their labels are unchanged.
- `mobile/src/features/gacha/library/LibraryHeader.tsx:243`: the pill's spoken label is now
  "Open Mistake Book, N mistake(s)" and no longer says "N to review". The visual "Mistakes · N"
  and the count are unchanged.
- `RESOLVE_STREAK` is now exported from `mistakeBook.ts:19`, so the row text uses the same
  number as the reducer.
- Updated existing assertions, because the finding makes the old label wrong:
  `mobile/tests/integration/library-mistakes-pill.screen.test.tsx` (two assertions) and
  `mobile/tests/integration/mistake-entry-points.test.tsx` (one) now expect "Open Mistake Book,
  N mistakes".
- Tests: `mobile/tests/integration/mistakeBookScreen.test.tsx` › "shows done for today on load
  with a secondary button, and a row one correct answer from clearing". With no tap, the done line
  shows for the done deck and not for the open one. It checks primary and secondary button fills,
  secondary text contrast of at least 4.5:1, the row meta text for both streak-1 cases and its
  absence at streak 0, and both spoken labels.
