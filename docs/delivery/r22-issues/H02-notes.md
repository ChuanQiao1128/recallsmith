# H02 — Starter lesson: a new learner learns 5 cards first; the first pack is the reward

Issue #600 · round r22, wave h · contract `R22-00-contracts.md` §1.2, §4 (and the §5 reminder copy).
Builds on H01 (#599): the goal step's choice is the lesson's deck.

## What changed (files)

| File | Change |
|---|---|
| `mobile/src/features/gacha/onboarding/onboardingPrefs.ts` | New stage `'starter'` (`welcome → audience → starter → done`); `getOnboardingStage` reads it; new `startStarterLesson()`. `completeOnboarding()` still sets `done`. |
| `mobile/src/features/gacha/starter/starterGate.ts` (new) | Lesson state, wallet-free so the wallet and the gate can both read it: `STARTER_LESSON_SIZE = 5`, `pickStarterUids` (first 5 by `OrderInDeck`, MCQ excluded via `normalizeMcq`), `isStarterLessonOpen` (stage `starter`), `ensureStarterLesson(deck)` (records `{ slug, uids }` once under `recallsmith:starter-lesson:v1`, only for the study-goal deck), `loadStarterUids(slug)`, `isStarterLessonCard`, `isStarterLessonComplete(lesson, progress)`, `clearStarterLesson`. |
| `mobile/src/features/gacha/starter/starterLesson.ts` (new) | `completeStarterLesson(slug)`: stage → `done`, drop the record, `ensureDeckBootstrap(slug)` (3 pulls), `markPermissionPromptPending()`. A no-op when the lesson is closed. |
| `mobile/src/features/gacha/starter/permissionPromptGate.ts` (new) | The one-shot reminder-prompt flag helpers moved out of the screen so the lesson can arm them without importing a screen. `PermissionPromptScreen` re-exports them, so existing imports still work. |
| `mobile/src/features/gacha/starter/starterCopy.ts` (new) | Lesson copy (Home CTA/headline, offline state). |
| `mobile/src/features/gacha/draw/effectiveOwned.ts` | Unions `loadStarterUids(slug)` into the gate at read time. Nothing is written into `drawState.owned`. |
| `mobile/src/features/gacha/rewards/deckWallet.ts` | `ensureDeckBootstrap` grants nothing (and marks nothing) while the lesson is open, for every pack. Home, Draw and Library all call it, so the rule holds whichever screen the learner opens. |
| `mobile/src/features/gacha/rewards/economyFloor.ts` | `prepareHomeDeckWallets` skips the bootstrap and the daily floor while the lesson is open. Otherwise a floor pull could land before the lesson ends and block the 3-pull bootstrap, which only pays into an empty wallet. |
| `mobile/src/features/gacha/rewards/sessionRewards.ts` | A starter card pays **no R1 pull**, whatever the rating. It is still stamped in the R1 ledger, so it counts toward R7 "learned today" and can never pay R1 later, after the lesson closes. Cards outside the lesson, other decks and stage-`done` users are paid exactly as before. |
| `mobile/src/screens/AudienceSurveyScreen.tsx` | Finishing calls `startStarterLesson()` then `replace('Home')`. `completeOnboarding`, `markPermissionPromptPending` and `{ firstDrawCoach: true }` are gone from onboarding. |
| `mobile/src/screens/HomeScreen.tsx` | In stage `starter`: once per mount (a later focus of the same Home does not repeat it), Home navigates to `SessionCard { slug: goalDeck, mode: 'learn-new' }`. The goal deck is the study goal's `deckSlug`, falling back to the active deck. After that, the single primary action (`home-starter-cta`), the hero pack and the header all point to the lesson. Stage `done` leaves Home unchanged. |
| `mobile/src/screens/SessionCardScreen.tsx` | On load: `ensureStarterLesson(deck)` before the gate is resolved. If every lesson card is already studied, it completes the lesson and opens Draw. While a missing deck installs, the loader reads **Downloading pack…**. An install or manifest failure while the lesson is open shows *Can't download your first lesson* with **Retry** (the existing button). After each rating: if the lesson is now complete, it calls `completeStarterLesson` then `replace('Draw', { slug, rewardPending: true })` instead of the summary. |
| `mobile/src/screens/PermissionPromptScreen.tsx` | Title is now *A short daily reminder to keep your reviews on time* (§5). Flag helpers are re-exported. |

## Surface shipped

1. Goal step → *Finish setup*. Stage becomes `starter` and Home opens.
2. Home goes straight into a session of the goal deck's first 5 non-MCQ cards in deck order. The learner owns nothing; the cards are studiable through the gate union only.
3. Pausing the session returns to Home: header and hero say *Learn 5 cards, then open your first pack*, and the one primary action is *Continue your first lesson*.
4. With the merged S01 learning step, each lesson card is first studied (*Got it*, no event) and then asked as a recall check at the end of the run. Answering the 5th recall check (either answer: the card is then studied) gives: stage `done`, the pack gets its bootstrap (3 pulls), the reminder prompt is armed, and **Draw** opens (`rewardPending: true`, the same entry the first-draw coach used). The first DrawResult *Done* then shows PermissionPrompt as before.
5. Net economy for a new learner is 3 pulls, as before: no R1 for the 5 lesson cards and no floor pull during the lesson.
6. Deck not installed: SessionCard downloads it first (*Downloading pack…*). Offline: *Can't download your first lesson* / *Your first lesson needs a connection to download. Connect to the internet, then tap Retry.* + Retry.
7. Existing users (stage `done`) never see the lesson: no union, no routing, bootstrap/floor/R1 unchanged.

## How it is tested

- `tests/unit/starterLesson.test.ts` (new): pick order + MCQ exclusion, goal-deck scoping, record kept across a deck update, completion predicate, `completeStarterLesson` (stage, 3 pulls, prompt armed, `owned` untouched), existing users.
- `tests/unit/effectiveOwned.test.ts`: union only while open, only on the lesson deck, never written to `owned`, gone after completion (studied cards stay through the learned term), stage `done` unaffected.
- `tests/unit/deckWallet.test.ts`: bootstrap refused (and not marked) while open; granted once by completion; second completion grants nothing; stage `done` bootstraps as before.
- `tests/unit/deckEconomyRewards.test.ts`: `prepareHomeDeckWallets` gives no bootstrap/floor during the lesson and bootstraps after it.
- `tests/unit/sessionRewards.test.ts`: no R1 for a starter card (still counted today); an `again` starter card passed after the lesson closes never pays; other cards and other decks still pay; stage `done` pays as before.
- `tests/integration/session-card-starter.screen.test.tsx` (new, real planner/gate/wallet/settle): 5 lesson cards c1..c5 (the MCQ is skipped), each *Got it* and then a *Remembered* recall check (`learning_check`, rating `hard`) → Draw, wallet 0 until the 5th check and 3 after, prompt armed, no summary. (Updated in F01 for the merged S01/S02 flow; the first version pressed *Good* and failed on the merged ref.) Also covers: completion on load, the downloading state, offline + Retry, and stage `done` showing the empty deck.
- `tests/integration/home-starter-lesson.spec.tsx` (new): lesson routing (once per mount, checked with a second focus since F01; CTA and hero resume, no Draw), active-deck fallback, existing users unaffected.
- Updated: `onboarding.screen.test.tsx` (stage `starter`, `replace('Home')`, prompt **not** armed; Splash routes `starter` to Home), `draw-result.screen.test.tsx` (test name and comment: armed by the lesson), `phase-a-milestones.screen.test.tsx` (§5 reminder copy, no "streak").

Gates: `npx tsc --noEmit` pass; `npx vitest run tests/unit tests/integration` (259 files, 1831 tests) pass;
`H02.verify.sh` pass. `npm run test:smoke` fails in this worktree with the `TS2403/TS2717` lib.dom vs
react-native globals conflicts H01 already recorded on the untouched base (they come from the worktree's
symlinked `node_modules`, not from this change).

## Owner steps

None (JS-only, OTA-safe; no package/app/eas/native change, frozen files untouched, no server change).

## Deferred / known limits

- `SplashScreen.tsx` and `navigation/types.ts` are outside this scope. Splash already sends any stage other than `welcome`/`audience` to Home, so `starter` works without changes. `Home.firstDrawCoach` is no longer passed by onboarding, but the param and its Home handling stay for compatibility (and their tests still pass).
- `LibraryScreen.tsx` (outside scope) still calls `ensureDeckBootstrap`; the guard inside it covers that path.
- A premium goal deck still hits the paywall in SessionCard as before. The three goal decks are expected to be free. This note overclaimed: nothing ended the lesson in that case. Since F01 (#614), a lesson whose deck is premium and locked, not published, missing from the manifest, or absent (no goal and no active deck) is closed by `skipStarterLesson()`, so it no longer holds every pack's bootstrap and floor. A failed download keeps the lesson open with the offline copy, and that copy now shows only for the lesson's own deck. The repo seed lists `csharp-basics` as premium (`005_decks_manifest_v2.sql:179`); see F01-fixes owner steps.
- The session header still uses the existing run copy (*Card 1 of 5* is H03/S04), and the §6 learning step arrives with wave s.
- A reinstall (stage reset to `welcome`) goes through onboarding and the lesson again. Synced progress already learned makes the lesson complete straight away (the completion-on-load path).
