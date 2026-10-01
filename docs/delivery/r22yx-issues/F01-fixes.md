# F01 — r22y review fixes: question code (fixes ledger)

Issue #620, round r22yx, wave y. Mobile, JS-only (OTA-safe: no package / app / eas / native change, no frozen file
touched). Each finding was checked against the code first; every new test below failed on the base
(`delivery/r22yx-y`) unless stated otherwise.

## Summary of changes

- `mobile/src/content/questionCode.ts` — new `FENCE_ONLY_QUESTION_TEXT` ("What does this code do?"): a fence-only
  question gets that prose instead of `''`. Every prose surface (`questionText`, `drawCommit`, `libraryMapper`,
  MistakeBook, CardDetail, DrawResult, RevealCardFace, TapCard) and `questionA11yLabel` read `split.text`, so all of
  them get it with no per-surface change.
- `mobile/src/features/gacha/components/LearningStudyView.tsx` — splits the question like ReviewBody: prose (with the
  `, code sample follows` label when there is code), then `QuestionCodeBlock`, then the answer sections.
- `mobile/src/screens/MyReportsScreen.tsx` — row text and its spoken label use `questionText(item.question)`.
- `docs/delivery/r22y-issues/Y01-notes.md` — surfaces table, parsing rules and Deferred section corrected.

### y-correctness-1
Status: fixed

Confirmed: `LearningStudyView.tsx` rendered `{card.Question}` as plain text, and `SessionCardScreen` shows it for every
never-reviewed Q/A card (`learningPhase === 'study'`).
Files: `mobile/src/features/gacha/components/LearningStudyView.tsx`.
Test: `mobile/tests/integration/session-card.screen.test.tsx` > "shows the question code block on the study view of a
never-reviewed card" (prose, label suffix, one C# code block, order question → code → answer, no backticks) and
"renders a study-view question without a fence exactly as before".

### y-tests-1
Status: fixed

Confirmed: `mountWithQuestion` always gave the card `lastReviewedAt: LEARNED_AT`, so the study view was never reached.
It now takes `{ neverReviewed: true }` (progress with `lastReviewedAt: 0`) and the two study-view tests above use it.
Files: `mobile/tests/integration/session-card.screen.test.tsx` (fix itself is under y-correctness-1).
Test: same as y-correctness-1.

### y-correctness-2
Status: fixed

Confirmed: `splitQuestionCode` returned `text: ''` for a fence-only question, giving blank rows/titles and a label of
`, code sample follows`. Chosen fix: the fallback prose `What does this code do?` (supervisor-1 wording) rather than
returning the question unchanged, so the code still renders as a code block.
Files: `mobile/src/content/questionCode.ts`.
Test: `mobile/tests/unit/questionCode.test.ts` > "falls back to neutral prose when the question is only a fence" and
"gives a fence-only question the fallback prose on row surfaces and in the spoken label" (replaces the old
"returns empty text when the question is only a fence", which pinned the bug).

### y-correctness-3
Status: fixed

Confirmed: `MyReportsScreen` printed `item.question` (the raw API echo) in the row and its accessibility label.
Files: `mobile/src/screens/MyReportsScreen.tsx`.
Test: `mobile/tests/integration/myReports.test.tsx` > "shows the prose only for a reported question with a fenced code
block" (fenced → prose, fence-only → fallback, plain unchanged; labels carry no backticks or code).

### y-tests-2
Status: fixed

Confirmed as a coverage gap: both Y01 MCQ tests forced `recallFirst: false`. The code itself was already correct
(`McqReviewBody` renders the code block before the `stage === 'stem'` hint), so the new test passes on the base; it was
checked by temporarily moving the code block into the options branch, which made it fail, then restoring the source.
Files: `mobile/tests/integration/session-card-mcq.screen.test.tsx`.
Test: "keeps the code block between the stem and the stem hint on the recallFirst stem stage" (order mcq-stem →
question-code → mcq-stem-hint, no options; after Show options the code stays, above the options).

### y-tests-3
Status: fixed

Confirmed: no surface handled empty prose. Fixed at the root by y-correctness-2 and pinned on surfaces.
Files: `mobile/src/content/questionCode.ts`, tests below.
Test: `mobile/tests/integration/session-card.screen.test.tsx` > "gives a fence-only question the fallback prose on the
review front and the study view" (full-question surfaces: text + label) and
`mobile/tests/integration/mistakeBookScreen.test.tsx` > "shows the fallback prose for a fence-only question, in the
row and its label" (row surface), plus the My Reports case under y-correctness-3.

### y-tests-4
Status: fixed

Confirmed: `studied` was filled from the loop variable, so `expect(studied).toEqual([...])` could not fail. It is now
filled from the rendered `learning-study-question` text (the screen's actual card), with one such node asserted per step.
Files: `mobile/tests/integration/session-card-starter.screen.test.tsx`.
Test: "teaches the first 5 non-MCQ cards with nothing drawn, then opens Draw with the 3-pull bootstrap".

### supervisor-1
Status: fixed

Same fix as y-correctness-2: `FENCE_ONLY_QUESTION_TEXT = 'What does this code do?'` on every text surface and in the
accessibility label (`What does this code do?, code sample follows`).
Files: `mobile/src/content/questionCode.ts`.
Test: the unit tests under y-correctness-2 and the surface tests under y-tests-3.

## Commands run (from `mobile/`)

- `npx tsc --noEmit` — pass
- `npx vitest run` — 269 files, all tests pass
- `F01.verify.sh` — F01 VERIFY OK
