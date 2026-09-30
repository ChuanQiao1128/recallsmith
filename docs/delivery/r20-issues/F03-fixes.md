# F03 — R20 review fixes: console (V09-V10)

Round R20X, wave c, issue #584. Base: `release/r20` (via `delivery/r20x-c`). Every finding was
checked against the code before it was changed. Each fix has a test that fails on the base
(checked by running the new test against the base source) and passes after the fix.

### c-correctness-1

Status: fixed

- Confirmed: `ReportsPage.tsx` said "Not shown to the learner". Contract §4 returns `resolutionNote`
  to the reporting learner on `GET /api/v1/user/card-reports`, so the copy was a false privacy promise.
- Changed: `frontend/src/pages/ReportsPage.tsx` — help text now reads "N / 500 characters. Shown to
  the learner who reported the card." (the contract is unchanged; no cross-wave change needed).
- Test: `frontend/tests/reportsPage.test.tsx` › "tells the editor the resolution note is shown to the
  learner who reported the card" pins the exact copy through the textarea's `aria-describedby`.
- Notes: `docs/delivery/r20-issues/V09-notes.md` corrected.

### c-tests-1

Status: fixed

- Confirmed: on `release/r20` the server already pins `affectedCards` and `needsHumanReview` in
  `WatchEventKeys`, and `npx vitest run tests/automationContractDrift.test.ts` failed with
  `watchEvent: server keys the console drops: expected [ 'affectedCards', 'needsHumanReview' ]`.
- Changed: `frontend/tests/automationContractDrift.test.ts` — the event gets typed values
  (`affectedCards: [<AffectedKeys card>]`, `needsHumanReview: false`); the test also reads
  `AffectedKeys`, `PossiblyAffectedKeys` and `FeedItemKeys` from `ChangeImpactTests.cs` and compares
  the normalised affected card, feed item and possibly-affected card key sets against them.
- Test: the drift test itself, "GET …/queue, …/watch and …/notifications" (green on release/r20 now;
  the whole suite, 163 files / 1498 tests, passes).
- Notes: `V10-notes.md` no longer claims the drift test "stays green"; it describes what it checks.

### c-tests-2

Status: fixed

- Confirmed: `applySuggestion()` put `String(2.7466666666666666)` into an `<input type=number
  step=0.01>`, which fails `stepMismatch`, so the browser refuses to submit the form.
- Changed: `frontend/src/pages/LedgerPage.tsx` — the suggestion is rounded to 2 decimals
  (`Math.round(m * 100) / 100`) when it fills the form. The display already rounds through
  `formatNumber` (`maximumFractionDigits: 2`), so it shows "2.75 min" unchanged.
- Test: `frontend/tests/ledgerBaselineSuggestion.test.tsx` › "rounds a non-terminating suggestion to
  the input step, so the form can be submitted" — suggestion `164800 / 60000`; asserts input value
  `'2.75'`, `validity.stepMismatch === false`, `form.checkValidity()` and a PUT body with `2.75`.
  On the base it fails with `expected '2.7466666666666666' to be '2.75'`.

### x-interfaces-1

Status: fixed

- Confirmed: `ChangeImpactTests.cs` pins `recentFeedItems[].id` as the string `"{feedId}:{sha}"`
  (contract §10.5); `normalizeFeedItem` used `idOf` (positive number only) and dropped every real item.
- Changed: `frontend/src/api/automation.ts` — `WatchFeedItem.id` is `string`; the normaliser keeps any
  non-empty text id. `WatchTab.tsx` needed no change (it uses the id only as key/test id/fallback text).
- Tests: `frontend/tests/watchChangeImpact.test.tsx` now uses the server's shape (`'12:9f3c0a'`,
  `'40:9f3c0a'`); `frontend/tests/automationContractDrift.test.ts` adds a `recentFeedItems` case pinned
  from `ChangeImpactTests.FeedItemKeys` (and its nested `PossiblyAffectedKeys`). Both fail on the base.

### c-security-1

Status: fixed

- Confirmed: `normalizeFeedItem` passed third-party `url` through `toText`, and `WatchTab` renders it
  as `<a href>`. React 19 blocks `javascript:` at render, but `data:` and other schemes passed.
- Changed: `frontend/src/api/automation.ts` — `webUrlOf()` keeps the link only when `new URL(url)`
  parses with protocol `http:` or `https:`; otherwise `url` is `''` and `WatchTab` renders the title
  as plain text (its existing `item.url ? <a> : <span>` branch).
- Test: `frontend/tests/watchChangeImpact.test.tsx` › "keeps a feed item link only when it is http(s),
  so the title renders as plain text otherwise" (`javascript:`, `data:`, relative → `''`; http/https kept).

### c-tests-3

Status: fixed

- Confirmed: the panel always renders, and an older server answers the two GETs with 404
  `NOT_FOUND` "Route not found" (`VpcFunction.cs`), which showed a danger callout.
- Changed: `frontend/src/features/qa/SemanticDuplicatesPanel.tsx` — a 404 with code `NOT_FOUND` or
  `HTTP_404` from either read shows a neutral info callout "Semantic duplicates are not on this server
  yet". A missing deck (`DECK_NOT_FOUND`, 404) is still an error. `frontend/README.md` now says the
  panel always shows and describes the older-server behaviour; `V10-notes.md` updated.
- Tests: `frontend/tests/semanticDuplicatesPanel.test.tsx` › "shows a neutral callout, not an error, on
  a server that predates the routes" (fails on the base) and "still shows a missing deck as an error".

### c-tests-4

Status: fixed

- Confirmed: no test exercised the `ALREADY_RESOLVED` branch, Load more deduplication or the Load more
  failure. Deleting the `ALREADY_RESOLVED` block or the dedupe filter left the suite green.
- Changed: tests only (`frontend/tests/reportsPage.test.tsx`); the page behaviour was already right.
- Tests: "refreshes the list instead of rolling back when the report was already resolved" (409 →
  `listCardReports` called again, refresh message, no "It is open again", row shows the server's
  resolved state); "appends a Load more page without repeating a report already listed" (report 41
  repeated → one row); "shows an alert and keeps the list when Load more fails". With the
  `ALREADY_RESOLVED` block and the dedupe filter removed, the first two fail.
- Notes: `V09-notes.md` records that these paths are now tested.

### c-tests-5

Status: fixed

- Confirmed: the "engine none" test also made the duplicates read answer `VECTOR_NOT_READY`, so it
  passed with `|| state.status?.engine === 'none'` removed.
- Changed: `frontend/tests/semanticDuplicatesPanel.test.tsx` — the duplicates read now succeeds with an
  empty pairs list; the test asserts the not-ready callout and that neither "No pair at or above" nor
  the status line shows. Verified it fails with the engine check removed.

### SUPERVISOR: axios audit (GHSA-542g-h47m-68v8)

Status: fixed

- Changed: `frontend/package.json`, `frontend/package-lock.json` — axios `^1.19.0` → `^1.20.0`
  (`npm install axios@1.20.0`). `npm audit --omit=dev --audit-level=high` reports 0 vulnerabilities.
  `src/api/http.ts` is unchanged; its wire tests pass.
- `frontend/tests/bundleFirstLoad.test.ts`: the upgrade alone moves the login page's eager closure
  483,869 → 486,771 B (+2,902 B, measured by swapping only axios), over the 484,000 cap that had 131 B
  left. The cap is raised to 487,000 with the measurement written next to it, following the file's
  precedent for security upgrades. The first-load closure (372,460 / 377,000) did not move.

### SUPERVISOR: drift test green on release/r20

Status: fixed

- `cd frontend && npx vitest run`: 163 files, 1498 tests pass, including
  `tests/automationContractDrift.test.ts` against the server pins on this base.
