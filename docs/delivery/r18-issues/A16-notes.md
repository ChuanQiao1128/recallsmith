# A16 — the console's Automation page (#421)

Frontend only, against contract A00 §16. Every server route belongs to wave S (A02, A04, A05, A06);
here they are contract-only, and every test mocks the network.

## What was added

- `frontend/src/pages/AutomationPage.tsx`: the `/automation` page. It shows the mode banner on every
  tab and six tabs (Overview, Runs, Decisions, Queue, Watch, Email log) as plain links, so the deep
  links of A00 §12.2 and §13 work: `?runId=`, `?draftId=`, `?tab=watch&targetId=`.
- `frontend/src/features/automation/`: the tab components, the eval gate card, the decision table and
  detail, and the mode banner.
- `frontend/src/api/automation.ts`: the 16 calls to `/api/v1/admin/automation/…`. Each returns an
  `ApiResult` and never throws. Each response object is built field by field, so no recipient and no
  field outside the contract reaches the page.
- `frontend/src/lib/automationRules.ts`: the codes, labels, mode banner, deep-link resolution and form
  checks, as pure functions.

## Decisions

- **No mode switch.** The banner states `Change AUTOMATION_MODE in src_C/env/prod.env.json and deploy`.
- **`automationHref` is a `ConsoleShell` prop only, not part of `consoleNav()`.** Adding it to
  `CONSOLE_NAV` would break tests that pin the console's seven nav links and must stay
  byte-identical. So the pages of the automation area pass it explicitly after `{...consoleNav()}`:
  - A16: `AutomationPage` and `LedgerPage`;
  - A17: `ReviewQueuePage` and `DeckQaPage`.

  `consoleNav.ts` exports `AUTOMATION_HREF` for them.

  **Superseded by B07 (frontend-console-12):** `automationHref` is now in `CONSOLE_NAV`, every console
  page links Automation, `AUTOMATION_HREF` and the explicit props are gone, and the pinned nav tests were
  updated. See `B07-fixes.md`.
- **The eval gate report is posted as pasted.** The server hashes the raw body bytes (A00 §15.4
  step 4).
- **The title pattern of a watched feed is not compiled in the browser.** It is a PostgreSQL ARE; the
  server answers `WATCH_PATTERN_INVALID`.
- **The tabs wait for the first status answer.** When migration 034 has not run, the page makes one
  request and shows only the not-ready notice.
- **`ui/Callout` has no neutral tone.** The "off" banner therefore renders as `info`; `modeBanner`
  still returns `neutral`.
