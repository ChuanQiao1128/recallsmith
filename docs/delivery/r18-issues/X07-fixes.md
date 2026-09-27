# X07 — Mobile Mistake Book / Source row fixes (r18x-k)

Issue #360. One section per audit finding. Paths are relative to the repo root; line numbers are
at the tip of `delivery/r18xk/X07-360`.

### mobile-1

Status: fixed

- `mobile/src/screens/CardDetailScreen.tsx:502-503`: the Source row's `accessibilityLabel` is now
  `Source, <host>: <quote>` (or `Source, <host>` when the card has no quote), and the action moved
  to `accessibilityHint="Opens the source in your browser"`. VoiceOver now reads the quote, which
  the old label replaced.
- The existing assertion in `mobile/tests/integration/cardDetailSource.test.tsx` pinned the old
  label (`'Open source on learn.microsoft.com'`), which dropped the quote. The finding makes that
  behaviour wrong, so the assertion was updated to the new label and hint. It was not removed.
- Tests: `cardDetailSource.test.tsx` › "shows the source host and quote under an opened answer"
  (updated), and › "labels a Source row without a quote with the host alone" (new).

### mobile-2

Status: fixed

- `mobile/src/screens/LibraryScreen.tsx:85-86, 132-150`: the count is stored with the slug it was
  read for (`mistakeTally: { slug, count }`), and `mistakeCount` is derived as that count only
  while the slug matches the selected deck, 0 otherwise. The focus callback no longer runs
  `setMistakeCount(0)` before the read. A plain re-focus keeps the last count on screen, so the
  pill and the measured header no longer unmount and remount. A deck switch still reads as 0 until
  the new deck's count lands, so one deck's count never shows against another deck.
- Tests: `mobile/tests/integration/library-mistakes-pill.screen.test.tsx` › "re-reads the book on
  focus and keeps the pill on screen while it does". It fails on the old code, because the pill
  disappears while the read is in flight. Also › "never shows the previous deck count on a deck
  switch".

### mobile-6

Status: fixed

- `mobile/src/features/gacha/mistakes/mistakeBook.ts:40` adds an optional `lastCorrectAt` to
  `MistakeEntry`, set when a correct answer counts (`:123`) and cleared by a new mistake. The
  mistake branch builds a fresh entry without it.
- `:53` adds `isSameLocalDay`, and `:116` skips a good or easy rating that falls on the same local
  calendar day as the previous counted correct answer. Per the brief's direction, a mistake now
  resolves only after two correct ratings on different calendar days (local time). Back-to-back
  focus runs can no longer clear the book.
- `:163-175`: parsing is lenient. A valid `lastCorrectAt` round-trips, and a missing or malformed
  one drops only that field, never the entry. Books written by 1.8.0 before this change still load.
- `mobile/src/screens/MistakeBookScreen.tsx:162`: the copy now reads "Two correct answers on
  different days clear a card."
- Contract note (§11.1): `correctStreak >= 2 ⇒ resolvedAt = at` still holds. The change narrows
  which good or easy ratings increment the streak, and adds one optional field. Storage key and
  shape version (`v: 1`) are unchanged.
- Tests: `mobile/tests/unit/mistakeBook.test.ts` › "two corrects in the same session do not
  resolve", › "spaces correct answers by local calendar day, not by elapsed hours", › "a new
  mistake clears the last correct answer", and › "reads corrupt or absent storage as an empty book"
  (extended with `lastCorrectAt` parsing). The existing reducer tests already rated a day apart,
  so they pass unchanged. The loop test under mobile-11 also covers this end to end.

### mobile-7

Status: fixed

- `mobile/src/features/gacha/planner/sessionBuilder.ts:99`: new `buildFocusRoute(length)` returns
  one plain node per focus card (`role: 'normal'`, title `Focus review`).
- `mobile/src/screens/SessionCardScreen.tsx:553`: a focus run passes
  `buildFocusRoute(focusIndex.cards.length)` to `startSession` instead of the planner's
  `plannedChallenge.nodes`. The role label matches the focus cards for every card, including runs
  longer than the planner's route and runs where the planner route is empty.
- Tests: `mobile/tests/integration/session-card-focus.screen.test.tsx` › "labels every focus card
  as a focus review, whatever route the planner would have dealt" and › "labels focus cards even
  when the planner has no route at all" (both fail on the old code).
  `mobile/tests/unit/sweepPlanner.test.ts` › "buildFocusRoute" (2 tests).

### mobile-8

Status: fixed

- (a) `mobile/src/screens/MistakeBookScreen.tsx:143`: the CTA reads `Review mistakes + up to N
  related`. The related count is only known once `pickRelatedCards` runs at start, and it can be
  fewer or none. The existing assertion `'Review mistakes + 3 related'` in `mistakeBookScreen.test.tsx`
  made that false promise, so it was updated to the new copy.
- (b) `:206-219`: the CTA passes `disabled={starting !== null}`, sets
  `accessibilityState.busy` for the deck being started, and shows an `ActivityIndicator` while
  progress loads.
- (c) `:248-249`: `backChip` has `minHeight: a11y.minTouch` (44) and `justifyContent: 'center'`.
- (d) `:44` `mistakeRowLabel()` and `:187-188`: each row has an explicit `accessibilityLabel`,
  for example `Question s3-1. s3. Wrong 2 times, last wrong 2 days ago`, with "once" for a single
  miss, plus `accessibilityHint="Opens the card"`. The "×" shorthand is not spoken.
- Tests: `mobile/tests/integration/mistakeBookScreen.test.tsx` › "lists active mistakes for each
  deck …" (CTA copy, not disabled, no spinner), › "gives each row an explicit spoken label and
  hint", › "disables the review button and shows a busy indicator while the run is prepared", and
  › "meets the minimum touch size and WCAG AA text contrast on its new surfaces".

### mobile-9

Status: fixed

Per the brief's direction, the fix uses existing theme colours only; no new token. Ratios use the
WCAG 2.x relative-luminance formula. The same formula is asserted in the test below.

| Surface | Before | Ratio | After | Ratio |
|---|---|---|---|---|
| Review CTA text on `pokeBlue` #3FB7DB (15pt bold) | white #FFFFFF | 2.33:1 | `inkSoft` #3A2C1F | 5.77:1 |
| Row topic chip on `pokeBlueFaint` #BFE6F1 (11pt) | `pokeBlueDeep` #2C9CC0 | 2.39:1 | `inkSoft` #3A2C1F | 10.13:1 |
| Source host on white (13pt, CardDetail) | `pokeBlueDeep` #2C9CC0 | 3.17:1 | `inkSecondary` #5A4B38 | 8.41:1 |
| Row meta text on white (11pt) | `inkMuted` #8A7B6A | 4.10:1 | `inkSecondary` #5A4B38 | 8.41:1 |
| Mistake Book subtitle and empty-state body on the cream→peach→lavender gradient | `inkMuted` | 3.22–3.79:1 | `inkSecondary` | 6.61–7.76:1 |

- Changes: `mobile/src/screens/MistakeBookScreen.tsx:258-324` (subtitle, emptyBody, rowTopic,
  rowMetaText, primaryActionText) and `mobile/src/screens/CardDetailScreen.tsx:851` (sourceHost).
  The CTA keeps its `pokeBlue` brand fill and switches to dark text. The subtitle and empty body go
  beyond the four pairs the finding lists: they are the same `inkMuted` pair on the same new screen,
  so they were fixed too.
- Out of scope: the existing white-on-`pokeBlue` pair elsewhere in the app (for example
  `libraryScreenStyles.ts`, `ReviewBody.tsx`) predates 1.8.0. As the verifier notes, it is a
  design-system issue outside this finding.
- Tests: `mobile/tests/integration/mistakeBookScreen.test.tsx` › "meets the minimum touch size and
  WCAG AA text contrast on its new surfaces" computes the rendered colour pairs and requires at
  least 4.5:1.

### mobile-11

Status: fixed

- LibraryScreen seam: new `mobile/tests/integration/library-mistakes-pill.screen.test.tsx` renders
  `LibraryScreen` itself, with the real `mistakeBook` module on an in-memory AsyncStorage mock and a
  replayable focus event. It covers the pill count read from the stored book, navigation to
  `MistakeBook` for the deck, hiding the pill when `mistakeBook.enabled` is off (the flag spread),
  a re-read on focus (count 2 → 1 → hidden), and the per-slug reset on a deck switch.
- Rating to resolution: new `mobile/tests/integration/mistake-loop.screen.test.tsx` runs the real
  `mistakeBook`, `focusSession`, `sessionReviewHelpers` and deck cache. SessionCard rates c1 Again,
  and the stored entry appears. MistakeBookScreen lists it and starts a focus run
  (`focusUids: ['c1']`). A Good that day gives streak 1. A second focus run the same day leaves
  streak 1, unresolved. A Good the next day resolves it, and MistakeBookScreen shows the empty
  state.
- The lossy a11y assertion is replaced (see mobile-1).
- Tests: the two files above (4 + 1 tests).

## Gates run

- `cd mobile && npm run test:typecheck`: pass
- `cd mobile && npm run test:unit`: 165 files, 1025 tests pass
- `cd mobile && npm run test:integration`: 66 files, 409 tests pass
- `cd mobile && npm run test:smoke`: fails at its `tsc` step with type errors in untouched files
  (`src/content/chunkedInstall.ts:300`, the frozen `src/content/deckRepository.ts:833`, and
  react-native/DOM lib conflicts). It fails the same way (exit 2) on an untouched checkout of
  `delivery/r18x-k`, so this change did not cause it.
