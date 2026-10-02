# F01 — r24 review fixes: domain progress (#654)

Fix round for D02 (Progress by domain). JS-only, OTA-safe. No frozen file, package or native change.
I checked each finding against the code before changing anything.

### d-correctness-1
Status: fixed

Confirmed: `DomainProgressScreen` caught every `loadRows` error as `'missing'` and called `setLoaded` with no
condition, so a failed read on refocus replaced rows that had loaded with the "Open this pack in the Library
first" empty state.

Fix: a failed load sets a separate `failed` flag and leaves `loaded` alone. The screen shows an inline error
(`domain-progress-error`, "Couldn't load your progress just now.") with a "Try again" button
(`domain-progress-retry`) above any rows already shown. `'missing'` now only comes from `getCachedDeck`
returning null. A successful reload clears the error.

- Files: `mobile/src/screens/DomainProgressScreen.tsx`
- Tests: `mobile/tests/integration/domain-progress.screen.test.tsx`: "keeps the rows on screen when a reload on
  focus fails, with an inline error and retry" and "shows an error with retry, not the deck-missing empty state,
  when the first load fails". Both failed on the base.

### d-correctness-2
Status: fixed

Confirmed: `openDomains` used `loadActiveDeckSlug()` whenever it was non-null and never checked that the deck
resolved. The drawn-deck and Library fallbacks only ran when no slug was stored.

Fix (supervisor item 2): new `mobile/src/features/domains/domainProgressDeck.ts`
`resolveDomainProgressSlug()` returns the active deck only when `getCachedDeck` resolves it, else the first
installed deck (`listInstalledDeckEntries`, sorted by slug), else null. If the active deck read throws, it moves
on to the installed list. More resolves the slug on mount and on every focus and hides the row when the result
is null. The row navigates straight to `DomainProgress { slug }`, so the Library fallback is gone. The helper
reads its sources through guarded dynamic imports, the same way `deckCache` reads its scope. This keeps
`deckRepository` out of the module graph of the many suites that render MoreScreen. If an import or read fails,
the row is hidden.

- Files: `mobile/src/features/domains/domainProgressDeck.ts` (new), `mobile/src/screens/MoreScreen.tsx`
- Tests: `mobile/tests/unit/domainProgressDeck.test.ts` (new). In `mobile/tests/integration/more.screen.test.tsx`:
  "skips an active deck that is not installed for the first installed deck", "uses the first installed deck when
  no active deck is stored" and "hides the Progress by domain row when no deck is installed". All three failed on
  the base. `mobile/tests/integration/mistake-entry-points.test.tsx` mocks the helper so its row-order check
  still includes the domain row. The old test "falls back to a drawn deck, then the Library" pinned the behaviour
  this finding replaces, so the new cases took its place.

### d-tests-1
Status: fixed

Confirmed: the navigation mock's `addListener` dropped the focus callback, so no test exercised the reload on
focus. The behaviour itself was already correct, so the new test passed on the base. This finding was a
coverage gap, not a defect.

- Files: `mobile/tests/integration/domain-progress.screen.test.tsx`
- Test: "reloads the counts on every focus and unsubscribes on unmount". It captures the focus listener, marks
  `r1` as learned, fires focus and checks that `domain-counts-d2` reads "1 of 2 learned · 0 mastered". It then
  checks that the unsubscribe function runs exactly once on unmount.

### d-tests-2
Status: fixed

Confirmed: the D02 Library test ran with no active mistakes, so `library-mistakes-pill` never rendered next to
`library-domains-link`.

- Files: `mobile/tests/integration/library.screen.test.tsx`
- Test: "shows the Mistakes pill and the By domain link in one row, each opening its own screen". It seeds an
  active mistake for `csharp` through the real `recordMistakeOutcome`, then checks that both pills render and
  share the same host row View. Pressing each one navigates to `MistakeBook { slug: 'csharp' }` and
  `DomainProgress { slug: 'csharp' }` respectively. Mutation check: hiding the Mistakes pill whenever
  `onOpenDomains` is set makes this test fail.

## Notes updated

`docs/delivery/r24-issues/D02-notes.md`: the More row rule (it overclaimed a fallback that only ran when no slug
was stored), the error state, and the test list.
