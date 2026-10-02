# F02 — r24 review fixes: offline first run (round r24x, wave o)

Fixes ledger for issue #655. I checked each finding against the code before acting on it. For each real defect, a test that fails on the base comes first, then the fix. For the test-quality findings, I tightened the test and checked it with a mutation of the code it guards.

### o-correctness-1

Status: fixed

- Confirmed. `main()` wrote each `<slug>.starter.json` inside the loop and checked the 300 KB limit only after it. A failure in the size check, a later slug's validation or a fetch left new packs next to the old `index.ts`.
- Fix: `buildStarterPacks()` (exported; the CLI entry now calls it) builds every pack and `index.ts` in memory. Only after every fetch, validation and the size check pass does it create the directory and write all four files. Fetch, output directory and log are injectable, so the test runs with no network.
- Files: `mobile/scripts/content/build-starter-packs.mjs`, `docs/delivery/r24-issues/O01-notes.md`.
- Test: `mobile/tests/unit/buildStarterPacks.test.ts`
  - Over 300 KB: every old file is left unchanged.
  - A later deck fails validation: every old file is left unchanged.
  - The success path writes three packs plus an `index.ts` naming their build.
  - All three cases failed on the base (no `buildStarterPacks` export, and the old code writes first).

### o-correctness-2

Status: fixed

- Confirmed. `listInstalledDeckEntries` set no `totalCards`, so `loadHomeDeckSummaries` (`declaredTotal`) fell back to `localCards`: 30 for a starter pack.
- Fix: a deck whose slug has a bundled pack and whose version ends in `-starter` takes `STARTER_PACKS[slug].totalCards`. Any other deck takes its installed card count.
- Files: `mobile/src/content/starterOffline.ts`.
- Tests: `mobile/tests/integration/offline-first-run.test.tsx`
  - The new case 'shelf entries carry the full deck size for a starter pack and the installed size otherwise'.
  - Test 1 now asserts that the Home summary has `totalCards: PACK.totalCards` (371) and `localCards: 30`.
  - Both failed on the base (`undefined` / 30).

### o-correctness-3

Status: fixed

- Confirmed. App's foreground `void upgradeStarterDecks()` dropped its result, and Home refreshed only from the result of its own focus run. A later focus run then returned `[]`, because no starter deck was left.
- Fix:
  - `starterOffline` exports `subscribeStarterUpgrades(listener)`. `upgradeStarterDecks` tells every listener the upgraded slugs after any run that upgraded at least one deck, whoever started it. Listener errors are isolated.
  - Home subscribes on mount through the same lazy, guarded import it already used (now shared through one cached import promise) and unsubscribes on unmount. Its focus effect still starts an upgrade, but the refresh now comes only from the listener, so a focus upgrade does not refresh twice.
  - `App.tsx` is unchanged.
- Files: `mobile/src/content/starterOffline.ts`, `mobile/src/screens/HomeScreen.tsx`, `docs/delivery/r24-issues/O02-notes.md`.
- Tests:
  - `mobile/tests/integration/home-starter-lesson.spec.tsx`, the new case 'refreshes a Home that is already showing when an upgrade started elsewhere (App on foreground) went in'. It failed on the base HomeScreen (no listener registered). This suite's `starterOffline` stand-in now mirrors the real module: it notifies listeners when a run upgrades something.
  - `beforeEach` clears the focus callbacks and listeners left by earlier tests' Home trees. Without that, `refocus()` reached stale Homes, and the old call-count assertions held only because the uncached import resolved late.
  - `offline-first-run.test.tsx` test 2 checks that a listener hears `[aws-saa-c03]` once and hears nothing about an empty run.

### o-tests-1

Status: fixed

- Confirmed. No test mounted SessionCard offline for a bundled deck that is not the lesson deck, using the real starter module and file system.
- Test: `mobile/tests/integration/offline-first-run.test.tsx`, the new case 'SessionCard keeps the plain error offline for a bundled deck that is not the lesson deck'. It sets the stage to `starter`, the goal deck to `csharp-basics` and opens `aws-saa-c03` learn-new offline. It asserts:
  - the manifest was tried;
  - no aws-saa-c03 meta exists;
  - there is no `session-card-offline-starter` and no starter notice;
  - "Deck not available" shows.
- Proof: with `&& (await isStarterLessonDeck(slugValue))` removed from `SessionCardScreen.tsx`, the case fails (`expected true to be false` on the meta assertion). It passes with the gate in place. Product code is unchanged.

### o-tests-2

Status: fixed

- Confirmed. The assertion checked the aws-saa-c03 meta key in a test that only touches `not-a-bundled-deck`.
- Test: `offline-first-run.test.tsx` test 7 now asserts that `devcards:content:deckmeta:v2:anon:not-a-bundled-deck` is absent and that no `devcards:content:deckmeta:` key exists at all.

### o-tests-3

Status: fixed

- Confirmed. `[].every(...)` is true.
- Test: `offline-first-run.test.tsx` test 1 now asserts `expect(fetchCalls).toContain(MANIFEST_URL)` next to the `every` check. The new o-tests-1 case asserts the same.

### o-tests-4

Status: fixed

- Confirmed. I restored the pre-O02 `DrawScreen`, `LibraryScreen` and `SessionCardScreen` (merge-base with `origin/main`), kept `starterOffline`, and ran the suite:
  - Tests 1, 2, 5 and 6 fail.
  - Tests 3 and 7 pass (as does test 4 there, which exercises only `starterOffline`; that module is absent on the true base).
- Fix: `docs/delivery/r24-issues/O02-notes.md` now says that only tests 1, 2, 4, 5 and 6 failed on the base and that tests 3 and 7 are regression guards. It also lists the cases this round added.
