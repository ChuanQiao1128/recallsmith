# D05 — SessionCardScreen MCQ branch (`session-card-mcq-branch`)

Make the 1.6.0 client render an MCQ card as MCQ: a per-card state machine in `SessionCardScreen` (stem → options → verdict), `renderAsMcq` computed in the same batch that sets a card current, three handlers plus `Next → handleRating(mapped rating)`, in-run redeal with `attemptIndex`, the planner `kindHint` on both call sites, the coach line, `SessionSummary.picks?` with its one-line summary, the flag-gated `'mcq'` capability token, one integration suite for the screen, one for the summary, one unit suite for the token and a bounded edit of the token's existing suite. Pure TS shipped as an OTA on runtimeVersion 1.6.0 (published as 1.6.1): no dependency, manifest or native change. A Q/A card, and every MCQ card under the kill switch, must render and behave exactly as on the base tree — `tests/integration/session-card.screen.test.tsx` stays untouched and green.

## Context

What the tree looks like today (`delivery/r16-d-mcq` == `main@107e2a2` plus the merged D01–D04; every line below read on 2026-09-22 on the base, where the D01–D04 files do not exist yet — their contracts are D00 §2.1–§2.4):

- **`mobile/src/screens/SessionCardScreen.tsx` (994 lines).** Imports `:1-61` (`react-native` named block `:2-10` names exactly `ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View`; planner `:37`; `sessionReviewHelpers` `:43-47`; `RatingBar` `:56`; `ReviewBody` `:57`). `type UiRating = ReviewRating;` `:65`. `isLearned` `:73-75`. State `:108-135`: `current` `:119`, `reviewing` `:120`, `showAnswer` `:121`, `sessionLimit = plannedLimit ?? routeLimit ?? 5` `:134`. Refs `:138-141` (`cardShownAtRef` `:141`, reset on uid change `:154-158`). Store hooks `:142-148` (`sessionId` `:142` lags a render behind `startSession`). `load()` `:216-401` inside the focus effect `:196-415`: resets `:221-223` (`setShowAnswer(false)` `:222`); `pickNextCard({...})` `:364-372` (first `kindHint` call site); `startSession({ sessionId: `${deckForStudy.Slug}-${now.getTime()}`, … })` `:373-378`; `setCurrent(nextCurrent)` `:382`. **The lint-directive comment at `:413`** (`react-hooks/exhaustive-deps`, the only one in any Wave D scope file) sits directly above the deps array `:414` `[isPremiumUser, mode, navigation, previewLimit, slug]` — neither line moves. `handleRating(rating: UiRating)` `:429-573`: guards `:430-433` (`!showAnswer` `:432`), `buildRatedSessionState({...})` `:438-448` (second `kindHint` call site), `recordReviewEvent({...})` `:454-467` (`reviewStage` `:463`, `dwellTimeMs` `:464`), `saveDeckProgress` `:479`, `settleRatingReward` `:480-489`, `recordRewardStep` `:490`, forecast `:495-506`, trial `:507-520`, `recordSessionRating` `:521`, `advanceSession` `:522`, the batch `:532-535` (`setCurrent(nextState.nextCurrent)` `:534`, `setShowAnswer(false)` `:535`), reminders `:536-539`, end of run `:540-569`: Settlement `:541-553`, `navigation.replace('SessionSummary', {...})` `:555-568` with `...(nextLoadForecast ? { loadForecast: nextLoadForecast } : {})` `:567`, `useSessionStore.getState().sessionId` `:556`. Render: `requestPause` `:666-671`; `const ratingDockHeight = 164 + Math.max(insets.bottom, 8);` `:672`; header `:688-705`; `SessionProgressHeader` `:706`; forecast `:707-711`; `ScrollView testID="screen-session-card-primary-surface"` `:712-774` (`paddingBottom: ratingDockHeight` `:717`); route-complete card `:731-765` (Continue navigations `:743-758`); `<ReviewBody card rank faceUp onFlip />` `:767-772`; dock `{current ? (` `:775` … `testID="review-rating-dock"` `:783` … `<RatingBar testID="review-rating-bar" disabled={reviewing || !showAnswer} revealed={showAnswer} onRate={(rating) => void handleRating(rating)} />` `:785-790` … `) : null}` `:792`. `styles.ratingDock` `:975-990`.
- **`mobile/src/screens/SessionSummaryScreen.tsx` (570 lines).** Imports `:1-19`; params destructured `:46` (`…, reward, loadForecast }`); `buildSessionSummaryVM({...})` `:102-113`; the forecast line `:262-266` (`<Text testID="session-summary-load-forecast" numberOfLines={2} style={styles.forecastLine}>`), followed by `SummaryProgressBlock` `:268`.
- **`mobile/src/navigation/types.ts` (209 lines).** `SessionSummary` `:191-204`; `loadForecast?: string;` `:203` is the last field before `};` `:204`.
- **`mobile/src/sync/clientCapabilities.ts` (79 lines, not frozen).** Comment `:14` reserves this issue ("Wave D appends 'mcq' when flags.mcq.enabled at call time"); `CLIENT_FEATURES: readonly string[] = []` `:15`; `normalizeClientFeatures` `:25-33`; `getClientCapabilities()` `:62-75` computes `normalizeClientFeatures(CLIENT_FEATURES)` at `:68`. The push envelope (`progressSync.ts:1487`, `:1500`) carries whatever this returns; `progressSync.ts` is frozen and is not touched.
- **`mobile/src/config/featureFlags.ts` (127 lines, not edited).** `FeatureFlags.mcq` `:5-11`; defaults `enabled: true, recallFirst: true, maxPerRun: 2, answerTelemetry: false` `:22-27`; `getFeatureFlags()` `:53-55`; `applyRemoteFeatures` `:63-116`; rule `:57-62`: read once at the moment of use.
- **Patterns you copy, not import.** `import * as RN from 'react-native'` + `readRN(key, fallback)` (`HomeScreen.tsx:11`, `:48-57`) for `AccessibilityInfo`; `announceForAccessibility?.(…)` (`DrawCeremonyScreen.tsx:523`); `loadExpoHaptics()` (`mobile/src/components/ceremonyHaptics.ts:45-51`, `ExpoHapticsLike` `:27-33`: `notificationAsync(NotificationFeedbackType.Success | Warning | Error)`).
- **Consumed unchanged.** `sessionStore.recordRating` `sessionStore.ts:60-64` (streak on hard/good/easy); `settleRatingReward` `sessionRewards.ts:127` (R1 pays on `rating !== 'again'`); `mapRatingToNumber` `progressSync.ts:224-237` (any unknown string → 3 = good, which is why only a `ReviewRating` ever reaches `handleRating`); `ReviewRating` `model.ts:2`; `CardProgress` `model.ts:4-27` (`hardStreak?` `:16`); `pickWith` honours `avoidUid` first then ignores it (`sessionPlanner.ts:108-129`), so an `again` card can be re-dealt in the same run.
- **Test harnesses you copy.** `tests/integration/session-card.screen.test.tsx` (974 lines, untouched): `react-native` factory mock `:5-40` (exactly `View, Text, ScrollView, ActivityIndicator, Pressable, Animated, useWindowDimensions, Alert, StyleSheet`), module mocks `:42-183` (`CodeBlock` `:63-69`, `deckRepository` `:71-84`, `review/storage` `:91-95`, `progressSync` `:101-105`, `sessionReviewHelpers` `:117-128`, `reviewContentHelpers` `:130-140`, `sessionPlanner` `:142-159`, `sessionRewards` `:161-183`), `flush` `:193-198`, `findPressableByLabel` `:200-206`, `findTextByLabel` `:208-210`, `buildDeck` / `buildChallengeRoute` `:212-238`, `beforeEach` `:244-256`, the exact Q/A `SessionSummary` param pin `:297-307`, the dock pin `:536-573`, `byTestID` `:889-890`. `tests/integration/paywall.screen.test.tsx:137-140` (the `featureFlags` factory mock). `tests/unit/deckRepositoryTopic.test.ts:17-34` (Map-backed AsyncStorage mock). `tests/integration/session-summary.screen.test.tsx` (`:1-97` harness, `:484-569` the forecast-line case whose `baseParams` and host-node order probe you reuse; `:112-122` passes no `picks`). `tests/unit/clientCapabilities.test.ts` (140 lines): `it('never sends undefined-valued keys'` `:92`, `it('ships no feature tokens in Wave C'` `:100`; `:42-54`, `:56-62` re-import the module after `vi.resetModules()`; `:64-67`, `:69-81` pin `toEqual({ updateId: 'abc-def' })` / `toEqual({})`.
- Typecheck: `mobile/tsconfig.json` is `strict: true`; `npm run test:typecheck` (`mobile/package.json:11`) covers `tests/`. vitest 4.1.5 (`vi.useFakeTimers({ toFake: ['Date'] })` is supported). `react-test-renderer` `mobile/package.json:67`.

What D00 decided (binding; `docs/delivery/r16-issues/D00-contracts.md`): §0 (`:11-27`) OTA-only, the three frozen files, no scheduler change, rating events byte-identical, flags read once, kill-switch semantics, do-not-touch list, the `.Mcq` reader allow-list (four files at this point in the queue, §6 #19), the mock-safety import rule; §1.1 (`:36-62`, D05 rows `:51-54`, tests `:62`); §2.2 (`:133-252`) the pure D02 API and `MCQ_COPY` / `MCQ_TEST_IDS`; §2.3 (`:256-285`) `buildKindHint` / `noteServedCard`; §2.4 (`:287-342`) the three components and `mcqCoachPrefs`; **§2.5 (`:344-392`) this issue's state, handlers, render and `picks`/token**; §3.5 (`:455-470`) the test contracts; §4 (`:484-495`, D05 row `:492`) deps = **D03, D04**; §5 (`:499-514`) verify conventions; §6 #4 (`:521`), #7 (`:524`), #8 (`:525`), #15 (`:532`), #16 (`:533`), #17 (`:534`), #18 (`:535`).

Doc drift, stated so nobody re-derives it: plan §6.1 (`docs/mcq-card-type-plan-2026-09-18.md:333-337`) names `mcqPhase`, `selectedKeys`, `firstPickKeys`, `pickChanged`, `mcqServedThisRunRef`, `lastNewKindRef` — D00 §2.5.1 renames them (`stage`, `picks`, `firstPicks`, `changedPick`, one `mcqRunRef: McqRunState`) and D00 wins. Plan §6.5 `:401-512` / §6.6 `:479-508` / `handleRating :396` are stale (D00 §6 #15): the tree has `:438-572`, `:540-568`, `:429`. Plan §6.6 lets `picks` be derived from `sessionRatings`; D00 §6 #7 makes it a screen ref (`landed` = submits whose verdict ≠ wrong), which is what this brief implements. The wave table row (`docs/delivery-wave-1.6-plan-2026-09-19.md:130`) lists three source files; D00 §6 #8 adds `clientCapabilities.ts`.

Gaps D00 leaves open, one place where D00 disagrees with the tree (gap 1) and one where it disagrees with itself (gap 8) — resolved here and binding for this issue:

1. **`clientCapabilities.test.ts` cannot stay "byte-identical outside the two retitled `it`s" (D00 §3.5).** On the tree four more cases pin the exact shape with `toEqual`: `:42-54` and `:56-62` (`toEqual({})` after a fresh import), `:64-67` (`toEqual({ updateId: 'abc-def' })`), `:69-81` (`toEqual({})` four times). Under the default `mcq.enabled === true` every one of them would now receive `clientFeatures: ['mcq']` and go red. Decision: the file gets a **bounded allow-listed edit** (Changes required §14): one import line, one kill-switch line in `beforeEach`, one fresh-registry kill-switch line in each of the two `vi.resetModules()` cases, the two retitles, and one explicit kill-switch line in each retitled case (as D00 asks). Every `it('…'` title of the base file other than the two retitled ones stays verbatim; no assertion changes. The verify pins the `-` lines (exactly the two old titles) and an allow-list for every `+` line. Measured 2026-09-22 in a scratch copy of `src/config`, `src/sync/clientCapabilities.ts` (with the §10 line) and this suite: untouched, 6 of 9 cases red; with the bounded edit, 9 of 9 green and the new `clientCapabilitiesMcq.test.ts` 4 of 4 green.
2. **`applyCurrent` takes the seed id as a parameter.** D00 §2.5.1 writes `applyCurrent(next)`, §6 #18 says where the id comes from. Decision: `applyCurrent(next: CurrentCardLike | null, sessionIdForSeed: string)`; `load()` passes the id it just handed to `startSession` (hoisted into a `const`), `handleRating` passes `useSessionStore.getState().sessionId ?? ''`.
3. **The coach line needs state to re-render.** D00 §2.5.1 lists `coachSeenRef: boolean | null` and says "fire-and-forget into state". A ref write does not re-render, so a read that resolves after the card's batch would surface the line only on the next interaction. Decision: `coachSeenRef` is the once-per-session latch and the last resolved value; `const [coachSeen, setCoachSeen] = useState<boolean | null>(null)` mirrors it; the render condition is `renderAsMcq && coachSeen === false`.
4. **`handleDontKnow` passes `changedPick: false` explicitly.** D00 §2.5.2 says "no `changedPick`"; a user who picked, then pressed *I don't know*, would otherwise compute `changedPick` from an empty set. Row 1 ignores it either way; the shared `settleMcq(picks, confidence, changedPick)` takes it as a parameter so the intent is literal.
5. **`MCQ_DOCK_HEIGHT = 216`.** D00 §2.5.3 leaves the number to this issue. Stacked worst case of the options stage: 8 top padding + 20 hint + 20 count + 56 + 8 + 56 (two buttons) + 44 (link) = 212. A side-by-side dock leaves blank space under the last section, which is harmless; content hidden behind the dock is not.
6. **Test 11's two call sites.** D00 §3.5 #11 says both calls carry `{ mcqAllowed: true, preferMcq: true }` "on a fresh run". With D00 §2.3's `noteServedCard`, that is true of `buildRatedSessionState` only when the first card was NOT new (a due MCQ card leaves `lastNewKind` null). Decision: test 11 serves a **due** MCQ card and asserts D00's literal on both sites, then serves a **new** MCQ card in a second render and asserts `buildRatedSessionState` carries `{ mcqAllowed: true, preferMcq: false }` — the proof that `noteServedCard` is wired.
7. **Import form of the D04 components.** D00 §2.4 pins props, not `export default` vs named; the D04 brief (`docs/delivery/r16-issues/D04-mcq-components.md:90-91`, `:152-153`, `:164-165`) exports each component both as a named function and as `export default`. Decision: default imports, like `ReviewBody` / `RatingBar` at `:56-57` (`import McqReviewBody, { type McqStage } from '../features/gacha/components/McqReviewBody';` etc.); the verify greps the module specifiers, not the import form.
8. **The `reviewStage` literal may occur only once.** D00 §2.5.2 spells `reviewStage: isLearned(current.progress) ? 'repeat_review' : 'first_review'` inside the `mapMcqVerdictToRating` input, while D00 §5 (and the verify) require that exact string, with its trailing comma, to occur exactly once in the file — the `recordReviewEvent` line `:463`. Decision: `settleMcq` binds `const reviewStage = isLearned(current.progress) ? 'repeat_review' : 'first_review';` (TS infers the literal union) and passes the shorthand `reviewStage,`. Same rule, one literal.
9. **Deterministic clock.** `sessionId` is `${slug}-${now.getTime()}`, so the shuffle seed of test 10 depends on the wall clock. The suite fakes `Date` only (`vi.useFakeTimers({ toFake: ['Date'] })` + `vi.setSystemTime(FIXED_NOW_MS)` in `beforeEach`, `vi.useRealTimers()` in `afterEach`); timers stay real so `readMcqCoachSeen`'s 250 ms guard and the `flush` microtasks behave. `responseMs` is then 0 unless a case advances the clock.

## Read first

1. `docs/delivery/r16-issues/D00-contracts.md` §0 (`:11-27`), §1.1 (`:36-62`), §2.2 (`:133-252`), §2.3 (`:256-285`), §2.4 (`:287-342`), §2.5 (`:344-392`), §3.5 (`:455-470`), §5 (`:499-514`), §6 #4, #7, #8, #15–#18 (`:521`, `:524-525`, `:532-535`).
2. `mobile/src/screens/SessionCardScreen.tsx` — whole file (994 lines); you edit it and nothing you do may move `:413`.
3. The D01–D04 files as merged: `mobile/src/features/gacha/mcq/normalizeMcq.ts`, `mcqConstants.ts`, `mcqVerdict.ts`, `mcqShuffle.ts`, `mcqRotation.ts`, `mcqCoachPrefs.ts`; `mobile/src/features/gacha/components/McqReviewBody.tsx`, `McqActionDock.tsx`, `McqCoachLine.tsx` (their export form decides your import lines).
4. `mobile/src/screens/SessionSummaryScreen.tsx:1-19`, `:46`, `:255-270`; `mobile/src/navigation/types.ts:176-209`.
5. `mobile/src/sync/clientCapabilities.ts` (whole, 79 lines); `mobile/src/config/featureFlags.ts:1-62`.
6. `mobile/src/screens/HomeScreen.tsx:1-57` (the `readRN` pattern), `mobile/src/components/ceremonyHaptics.ts:25-51`.
7. `mobile/tests/integration/session-card.screen.test.tsx:1-310`, `:536-573`, `:871-905` (the harness, the param pin, the dock pin, `byTestID`).
8. `mobile/tests/integration/session-summary.screen.test.tsx:1-97`, `:484-569`; `mobile/tests/unit/clientCapabilities.test.ts` (whole, 140 lines); `mobile/tests/integration/paywall.screen.test.tsx:137-140`; `mobile/tests/unit/deckRepositoryTopic.test.ts:17-34`.
9. `docs/mcq-card-type-plan-2026-09-18.md:172-254` (the two fixture cards — the ONLY MCQ text this issue may quote, besides `content/decks/*.md`), `:276-329` (§5), `:331-361` (§6.1–6.7).

## Constraints

- **Scope (the ONLY files that may change):**
  `mobile/src/screens/SessionCardScreen.tsx`, `mobile/src/screens/SessionSummaryScreen.tsx`, `mobile/src/navigation/types.ts` (one field), `mobile/src/sync/clientCapabilities.ts`, `mobile/tests/integration/session-card-mcq.screen.test.tsx` (new), `mobile/tests/integration/session-summary-picks.screen.test.tsx` (new), `mobile/tests/unit/clientCapabilitiesMcq.test.ts` (new), and the bounded edit of `mobile/tests/unit/clientCapabilities.test.ts` (Changes required §14). Nothing else — in particular none of the D01–D04 files, no new file under `mobile/src/features/gacha/mcq/` or `components/`.
- **Frozen files (gacha-v7 §2.1, narrowed by C00 §0 and D00 §0):** `mobile/src/content/deckRepository.ts`, `mobile/src/sync/progressSync.ts`, `mobile/src/review/model.ts` are zero-diff (D01 holds Wave D's only exception; this issue has none). Also untouched: `mobile/src/review/storage.ts`, `mobile/src/content/chunkedInstall.ts`, `mobile/src/features/gacha/planner/*`, `mobile/src/features/gacha/session/*`, `mobile/src/features/gacha/rewards/*`, `mobile/src/features/gacha/components/ReviewBody.tsx`, `RatingBar.tsx`, the three `Mcq*.tsx`, `mobile/src/features/gacha/mcq/*`, `mobile/src/config/*`, `mobile/src/types/deckExport.ts`, `mobile/src/features/gacha/contracts.ts`, `mobile/tests/setup/*`, `mobile/vitest.config.ts`, `mobile/tsconfig.json`.
- **OTA rule (D00 §0):** no change to `mobile/package.json`, `mobile/package-lock.json`, `mobile/app.json`, `mobile/eas.json`; no new dependency, no native module, no `npm install`. `"expo-updates": "~29.0.15"`, `"vite": "7.2.4"` and `"version": "1.6.0"` stay as they are. No `@sentry`, no static `expo-updates` or `expo-haptics` import.
- **No scheduler / progress / event change.** MCQ answers reach `handleRating(rating: UiRating)` (`:429`, signature unchanged) as one of the four `ReviewRating`s through `mapMcqVerdictToRating`. The `recordReviewEvent({...})` call `:454-467` is byte-identical (no `-` line touches `recordReviewEvent`, `reviewStage:`, `dwellTimeMs:`, `statedDifficulty:`, `cardRevision:`, `progressAfter:`); `reviewStage: isLearned(current.progress) ? 'repeat_review' : 'first_review',` occurs exactly once. No new `eventType`, no `answer` payload, `answerTelemetry` is never read. No `attemptIndex`, `verdict`, `confidence`, `picks` or `kind` field on `CardProgress`, the session store, `SessionRatingRecord` or `RatingRewardInput`.
- **Flags are read once at the moment of use** (`getFeatureFlags()`, never `useFeatureFlags()` in this screen): in `applyCurrent` (same batch as `setCurrent`) and in the two `kindHint` expressions. `featureFlags.ts`, `remoteConfig.ts`, `forceUpdateGate.ts` and `tests/unit/featureFlags.test.ts` are not edited.
- **`card.Mcq` is not read here.** The screen calls `resolveMcq(next.card, flags)`; no added line under `mobile/src` contains `.Mcq` (D00 §0 reader allow-list — after D03 it is `deckExport.ts`, `deckRepository.ts`, `normalizeMcq.ts`, `planner/sessionPlanner.ts`, and D05 adds nothing; the verify greps it).
- **Mock-safety import rule (D00 §2.4, §5).** The `react-native` named import block `:2-10` is byte-identical; the only new `react-native` line is `import * as RN from 'react-native';`. `AccessibilityInfo` comes from `readRN('AccessibilityInfo', null)`; `Platform`, `Vibration` are never imported. Haptics go through `loadExpoHaptics()`. No new named import from `../features/gacha/planner/sessionPlanner` or `../features/gacha/session/sessionReviewHelpers` (both factory-mocked at `session-card.screen.test.tsx:117-128`, `:142-159`; their import statements stay byte-identical). `buildKindHint`, `noteServedCard`, `EMPTY_MCQ_RUN_STATE` come from `../features/gacha/mcq/mcqRotation` (D00 §6 #4).
- **The lint-directive comment `:413` and the deps array `:414` do not move, re-indent or change** (a `+` line carrying that comment fails the driver's diff-scoped suppression scan; a wider deps array re-fires `load()` every render). `applyCurrent` reads only refs, setters, `getFeatureFlags()` and pure functions, so the stale closure inside `load()` is harmless.
- **testIDs / copy (pinned by D00 §2.2 `MCQ_TEST_IDS` / `MCQ_COPY`; copy always comes from `MCQ_COPY` and the `mcq*` formatters, never a re-typed string; the two screen-level testIDs this issue writes — `testID="review-rating-bar"` on `McqActionDock` and `testID="session-summary-picks"` on the summary line — are written as the literal JSX attribute because the verify greps the attribute, exactly as `RatingBar` and `session-summary-load-forecast` are written today):** dock View `review-rating-dock` (unchanged), `McqActionDock testID="review-rating-bar"`, coach line `mcq-coach-line` / `mcq-coach-dismiss`, summary line `session-summary-picks`; the body/dock testIDs (`mcq-show-options`, `mcq-option-<key>`, `mcq-submit-sure`, `mcq-submit-unsure`, `mcq-dont-know`, `mcq-next`, `mcq-stem`, `mcq-kind-chip`, `mcq-stem-hint`, `mcq-show-full-stem`, `mcq-selected-count`, `mcq-over-limit-hint`, `mcq-verdict-banner`, `mcq-schedule-line`, `mcq-why-<key>`, `mcq-redeal-banner`) belong to D04 and are asserted by your tests as they are. Copy asserted by the tests: `Multiple choice`, `Choose 2`, `Correct`, `Not this time`, `You knew 1 of 2`, `1 of 2 selected`, `2 of 2 selected`, `Deselect one first`, `Reveal answer` (Q/A), `3 of 5 picks landed`, `0 of 5 picks landed — they're all back in 10 minutes`.
- **Banned literals in any new/changed line and in this brief:** the six terms of B00 §0 (driver gate, case-insensitive). Use "sidestep", "work around", "guard", "fallback", "probe". None of the five suppression tokens of C00 §0 in any diff (the pre-existing one at `:413` is the only one allowed in the whole file, and it is not a `+` line).
- **Existing tests:** `tests/integration/session-card.screen.test.tsx`, `tests/integration/session-summary.screen.test.tsx`, `tests/unit/ratingBar.test.tsx`, `tests/unit/reviewBody.test.tsx`, `tests/unit/session-store.test.ts`, `tests/unit/sessionRewards.test.ts`, `tests/unit/featureFlags.test.ts`, `tests/unit/progressSyncEnvelopeBytes.test.ts`, `tests/unit/planner.test.ts` and every D01–D04 suite are byte-identical and green. The ONLY existing test file that changes is `tests/unit/clientCapabilities.test.ts`, exactly as §8 below.
- Never copy ExamTopics / SAA-C03 dump content. Fixture text comes from plan §4.3 (`:177-253`, uids `aws-sqs-order-buffer-mcq-01` and `aws-s3-compliance-copy-mcq-02`) — original cards.
- Any explicit component return type is `React.JSX.Element` (or omitted), never `JSX.Element` (C00 §6 #23).
- Standing rules: no `git push`, no PR, never touch `main`, no EAS / expo / deploy command, no npm/git activity outside your worktree.

## Changes required

1. **`mobile/src/screens/SessionCardScreen.tsx` — imports (added lines only; nothing removed or reordered).** Directly after the `react-native` block (`:10`): `import * as RN from 'react-native';`. With the other project imports, in this order after `:57` (`ReviewBody`):
   ```ts
   import { getFeatureFlags } from '../config/featureFlags';
   import { loadExpoHaptics } from '../components/ceremonyHaptics';
   import type { McqExport, McqOption } from '../types/deckExport';
   import { mcqRequiredCount, resolveMcq } from '../features/gacha/mcq/normalizeMcq';
   import { MCQ_COPY, mcqBannerPartial } from '../features/gacha/mcq/mcqConstants';
   import {
     describeScheduledRating,
     mapMcqVerdictToRating,
     resolveMcqVerdict,
     type McqConfidence,
     type McqVerdict,
   } from '../features/gacha/mcq/mcqVerdict';
   import { mcqSeed, shownOrderFor } from '../features/gacha/mcq/mcqShuffle';
   import { buildKindHint, EMPTY_MCQ_RUN_STATE, noteServedCard, type McqRunState } from '../features/gacha/mcq/mcqRotation';
   import { markMcqCoachSeen, readMcqCoachSeen } from '../features/gacha/mcq/mcqCoachPrefs';
   ```
   plus the three components as default imports (gap 7): `import McqReviewBody, { type McqStage } from '../features/gacha/components/McqReviewBody';`, `import McqActionDock from '../features/gacha/components/McqActionDock';`, `import McqCoachLine from '../features/gacha/components/McqCoachLine';`. The verify greps every module specifier above with `-F`.

2. **Module-level additions** (after `EMPTY_TRIAL_INFO` `:71`, before `isLearned`):
   ```ts
   // Vitest supplies react-native without AccessibilityInfo — guarded lookup so tests don't crash (HomeScreen.tsx pattern).
   function readRN<T = any>(key: string, fallback: T): T {
     try {
       const value = (RN as any)[key];
       return (value ?? fallback) as T;
     } catch {
       return fallback;
     }
   }
   const AI: any = readRN('AccessibilityInfo', null);
   // Options-stage dock, stacked worst case: 8 + hint 20 + count 20 + 56 + 8 + 56 + link 44 = 212 (D05 gap 5).
   const MCQ_DOCK_HEIGHT = 216;
   type McqCardState = {
     mcq: McqExport | null;               // resolveMcq(card, getFeatureFlags()) — null ⇒ renderAsMcq false
     stage: McqStage;                     // 'stem' when flags.mcq.recallFirst !== false, else 'options'
     shownOrder: McqOption[];             // shownOrderFor(mcq, mcqSeed(sessionId, StableUid, attemptIndex))
     picks: string[];
     firstPicks: string[] | null;         // the first COMPLETE set (length === requiredCount); set once
     changedPick: boolean;                // submitted set ≠ firstPicks (as sets)
     confidence: McqConfidence | null;
     verdict: McqVerdict | null;
     mappedRating: ReviewRating | null;
     scheduleLine: string | null;
     attemptIndex: number;
   };
   const EMPTY_MCQ_CARD_STATE: McqCardState = {
     mcq: null, stage: 'stem', shownOrder: [], picks: [], firstPicks: null, changedPick: false,
     confidence: null, verdict: null, mappedRating: null, scheduleLine: null, attemptIndex: 0,
   };
   function sameSet(a: readonly string[], b: readonly string[]): boolean {
     if (a.length !== b.length) return false;
     const set = new Set(a);
     return b.every((key) => set.has(key));
   }
   function mcqHaptic(kind: 'success' | 'warning' | 'error'): void {
     try {
       const haptics = loadExpoHaptics();
       if (!haptics) return;
       const name = kind === 'success' ? 'Success' : kind === 'warning' ? 'Warning' : 'Error';
       Promise.resolve(haptics.notificationAsync(haptics.NotificationFeedbackType[name])).catch(() => {});
     } catch {
       // device mechanism only; never reaches a test or a user without the native module
     }
   }
   ```
   The verify greps `const MCQ_DOCK_HEIGHT = 216;`, `type McqCardState = {`, `const EMPTY_MCQ_CARD_STATE: McqCardState`, `function sameSet(`, `function mcqHaptic(`, `readRN('AccessibilityInfo', null)`.

3. **State and refs** (inside the component, directly after `showAnswer` `:121`):
   ```ts
   const [mcqState, setMcqState] = useState<McqCardState>(EMPTY_MCQ_CARD_STATE);
   const renderAsMcq = mcqState.mcq !== null;
   const [coachSeen, setCoachSeen] = useState<boolean | null>(null);
   ```
   and with the refs after `cardShownAtRef` `:141`:
   ```ts
   const optionsShownAtRef = useRef(0);
   const submittedAtRef = useRef(0);
   const attemptIndexRef = useRef<Map<string, number>>(new Map());   // StableUid → serves so far this run
   const mcqRunRef = useRef<McqRunState>(EMPTY_MCQ_RUN_STATE);
   const picksRef = useRef<{ landed: number; answered: number }>({ landed: 0, answered: 0 });
   const coachSeenRef = useRef<boolean | null>(null);                 // null = not read yet; latch + last value (gap 3)
   ```
   Exact lines the verify greps: `const [mcqState, setMcqState] = useState<McqCardState>(EMPTY_MCQ_CARD_STATE);`, `const renderAsMcq = mcqState.mcq !== null;`, `const [coachSeen, setCoachSeen] = useState<boolean | null>(null);`, `const mcqRunRef = useRef<McqRunState>(EMPTY_MCQ_RUN_STATE);`.

4. **`applyCurrent` — the ONE helper that replaces the bare `setCurrent` at `:382` and `:534`** (component-scoped, declared before the focus effect that holds `load()`):
   ```ts
   function applyCurrent(next: CurrentCardLike | null, sessionIdForSeed: string): void {
     const flags = getFeatureFlags();
     const mcq = next ? resolveMcq(next.card, flags) : null;
     if (next) {
       const uid = next.card.StableUid;
       const attemptIndex = attemptIndexRef.current.get(uid) ?? 0;
       attemptIndexRef.current.set(uid, attemptIndex + 1);
       mcqRunRef.current = noteServedCard(mcqRunRef.current, next.progress, mcq !== null);
       if (mcq !== null && coachSeenRef.current === null) {
         coachSeenRef.current = true;               // latch: one read per session; "seen" until the read says otherwise
         void readMcqCoachSeen().then((seen) => {
           coachSeenRef.current = seen;
           setCoachSeen(seen);
         });
       }
       setCurrent(next);
       if (mcq !== null) {
         const stage: McqStage = flags.mcq.recallFirst !== false ? 'stem' : 'options';
         if (stage === 'options') optionsShownAtRef.current = Date.now();
         setMcqState({
           ...EMPTY_MCQ_CARD_STATE,
           mcq,
           stage,
           shownOrder: shownOrderFor(mcq, mcqSeed(sessionIdForSeed, uid, attemptIndex)),
           attemptIndex,
         });
         return;
       }
     } else {
       setCurrent(null);
     }
     setMcqState(EMPTY_MCQ_CARD_STATE);
   }
   ```
   A card re-dealt after `again` gets `attemptIndex 1`, a fresh order and D04's redeal banner. Call sites: `:382` becomes `applyCurrent(nextCurrent, nextSessionId);` where `const nextSessionId = `${deckForStudy.Slug}-${now.getTime()}`;` is declared directly before `startSession({...})` and `:374` becomes `sessionId: nextSessionId,`; `:534` becomes `applyCurrent(nextState.nextCurrent, useSessionStore.getState().sessionId ?? '');`. `load()` additionally resets, next to `:221-223`: `setMcqState(EMPTY_MCQ_CARD_STATE); setCoachSeen(null); attemptIndexRef.current = new Map(); mcqRunRef.current = EMPTY_MCQ_RUN_STATE; picksRef.current = { landed: 0, answered: 0 }; coachSeenRef.current = null;`. The other `setCurrent(null)` sites (`:197`, `:207`, `:359`, `:391`) are unchanged — nothing MCQ renders without `current`.

5. **Kind hint on both planner call sites.** Inside the `pickNextCard({...})` object `:364-372` and the `buildRatedSessionState({...})` object `:438-448`, one added line each, verbatim: `kindHint: buildKindHint(mcqRunRef.current, getFeatureFlags()),` (the verify counts it exactly twice). Nothing else about those two calls changes.

6. **Handlers** (component-scoped, after `handleRating`; `handleRating` itself changes only at `:534` and `:438-448` as above):
   - `function handleShowOptions(): void` — `if (mcqState.stage !== 'stem') return; optionsShownAtRef.current = Date.now(); setMcqState((prev) => ({ ...prev, stage: 'options' }));`
   - `function handleToggleOption(key: string): void` — `const mcq = mcqState.mcq;` returns unless `mcq && mcqState.stage === 'options' && !reviewing`. `const n = mcqRequiredCount(mcq)`. Single (`n === 1`): `next = [key]`. Multi: if `picks.includes(key)` remove it; else if `picks.length >= n` return (D04's body already showed `Deselect one first` and called `onOverLimit`); else append. Then `firstPicks = prev.firstPicks ?? (next.length === n ? next : null)` and `setMcqState({ ...prev, picks: next, firstPicks })`.
   - `function settleMcq(picks: string[], confidence: McqConfidence, changedPick: boolean): void` — `const mcq = mcqState.mcq;` guards `current && mcq && mcqState.stage === 'options' && !reviewing`. `const verdict = resolveMcqVerdict(picks, mcq); const responseMs = Date.now() - optionsShownAtRef.current; const reviewStage = isLearned(current.progress) ? 'repeat_review' : 'first_review'; const mappedRating = mapMcqVerdictToRating({ verdict, confidence, changedPick, responseMs, optionCount: mcqState.shownOrder.length, reviewStage, stage: current.progress.stage, hardStreak: current.progress.hardStreak ?? 0 }); const scheduleLine = describeScheduledRating(current.progress, mappedRating, new Date()).line;` — then in ONE synchronous batch `setMcqState((prev) => ({ ...prev, stage: 'verdict', picks, confidence, changedPick, verdict, mappedRating, scheduleLine })); setShowAnswer(true);` then `submittedAtRef.current = Date.now(); mcqHaptic(verdict === 'correct' ? 'success' : verdict === 'partial' ? 'warning' : 'error');` and `AI?.announceForAccessibility?.(`${banner}. ${scheduleLine}.`)` where `banner` is `MCQ_COPY.bannerCorrect` / `mcqBannerPartial(k, n)` / `MCQ_COPY.bannerWrong` with `k` = number of `picks` whose option is `correct` and `n = mcqRequiredCount(mcq)`.
   - `function handleSubmit(confidence: McqConfidence): void` — `const mcq = mcqState.mcq; if (!mcq || mcqState.picks.length !== mcqRequiredCount(mcq)) return; settleMcq(mcqState.picks, confidence, mcqState.firstPicks !== null && !sameSet(mcqState.picks, mcqState.firstPicks));`
   - `function handleDontKnow(): void` — `settleMcq([], 'unsure', false);` (row 1 → `again`).
   - `function handleMcqNext(): void` — `const mappedRating = mcqState.mappedRating; if (mcqState.stage !== 'verdict' || !mappedRating) return; picksRef.current = { answered: picksRef.current.answered + 1, landed: picksRef.current.landed + (mcqState.verdict !== 'wrong' ? 1 : 0) }; if (coachSeen === false) handleCoachDismiss(); void handleRating(mappedRating);`
   - `function handleCoachDismiss(): void` — `coachSeenRef.current = true; setCoachSeen(true); void markMcqCoachSeen();`
   The verify greps `function handleShowOptions(`, `function handleToggleOption(`, `function settleMcq(`, `function handleSubmit(`, `function handleDontKnow(`, `function handleMcqNext(`, `function handleCoachDismiss(`, `void handleRating(mappedRating);`, `resolveMcqVerdict(`, `mapMcqVerdictToRating({`, `describeScheduledRating(`, `announceForAccessibility?.(`.

7. **Render.**
   a. `:672` becomes exactly `const ratingDockHeight = (renderAsMcq ? MCQ_DOCK_HEIGHT : 164) + Math.max(insets.bottom, 8);`.
   b. The `ReviewBody` mount `:767-772` becomes a ternary on `mcqState.mcq`: when non-null `<McqReviewBody card={current.card} mcq={mcqState.mcq} rank={rankMapRef.current.get(current.card.StableUid) ?? null} stage={mcqState.stage} shownOrder={mcqState.shownOrder} picks={mcqState.picks} verdict={mcqState.verdict} scheduleLine={mcqState.scheduleLine} attemptIndex={mcqState.attemptIndex} onToggleOption={handleToggleOption} onOverLimit={() => mcqHaptic('warning')} />`, else the existing `<ReviewBody … />` byte-identical. Nest this ternary inside the existing else branch of `{!current ? (…) : (…)}` (`:731-773`) so the route-complete card is not re-indented — the verify rejects any added `SessionCardScreen.tsx` line containing `numberOfLines`, `allowFontScaling` or `maxFontSizeMultiplier`.
   c. Between `</ScrollView>` `:774` and `{current ? (` `:775`: `<McqCoachLine visible={renderAsMcq && coachSeen === false} onDismiss={handleCoachDismiss} />` (D04 renders null when `!visible`, so it is mounted in all three stages and never for Q/A).
   d. Inside the dock View (`:776-791`; its `testID="review-rating-dock"` and style stay), the `RatingBar` mount `:785-790` becomes a ternary on `mcqState.mcq`: when non-null `<McqActionDock testID="review-rating-bar" stage={mcqState.stage} requiredCount={mcqRequiredCount(mcqState.mcq)} selectedCount={mcqState.picks.length} disabled={reviewing} isLastNode={sessionLimit > 0 && sessionDone + 1 >= sessionLimit} onShowOptions={handleShowOptions} onSubmit={handleSubmit} onDontKnow={handleDontKnow} onNext={handleMcqNext} />`, else the existing `<RatingBar … />` byte-identical (so `testID="review-rating-bar"` appears exactly twice in the file).
   e. `SessionSummary` navigation `:555-568`: one added line after the `loadForecast` spread `:567`, verbatim: `...(picksRef.current.answered > 0 ? { picks: { ...picksRef.current } } : {}),`. The Settlement branch `:541-553` and the route-complete Continue navigations `:743-758` are untouched (`session-card.screen.test.tsx:297-307` pins the Q/A shape without `picks`).
   f. Header, `SessionProgressHeader`, forecast line, trial preview, route-complete card, styles: untouched. No time estimate anywhere (plan §6.7).

8. **`mobile/src/navigation/types.ts`** — inside `SessionSummary`, directly after `loadForecast?: string;` (`:203`), one field (a one-line `/** … */` comment above it is allowed):
   ```ts
       picks?: { landed: number; answered: number };
   ```
   Zero removed lines; the verify requires every added line to be that field or a comment.

9. **`mobile/src/screens/SessionSummaryScreen.tsx`** — `import { mcqPicksLine } from '../features/gacha/mcq/mcqConstants';` with the feature imports (`:8-15`); `picks` joins the destructuring at `:46` after `loadForecast`; directly under the forecast block (`:262-266`, before `SummaryProgressBlock` `:268`):
   ```tsx
   {picks ? (
     <Text testID="session-summary-picks" numberOfLines={2} style={styles.forecastLine}>
       {mcqPicksLine(picks)}
     </Text>
   ) : null}
   ```
   `buildSessionSummaryVM` (`:102-113`), `summaryMapper.ts` and every other line are untouched.

10. **`mobile/src/sync/clientCapabilities.ts`** — `import { getFeatureFlags } from '../config/featureFlags';` at the top; `:68` becomes
    ```ts
        const features = normalizeClientFeatures(
          getFeatureFlags().mcq.enabled ? [...CLIENT_FEATURES, 'mcq'] : CLIENT_FEATURES,
        );
    ```
    `CLIENT_FEATURES` stays `[]` (`:15`), `MAX_CLIENT_FEATURES`, `normalizeClientFeatures`, `readUpdateId`, the cache and `resetClientCapabilitiesForTests` are unchanged. Rewording the comments at `:4-6` / `:14` is allowed, nothing else.

11. **`mobile/tests/integration/session-card-mcq.screen.test.tsx` (new).** Copy `session-card.screen.test.tsx:1-238` (the `react-native` factory mock verbatim, every module mock, `flush`, `findPressableByLabel`, `findTextByLabel`, `buildDeck`, `buildChallengeRoute`) and add:
    - `const featureFlagsMock = vi.hoisted(() => vi.fn());` + `vi.mock('../../src/config/featureFlags', () => ({ useFeatureFlags: () => featureFlagsMock(), getFeatureFlags: () => featureFlagsMock() }));` with a `flags(overrides)` helper returning `{ mcq: { enabled: true, recallFirst: true, maxPerRun: 2, answerTelemetry: false, ...overrides }, paywall: { hidden: false }, ceremony: { seamOfLight: true, forceFallback: false } }`; `beforeEach` sets `featureFlagsMock.mockReturnValue(flags())`.
    - `const store = new Map<string, string>();` + `vi.mock('@react-native-async-storage/async-storage', …)` as `deckRepositoryTopic.test.ts:20-34` (`getItem`, `setItem`, `removeItem`, `getAllKeys`, `multiRemove`); `store.clear()` in `beforeEach`.
    - `const FIXED_NOW_MS = Date.UTC(2026, 8, 22, 9, 0, 0);` `beforeEach`: `vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(FIXED_NOW_MS);` `afterEach`: `vi.useRealTimers();`.
    - Helpers: `byTestID(tree, id)` = host nodes (`typeof node.type === 'string'`) with that `testID`; `press(tree, id)` = `byTestID(tree, id)[0].props.onPress()` inside `act` + `flush()`; `mount(params?)` as `session-card.screen.test.tsx:872-886` returning `{ tree, navigation }`; `serve(card, progress)` = `vi.mocked(resolveDeckBySlug).mockResolvedValue(buildDeck({ Cards: [card] }) as any); vi.mocked(pickNextCard).mockReturnValue({ card, progress });` plus `loadDeckProgress` resolving `[progress]`; `renderedOrder(tree)` = the `key` suffix of every `mcq-option-<key>` host node in tree order.
    - Fixtures, PG key order (`v, options[{ key, why, text, correct }], shuffle, qualifier`): `CARD_1` = plan §4.3 card 1 (`StableUid: 'aws-sqs-order-buffer-mcq-01'`, `Difficulty: 2`, 4 options, `b` correct, `why: null` on `b`, `qualifier: 'LEAST operational overhead'`, `shuffle: true`); `CARD_2` = card 2 (`StableUid: 'aws-s3-compliance-copy-mcq-02'`, `Difficulty: 3`, 5 options, `a` and `c` correct, `qualifier: null`); `CARD_LONG` = `CARD_1` with option `b`'s text replaced by a 481-character string built from plan §4.3's own answer sentence (`'…'.repeat(6).slice(0, 481)`, asserted `toHaveLength(481)`); `NEW_PROGRESS(uid)` = `{ stableUid: uid, stage: 0, nextReviewAt: 0 }`; `DUE_PROGRESS(uid)` = `{ stableUid: uid, stage: 1, lastReviewedAt: FIXED_NOW_MS - 86_400_000, nextReviewAt: FIXED_NOW_MS - 1, hardStreak: 0 }`; `REPEAT_PROGRESS(uid)` = the same with `stage: 2`. Route: `limit: 1` unless stated; the dock's Next button then reads `Finish run` — press it by testID `mcq-next`.
    - Cases, titles verbatim:
      1. `it('renders the stem stage first with recall-first on', …)` — `serve(CARD_1, NEW_PROGRESS)`; `mcq-kind-chip` text `Multiple choice`; `mcq-stem-hint` present; one `mcq-show-options`; zero nodes whose `testID` starts with `mcq-option-`; exactly one `View` `review-rating-dock`, one `View` `review-rating-bar`, one `ScrollView` `screen-session-card-primary-surface`, one `SafeAreaView` `screen-session-card-root`; no `Reveal answer` Pressable.
      2. `it('answers a single-choice card correctly and rates it good on first review', …)` — show options → `press('mcq-option-b')` → `press('mcq-submit-sure')` → `mcq-verdict-banner` text `Correct`, `mcq-schedule-line` present, `mcq-next` present → press it → `recordReviewEvent` called with `expect.objectContaining({ rating: 'good', reviewStage: 'first_review' })`, `settleRatingReward` with `expect.objectContaining({ rating: 'good' })`, `navigation.replace('SessionSummary', expect.objectContaining({ picks: { landed: 1, answered: 1 }, streakEarned: true }))`, `useSessionStore.getState().streakEarned === true`.
      3. `it('rates a wrong pick again and reports zero landed picks', …)` — `a` → `press('mcq-submit-unsure')` → banner `Not this time`, `mcq-why-a` present (auto-expanded WHY), → Next → `rating: 'again'`, `picks: { landed: 0, answered: 1 }`, `streakEarned: false`.
      4. `it("rates I don't know as again without a pick", …)` — show options → `press('mcq-dont-know')` without any pick → banner `Not this time`, no `mcq-why-b` (the correct option has no WHY) → Next → `rating: 'again'`, `picks: { landed: 0, answered: 1 }`.
      5. `it('skips the stem stage when recallFirst is off', …)` — `flags({ recallFirst: false })` → after mount `mcq-option-b` present, zero `mcq-show-options`, `mcq-submit-sure` present.
      6. `it('renders the card as Q/A under the kill switch', …)` — `flags({ enabled: false })` with `CARD_1` → `findPressableByLabel(tree, 'Reveal answer')` exists; zero host nodes whose `testID` starts with `mcq-`; `pickNextCard` called with `expect.objectContaining({ kindHint: null })`; Reveal → `Good` → `navigation.replace('SessionSummary', { sessionId: expect.any(String), slug: 'csharp', deckTitle: 'C# Interview', sessionDone: 1, sessionLimit: 1, minimumGoal: 1, dueCount: 0, streakEarned: true, reward: expect.any(Object) })` — the exact object, no `picks`.
      7. `it('walks a choose-two card: count, over-limit hint, partial verdict, hard', …)` — `serve(CARD_2, NEW_PROGRESS)`; `mcq-kind-chip` text `Choose 2`; show options → every `mcq-option-*` has `accessibilityRole === 'checkbox'`; `mcq-submit-sure` and `mcq-submit-unsure` have `disabled === true`; press `a` → `mcq-selected-count` text `1 of 2 selected`; press `b` → `2 of 2 selected`, both submits `disabled === false`; press `d` → count still `2 of 2 selected`, `mcq-over-limit-hint` text `Deselect one first`; `press('mcq-submit-sure')` → banner `You knew 1 of 2` → Next → `rating: 'hard'`, `streakEarned: true`, `picks: { landed: 1, answered: 1 }`.
      8. `it('never truncates the stem or an option under Dynamic Type', …)` — `serve(CARD_LONG, NEW_PROGRESS)`; stem stage: `mcq-stem` `numberOfLines` undefined; show options: `mcq-stem` `numberOfLines === 3`, `press('mcq-show-full-stem')` → undefined; the 481-character text appears as a `Text` child inside `mcq-option-b` and every `Text` under any `mcq-option-*` other than `mcq-option-letter-*` has `numberOfLines` undefined; after `b` → Sure: `mcq-stem` undefined again; no node in the tree has `allowFontScaling === false`.
      9. `it('gives good, not easy, to a changed pick on repeat review and easy to a fast unchanged one', …)` — `serve(CARD_1, REPEAT_PROGRESS)`; show options → `a` then `b` → `vi.setSystemTime(FIXED_NOW_MS + 3_000)` → Sure → Next → `rating: 'good'`, `reviewStage: 'repeat_review'`; unmount, `vi.clearAllMocks()`, re-serve, fresh mount → show options → `b` → `vi.setSystemTime(FIXED_NOW_MS + 3_000)` → Sure → Next → `rating: 'easy'`.
      10. `it('re-deals an again card with a new order and the redeal banner', …)` — route `limit: 2` (`planChallengeRoute` mock and params); `serve(CARD_1, NEW_PROGRESS)`; `buildRatedSessionState` mocked once to return `nextCurrent: { card: CARD_1, progress: { ...NEW_PROGRESS, stage: 0, lastReviewedAt: FIXED_NOW_MS, nextReviewAt: FIXED_NOW_MS + 600_000, lapses: 1 } }`, `nextDone: 1`; first serve: zero `mcq-redeal-banner`, `renderedOrder(tree)` equals `shownOrderFor(normalizeMcq(CARD_1.Mcq)!, mcqSeed(sessionId, CARD_1.StableUid, 0)).map(o => o.key)` (import the real `mcqShuffle` / `normalizeMcq`; `sessionId = useSessionStore.getState().sessionId!`); pick `a` → Not sure → Next; second serve: one `mcq-redeal-banner`, `renderedOrder` equals the `attemptIndex 1` order, and the two expected orders differ (deterministic under the fixed clock; if D02's hash makes them coincide for this `FIXED_NOW_MS`, change the constant, not the assertion).
      11. `it('passes a kind hint to the planner on both call sites', …)` — `serve(CARD_1, DUE_PROGRESS)` → answer `b` → Sure → Next: `pickNextCard` and `buildRatedSessionState` each called with `expect.objectContaining({ kindHint: { mcqAllowed: true, preferMcq: true } })`; then `vi.clearAllMocks()`, `serve(CARD_1, NEW_PROGRESS)`, fresh mount, same flow: `buildRatedSessionState` called with `expect.objectContaining({ kindHint: { mcqAllowed: true, preferMcq: false } })` (gap 6).
      12. `it('shows the coach line once and marks it seen on Next', …)` — `store` empty; after mount + `flush()` one `mcq-coach-line`; answer `b` → Sure → Next → `store.get('recallsmith:mcq:coach-seen:v1') === '1'`; fresh mount → zero `mcq-coach-line`; then `store.clear()`, fresh mount, `press('mcq-coach-dismiss')` → key `'1'` and zero `mcq-coach-line`.
    - The suite imports `normalizeMcq` from `../../src/features/gacha/mcq/normalizeMcq` and `mcqSeed`, `shownOrderFor` from `../../src/features/gacha/mcq/mcqShuffle` (both pure, unmocked). ≥ 12 `it(` blocks.

12. **`mobile/tests/integration/session-summary-picks.screen.test.tsx` (new).** Copy `session-summary.screen.test.tsx:1-97` (mocks, `getTextContent`, `ONE_NEW_CARD_REWARD`) and the `baseParams` of `:486-496`. Cases, titles verbatim:
    1. `it('renders the picks line under the forecast line', …)` — params `{ ...baseParams, loadForecast: LINE, picks: { landed: 3, answered: 5 } }` → one `Text` `session-summary-picks` with text `3 of 5 picks landed` and `numberOfLines === 2`; host-node testID order `['summary-reward-block', 'session-summary-load-forecast', 'session-summary-picks', 'summary-progress-block']`.
    2. `it('spells out the ten-minute return when no pick landed', …)` — `picks: { landed: 0, answered: 5 }` → text `0 of 5 picks landed — they're all back in 10 minutes`.
    3. `it('renders no picks line for a Q/A run', …)` — `baseParams` alone → zero `session-summary-picks` nodes.

13. **`mobile/tests/unit/clientCapabilitiesMcq.test.ts` (new).** `vi.mock('expo-updates', () => ({ updateId: null }))`; imports `applyRemoteFeatures` from `../../src/config/featureFlags` and `CLIENT_FEATURES`, `getClientCapabilities`, `normalizeClientFeatures`, `resetClientCapabilitiesForTests` from `../../src/sync/clientCapabilities`; `beforeEach` resets the cache and applies `applyRemoteFeatures(null)`. Cases, titles verbatim:
    1. `it('advertises mcq under the default flags', …)` — `toEqual({ clientFeatures: ['mcq'] })`.
    2. `it('sends no clientFeatures key under the kill switch', …)` — `applyRemoteFeatures({ features: { mcq: { enabled: false } } })` → `toEqual({})`, `'clientFeatures' in caps === false`.
    3. `it('reads the flag at call time and keeps CLIENT_FEATURES empty', …)` — kill switch → `{}`; `applyRemoteFeatures(null)` → `{ clientFeatures: ['mcq'] }` on the same module instance; `CLIENT_FEATURES` `toEqual([])`.
    4. `it('still sorts, dedupes and caps the token list', …)` — `normalizeClientFeatures(['MCQ ', 'mcq', 'zeta', 'alpha'])` → `['alpha', 'mcq', 'zeta']`; 20 valid tokens → length 16.

14. **`mobile/tests/unit/clientCapabilities.test.ts` (bounded edit, gap 1).** Exactly these changes and nothing else:
    - after the import block `:19-24`: `import { applyRemoteFeatures } from '../../src/config/featureFlags';`
    - in `beforeEach`, after `resetClientCapabilitiesForTests();` `:39`: `applyRemoteFeatures({ features: { mcq: { enabled: false } } });`
    - in `:42-54`, directly before `const mod = await import(…)` `:48`, and in `:56-62`, directly after `vi.resetModules();` `:58`: `(await import('../../src/config/featureFlags')).applyRemoteFeatures({ features: { mcq: { enabled: false } } });`
    - `:92` retitled `it('never sends undefined-valued keys under the kill switch', async () => {` and `:100` retitled `it('ships no feature tokens beyond the flag-gated mcq token', async () => {`, each gaining `applyRemoteFeatures({ features: { mcq: { enabled: false } } });` as its first statement.
    The diff therefore removes exactly the two old `it(` lines, and every added line (trimmed) is one of: the import line, the `applyRemoteFeatures({ features: { mcq: { enabled: false } } });` line, the `(await import('../../src/config/featureFlags')).applyRemoteFeatures(…)` line, or one of the two new `it(` lines. No assertion changes; every other `it('…'` title of the base file is still present verbatim.

Estimated size: SessionCardScreen ~+190 lines / −3, SessionSummaryScreen +7, types.ts +1–2, clientCapabilities +3 / −1, tests ~520 + ~90 + ~60 lines, clientCapabilities.test.ts +8 / −2.

## Acceptance

Run from the worktree root. `docs/delivery/r16-issues/D05.verify.sh` re-runs exactly these.

1. Scope files exist: `session-card-mcq.screen.test.tsx`, `session-summary-picks.screen.test.tsx`, `clientCapabilitiesMcq.test.ts`; D01–D04 have landed (`mobile/src/features/gacha/mcq/{normalizeMcq,mcqConstants,mcqVerdict,mcqShuffle,mcqRotation,mcqCoachPrefs}.ts` and `components/{McqReviewBody,McqActionDock,McqCoachLine}.tsx` exist; `buildKindHint`, `resolveMcq`, `mapMcqVerdictToRating`, `shownOrderFor`, `mcqPicksLine`, `readMcqCoachSeen` are exported; `sessionPlanner.ts` has `kindHint?: McqKindHint | null;`).
2. Literal guards (all exit 0): `SessionCardScreen.tsx` contains every module specifier of §1, `import * as RN from 'react-native';`, the exact state/ref/constant lines of §2–§3, `function applyCurrent(`, `applyCurrent(nextCurrent, nextSessionId)`, `applyCurrent(nextState.nextCurrent, useSessionStore.getState().sessionId ?? '')`, `kindHint: buildKindHint(mcqRunRef.current, getFeatureFlags()),` exactly twice, the seven handler signatures, `void handleRating(mappedRating);`, the exact `ratingDockHeight` line, `<McqReviewBody`, `<McqActionDock`, `<McqCoachLine`, `<ReviewBody`, `<RatingBar`, `testID="review-rating-bar"` exactly twice, `testID="review-rating-dock"` once, the `picks` spread line; `reviewStage: isLearned(current.progress) ? 'repeat_review' : 'first_review',` once, `async function handleRating(rating: UiRating)` once; the `react-native` named import block and both planner-helper import statements byte-identical to base; no `-` line touches the `recordReviewEvent` fields; no `+`/`-` line carries the lint directive; no `Platform`/`AccessibilityInfo`/`Vibration` named import, no `expo-haptics`/`expo-updates` import, no `.Mcq` in any added `mobile/src` line, no `useFeatureFlags` in the screen, no added screen line with `numberOfLines` / `allowFontScaling` / `maxFontSizeMultiplier`; `types.ts` has the `picks?` field with zero removed lines and only that field (plus comments) added; `SessionSummaryScreen.tsx` has the `mcqConstants` import, `session-summary-picks`, `mcqPicksLine(picks)`; `clientCapabilities.ts` has the `featureFlags` import, `getFeatureFlags().mcq.enabled ? [...CLIENT_FEATURES, 'mcq'] : CLIENT_FEATURES`, and still `export const CLIENT_FEATURES: readonly string[] = [];`; the three new test files carry every `it('…'` title of §11–§13 (≥ 12 / ≥ 3 / ≥ 4 `it(` blocks), the featureFlags and AsyncStorage mocks, `vi.useFakeTimers({ toFake: ['Date'] })`, the two plan §4.3 uids, the coach key; `clientCapabilities.test.ts` has the two new titles, not the two old ones, every other base title, `-` lines exactly the two old titles, `+` lines within the allow-list; none of the five suppression tokens in any new file or in any `+` line of an edited file; the nine untouched suites and the D01–D04 trees are zero-diff.
3. `cd mobile && npm run test:typecheck` — exit 0.
4. `cd mobile && npx vitest run tests/integration/session-card-mcq.screen.test.tsx tests/integration/session-summary-picks.screen.test.tsx tests/unit/clientCapabilitiesMcq.test.ts tests/unit/clientCapabilities.test.ts tests/integration/session-card.screen.test.tsx tests/integration/session-summary.screen.test.tsx tests/unit/ratingBar.test.tsx tests/unit/reviewBody.test.tsx tests/unit/session-store.test.ts tests/unit/sessionRewards.test.ts tests/unit/featureFlags.test.ts tests/unit/progressSyncEnvelopeBytes.test.ts tests/unit/planner.test.ts` plus every D01–D04 suite that exists `--reporter=dot` — exit 0.
5. Scope + frozen + OTA guard (merge-base → working tree, as C07): `git diff --quiet <merge-base> -- mobile/src/content/deckRepository.ts mobile/src/sync/progressSync.ts mobile/src/review/model.ts` and the do-not-touch set of Constraints; `"expo-updates": "~29.0.15"`, `"version": "1.6.0"`, `"vite": "7.2.4"` unchanged; no `@sentry` under `mobile/src`; `grep -rln '\.Mcq\b' mobile/src` names only the four readers allowed after D03 (`types/deckExport.ts`, `content/deckRepository.ts`, `features/gacha/mcq/normalizeMcq.ts`, `features/gacha/planner/sessionPlanner.ts` — D00 §0 / §6 #19); every changed or untracked path under `mobile/src` / `mobile/tests` is one of the eight scope files (or `docs/delivery/r16-issues/*`).

## Verify

```bash
BASE=delivery/r16-d-mcq bash docs/delivery/r16-issues/D05.verify.sh
```

Runs steps 1–5 above (≈ 2–3 min; `tsc` dominates; no network). The driver then runs the full mobile root gate — `cd mobile && npm run test:typecheck && npx vitest run` — plus the diff-scoped banned-term grep and the suppression scan; all must be green, so do not leave any other suite red.

## Do NOT

- Do NOT widen `handleRating`'s parameter, add a fifth rating, touch `scheduleNextReview`, `CardProgress`, the session store, `settleRatingReward`, `recordReviewEvent`'s fields or `progressSync.ts` — the verdict becomes one of the four ratings BEFORE `handleRating`.
- Do NOT read `card.Mcq` in the screen, call `normalizeMcq` on it, or trust it — `resolveMcq(card, flags)` is the only entry (kill switch included).
- Do NOT read flags with `useFeatureFlags()` or more than once per card; do NOT edit `featureFlags.ts`, `remoteConfig.ts`, `forceUpdateGate.ts`.
- Do NOT import `AccessibilityInfo`, `Platform` or `Vibration` from `react-native`, `expo-haptics` statically, or a new name from `sessionPlanner` / `sessionReviewHelpers` — the untouched `session-card.screen.test.tsx` factory-mocks all three.
- Do NOT move, re-indent or retype the lint-directive comment at `:413` or widen the deps array `:414`.
- Do NOT put `picks` on the Settlement params, the route-complete Continue params, or the Q/A `SessionSummary` params (the spread is conditional on `answered > 0`).
- Do NOT add `numberOfLines`, `allowFontScaling={false}` or `maxFontSizeMultiplier` to anything MCQ; do NOT add a time estimate to the header.
- Do NOT edit any D01–D04 file, `ReviewBody.tsx`, `RatingBar.tsx`, or any existing test other than the bounded `clientCapabilities.test.ts` edit; do NOT change an assertion in that file.
- Do NOT quote any MCQ text other than plan §4.3 or `content/decks/*.md`; never ExamTopics / SAA-C03 dump content.
- Do NOT run `npm install`, `npm ci`, `eas …`, `npx expo …`; do NOT run npm or git inside `/Users/qc/src/recallsmith` or anywhere under `/Users/qc/Desktop` — only inside your worktree.
