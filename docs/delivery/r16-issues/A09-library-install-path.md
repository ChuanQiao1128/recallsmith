# A09 — library-install-path: Library never throws "Deck is not installed yet"

Issue: I2 — an uninstalled deck routes to the install action instead of the error state.
Wave: r16 Wave A (Home). Branch base: `delivery/r16-a-home`. Timeout: 40 min. Deps: none.

## Context

`LibraryScreen.refresh()` (`mobile/src/screens/LibraryScreen.tsx:85-129`) resolves the current slug with
`resolveDeckBySlug` and, when that returns `null`, throws `'Deck is not installed yet. Open Deck to install or update.'`
(`LibraryScreen.tsx:104-107`), which the `catch` at `:117-126` turns into the "Library unavailable" state
(`:253-283`) whose only CTA is Retry — a dead end for a new user whose deck simply has not been downloaded yet
(`docs/home-review-and-launch-copy-2026-09-17.md` §3.1 row 3(b); `docs/release-1.6.0-plan-2026-09-19.md` row I2 and M1
exit gate "new-user path Home → Draw never hits 'Deck is not installed yet'"). `DrawScreen` already solves the same
problem inline with `resolveOrInstall` (`mobile/src/screens/DrawScreen.tsx:362-371`: resolve → `checkManifestForUpdates(false)`
→ `installDeckFromUrl(slug, remoteUrl, remoteVersion, remoteSha256)` → resolve again); the Library must take the same path,
and when the deck is genuinely not installable (no `remoteUrl` in the update map) it must show the unavailable state with
a "Go to Home" CTA instead of an opaque error.

Read first: `LibraryScreen.tsx:17` (existing `deckRepository` import), `:85-129`, `:253-283`; `DrawScreen.tsx:362-371`;
`mobile/src/content/deckRepository.ts:362-371` (`UpdateInfo`), `:460-462` (`checkManifestForUpdates(_isPremiumUser = false)`),
`:655-659` (`installDeckFromUrl(slug, url, remoteVersion, remoteSha256)`); `mobile/src/navigation/types.ts:14-22` (`Home`
params are optional, so `navigation.navigate('Home')` typechecks); the test-mock pattern in
`mobile/tests/integration/draw.screen.test.tsx:97-112` and its auto-install case at `:626-663`; the Library render
harness in `mobile/tests/integration/library-final.screen.test.tsx:1-142` (react-native / safe-area / gradient /
`useFocusEffect` / AsyncStorage / `review/storage` mocks and the `flush()` + `collectText()` helpers).

## Constraints

- Scope (only these paths may change; the third one is created):
  - `mobile/src/screens/LibraryScreen.tsx`
  - `mobile/src/features/gacha/home/deckActionResolver.ts` — **leave untouched** (see Changes §4 for why).
  - `mobile/tests/integration/library.screen.test.tsx` (new file)
- Frozen files (gacha-v7.md §2.1) — zero-diff: `mobile/src/content/deckRepository.ts`, `mobile/src/sync/progressSync.ts`,
  `mobile/src/review/model.ts`. Import from `deckRepository`; do not edit it.
- No new dependencies; no `package.json` / lockfile changes; no `npm ci`.
- **Do NOT import `deckActionResolver` (or anything that reaches `notifications/reminders` / `sync/progressSync`) into
  `LibraryScreen.tsx`.** Those modules pull `expo-notifications` / `expo-crypto` / `expo-constants` into the screen's import
  graph and would break `library-final.screen.test.tsx` and `library-360-columns.spec.tsx` at import time; both files are
  out of scope and must stay green unmodified. `LibraryScreen` already imports from `../content/deckRepository` (`:17`);
  extend that import with `checkManifestForUpdates` and `installDeckFromUrl`.
- testIDs that must keep existing exactly: `screen-library-root`, `screen-library-primary-surface`, `library-card-grid`,
  `library-empty-state`, `library-empty-cta`.
- New testIDs (exact): `library-unavailable-state` (the error-branch `centerState` View), `library-unavailable-retry`
  (the existing Retry Pressable), `library-unavailable-home-cta` (the new Go to Home Pressable).
- String literals allowed to change: the thrown message `'Deck is not installed yet. Open Deck to install or update.'` is
  removed (the substring `Deck is not installed yet` must no longer appear in `LibraryScreen.tsx`). Keep
  `'No deck available yet. Install one first.'`, `'Library unavailable'`, `'Retry'`, `'Loading your library...'` unchanged.
- New user-facing literals (exact, used verbatim by the tests):
  - `This deck is not available on this device yet.` — not installable (no `remoteUrl`)
  - `Install failed. Check your connection and retry.` — install attempted and failed / deck still unresolved
  - `Go to Home` — CTA label
- Existing tests must stay green without edits: `tests/integration/library-final.screen.test.tsx`,
  `tests/integration/library-360-columns.spec.tsx` (their `deckRepository` mocks only export `listManifestDecks` +
  `resolveDeckBySlug`; that is fine because their fixtures always resolve a deck, so the install path is never entered —
  do not restructure `refresh()` so the new exports are touched on the happy path).

## Changes required

1. `mobile/src/screens/LibraryScreen.tsx:17` — extend the existing import to
   `import { checkManifestForUpdates, installDeckFromUrl, listManifestDecks, resolveDeckBySlug } from '../content/deckRepository';`.

2. `mobile/src/screens/LibraryScreen.tsx:104-107` — replace the throw with the Draw-screen install path (same order of
   calls as `DrawScreen.tsx:362-371`, `checkManifestForUpdates(false)` exactly as Draw does):
   ```ts
   let resolvedDeck = await resolveDeckBySlug(currentSlug);
   if (!resolvedDeck) {
     const updates = await checkManifestForUpdates(false);
     const update = updates[currentSlug];
     if (!update?.remoteUrl) {
       throw new Error('This deck is not available on this device yet.');
     }
     const installed = await installDeckFromUrl(
       currentSlug,
       update.remoteUrl,
       update.remoteVersion,
       update.remoteSha256,
     ).catch(() => false);
     resolvedDeck = installed ? await resolveDeckBySlug(currentSlug) : null;
     if (!resolvedDeck) {
       throw new Error('Install failed. Check your connection and retry.');
     }
   }
   ```
   The rest of `refresh()` (`loadDeckProgress` → `resolveEffectiveOwned` → `setActiveDeckSlug` → state sets) is unchanged
   and now runs after a successful install. The `catch` block (`:117-126`) is unchanged: these two throws are the only way
   the error state is reached for an uninstalled deck. `checkManifestForUpdates` may itself throw offline — let it fall
   into the same `catch` (the body text is then whatever the error says, as today).

3. `mobile/src/screens/LibraryScreen.tsx:253-283` (error branch) — add `testID="library-unavailable-state"` to the
   `centerState` View, add `testID="library-unavailable-retry"` to the existing Retry `Pressable`, and add a second
   `Pressable` after it:
   ```tsx
   <Pressable
     style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}
     onPress={() => navigation.navigate('Home')}
     testID="library-unavailable-home-cta"
   >
     <Text style={styles.retryText} numberOfLines={1}>
       Go to Home
     </Text>
   </Pressable>
   ```
   Call `navigation.navigate('Home')` with exactly one argument (the test asserts `toHaveBeenCalledWith('Home')`).
   Reuse `styles.retryButton` / `styles.retryText`; do not add new style keys to `libraryScreenStyles` (out of scope).
   Title stays `Library unavailable`; body stays `{error ?? 'Unable to read your deck right now.'}`.

4. `mobile/src/features/gacha/home/deckActionResolver.ts` — no change. `executeDeckAction` (`:350-384`) would work for
   the install but the module imports `notifications/reminders` (`:10`) and `sync/progressSync` (`:12`) at module scope,
   which the Library's import graph must not gain (see Constraints). Do not add a helper there for this issue.

5. Create `mobile/tests/integration/library.screen.test.tsx`. Copy the mock harness from
   `library-final.screen.test.tsx:24-142` (react-native, react-native-safe-area-context, expo-linear-gradient,
   `@react-navigation/native` `useFocusEffect`, `../../src/content/activeDeck`, AsyncStorage map, `../../src/review/storage`
   with `getUserScopedKey` + `loadDeckProgress`, `flush()`, `collectText()`), but mock `../../src/content/deckRepository`
   with four exports driven by module-level fixtures (pattern from `draw.screen.test.tsx:97-112`):
   `listManifestDecks` (returns `[{ slug: 'csharp', title: 'C# Interview', availability: 'live' }]`), `resolveDeckBySlug`
   (calls a `resolveDeckFixture` function), `checkManifestForUpdates` (returns `updatesFixture`), `installDeckFromUrl`
   (returns `installDeckOkFixture`). `beforeEach` must set `IS_REACT_ACT_ENVIRONMENT`, clear the AsyncStorage map, call
   `invalidateDrawStateCache()`, reset fixtures and `vi.clearAllMocks()` / reset call counters. Mount with
   `navigation={{ navigate } as any}` and `route={{ key: 'library', name: 'Library' } as any}`. Three cases, in a
   `describe('LibraryScreen install path (I2)')`:
   - `it('installs an uninstalled installable deck instead of throwing', …)` — `resolveDeckFixture` returns `null` on the
     first call and a 3-card `csharp` deck (`Slug`, `Title`, `Locale`, `Version`, `DeckType`, `Cards[{StableUid,
     OrderInDeck, Difficulty, Question}]`) from the second call on; `updatesFixture = { csharp: { remoteUrl:
     'https://cdn.example.com/content/csharp.json', remoteVersion: 'v1', remoteSha256: null } }`; `installDeckOkFixture = true`.
     Assert: `installDeckFromUrl` mock called exactly once with `('csharp', 'https://cdn.example.com/content/csharp.json', 'v1', null)`;
     `findByProps({ testID: 'library-card-grid' })` exists; `findAllByProps({ testID: 'library-unavailable-state' })` has
     length 0; `collectText(tree)` does not contain `Library unavailable` and does not contain `Deck is not installed yet`.
   - `it('shows the unavailable state with a Go to Home CTA when the deck cannot be installed', …)` — `resolveDeckFixture`
     always `null`, `updatesFixture = {}`. Assert: `installDeckFromUrl` not called; `library-unavailable-state` present;
     text contains `This deck is not available on this device yet.` and `Go to Home`; `act(() => …props.onPress())` on
     `library-unavailable-home-cta` → `expect(navigate).toHaveBeenCalledWith('Home')`; `library-unavailable-retry` present.
   - `it('shows the unavailable state when the install fails', …)` — `resolveDeckFixture` always `null`, `updatesFixture`
     as in case 1, `installDeckOkFixture = false`. Assert: `installDeckFromUrl` called once; `library-unavailable-state`
     present; text contains `Install failed. Check your connection and retry.`; text does not contain `Deck is not installed yet`.

## Acceptance

Run from the worktree root. Each bullet is one command and is exactly what `A09.verify.sh` runs.

- `[ -f mobile/tests/integration/library.screen.test.tsx ] && cd mobile && npx vitest run tests/integration/library.screen.test.tsx tests/integration/library-final.screen.test.tsx tests/integration/library-360-columns.spec.tsx --reporter=dot` — exit 0; the new file must exist (a missing vitest filter silently matches nothing) and contributes ≥ 3 passing tests.
- `cd mobile && npm run test:typecheck` — exit 0.
- `! grep -q 'Deck is not installed yet' mobile/src/screens/LibraryScreen.tsx && grep -q 'installDeckFromUrl(' mobile/src/screens/LibraryScreen.tsx && grep -q 'checkManifestForUpdates(false)' mobile/src/screens/LibraryScreen.tsx && grep -q 'This deck is not available on this device yet.' mobile/src/screens/LibraryScreen.tsx && grep -q 'Install failed. Check your connection and retry.' mobile/src/screens/LibraryScreen.tsx && grep -q 'testID="library-unavailable-home-cta"' mobile/src/screens/LibraryScreen.tsx && grep -q 'testID="library-unavailable-state"' mobile/src/screens/LibraryScreen.tsx && grep -q 'testID="library-unavailable-retry"' mobile/src/screens/LibraryScreen.tsx && grep -q "navigate('Home')" mobile/src/screens/LibraryScreen.tsx && ! grep -q 'deckActionResolver' mobile/src/screens/LibraryScreen.tsx` — exit 0.
- `grep -q "toHaveBeenCalledWith('Home')" mobile/tests/integration/library.screen.test.tsx && grep -q 'library-unavailable-home-cta' mobile/tests/integration/library.screen.test.tsx && grep -q "'https://cdn.example.com/content/csharp.json'" mobile/tests/integration/library.screen.test.tsx && grep -q 'checkManifestForUpdates' mobile/tests/integration/library.screen.test.tsx && [ "$(grep -c "^\s*it(" mobile/tests/integration/library.screen.test.tsx)" -ge 3 ]` — exit 0.
- `BASE=$(git merge-base HEAD delivery/r16-a-home); [ -z "$(git diff --numstat "$BASE" -- mobile/src/content/deckRepository.ts mobile/src/sync/progressSync.ts mobile/src/review/model.ts mobile/src/features/gacha/home/deckActionResolver.ts mobile/package.json mobile/package-lock.json)" ] && [ -z "$( { git diff --name-only "$BASE"; git ls-files --others --exclude-standard; } | grep -v -E '^(mobile/src/screens/LibraryScreen\.tsx|mobile/tests/integration/library\.screen\.test\.tsx|docs/delivery/r16-issues/)' )" ]` — exit 0 (frozen files and `deckActionResolver.ts` untouched; nothing outside scope changed).

## DO NOT

- Do not push, do not open a PR, never target or touch `main`, do not run any deploy / `eas update` / `eas build` command.
- Do not disable, skip, delete or loosen tests; no `@ts-ignore` / `@ts-expect-error` / `eslint-disable`; do not edit
  `library-final.screen.test.tsx`, `library-360-columns.spec.tsx`, `draw.screen.test.tsx` or any other existing test.
- Do not touch the frozen files (`deckRepository.ts`, `progressSync.ts`, `review/model.ts`) or `deckActionResolver.ts`.
- Do not refactor `DrawScreen.resolveOrInstall` into a shared helper, do not add exports to `deckRepository`, do not
  change `libraryScreenStyles`, `LibraryHeader`, `libraryMapper` or `navigation/types.ts`.
- Do not change the loading-state copy, the empty-state copy/testIDs, the `!currentSlug` message, the 1.5 s focus
  debounce or the highlight/scroll logic — this issue is only the uninstalled-deck branch of `refresh()` and the error
  branch's CTAs.
- Do not pass `true` to `checkManifestForUpdates` or read premium state in the Library; Draw passes `false` and this
  issue matches Draw.
- Do not add a new dependency, a new screen, a new route, or a manifest fetch on the happy path (installed deck must
  still resolve with a single `resolveDeckBySlug` call and no `checkManifestForUpdates` call).
