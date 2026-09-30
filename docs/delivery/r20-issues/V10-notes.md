# V10 — Console Usage page, Freshness tile, change impact on Watch, semantic duplicates, suggested baselines

Round R20, wave c (console). Issue #564. Built against contract §5 (embeddings status, semantic
duplicates, `VECTOR_NOT_READY`), §6 (watch response additions), §7 (usage, freshness, baseline
suggestion) and §8, with mocked API modules; the server side (V06, V07, V08) lands in wave s.
No model call, no new dependency, no chart library, no env or secret change.

## What changed

| File | Change |
|---|---|
| `frontend/src/api/usage.ts` | New API module: `fetchUsage(days=30)`, `fetchFreshness(days=30)`, `latestUsageDay`, `USAGE_DAYS`. |
| `frontend/src/api/embeddings.ts` | New API module: `fetchEmbeddingsStatus(deckId?)`, `fetchSemanticDuplicates(deckId, {minCosine?, limit?})`, `SEMANTIC_DUPLICATE_MIN_COSINE` (0.90), `SEMANTIC_DUPLICATES_LIMIT` (50). |
| `frontend/src/api/automation.ts` | `AutomationStatus.freshness?`, `AutomationStatus.watch.needsReview?`; `WatchEvent.affectedCards?` / `needsHumanReview?`; `WatchPage.recentFeedItems?`; new types `WatchAffectedCard`, `WatchPossiblyAffectedCard`, `WatchFeedItem`, `AutomationFreshness`; `watchCardEditorHref`. Every new key is set only when the server sends it. |
| `frontend/src/api/ledger.ts` | `AutomationBaseline.suggestedMeasuredMinutes?` / `suggestedFromN?`, set only when the server sends them. |
| `frontend/src/lib/usageView.ts` | New pure helpers: `formatCount`, `formatRetention`, `formatMinutes`, `sparklinePoints`, `FRESHNESS_HREF` (`/usage#freshness`). |
| `frontend/src/pages/UsagePage.tsx` | New lazy page at `/usage` (headline, sparkline, daily table, per-deck table, excluded accounts, last computed, Freshness section). |
| `frontend/src/App.tsx` | Lazy route `/usage` → `UsagePage` (named export remap). |
| `frontend/src/lib/brand.ts` | `ROUTE_TITLES['/usage'] = 'Usage'`. |
| `frontend/src/components/console/consoleNav.ts` | `usageHref: '/usage'`; section `usage` in `consoleSectionFor`. |
| `frontend/src/components/console/ConsoleShell.tsx` | "Usage" nav link after Reports, not role-gated. |
| `frontend/src/features/automation/OverviewTab.tsx` | "Freshness" tile (median time to publish, n, link "Open the freshness list" → `/usage#freshness`) when `status.freshness` is present; "Needs review" stat in Watched sources when `status.watch.needsReview` is present. |
| `frontend/src/features/automation/WatchTab.tsx` | Per event: affected cards under the row (question → editor link, deck slug, "Quote missing" badge) and a "Needs review" badge; "Recent release notes" section when `recentFeedItems` is present. |
| `frontend/src/features/qa/SemanticDuplicatesPanel.tsx` | New panel: pairs (cosine, card A, card B with editor links), embeddings status line, `VECTOR_NOT_READY` callout with the owner steps. |
| `frontend/src/pages/DeckQaPage.tsx` | Renders the panel after "Past runs" when a deck is open. |
| `frontend/src/pages/LedgerPage.tsx` | Baselines table: "Suggested from N reviews: X min"; super_admin "Use as measured" pre-fills the existing edit form (minutes, source `measured`, note kept). |
| `frontend/README.md` | "Usage and freshness (`/usage`)" section. |
| `frontend/tests/usageApi.test.ts`, `frontend/tests/embeddingsApi.test.ts` | New: wire tests of the two API modules. |
| `frontend/tests/usagePage.test.tsx` | New: page render, "—" for nulls, sparkline geometry, per deck, meta line, Freshness, `#freshness` scroll, NOT_READY, errors, Refresh, nav. |
| `frontend/tests/freshnessOverviewTile.test.tsx` | New: tile present/absent, "—" median, Needs review stat, status normaliser. |
| `frontend/tests/watchChangeImpact.test.tsx` | New: affected cards, badges, release notes, absent fields → unchanged tab, watch normaliser (top level, `details` fallback, absent, top 5). |
| `frontend/tests/semanticDuplicatesPanel.test.tsx` | New: pairs, links, status, empty, `VECTOR_NOT_READY`, engine `none`, other errors, deck switch race. |
| `frontend/tests/ledgerBaselineSuggestion.test.tsx` | New: suggestion text, super_admin pre-fill + unchanged PUT, editor without button, normaliser. |
| `frontend/tests/usageView.test.ts` | New: display helpers. |
| `frontend/tests/deckQaPage.test.tsx`, `frontend/tests/deckQaAutomationRuns.test.tsx` | Mock `src/api/embeddings` (answered `VECTOR_NOT_READY`); the heading census gains "Semantic duplicates". |
| `frontend/tests/consoleNavEverywhere.test.tsx`, `frontend/tests/contentIntelligencePage.test.tsx`, `frontend/tests/deckListPagePermissionGate.test.tsx` | Nav census, order, aria-current and `consoleNav` key list gain Usage. |
| `frontend/tests/deckListSplitParity.test.tsx`, `frontend/tests/__snapshots__/deckListSuperAdminPaginated.html` | Re-measured B1 baselines: +216 B in the nine shell scenarios, verified by character diff to be exactly the one new `<a href="/usage">`; stable across two vitest processes. |
| `frontend/tests/e2e/authoringConsole.spec.ts` | The AI QA stub answers the panel's two reads. |

## API surface (console side)

- `fetchUsage(days = 30)` → `GET /api/v1/admin/analytics/usage?days=` →
  `ApiResult<{days: UsageDay[], decks: UsageDeck[], excludedSubsCount: number, lastComputedAt: string|null}>`.
  `UsageDay = {day, dau, wau, mau, reviews, newUsers, cardsLearned, d1Retention, d7Retention}`; every
  figure is `number|null` (numeric strings coerced; null stays null). Rows without `day` / `deckSlug`
  are dropped. No `days` array → `BAD_RESPONSE`.
- `fetchFreshness(days = 30)` → `GET /api/v1/admin/automation/freshness?days=` →
  `ApiResult<{items: FreshnessItem[], medians: {minutesToDraft, minutesToDecision, minutesToPublish}, n}>`;
  `kind` is `page|feed` (unknown → `page`), `refId` kept as a string, rows without one dropped.
- `fetchEmbeddingsStatus(deckId?)` → `GET /api/v1/admin/card-embeddings/status[?deckId=]` →
  `ApiResult<{engine: 'vector'|'none', model: string|null, cards, embedded, stale}>`.
- `fetchSemanticDuplicates(deckId, {minCosine = 0.9, limit = 50})` →
  `GET /api/v1/admin/decks/:deckId/semantic-duplicates?minCosine=&limit=` →
  `ApiResult<{engine: 'vector', minCosine, pairs: [{cosine, a: {cardId, stableUid, question}, b}]}>`;
  pairs without a finite cosine or a positive card id on either side are dropped.
- `fetchAutomationStatus()` additionally keeps `freshness: {medianMinutesToPublish: number|null, n}` and
  `watch.needsReview: number` when sent.
- `fetchWatch()` additionally keeps, per event, `affectedCards` (from the event, or from
  `details.affectedCards` when only stored there; capped at 200) and `needsHumanReview` (same fallback),
  and `recentFeedItems: [{id, title, url, firstSeenAt, possiblyAffectedCards (≤ 5, with rank)}]`.
  (Corrected in F03: `id` is the server's opaque string `"<targetId>:<itemKey>"`, not a number — the
  first version dropped every real item; `url` is kept only when it is an http(s) URL, else `''`.)
- `fetchAutomationBaselines()` additionally keeps `suggestedMeasuredMinutes` (positive number or null)
  and `suggestedFromN` when sent. `updateAutomationBaseline` is unchanged.
- Everything returns `ApiResult` and never throws. `503 NOT_READY` and `503 VECTOR_NOT_READY` keep
  their code through `apiResultFromError`.
- Every new optional key is absent (not null) when the server does not send it.
  (Corrected in F03: the original claim that `tests/automationContractDrift.test.ts` "stays green"
  once wave s pins the keys was wrong. The drift test fills unpinned-shape keys with `'1'`, and the
  normaliser keeps `affectedCards` only as an array and `needsHumanReview` only as a boolean, so it
  went red as soon as `WatchEventKeys` gained them. The test now gives those keys typed values and
  also compares `recentFeedItems[]`, `affectedCards[]` and `possiblyAffectedCards[]` against
  `FeedItemKeys`, `AffectedKeys` and `PossiblyAffectedKeys` pinned in `ChangeImpactTests.cs`.)

## Page behaviour

- `/usage`: "Latest complete day: YYYY-MM-DD" (the latest `day` in the response, whatever the order)
  with DAU / WAU / MAU; an SVG `<polyline>` sparkline of DAU oldest→newest (`role="img"`, labelled; null
  days skipped; none drawn with fewer than two points); daily table newest first with columns Day, DAU,
  Reviews, New users, Cards learned, D1, D7 (retention as a percentage, "—" for null); per-deck table
  (Deck, Active learners, Reviews, New learners); "Excluded accounts: N · Last computed: …"; a
  Freshness section (`id="freshness"`, scrolled into view for `/usage#freshness`) with the three
  medians, n and the change list. `NOT_READY` → neutral info callouts (no `role=alert`, no table).
  Refresh reloads both reads.
- Watch tab: an event with a non-empty `affectedCards` gets one extra row spanning the table with the
  list; `needsHumanReview === true` adds a "Needs review" badge in the Kind cell. A card without a deck
  id is shown as text (no link). With none of the fields the tab is unchanged (same rows).
- AI QA page: the panel loads both reads per deck (a late answer for a previous deck is dropped). A
  `VECTOR_NOT_READY` from either read, or `engine: 'none'`, shows the info callout with three owner
  steps (install the extension, re-run the migration, push embeddings); other failures are danger
  callouts with the server message. (F03: a 404 `NOT_FOUND`/`HTTP_404` from a server that predates
  the routes shows a neutral "not on this server yet" callout; `DECK_NOT_FOUND` stays an error.)
- Ledger: the suggestion line appears only when `suggestedMeasuredMinutes` is a number. "Use as
  measured" (super_admin only) opens the existing form with those minutes, source `measured` and the
  current note, and announces it; nothing is sent until Save, which is the unchanged PUT. (F03: the
  minutes are rounded to 2 decimals, matching the input's `step="0.01"`; unrounded values such as
  2.7466… made the browser refuse to submit the form.)

## How it was tested

- Tests were written for each behaviour; each new test fails on the base (the modules, route, link,
  keys and UI do not exist there).
- `cd frontend && npx vitest run` — 163 files, 1490 tests pass (includes the bundle budget test).
- `cd frontend && npx tsc -b` — passes. `cd frontend && npm run build` — passes; `UsagePage` is its own
  lazy chunk (10.8 kB, 3.2 kB gzip); nothing new in the first-load closure except the nav link.
- `cd frontend && npm run lint` — 0 errors (one pre-existing warning in `DeckListPage.tsx`, untouched).
- `cd frontend && npx playwright test` — 16 passed (axe scans include the AI QA page with the new panel).

## Owner steps

- None for the console itself. The features fill in as wave s lands:
  - Usage and Freshness need V08 deployed and migration 040 run (then the next automation tick);
    put the owner's own mobile user sub into `ANALYTICS_EXCLUDED_SUBS`.
  - Semantic duplicates need V06 deployed, `CREATE EXTENSION vector` as the RDS master, the migration
    re-run (038 creates the table) and `dc-evals embed-cards --deck <slug> --push`.
  - Change impact needs V07 deployed. Suggested baselines need V08 deployed and ≥ 5 recorded draft reviews.

## Deferred

- No Playwright/axe spec for `/usage` itself (unit tests cover roles, names and labels); one can be
  added beside `automationConsole.spec.ts` once the server shape is live.
- No filter or window picker on `/usage` (the contract's 30-day default only) and no minimum-cosine
  control on the duplicates panel (the contract default 0.90).
- The Review queue's "Similar cards" is unchanged: the MCP server and the authoring similar route's
  optional `embedding` are server/tooling concerns this round.
