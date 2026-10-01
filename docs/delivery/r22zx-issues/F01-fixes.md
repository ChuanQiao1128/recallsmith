# F01 — r22z review fixes: inline code (fixes ledger)

Issue #625, round r22zx, wave z. Mobile, JS-only and OTA-safe: no package, app, eas or native change, and no frozen
file touched. I checked each finding against the code before changing anything. Every new or tightened test below
fails on the base (`delivery/r22zx-z`) and passes with the change, except where the entry says otherwise. For the
test-only findings, a mutation check shows the test now catches the regression.

## Summary of changes

- `mobile/src/screens/CardDetailScreen.tsx`: the CORRECT ANSWER option texts render through `InlineCodeText`.
- `mobile/src/features/gacha/components/McqReviewBody.tsx`: `stemSegments` gets the code-span ranges from
  `splitInlineCode`. It skips any qualifier or caps match that overlaps a span. For a qualifier, it takes the next
  match in prose, or falls back to caps emphasis outside spans.
- Tests:
  - `mobile/tests/integration/card-detail-answer.screen.test.tsx`
  - `mobile/tests/unit/mcqReviewBody.test.tsx`
  - `mobile/tests/integration/session-card-mcq.screen.test.tsx`
  - `mobile/tests/unit/drawCommitFaces.test.ts`
  - `mobile/tests/integration/myReports.test.tsx`
  - `mobile/tests/integration/question-code-surfaces.test.tsx`
- `docs/delivery/r22z-issues/Z01-notes.md`: the file table, test list and Deferred section are corrected.

### z-correctness-1
Status: fixed

Confirmed: the CORRECT ANSWER block in `CardDetailScreen.tsx` rendered `<Text>{option.text}</Text>`, so an option
like `` Call `ConfigureAwait(false)` on the awaited task `` showed its backticks.
Fix: `<InlineCodeText key={option.key} style={styles.mcqCorrectText} text={option.text} />`.
Files: `mobile/src/screens/CardDetailScreen.tsx`.
Test: `card-detail-answer.screen.test.tsx` > "renders inline code spans in the question card and the CORRECT ANSWER
option (F01)" uses a new `.NET` MCQ fixture. It checks:
- one `inline-code` segment `ConfigureAwait(false)` in Menlo
- the stripped label
- no backtick anywhere on the page

### z-correctness-2
Status: fixed

Confirmed: `capsSegments` ran `/\b[A-Z]{4,}\b/` on the raw stem. `` `POST` `` was cut into `` ` `` + `POST` (caps) +
`` ` ``, so both backticks rendered literally. The same thing happened to a qualifier match inside or across a span.
That second case was the one Z01 had deferred.
Fix: `stemSegments` computes the `[start, end)` range of each span from `splitInlineCode`. Caps matches that overlap
a span are skipped. A qualifier match that overlaps a span is skipped for the next case-insensitive match. If no
match is left, the stem falls back to the span-aware caps emphasis. Stems without spans segment exactly as before,
and the existing qualifier and caps tests are unchanged.
Files: `mobile/src/features/gacha/components/McqReviewBody.tsx`.
Test: `mcqReviewBody.test.tsx` > "never cuts an inline code span for caps or qualifier emphasis (F01)". It renders
the reviewer's stem (`` `HttpPost` ``, `` `POST` ``, LEAST) and checks:
- the spans are `['HttpPost', 'POST']`
- caps emphasis lands only on `LEAST`
- no visible backtick, and the label is the stripped stem

It also covers three `stemSegments` cases:
- a caps word inside a span
- a qualifier hit inside a span, skipped for the prose hit
- a qualifier found only inside a span, which falls back to caps

### z-tests-1
Status: fixed

Confirmed: `byTestID(tree, 'mcq-section-explanation')[0] ?? tree.root` plus `arrayContaining(['new List<int>(n)',
'Add'])` could be satisfied by option b and the stem alone.
Fix: the fixture explanation now uses identifiers that appear nowhere else on the card (`Capacity`,
`EnsureCapacity`). The test asserts the section exists exactly once and its spans `toEqual(['Capacity',
'EnsureCapacity'])`.
Files: `mobile/tests/integration/session-card-mcq.screen.test.tsx`.
Test: the same test, "renders inline code spans ...". Mutation check: rendering EXPLANATION as plain `<Text>` in
`McqReviewBody.tsx` now fails it. The old assertion passed in that case. This is a test-only fix, so the test passes
on the base.

### z-tests-2
Status: fixed

Confirmed: no test exercised the inline-code strip in `drawCommit`, `RevealCardFace`, the DrawResult featured label,
grid tile or detail sheet, the MyReports row, or the CardDetail question card. One assertion per surface was added:
- CardDetail question card: the z-correctness-1 test above checks the `Task` span and the stripped label.
- `drawCommit` question: `drawCommitFaces.test.ts` > "tags drawn cards with topic and kind" uses one question with
  two spans and one with a fence.
- MyReports row and label: `myReports.test.tsx` > "drops inline-code backticks from a reported question".
- DrawResult and RevealCardFace: `question-code-surfaces.test.tsx` > "strips inline-code backticks on the featured
  face, its label, the grid and the detail sheet". It feeds a draw result whose questions still carry spans and
  checks each surface's own strip:
  - `draw-result-featured-question` (the RevealCardFace slab)
  - the featured `accessibilityLabel`
  - one tile per card in the all-cards sheet
  - `draw-result-detail-question`

Mutation checks: removing each `stripInlineCode` fails its test. That covers `drawCommit.ts`, `MyReportsScreen.tsx`,
`RevealCardFace.tsx`, and the three `DrawResultScreen.tsx` sites (one at a time). These are test-only additions for
code that was already correct, so they pass on the base.
Files: the four test files named above; no source change.

### z-tests-3
Status: fixed

Confirmed: `DrawSummaryGrid.tsx` prints `card.question` from the draw result. Draw results are not persisted; they
only come from `commitDraw`, which strips the question. So the summary grid shows no backticks, and the Z01 Deferred
bullet contradicted itself. The same holds for `TapCard` and `RevealSpotlight`, which get the same `commitDraw` text, and
for `LibraryCardTile`, which gets its text from `libraryMapper`. Mobile has no search surface, so that part of the bullet was wrong as well.
Fix: the Deferred section of `Z01-notes.md` now says these surfaces are covered by the `drawCommit` and
`libraryMapper` strips. It names console pages as the only unaudited readers. It also records that the qualifier and
caps straddle is fixed (z-correctness-2).
Files: `docs/delivery/r22z-issues/Z01-notes.md`.
Test: docs only.
