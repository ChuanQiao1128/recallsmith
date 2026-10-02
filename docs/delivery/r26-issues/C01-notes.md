# C01 — Console: remove the Content Intelligence page (R26, wave c)

Issue #713. Contract `R26-00-contracts.md` §2. Snowflake was retired on 2026-10-02, and the server
(R26 S01) drops `GET /api/v1/authoring/content-intelligence`, so the console no longer offers a
page that could only fail. Usage and per-card numbers stay on the Usage and Reports pages, which
read the Postgres rollups.

## What changed (files)

Removed:
- `frontend/src/pages/ContentIntelligencePage.tsx` — the page.
- `frontend/tests/contentIntelligencePage.test.tsx`, `contentIntelligenceRace.test.tsx`,
  `contentIntelligenceMcqBanner.test.tsx` — the tests of that page, deleted together with it.
  One case in `contentIntelligencePage.test.tsx` ("shows an em dash when there is no session at all")
  was in fact the only test of a shared ConsoleShell behaviour, not of the page; F02 (r26x, c-tests-1)
  moved it to `frontend/tests/consoleShellEverywhere.test.tsx`.

Edited (source):
- `frontend/src/App.tsx` — the lazy `ContentIntelligencePage` import and the `/content-intelligence` route.
- `frontend/src/lib/brand.ts` — the `/content-intelligence` entry in `ROUTE_TITLES`.
- `frontend/src/components/console/consoleNav.ts` — `contentIntelligenceHref` (type, `CONSOLE_NAV`),
  the `contentIntelligence` section and its `consoleSectionFor` branch.
- `frontend/src/components/console/ConsoleShell.tsx` — the `contentIntelligenceHref` prop and the
  "Content Intelligence" nav link; comments updated.
- `frontend/src/api/authoring.ts` — `ContentIntelligenceCard`, `ContentIntelligenceData`,
  `fetchContentIntelligence`.

Edited (tests):
- `frontend/tests/contentIntelligenceRetired.test.ts` (new) — no page module, no title, no nav
  section, no api client, and no reference anywhere under `src/`.
- `frontend/tests/consoleNavEverywhere.test.tsx` — nav sets/order without Content Intelligence;
  `consoleSectionFor('/content-intelligence')` is `null`.
- `frontend/tests/consoleBrand.test.tsx` — `/content-intelligence` falls back to the console name.
- `frontend/tests/deckListPagePermissionGate.test.tsx` — control inventories lose
  `a:Content Intelligence` (re-measure note added).
- `frontend/tests/deckListSplitParity.test.tsx` + `__snapshots__/deckListSuperAdminPaginated.html` —
  nine baselines re-measured: every shell-rendering scenario moved by -246 B; a character diff of
  the snapshot shows the only change is the removed `<a href="/content-intelligence">`; hashes
  stable across two vitest processes; the two early-return scenarios are unchanged.
- `frontend/tests/docsPaths.test.ts` — see Deviations.
- `frontend/tests/uiLanguage.test.ts`, `tests/support/routerProbe.tsx`, `tests/support/apiResult.ts` —
  comments that named the deleted page/test.

## Surface shipped

- Console routes: `/content-intelligence` is no longer registered (falls to the app's unknown-route
  handling); document title for it is the bare console name.
- Console nav: Decks, Review queue, AI QA, Reports, Usage, Automation ledger, Automation, then
  (super_admin) Webhooks, Admin Management.
- API client: nothing calls `/api/v1/authoring/content-intelligence` any more.
- No backend, mobile, infra or API Gateway change. No paid model call.

## How it is tested

Tests first: commit `test(console): expect the Content Intelligence page to be retired` fails on the
base (12 failures across the four touched/new test files), then the removal makes them pass.

- `cd frontend && npx tsc --noEmit -p . && npx vitest run` — 163 files, 1504 tests pass.
- `npx tsc -b --force` and `npx eslint .` — clean.

## Owner steps

None for the console. Deploying the console build simply drops the page; it does not depend on
migration 045 and works before and after it.

## Deviations / deferred

- `docs/delivery-wave-1.6-plan-2026-09-19.md` cites `frontend/src/pages/ContentIntelligencePage.tsx`
  as a historical record, and `docsPaths.test.ts` requires such a path to be listed in that doc's
  `paths-not-on-disk` block. This issue may not edit `docs/` outside `docs/delivery/r26-issues/C01-*`,
  so the citation is recorded in a new `RETIRED_CITATIONS` list inside `docsPaths.test.ts`, held to the
  same two-way rule (still cited, really gone) plus a guard that fails once the doc registers it.
  Follow-up (D01 or the owner): add `- frontend/src/pages/ContentIntelligencePage.tsx` to that doc's
  `paths-not-on-disk` block and drop the `RETIRED_CITATIONS` entry (the guard will demand it).
