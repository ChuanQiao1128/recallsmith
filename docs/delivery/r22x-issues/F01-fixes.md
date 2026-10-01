# F01 — r22 review fixes: first run and home (fixes ledger)

Issue #614 · round r22x, wave h · base `delivery/r22x-h` (merged `release/r22`, b3080c5).
Every finding was checked against the code first. Each fix has a test that fails on the base and
passes after the change (checked by running the new test against the base file).

### h-correctness-1
Status: fixed

Confirmed. In stage `starter`, `ensureDeckBootstrap` and `prepareHomeDeckWallets` refuse every pack,
and only `completeStarterLesson` closed the stage. A premium goal deck went to the paywall, a
`coming` or missing deck showed an error, and with no study goal and no active deck Home offered no
lesson. In every case the stage stayed `starter`. The repo seed does list `csharp-basics` as
`'premium'` (`src_C/Vpc/Db/Migrations/005_decks_manifest_v2.sql:179`), so the scenario is real.

Fix: the lesson now has a way out. `skipStarterLesson()` (new, `starter/starterLesson.ts`) sets the
stage to `done`, drops the lesson record and arms the reminder prompt. It grants nothing itself, so
the ordinary first-visit bootstrap pays on the next Home, Draw or Library open, as it did before R22.
It runs when:
- SessionCard finds the lesson's deck is premium and locked (paywall or trial preview), before the
  paywall opens (`SessionCardScreen.tsx`, premium branch);
- SessionCard finds the lesson's deck cannot be studied: `availability: 'coming'`, or a manifest
  that loaded but has no download for the deck (catch block, `failure === 'unavailable'`);
- Home is in stage `starter` with no study goal and no active deck (`HomeScreen.tsx`, starter focus
  effect). Home then re-prepares the wallets.
`isStarterLessonDeck(slug)` (new, `starter/starterGate.ts`) scopes these checks to the lesson's own
deck: the recorded lesson, otherwise the deck `ensureStarterLesson` would record.

A failed download (no manifest at all, `checkManifestForUpdates` throws, or install fails) keeps the
lesson open with the offline copy and Retry. That is the offline first run H02 designed for.

Files: `mobile/src/features/gacha/starter/starterLesson.ts`, `mobile/src/features/gacha/starter/starterGate.ts`,
`mobile/src/screens/SessionCardScreen.tsx`, `mobile/src/screens/HomeScreen.tsx`.
Tests: `tests/integration/session-card-starter.screen.test.tsx` › "a premium goal deck ends the lesson before
the paywall…", "a goal deck that is not published yet…", "a goal deck missing from a manifest that did load…",
"keeps the lesson open and the offline copy when the goal deck download itself fails";
`tests/integration/home-starter-lesson.spec.tsx` › "ends a lesson that has no deck to teach…";
`tests/unit/starterLesson.test.ts` › "skipping a lesson that cannot run…", "knows which deck the open lesson teaches".

Not done here: the live production manifest tier for `aws-saa-c03`, `claude-ccdv-f` and
`csharp-basics` could not be checked from this worktree (no production access in this round). With
the fix, a premium or unpublished goal deck no longer locks the economy. The learner just gets no
starter lesson. Owner check below.

### h-security-1
Status: fixed

Same root cause as h-correctness-1 (no exit from `starter`), and the same fix covers it. The
reviewer's paths: premium goal deck → paywall (lesson closed first; tested); trial preview of the
lesson deck → lesson closed by the same premium branch (`premiumDeck && !premiumActive`, before the
trial/paywall split; no separate test);
`Deck not found` from a manifest without the deck → plain error, lesson closed; offline copy only
for a real download failure on the lesson's deck (see h-correctness-2). No Settings change was added
(out of scope). The skip is automatic, so no "Skip lesson" link was needed.
Files and tests: as h-correctness-1.

### h-tests-1
Status: fixed

Confirmed. With 0 due cards, a locked draw and `newToday > 0`, the header read *All caught up for
now* while the hero read *A few new cards are ready*. With a run in progress the hero read *Today's
cards are in progress* under the same header. Fix: *Caught up* / *All caught up for now* only sit
over a hero that says the learner is clear (`statusKind` `nothing_to_learn` or `today_full_clear`).
Every other hero gets no subtitle. Due cards (*N cards waiting today*) and a ready draw keep their
matching lines.
Files: `mobile/src/screens/HomeScreen.tsx`.
Tests: `tests/integration/home.screen.test.tsx` › "keeps the header in agreement with the hero when only new
cards are left and pulls are spent" (due=0/new>0/locked), "…while today is in progress" (today_partial),
"says caught up in the header only when the hero says the learner is clear" (nothing_to_learn), using
the shared `expectHeaderAgreesWithHero` check. H03 notes corrected.

### x-interfaces-1
Status: fixed

Confirmed: `session-card-starter.screen.test.tsx` failed on the merged ref (`No instances found` at
`Reveal answer`). The test now follows the merged flow: 5 × *Got it* (`learning-study-got-it`, no
event recorded), then the 5 recall checks in study order (*Reveal answer* → *Remembered*). Before
each check it asserts wallet 0 and no `replace`. After the 5th check it asserts Draw
`{ slug: 'csharp', rewardPending: true }`, wallet 3, stage `done`, prompt armed and `owned` `[]`. It
also asserts one `recordReviewEvent` per check with `reviewStage: 'learning_check'` and rating `hard`.
H02 notes updated ("Rating the 5th lesson card" → the 5th recall check).
Files: `mobile/tests/integration/session-card-starter.screen.test.tsx`, `docs/delivery/r22-issues/H02-notes.md`.

### h-correctness-2
Status: fixed

Confirmed. The catch block showed the *Can't download your first lesson* copy for any error on any
deck while the lesson was open. Now the load records why it failed (`'download'` or
`'unavailable'`), and the starter copy shows only when the failing deck is the lesson's deck
(`isStarterLessonDeck`) and the failure is a download failure. `Coming soon` and `Deck not found`
keep the original *Deck not available* error (and close the lesson, per h-correctness-1). Another
deck keeps its own error and leaves the lesson open.
Files: `mobile/src/screens/SessionCardScreen.tsx`.
Tests: `tests/integration/session-card-starter.screen.test.tsx` › "another deck that fails during the lesson
keeps its own error, not the first-lesson copy", plus the "not published yet" / "missing from a manifest"
cases; the existing "explains an offline first run and recovers on Retry" still passes.

### h-correctness-3
Status: fixed

Confirmed: `finish()` used `try/finally` with no `catch`. A failed write was an unhandled rejection
with no message, and `setSaving(false)` ran after `replace`. Now a failed write shows *Couldn't save
your choice. Please try again.* (`goal-finish-error`) under *Finish setup*, and the button works
again. Every write is idempotent, so a retry redoes them all. On success the screen calls
`replace('Home')` and makes no state update after it.
Files: `mobile/src/screens/AudienceSurveyScreen.tsx`.
Tests: `tests/integration/onboarding.screen.test.tsx` › "tells the learner when Finish setup could not save,
and lets them retry". On the base it fails with an assertion and the unhandled `disk full` rejection.

### h-tests-2
Status: fixed

Confirmed: the default fixture has 3 due cards, so the old `firstDrawCoach` branch could never
render and the assertion was vacuous. The test now uses the state the old branch rendered in: 0 due
cards on every deck, a locked draw and new cards on the selected deck. It asserts that *Tap your pack
to begin* is absent, that the hero is *A few new cards are ready*, and that the header agrees with
the hero. Restoring the old branch (or the old *All caught up for now* fallback) fails it.
Files: `mobile/tests/integration/home.screen.test.tsx`.

### h-tests-3
Status: fixed

Confirmed: the `useFocusEffect` mock fired each callback once. The mock now records the mounted
focus callbacks, and `refocus()` runs them again (a second focus without a remount). The test
re-focuses Home after the first automatic navigation and asserts that `sessionCalls()` still has
length 1. Removing `!starterAutoStartedRef.current` makes it fail (checked).
Files: `mobile/tests/integration/home-starter-lesson.spec.tsx`. H02 note wording fixed ("once per mount").

### h-tests-4
Status: fixed

Confirmed: the exam countdown test built the date key from the real clock. It now runs at a fixed
local noon (`vi.useFakeTimers({ toFake: ['Date'] })` + `vi.setSystemTime(new Date(2026, 9, 2, 12))`),
pins the key (`2026-10-14`) and restores the real timers in `finally`.
Files: `mobile/tests/integration/home.screen.test.tsx`.

### supervisor-1
Status: fixed

Confirmed: `ensureDeckBootstrap` returned 0 for a pack that was already bootstrapped or had any
owned uid, even if every one of those uids had left the deck. Fix (`rewards/deckWallet.ts`):
- If the first-visit path does not apply and the pack's wallet is empty, the pack qualifies for a
  one-time re-bootstrap when it has no `rebootstrappedAtMs[slug]` mark and the learner holds at
  least one card (`drawState.owned` ∪ learned progress) but none of them is in the current card list.
- The current card list is read through the non-frozen `content/deckCache.getCachedDeck`, with a
  guarded dynamic import. `deckRepository.ts` is untouched.
- The deck read happens outside the wallet lock. The grant re-checks the empty wallet and the mark
  under the lock, then writes the pulls and `rebootstrappedAtMs[slug]` in one record write.
- The first-visit mark `bootstrappedAtMs` is unchanged. Anon→account adoption carries the new mark.
- A pack is never re-bootstrapped when one held uid is still in the deck, when the deck can't be
  read, or when nothing is held.
- The record field is optional and is only written when used, so existing records and the tests that
  pin them are unchanged.

Tests: `tests/unit/deckWallet.test.ts` › "re-bootstrap after a content replacement":
- owned `[c-001, c-002]` vs deck `[net-types-01, …]`, wallet 0, already bootstrapped → grants 3 once;
  the second call grants 0.
- Learned progress counts as held.
- One live uid (owned or learned) → 0.
- Wallet not empty, deck missing, or nothing held → 0.
- The brand-new learner path is unchanged.

## Owner steps

- Check the production manifest tier and availability of the three goal decks (`aws-saa-c03`,
  `claude-ccdv-f`, `csharp-basics`). The repo seed lists `csharp-basics` as premium. With F01 a premium
  or unpublished goal deck no longer locks the economy, but those learners get no starter lesson.
  Publishing the goal decks as free is still the intended setup (contract §3/§4).

## Gates

- `F01.verify.sh`: pass.
- `cd mobile && npx tsc --noEmit`: pass.
- `cd mobile && npx vitest run tests/unit tests/integration`: pass (266 files, 1913 tests at the
  supervisor-1 commit).
