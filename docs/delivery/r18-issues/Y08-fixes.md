# Y08 — Mobile round 2 (OTA): per-finding fixes ledger

Release 1.8.0 fix wave, round 2 (r18y-k). Every change is pure JS/TS under `mobile/src` and
`mobile/tests`, so it ships as an OTA on runtime 1.8.0. No native code, `app.json`,
`package.json`, lockfile or `eas.json` change. The frozen files (`deckRepository.ts`,
`progressSync.ts`, `review/model.ts`) are untouched, and there is no schema or migration change.

Gates run in `mobile/`: `npm run test:typecheck`, `npm run test:unit` (165 files, 1032 tests) and
`npm run test:integration` (66 files, 416 tests) all pass. Every test named below fails against
the pre-fix source and passes after the fix.

### mobile-12

Status: fixed

A focus run no longer gives scheduler credit to cards that are not due, and repeated taps on the
same day no longer deal the same cards again.

- Credit. `mobile/src/features/gacha/mistakes/focusSession.ts:74` adds `scheduleFocusReview`. A
  due card, or an Again on any card, goes through the unchanged `scheduleNextReview`. A Hard, Good
  or Easy on a card that is not due is treated as practice: `stage`, `nextReviewAt`, `lapses` and
  `hardStreak` stay as they were, and only `lastReviewedAt` moves to now. The Mistake Book still
  records the rating either way, so `recordMistakeOutcome` and its "two correct answers on
  different days" rule are unchanged. `buildRatedSessionState` takes an optional `focusRun` flag
  (`mobile/src/features/gacha/session/sessionReviewHelpers.ts:62,73`), and `SessionCardScreen`
  sets it for a focus run (`mobile/src/screens/SessionCardScreen.tsx:629`). Normal, sweep and
  learn sessions keep the plain `scheduleNextReview` path. The review event carries this
  `progressAfter`, so the server stores the same unchanged schedule.
- Related cards. `pickRelatedCards` now reads the `now` input that was reserved for this. It drops
  candidates whose `lastReviewedAt` falls on the same local calendar day as `now`
  (`mobile/src/features/gacha/mistakes/relatedReview.ts:24,82`). The practice rating above still
  moves `lastReviewedAt`, so a related card from the first run is not dealt again that day.
- Mistakes. `MistakeBookScreen.startFocus` drops mistakes whose `lastCorrectAt` is today
  (`mobile/src/screens/MistakeBookScreen.tsx:132-141`). Another correct answer today would not
  count toward resolving them. If no mistake is left, the tap does not navigate. It shows
  "Done for today, come back tomorrow." under the button (`:36`, `:252`) and announces it through
  `AccessibilityInfo`. The mistakes stay listed, because the book is still unresolved.
  A mistake answered Again or Hard stays eligible: Again makes it due again in 10 minutes, and Hard
  on a card that is not due earns no credit.
- Text colour of the new line: `inkSecondary` #5A4B38 on the cream→peach→lavender gradient is
  7.76 / 6.87 / 6.61:1, which clears WCAG AA 4.5:1.
- Updated existing assertions, because the finding makes the old behaviour wrong:
  - `mobile/tests/integration/mistake-loop.screen.test.tsx` › "records Again, lists it, and
    resolves it only after correct focus runs on two days". The same-day second tap used to start
    a run. It now shows "Done for today" and starts nothing. The book assertions are unchanged.
  - `mobile/tests/unit/relatedReview.test.ts`: the shared `learned()` fixtures had cards reviewed
    a second before `NOW`, which is the same day, so every candidate would now be dropped. The
    fixtures move to the previous day (`PREV_DAY`) and keep the same relative order. Every
    ranking assertion is unchanged.
- Tests:
  - `mobile/tests/integration/mistake-loop.screen.test.tsx` › "gives no scheduler credit to cards
    that are not due and deals nothing twice on the same day". Progress is stateful here. After
    the first run, the due mistake is at stage 2 and the not-due related cards are still at stage 1
    with the same `nextReviewAt`. A second tap a minute later deals nothing and leaves every
    `stage` and `nextReviewAt` unchanged. The next day the mistake resolves without further
    schedule credit.
  - `mobile/tests/unit/sessionFocusUids.test.ts` › "scheduleFocusReview" (3 tests: not-due
    practice for Hard/Good/Easy with no stage creep; due cards and Again match `scheduleNextReview`;
    `buildRatedSessionState` applies it only when `focusRun` is set).
  - `mobile/tests/unit/relatedReview.test.ts` › "leaves out a card already reviewed on the local
    day of now, by calendar day not elapsed hours" and › "does not deal the same related cards
    again after they were rated earlier the same day".
  - `mobile/tests/integration/mistakeBookScreen.test.tsx` › "leaves out mistakes answered
    correctly today, and says done for today when none is left".

### mobile-13

Status: fixed

- `mobile/src/features/gacha/mistakes/mistakeBook.ts:166` adds `resolveActiveMistakeRows(book,
  deck, now)`. It returns the deck's active mistakes whose `stableUid` is still one of the deck's
  cards, newest first.
- `mobile/src/screens/LibraryScreen.tsx:143`: the pill now counts with the helper on the deck from
  `getCachedDeck`, the same source the Mistake Book uses. A deck that is not installed counts 0.
- `mobile/src/screens/MistakeBookScreen.tsx:84`: `loadGroups` builds its rows with the same helper,
  so the pill and the list cannot disagree.
- Not done: the optional pruning of orphaned entries. They already stop counting anywhere, and
  they age out of the 30-day window. Pruning would add another write path next to
  `recordMistakeOutcome`'s serialised chain for no visible gain.
- Tests: `mobile/tests/integration/library-mistakes-pill.screen.test.tsx` › "counts only mistakes
  whose card is still in the selected deck" (a stored entry for a uid missing from the deck) and ›
  "shows no pill for a selected deck that is not installed". Also
  `mobile/tests/unit/mistakeBook.test.ts` › "resolves only the active mistakes whose card is still
  in the deck".

### mobile-14

Status: fixed

- `mobile/src/features/gacha/mistakes/mistakeBook.ts:54,61`: `isSameLocalDay` is exported, and a
  new `localDaysBetween(from, to)` gives the difference between local midnights. It is rounded,
  so the 23- or 25-hour days around DST still count as one day, and it is never negative.
- `mobile/src/screens/MistakeBookScreen.tsx:56`: `formatLastWrong` uses it. The spoken
  `mistakeRowLabel` reuses the same function. Both now count the calendar days that resolution
  and the subtitle's "different days" rule count.
- Tests: `mobile/tests/integration/mistakeBookScreen.test.tsx` › "labels the last wrong answer by
  local calendar day, not by elapsed 24-hour blocks" checks the midnight boundary. A miss at 23:00
  viewed at 08:00 reads and is spoken as "yesterday", 00:30 → 23:30 reads "today", and 33 hours
  across two midnights reads "2 days ago". Also `mobile/tests/unit/mistakeBook.test.ts` › "counts
  local calendar days between two instants".

### mobile-9

Status: fixed

Ratios use the WCAG 2.x relative-luminance formula, computed locally and asserted in the test.

| Surface | Before | Ratio | After | Ratio |
|---|---|---|---|---|
| CardDetail Source row "SOURCE" label (11pt, weight 900) on the white answer body #FFFFFF | `inkMuted` #8A7B6A | 4.10:1 | `inkSecondary` #5A4B38 | 8.41:1 |

- `mobile/src/screens/CardDetailScreen.tsx:843-847`: `sourceLabel.color` changes to
  `colors.inkSecondary`. It uses an existing theme colour, with no new token. `sourceHost`
  (`inkSecondary`, 8.41:1) and `sourceQuote` (`inkSoft` #3A2C1F) already passed.
- Out of scope: the pre-existing `metaLabel` pair (`:712`) predates 1.8.0. It is the design-system
  pattern the verifier cites, not a new surface.
- Tests: `mobile/tests/integration/cardDetailSource.test.tsx` › "meets WCAG AA text contrast for
  every text in the Source row, SOURCE label included". It uses the same `contrast()` as
  `mistakeBookScreen.test.tsx`, reads the answer body's rendered background, and requires at least
  4.5:1 for the SOURCE label and every other text in the row.

### mobile-15

Status: fixed

- `mobile/src/screens/MistakeBookScreen.tsx:189-194`: the loading container is `accessible`, with
  `accessibilityLabel="Loading mistakes"` and `accessibilityState={{ busy: true }}`.
- `mobile/src/screens/MistakeBookScreen.tsx:208`: each per-deck title has
  `accessibilityRole="header"`, like the page title, so rotor navigation can jump between decks
  (WCAG 1.3.1).
- Tests: `mobile/tests/integration/mistakeBookScreen.test.tsx` › "announces the loading state and
  marks each deck title as a header". It holds the deck read open to check the loading props,
  then checks that the headers are exactly `['Mistake Book', 'AWS SAA', 'C# Interview']`.
