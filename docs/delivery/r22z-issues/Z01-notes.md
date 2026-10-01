# Z01 — Inline `code` spans render as monospace in card text; titles and rows drop the backticks

Issue #623, round r22z, wave z. Base: `delivery/r22z-z`.

## Problem

The rebuilt .NET deck (R23, live since 2026-10-02) writes code identifiers as markdown inline code
spans (`` `List<int>` ``, `` `Add(4)` ``, `` `ConfigureAwait(false)` ``) in 193 of its 217 cards: questions,
explanations, REAL USAGE, MCQ options and WHY texts. Every surface printed the raw backticks.

## What changed (files)

| File | Change |
| --- | --- |
| `mobile/src/content/inlineCode.ts` (new) | Pure helper: `splitInlineCode(text)` → `Array<{ kind: 'text' \| 'code', value }>`, `stripInlineCode(text)`, `hasInlineCode(text)`. |
| `mobile/src/features/gacha/components/InlineCodeText.tsx` (new) | `InlineCodeText` component, plus `useInlineCodeStyle` and `inlineCodeNodes` for callers that already own a `<Text>` (the MCQ stem). |
| `mobile/src/features/gacha/components/ReviewBody.tsx` | Question (front and recap) uses `InlineCodeText`; fenced-question label is stripped. |
| `mobile/src/features/gacha/components/LearningStudyView.tsx` | Question uses `InlineCodeText`; label is stripped. |
| `mobile/src/features/gacha/components/CardAnswerSections.tsx` | EXPLANATION uses `InlineCodeText`. |
| `mobile/src/features/gacha/session/reviewContentHelpers.tsx` | `renderSimpleMarkdown` paragraphs and bullets (REAL USAGE) use `InlineCodeText`. |
| `mobile/src/features/gacha/components/McqReviewBody.tsx` | Stem: spans applied inside every stem segment, so the qualifier and caps emphasis still work; the clamped lead-in too. Since F01 (r22zx), `stemSegments` skips any qualifier or caps match that overlaps a span, so emphasis never cuts a span. Option texts, WHY texts and EXPLANATION use `InlineCodeText`. The stem and option labels are stripped. |
| `mobile/src/screens/CardDetailScreen.tsx` | Question card uses `InlineCodeText` (this is also the page's title text); the fenced-question label is stripped. Since F01 (r22zx), the CORRECT ANSWER option texts use `InlineCodeText` too (Z01 had missed them). |
| `mobile/src/screens/MistakeBookScreen.tsx` | Row text and row label use `stripInlineCode`. |
| `mobile/src/screens/DrawResultScreen.tsx` | Grid tile, featured label and detail-modal title use `stripInlineCode`. |
| `mobile/src/components/ceremony/RevealCardFace.tsx` | Question slab uses `stripInlineCode`. |
| `mobile/src/features/gacha/library/libraryMapper.ts` | Library row `question` is stripped. |
| `mobile/src/features/gacha/draw/drawCommit.ts` | Drawn-card `question` is stripped, so reveal, grid and summary all get clean text. |
| `mobile/src/screens/MyReportsScreen.tsx` | Report row question and its label are stripped. |

## Shipped behaviour

### Span rules (`splitInlineCode`)
- A span is one backtick, at least one non-backtick character, then a closing single backtick on the
  same line.
- A run of two or more backticks is never a delimiter. A ```` ``` ```` fence is left as written for
  `splitQuestionCode`, and an empty span ` `` ` stays literal.
- An unmatched backtick and a backtick pair that spans a line break both stay literal text.
- `stripInlineCode` removes the backticks of well-formed spans only.
- It is a plain character scanner with no regex lookbehind, so Hermes needs no new regex support.

### Rendering (`InlineCodeText`)
- Each code span is a nested `<Text>` inside the parent `<Text>`, so it wraps with the sentence.
- The span style:
  - Font: Menlo on iOS and `monospace` elsewhere, the same families `CodeBlock` uses.
  - Size: 0.9× the parent `fontSize` when the parent sets one.
  - Weight: normal.
  - Background: `rgba(67,42,18,0.08)` in light mode and `rgba(255,255,255,0.14)` in dark mode (`useColorScheme`).
  - Padding and radius: `paddingHorizontal: 3`, `borderRadius: 4`. These only show where the platform honours them on nested text.
- Text without a well-formed span renders as `<Text {...props}>{text}</Text>`, with no extra props
  and no label override. AWS cards are byte-for-byte unchanged.
- When spans are present and the caller passes no `accessibilityLabel`, the label is the stripped text.
- `react-native` exports (`useColorScheme`, `Platform`) are read through a guarded `readRN` lookup.
  This follows the existing `MistakeBookScreen` pattern, so suites that mock a minimal `react-native` keep working.

## How it is tested
- `mobile/tests/unit/inlineCode.test.ts` covers:
  - no span and an empty string
  - several spans
  - generics with `< >`
  - an unmatched backtick
  - no pairing across a line break
  - a ```` ``` ```` fence left untouched (and still split by `splitQuestionCode`)
  - the empty span ` `` `
- `mobile/tests/unit/inlineCodeText.test.tsx` covers:
  - plain text unchanged
  - nested monospace segments, smaller size and the stripped label
  - the dark-mode background
  - a caller label kept
  - REAL USAGE paragraphs and bullets
  - a library row without backticks
- `mobile/tests/integration/session-card.screen.test.tsx` covers:
  - a Q/A card with spans in the question and explanation, before and after reveal, with monospace style and no backtick anywhere in the tree
  - the same on the study view
  - an AWS card whose question and explanation render as before
- `mobile/tests/integration/session-card-mcq.screen.test.tsx` covers spans in the lead-in, the stem
  (qualifier still highlighted), an option text and label, and a WHY text.
- `mobile/tests/integration/mistakeBookScreen.test.tsx` covers a row and its label without backticks,
  including a question with both an inline span and a fence.
- Added in F01 (r22zx), see `docs/delivery/r22zx-issues/F01-fixes.md`:
  - `card-detail-answer.screen.test.tsx`: the CardDetail question card and its CORRECT ANSWER option
  - `mcqReviewBody.test.tsx`: a caps word and a qualifier hit inside a span
  - `drawCommitFaces.test.ts`: the drawn-card `question`
  - `myReports.test.tsx`: the report row and its label
  - `question-code-surfaces.test.tsx`: the DrawResult featured face (RevealCardFace), its label, the grid tiles and the detail sheet
- Z01 itself shipped without tests for CardDetail, DrawResult, RevealCardFace, MyReports or drawCommit,
  and its MCQ EXPLANATION check could pass without the section (fixed in F01).
- The new screen tests fail on the base (`c3c7774`) and pass with the change.
- Gates:
  - `npx tsc --noEmit`
  - the full `npx vitest run`
  - `Z01.verify.sh`

## Owner steps
- None to ship: JS-only and OTA-safe on runtime 1.9.0. No package, app.json, eas.json or native change, and no frozen file touched.
- Optional: on a simulator, open a .NET card that has inline code in each of these places and check the monospace look in light mode:
  - the question
  - the explanation
  - REAL USAGE
  - an MCQ option and its WHY

## Deferred
- iOS ignores padding on nested `<Text>`, so the span background sits flush to the glyphs there.
  A true chip would need a `View`, and that would break line wrapping. The brief ranks wrapping first.
- Surfaces that print the drawn or library question as given (`DrawSummaryGrid`, `TapCard`,
  `RevealSpotlight`'s full-question sheet, `LibraryCardTile`) show no backticks: they only receive text that
  `drawCommit` or `libraryMapper` already stripped. They are not a follow-up. (Corrected in F01. An earlier
  version of this note listed `DrawSummaryGrid` as still showing backticks.)
- Inside `mobile/src`, `card.Question` is read raw only by the surfaces in the table above. The mobile app
  has no search surface. Console pages (`frontend/`) were not audited.
- Fixed in F01: an MCQ qualifier or caps match that falls inside or across a code span used to cut the
  span and leave its backticks visible. `stemSegments` now skips such a match. For a qualifier it takes
  the next match in prose, or falls back to caps emphasis outside spans.
