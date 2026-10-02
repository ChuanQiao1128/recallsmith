# O02 — Offline first run: install the bundled starter pack, show it, upgrade online (#633)

Contract: R24-00 §2.2 (offline first run, wave o). Builds on O01 (#632, `mobile/src/content/starter/`).

## What changed (files)

- `mobile/src/content/starterOffline.ts` (new): the starter module.
- `mobile/src/screens/SessionCardScreen.tsx`:
  - On a download failure for the starter lesson's deck, loads the bundled pack.
  - Shows the offline starter notice.
- `mobile/src/screens/DrawScreen.tsx`: `resolveOrInstall` falls back to the bundled pack.
- `mobile/src/screens/LibraryScreen.tsx`: the deck load falls back to the bundled pack.
- `mobile/src/screens/HomeScreen.tsx`: calls `upgradeStarterDecks()` on every focus, and reloads Home when a deck was upgraded.
- `mobile/App.tsx`: calls `upgradeStarterDecks()` when the app returns to the foreground (`AppState` `active`).
- `mobile/src/features/gacha/home/deckActionResolver.ts`: `loadHomeDeckSummaries` falls back to the installed decks when there is no manifest and no update map.
- `mobile/src/features/gacha/starter/starterCopy.ts`: new string `offlineStarterNotice`.
- Tests:
  - `mobile/tests/integration/offline-first-run.test.tsx` (new)
  - `mobile/tests/integration/home-starter-lesson.spec.tsx` (one new test, plus a mock of the starter module)
  - `mobile/tests/unit/starterUpgradeTriggers.test.ts` (new)

`deckRepository.ts`, `progressSync.ts` and `review/model.ts` are untouched. There is no package, app.json, eas.json or native change, so the update stays OTA-safe.

## Exact surface shipped

`mobile/src/content/starterOffline.ts`:

- `ensureStarterDeckInstalled(slug): Promise<'installed-starter' | 'already-installed' | 'unavailable'>`
  - Returns `'unavailable'` when the slug has no bundled pack.
  - Returns `'already-installed'` when `getCachedDeck(slug)` finds a deck.
  - Otherwise it writes `STARTER_PACKS[slug]` as JSON to `FileSystem.cacheDirectory` (`starter-<slug>-<ms>.json`), calls `installDeckAndInvalidate(slug, fileUri, pack.version, null)`, then deletes the cache copy.
  - Concurrent calls for one slug share one install, and it never throws.
  - `expo-file-system/legacy` is loaded through a guarded dynamic import, so screen suites that do not mock the file system just get `'unavailable'`.
- `upgradeStarterDecks(): Promise<string[]>`
  - Finds each bundled slug whose installed deck has a `Version` ending in `-starter`.
  - Allows at most one attempt per slug per `STARTER_UPGRADE_BACKOFF_MS` (5 minutes, module state). The attempt is counted before the manifest fetch, so an offline attempt also counts.
  - Fetches the manifest once (`checkManifestForUpdates()`) and installs the full deck through the normal path (`installDeckAndInvalidate(slug, remoteUrl, remoteVersion, remoteSha256)`).
  - Returns the upgraded slugs. Concurrent callers share one run, and it never throws.
- `listInstalledDeckEntries(): Promise<ManifestDeckEntry[]>`
  - Builds Home's shelf without a manifest: it scans the AsyncStorage keys for the deck meta prefix `devcards:content:deckmeta:v2:` (mirrored, like `cardSource.ts`) and keeps the slugs that `getCachedDeck` resolves for the current user.
  - Entries have `availability: 'live'`, `tier: null`, and the deck's title, locale, type and version.
  - It does not seed the manifest cache (facts-offline §6).
- Helpers: `hasStarterPack`, `isStarterVersion`, `resetStarterUpgradeBackoff` (a test seam), plus the constants `STARTER_VERSION_SUFFIX` and `STARTER_UPGRADE_BACKOFF_MS`.

Screen behaviour:

- **SessionCard.** The fallback runs only for the starter lesson's deck (`isStarterLessonDeck`, per §2.2 "starter lesson load"). It runs when the load is a download failure:
  - the manifest check threw,
  - no manifest loaded, or
  - the install failed.

  It then calls `ensureStarterDeckInstalled`. On success the lesson runs from the pack, and the line "You're offline. We've loaded the first cards so you can start now." (`testID session-card-offline-starter`) shows under the header. It only shows when the pack was just installed because no deck existed for the slug.

  A slug with no pack keeps the existing "Can't download your first lesson" copy and Retry. A deck that is not published, or is missing from a manifest that did load, still ends the lesson with the plain error.
- **Draw and Library.** On the same download-failure conditions, any bundled slug installs the pack before the screen gives up. A thrown manifest error is still rethrown when there is no pack, so the existing error copy is unchanged ("No active pack yet" in Draw; "This deck is not available on this device yet." or "Install failed. Check your connection and retry." in Library).
- **Home.**
  - With an empty manifest list and an empty update map, the shelf comes from `listInstalledDeckEntries()`.
  - Every focus runs `upgradeStarterDecks()`, lazily imported and guarded. When it upgrades a deck, Home refreshes.
  - Home's existing one-per-session auto-update can also pick up a starter deck, because its version differs from the manifest. Both paths join the repository's single-flight install.
- **App.** On every return to the foreground: `void upgradeStarterDecks()`.

Progress, the owned set and the lesson record are keyed by slug and stableUid. The pack is a verbatim prefix of the live build (O01), so neither install touches them. The test checks this.

## How it is tested

Tests first. Each new test failed on the base and passes now; for each screen, I checked this by restoring the base file.

`tests/integration/offline-first-run.test.tsx` uses the real `deckRepository`, `deckCache`, starter module, wallet, draw commit, owned gate and storage. The fakes are an in-memory file system (`downloadAsync` copies `file://` sources as iOS does), in-memory AsyncStorage, and a `fetch` that throws while offline. It uses the real bundled `aws-saa-c03` pack. It covers:

1. **The fresh offline install.** Onboarding (goal step: Continue, then Finish setup) leads to SessionCard learn-new:
   - The pack is installed, the notice shows, and the offline error does not.
   - The 5 study cards are exactly `pickStarterUids(pack)`, followed by 5 checks.
   - The lesson then replaces to Draw with `rewardPending`.
   - Wallet 3 leads to Draw, then Open 1, then `DrawCeremony` with a result. The drawn card comes from the pack and is not a lesson card.
   - The owned set is updated and the wallet drops to 2.
   - Only manifest fetches were tried.
   - `loadHomeDeckSummaries` with no manifest lists the deck as studiable.
2. **The upgrade.**
   - Offline, the attempt fails, and the backoff then blocks a second attempt even once the network is back.
   - After 5 minutes the full build installs (meta buildId and card count). The lesson record, owned set and studied progress are identical before and after.
   - A further call makes no network request.
3. **Online.** The normal install wins: the meta holds the full buildId and no notice shows.
4. `ensureStarterDeckInstalled` returns `installed-starter`, then `already-installed`, then `unavailable` for an unknown slug. The cache copy is removed.
5. Draw opens the bundled pack offline when no deck is installed.
6. Library shows the bundled pack offline when no deck is installed.
7. A non-bundled slug keeps its offline error in both Library and Draw.

Other tests:

- `tests/integration/home-starter-lesson.spec.tsx`: Home calls `upgradeStarterDecks` on every focus, and reloads its shelf when the call reports an upgrade.
- `tests/unit/starterUpgradeTriggers.test.ts` checks the source of `App.tsx`. App cannot mount under Node, so the test checks that `App.tsx` imports `upgradeStarterDecks` and calls it in the `AppState` `active` branch.
- The existing starter tests are unchanged and green: `session-card-starter.screen.test.tsx`, `home-starter-lesson.spec.tsx`, `onboarding.screen.test.tsx` and `starterPacks.test.ts`.

Commands run:

- `cd mobile && npx tsc --noEmit && npx vitest run tests/integration/offline-first-run.test.tsx tests/integration/session-card-starter.screen.test.tsx tests/integration/home-starter-lesson.spec.tsx tests/unit/starterPacks.test.ts`
- `cd mobile && npx vitest run`: 274 files, 2010 tests, all passing (run twice).

## Owner steps

- None needed to ship. This is JS-only and goes out by OTA on runtime 1.9.0.
- Manual check on an iOS device is recommended:
  1. Fresh install in airplane mode, then onboarding, the lesson, the first pack and Home.
  2. Turn the network on and bring the app to the foreground (or focus Home). The deck should become the full build within one attempt, with progress kept.

## Deferred

- Android: `downloadAsync` with a `file://` source is iOS-only (facts-offline §2). On Android the starter install fails and the old offline copy shows. This is a non-goal per §8.
- Library's deck switcher still lists manifest decks only, so offline it shows no switcher entries while the bundled deck is open.
- A cached manifest whose entry has a `packagePath` makes the starter install try the chunked package first. That attempt fails on its version check, and the install then falls back to the local file. Offline it costs one failing fetch.
- `npm run test:smoke` fails with TypeScript errors in files this issue does not touch (`apiClient.ts`, `chunkedInstall.ts`, `deckRepository.ts`, `mistakeBook.ts`, plus `node_modules` type conflicts). No error points at a file changed here.
