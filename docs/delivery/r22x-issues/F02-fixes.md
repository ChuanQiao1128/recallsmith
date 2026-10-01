# F02 — r22 review fixes: study session (fixes ledger)

Round r22x, wave s. Base `delivery/r22x-s` (b3080c5). I checked each finding against the code first.
Each real finding got a test that failed on the base before the fix went in.

### s-correctness-1

Status: fixed

- Confirmed. On a recall check the dock used `TWO_RATING_ITEMS`, so the button read "Remembered — Normal
  gap" and VoiceOver said "Remembered, normal gap". `mapLearningCheckRating` then stored it as `hard`
  (stage 0, due in 1 day).
- Fix: `RatingBar` gets a `learningCheck` prop and a `LEARNING_CHECK_ITEMS` dock: **Forgot** *Show soon*
  (`again`) and **Remembered** *See it tomorrow* (`hard`). It ignores the four-button setting.
  `SessionCardScreen` passes `learningCheck={learningPhase === 'check'}`. `mapLearningCheckRating` stays
  as the guard that turns any rating on a check into `again` or `hard`.
- Files: `mobile/src/features/gacha/components/RatingBar.tsx`, `mobile/src/screens/SessionCardScreen.tsx`.
- Tests: `mobile/tests/unit/ratingBar.test.tsx` › "RatingBar learning-check dock" (2 cases: the wording,
  the a11y labels, and the dock winning over `fourButtons` while sending again/hard).
  `mobile/tests/integration/session-card-learning.screen.test.tsx` › "asks the check with Forgot /
  Remembered even when four rating buttons are on" now also asserts the label "Remembered, see it
  tomorrow" and that "Normal gap" does not appear.

### s-correctness-2

Status: fixed

- Confirmed. The badge read `sessionRoute[currentIndex]`, and `currentIndex` moved only on a rating.
  After a study it lagged the screen by one slot. In a mixed run (learned, learned, new; route warm-up,
  elite, boss), the study view and its check both showed "Boss check".
- Fix: the screen now indexes the badge by planner slot (`sessionDone - checksDone`, where a study uses
  its card's slot). The badge is hidden when `learningPhase !== null`, because a study view or a recall
  check is not the planned elite or boss card. The session store and `advanceSession()` are unchanged.
  Home's `completedCount` still reads them.
- Files: `mobile/src/screens/SessionCardScreen.tsx`.
- Test: `session-card-learning.screen.test.tsx` › "keeps the route role badge on its planned card across
  a study and its check". It expects rate:- → rate:Elite recall → study:- → check:-. On the base it got
  "Boss check" on the study and on the check.

### s-correctness-3

Status: fixed

- Confirmed. Y was `sessionLimit + learningCheckSlots`, and that count only grew at each Got it. A
  two-card first lesson read "Card 1 of 2", then "Card 2 of 3", then "Card 3 of 4".
- Fix: the new `projectLearningChecks()` in `mobile/src/features/gacha/study/learningRunLength.ts`
  replays the planner's deal for the run's slots when the run is planned. It uses the same
  `pickNextCard`, `excludeUids`, MCQ rotation and owned gate as the screen, and counts the new Q/A cards.
  These are the cards that will be studied and then checked.
  - While the planner still deals, the header shows `sessionLimit + max(checks queued, projected)`.
  - Once the planner's slots are used up, it shows the exact count.
  - A focus run projects 0.
  - The run's guard, the summary's `sessionLimit` and the route-complete card still use the exact
    `sessionLimit + learningCheckSlots`.
- Known limit: this is a projection. If a card rated Again comes back within the same run, the planner
  can deal differently and Y can be off until the planner slots run out. Y never falls below the checks
  already queued.
- Files: `mobile/src/features/gacha/study/learningRunLength.ts` (new), `mobile/src/screens/SessionCardScreen.tsx`.
- Tests: `session-card-learning.screen.test.tsx` › "shows the run length, checks included, from the
  first card and keeps it" (Card 1/2/3/4 of 4). It got "Card 1 of 2" on the base. Also "counts only the
  new Q/A cards in a mixed run" (Card 1 of 3 from the start). New `mobile/tests/unit/learningRunLength.test.ts`
  covers the first lesson, the limit, the planner running out, learned and MCQ cards, the MCQ kill switch
  and the owned gate.
- Pinned tests I updated for the new Y: `session-card-learning.screen.test.tsx` (Got-it case "Card 1 of 2";
  two-card case "Card 1 of 4", "Card 2 of 4") and `economy-floor.spec.tsx` (one new Q/A card →
  "Card 1 of 2").

### s-correctness-4

Status: fixed

- Partly confirmed. `buildHeroCopy` in `homeSelectors.ts` did return "Clear 1 node to keep momentum. Full
  run stays capped at 5 nodes." The finding's scenario does not happen, though: `hero.helper` is not
  rendered anywhere. The function is marked `@deprecated … never rendered on Home (HomeHero.tsx removed
  in A04)`, and nothing in `src` reads `.helper`. So S04's claim about the Home preview was accurate.
  The string was still Home copy in the view model, so I renamed it anyway.
- Fix: "Clear 1 card to keep momentum. Full run stays capped at 5 cards." `SESSION_MIN_GOAL` is
  pluralised the same way as in `sessionBuilder.ts`.
- Files: `mobile/src/features/gacha/selectors/homeSelectors.ts`, `docs/delivery/r22-issues/S04-notes.md`.
- Test: `mobile/tests/unit/sessionWords.test.tsx` › "keeps Home’s hero copy free of "node", with card
  counts pluralised". The deck fixture moved into a shared `sampleDeck()`.

### s-tests-1

Status: fixed

- Same defect as s-correctness-2. The fixture route in the learning integration test used role `core`
  with titles `Node i`, so it never checked the badge across Got it.
- Fix and test: as in s-correctness-2. `serve()` in `session-card-learning.screen.test.tsx` now takes an
  optional route, and the new case walks rate → rate → study → check with a warm-up/elite/boss route,
  asserting the header badge at each step.
- Files: `mobile/src/screens/SessionCardScreen.tsx`, `mobile/tests/integration/session-card-learning.screen.test.tsx`.

### s-tests-2

Status: fixed

- Confirmed. S01-notes said `Run X/(N+k)`, "0/1 to 1/2", "ending at 4/4" and "Header and summary words
  stay 'Run X/Y'". The comment in `session-card.screen.test.tsx` pointed at the wrong file.
- Fix:
  - S01-notes now describes the header as `Card X of (N+k)`, with check slots counted from the first card.
  - The test bullets now give the actual subtitles.
  - The deferred "Normal gap" note is closed, and the new check dock and badge rule are under Shipped
    surface.
  - S02-notes is corrected for the check dock and the device-wide probe.
  - S04-notes is corrected for the badge rule and the hero helper.
  - The test comment now points to `session-card-learning.screen.test.tsx`.
- Files: `docs/delivery/r22-issues/S01-notes.md`, `docs/delivery/r22-issues/S02-notes.md`,
  `docs/delivery/r22-issues/S04-notes.md`, `mobile/tests/integration/session-card.screen.test.tsx`.
- Test: docs only. The counts in the notes match the assertions in `session-card-learning.screen.test.tsx`.

### x-deploy-1

Status: fixed

- Confirmed. `hasAnyLearnedCard()` used `loadAllProgress()`, which reads only the current scope's
  new-schema keys. Its answer was then stored in the device-global `recallsmith:study-prefs:v1`. If a
  learner was signed out at the first read (scope `anon`), or their progress was only in legacy
  versioned keys, the probe stored `{fourButtons:false}`. That broke §6's "Existing users keep four
  buttons".
- Fix: the probe now scans every deck-progress key on the device and uses `multiGet` to find a row with
  `lastReviewedAt > 0`. The pattern `^(devcards:u:[^:]+:)?deck-progress:[^:]+(:[^:]+)?$` covers every
  user scope, the legacy versioned keys and the unscoped global keys. Unreadable or non-array values
  are skipped. The decide-once-and-store behaviour is unchanged.
- Files: `mobile/src/features/gacha/study/studyPrefs.ts`, `docs/delivery/r22-issues/S02-notes.md`.
- Tests: `mobile/tests/unit/studyPrefs.test.ts`:
  - "keeps four buttons for a user who upgrades while signed out (progress under their own sub)";
  - "counts progress still held only in legacy versioned or unscoped keys";
  - "ignores other keys and unreadable progress when deciding";
  - the two default cases now seed real progress keys.

  Pinned tests I moved to device keys: `session-card.screen.test.tsx` (existing learner; the
  stored-choice case now asserts that the stored value stands) and `settings.screen.test.tsx` (the
  AsyncStorage mock holds a learned card in another account's scope).

## Also changed

- `mobile/tests/integration/session-card-starter.screen.test.tsx`: this test already failed on the base
  b3080c5. H02's starter-lesson test rated each lesson card with Reveal → Good, but merging S01 put new
  Q/A cards on the study view first. The test now walks five Got its and then five passed checks, with
  the same wallet and Draw assertions. No product code changed for this.

## Gates

- `cd mobile && npx tsc --noEmit`: pass
- `npm run test:unit`: 193 files, 1417 tests, pass
- `npm run test:integration`: 74 files, 492 tests, pass. `home-auto-update.spec.tsx` failed once in a
  full run and passed on rerun and in isolation. It is unrelated to F02.
