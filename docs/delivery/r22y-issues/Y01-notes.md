# Y01 — Code inside a card question renders as a code block (never raw backticks)

Issue #616, round r22y, wave y. Mobile, JS-only (OTA-safe: no package / app / eas / native change, no frozen file touched).

## What shipped

The rebuilt C#/.NET deck (R23) puts the code a learner must read INSIDE the question as one fenced block
(an opening line with three backticks and a language word, the code lines, a closing line with three backticks).
Every surface used to print `card.Question` as plain text. Now:

| Surface | What it renders |
| --- | --- |
| ReviewBody front face (before reveal) | prose, then the code as a `CodeBlock`, then "Reveal answer" |
| ReviewBody question recap (after reveal) | prose, then the same `CodeBlock`, above the answer |
| McqReviewBody stem | prose stem (lead-in split, qualifier / caps highlighting run on the prose only), then the `CodeBlock`, then the options; on the stem stage the code sits above the stem hint |
| CardDetailScreen question card | prose, then the `CodeBlock` |
| CardDetailScreen title, MistakeBook row + its spoken label, DrawResult featured question / grid / detail sheet, RevealCardFace, TapCard, DrawSummaryGrid, Library tiles | prose only (via `drawCommit` / `libraryMapper` / `questionText`) |

The question `CodeBlock` is the same component, tokenizer hint (`normalizeCodeLanguage`) and language caption
(`friendlyCodeLanguage`, e.g. "C#") the answer-side CODING SAMPLE uses, inside the same rounded container; its
horizontal `ScrollView` keeps long lines on one line.

Accessibility: on the full-question surfaces the question Text's label is the prose plus `, code sample follows`.
When the question has no fence no label is set, so VoiceOver reads it exactly as before.

Cards without a well-formed fence (every existing AWS / Claude card) render exactly as today: same text, no
extra node (ReviewBody uses a fragment), no `accessibilityLabel` override.

## Files

- `mobile/src/content/questionCode.ts` (new) — pure helper:
  - `splitQuestionCode(question) -> { text, code: { language, source } | null }`
  - `questionText(question)` (prose only, for row / title surfaces)
  - `questionA11yLabel(split)` and `QUESTION_CODE_A11Y_SUFFIX`
- `mobile/src/features/gacha/session/QuestionCodeBlock.tsx` (new) — the shared question code block (testID `question-code`).
- `mobile/src/features/gacha/components/ReviewBody.tsx` — front face + recap.
- `mobile/src/features/gacha/components/McqReviewBody.tsx` — stem split, code between stem and options.
- `mobile/src/screens/CardDetailScreen.tsx` — title = prose; question card renders the code block.
- `mobile/src/screens/MistakeBookScreen.tsx` — row text and `mistakeRowLabel` get the prose (`splitQuestionCode(card.Question).text`).
- `mobile/src/features/gacha/draw/drawCommit.ts` — `DrawnCardVm.question` is the prose (DrawResult grid, featured card, RevealCardFace, TapCard, DrawSummaryGrid read it).
- `mobile/src/features/gacha/library/libraryMapper.ts` — library row `question` is the prose.

## Parsing rules (`splitQuestionCode`)

- Opening fence: a line that is three backticks plus a language word (`[A-Za-z0-9_+#.-]+`), surrounding spaces allowed.
  Closing fence: a later line that is three backticks only. CRLF is accepted.
- No well-formed fence (no fence, no language word, no closing line, inline backticks, an empty / blank-only body)
  → the question is returned unchanged with `code: null`.
- Only the first fence is extracted; a second fence stays in `text` as written.
- Code lines keep their indentation; blank lines at the edges of the fence body are dropped, inner blank lines kept.
- `text`: prose before and after the fence joined by one blank line, trailing spaces per line removed, runs of
  blank lines collapsed, outer whitespace trimmed.

## Tests

- `mobile/tests/unit/questionCode.test.ts` — no fence, one fence with indentation kept, prose before + after,
  two fences → first only, malformed fences unchanged (unclosed, no language, inline), blank-line edges,
  blank-only body, CRLF / padded fence lines, fence-only question, `questionText` / `questionA11yLabel`.
- `mobile/tests/integration/session-card.screen.test.tsx` — Q/A front shows the code block before reveal, ordered
  question → code → Reveal, with the code label and C# caption; the recap keeps it after reveal; no backticks;
  an AWS question renders unchanged (same text, no label, no code block).
- `mobile/tests/integration/session-card-mcq.screen.test.tsx` — MCQ renders stem → code → options, qualifier
  still highlighted, label suffix, no backticks; the AWS MCQ renders unchanged.
- `mobile/tests/integration/mistakeBookScreen.test.tsx` — MistakeBook row text and spoken label are prose only.
- `mobile/tests/integration/question-code-surfaces.test.tsx` (new) — the real `commitDraw` maps the prose; the
  DrawResult featured card, grid and detail sheet show no backticks and no code; library rows are prose; AWS unchanged.
- `mobile/tests/integration/card-detail-answer.screen.test.tsx` — CardDetail question card renders prose + code
  block (C# caption, label suffix); a question without a fence renders unchanged.

Commands run (from `mobile/`): `npx tsc --noEmit`, `npx vitest run` (all suites), and the Y01 verify script.

## Owner steps

None. No config, flag, migration or deploy. The R23 C#/.NET deck only has to author its code as a fenced block
inside `Question` (opening line with a language word, closing line on its own).

## Deferred

- `LearningStudyView.tsx` (the R22 study view shown for a never-reviewed Q/A card) still prints `card.Question`
  as plain text. It was outside this issue's file scope; it should call `splitQuestionCode` and render
  `QuestionCodeBlock` the same way ReviewBody does.
- `MyReportsScreen` shows the question echoed back by the card-report API; it is outside scope and would need
  `questionText` too.
- `tests/integration/session-card-starter.screen.test.tsx` > "teaches the first 5 non-MCQ cards…" failed on the
  base (`delivery/r22y-y`) before any Y01 change: the H02 starter test predates the merged R22 §6 learning step
  (r22-s), so it looked for "Reveal answer" / "Good" on a study view. To make the root mobile gate pass, the test
  now walks the merged flow: study c1..c5 ("Got it"), then their recall checks in study order (Reveal →
  "Remembered"). Every original assertion is kept (no pull before the last card, Draw opens with the 3-pull
  bootstrap, stage closed, prompt armed, owned set empty, c1..c5 learned). No source change.
- Pre-existing on the base too: `npm run test:smoke` stops on 32 TypeScript errors inside `node_modules`
  (react-native `globals.d.ts` against `lib.dom.d.ts`) in this worktree setup; Y01 changes nothing there.
