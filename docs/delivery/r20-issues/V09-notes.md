# V09 — Console Reports page (learner card reports)

Round R20, wave c (console). Issue #563. Built against contract §4 (console
routes) and §8 with mocked API modules; the server side (V05) lands in wave s.
No model call, no new dependency, no env or secret change.

## What changed

| File | Change |
|---|---|
| `frontend/src/api/cardReports.ts` | New API module: `listCardReports`, `resolveCardReport`, `cardReportEditorHref`, reason/resolution lists, `CARD_REPORT_NOTE_MAX` (500). |
| `frontend/src/pages/ReportsPage.tsx` | New lazy page at `/reports`. |
| `frontend/src/App.tsx` | Lazy route `/reports` → `ReportsPage` (named export remap). |
| `frontend/src/lib/brand.ts` | `ROUTE_TITLES['/reports'] = 'Card reports'`. |
| `frontend/src/components/console/consoleNav.ts` | `reportsHref: '/reports'` in `ConsoleNavHrefs`/`CONSOLE_NAV`; section `reports` in `consoleSectionFor`. |
| `frontend/src/components/console/ConsoleShell.tsx` | "Reports" nav link, after Content Intelligence (end of the authoring group), not role-gated. |
| `frontend/src/api/automation.ts` | `AutomationStatus.cardReports?: {open, openedLast7d}`; normalised only when the server sends an object, absent otherwise. |
| `frontend/src/features/automation/OverviewTab.tsx` | "Card reports" tile (Open, New in 7 days, link "Open card reports" → `/reports`), hidden when `cardReports` is absent. |
| `frontend/README.md` | "Card reports (`/reports`)" section. |
| `frontend/tests/cardReportsApi.test.ts` | New: wire test of the API module. |
| `frontend/tests/reportsPage.test.tsx` | New: page render, filters, URL deep link, resolve, rollback, load more, NOT_READY, errors, labels. |
| `frontend/tests/cardReportsOverviewTile.test.tsx` | New: tile present/absent and the status normaliser. |
| `frontend/tests/consoleNavEverywhere.test.tsx` | Nav census, order, aria-current and `consoleNav` key list gain Reports. |
| `frontend/tests/contentIntelligencePage.test.tsx`, `frontend/tests/deckListPagePermissionGate.test.tsx` | Nav order / control census gain Reports. |
| `frontend/tests/deckListSplitParity.test.tsx`, `frontend/tests/__snapshots__/deckListSuperAdminPaginated.html` | Re-measured B1 baselines: +220 B in the nine shell scenarios, verified by character diff to be exactly the one new `<a href="/reports">`; stable across two vitest processes. |

## API surface (console side)

- `listCardReports({status: 'open'|'resolved'|'all', deckId?, cursor?, limit?})`
  → `GET /api/v1/admin/card-reports?status=&deckId=&cursor=&limit=` (limit defaults to 50; unset
  filters are not sent) → `ApiResult<{items: CardReport[], nextCursor: string|null}>`.
- `resolveCardReport(reportId, {resolution, note?})`
  → `POST /api/v1/admin/card-reports/:reportId/resolve` body `{resolution, note?}` (note trimmed,
  blank left out, capped at 500) → `ApiResult<{reportId, status:'resolved', resolution}>`.
- Both return `ApiResult` and never throw. Non-envelope payloads → `BAD_RESPONSE`. Server envelopes
  (`NOT_READY` 503, `ALREADY_RESOLVED` 409, `REPORT_NOT_FOUND` 404, `VALIDATION_ERROR`) keep their code
  and HTTP status through `apiResultFromError`.
- Normaliser: rows without a positive integer `reportId` are dropped; unknown `reason` → `other`,
  unknown `status` → `open`, unknown `resolution` → null; `note`/`resolutionNote` capped at 500;
  only contract keys are kept (a stray `userSub`/`email` never reaches the page).
- `AutomationStatus.cardReports` read from `GET /api/v1/admin/automation/status`.

## Page behaviour

- Table columns: Deck, Card question (with stable UID), Reason badge, Note (plain text node),
  Age (relative to when the page loaded), Status (Open / Resolved · resolution), Actions.
- Filters: Status (Open default, Resolved, All) and Deck (from `fetchDecks`, plus any deck seen in
  the rows). Both are URL params (`?status=&deckId=`); invalid values fall back to open / all decks.
- "Open in editor" → `/decks/cards/edit?deckId=&cardId=`; "Card deleted" when the card or deck id is null.
- Resolve: an accessible inline form under the row (`<form aria-label>`, labelled Resolution select,
  labelled Note textarea with `maxLength=500` and a described-by character count). Chosen over
  `useConfirm` because the dialog has no select/textarea fields.
- Optimistic update: the row reads resolved immediately; on failure it is restored and an alert says
  why. `ALREADY_RESOLVED` refreshes the list instead of restoring the row.
- "Load more" pages with `nextCursor` and appends (deduplicated by report id).
- `NOT_READY` → neutral info callout "Card reports are not set up on the server yet (run the
  database migration)" (no `role=alert`, no table). Other failures → danger callout with the server message.
- One persistent `aria-live` region announces resolve results.

## How it was tested

- Tests were written first; each new test fails on the base (the modules/route/link do not exist there).
- `cd frontend && npx vitest run` — 155 files, 1440 tests pass (includes the bundle budget test).
- `cd frontend && npm run build` (`tsc -b` + vite) — passes; `ReportsPage` is its own lazy chunk (~11 kB).
- `cd frontend && npm run lint` — 0 errors (one pre-existing warning in `DeckListPage.tsx`, untouched).

## Owner steps

- None for the console. The page is useful once V05 is deployed and its migration
  (`037_card_reports.sql`) has run; before that it shows the neutral NOT_READY callout, and the
  overview tile stays hidden until the status route sends `cardReports`.

## Deferred

- No Playwright/axe e2e spec for `/reports` (unit tests cover labels, roles and names); a stubbed
  e2e spec like `automationConsole.spec.ts` could be added once the server shape is live.
- No bulk resolve and no "reopen" (the contract has no such route).
