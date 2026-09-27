# X06 — console HITL polish: per-finding record

Release 1.8.0 fix wave r18x-c, issue #359. Every path below is under `frontend/`.
Line numbers are for the branch head at the time of writing.

Gates run locally: `npx tsc -b` (clean), `npx eslint src tests` (the one known
`react-hooks/exhaustive-deps` warning in DeckListPage.tsx and nothing else),
`npx vitest run` (all files green), and `npx playwright test` (3/3 against the
built `--mode e2e` bundle).

### frontend-console-1
Status: fixed

- `src/lib/qaReview.ts:118-127` adds `QaCardVerdict` (`passed | flagged | pending | not_reviewed`)
  and `cardVerdict(itemStatus, findings)`: `flagged` for any blocker or major; `passed` only
  when the item is `done` (or findings exist with no item row); `pending` for `queued`;
  `not_reviewed` for `error`, `refused` and `skipped`. `groupFindingsByCard` sets `verdict`
  (`:188`), and `passes` is now `verdict === 'passed'`. The initial value is no longer `passes: true`.
- `src/pages/DeckQaPage.tsx:702` renders the badge from `VERDICT_BADGES`: Passed/success,
  Flagged/danger, Pending/neutral, Not reviewed/warning. A queued card also shows "Waiting for review." (`:709`).
- Changed an existing assertion: `tests/qaReview.test.ts` "groups findings by card with blockers first"
  expected `{ itemStatus: 'error', passes: true }`. That was the defect, so it now expects
  `passes: false, verdict: 'not_reviewed'`. The refused card in `tests/deckQaPage.test.tsx`
  "groups findings by card and resolves one as fixed" now also asserts "Not reviewed" and no "Passed".
- Tests: `qaReview.test.ts` › "gives a three-state verdict from the item status, never Passed for an unreviewed card";
  `deckQaPage.test.tsx` › "shows Pending, not Passed, for a card still queued in a running run".

### frontend-console-2
Status: fixed

- `src/pages/DeckQaPage.tsx:482-500`: the gate panel lists `status.missing` and `status.openBlockers`
  whenever either is non-empty. It uses a danger Callout "Publishing is blocked" when `wouldBlock`, and
  otherwise a warning Callout "Open blockers (advisory — publishing is not blocked)" (or "Not reviewed
  yet (advisory — …)" when only unreviewed cards remain). The lists carry counts. The unreviewed count
  comes from `changedCards - reviewedCurrent`, because the server caps the `missing` list.
- Test: `deckQaPage.test.tsx` › "lists open blockers and unreviewed cards in advisory mode without blocking"
  (`required: false`, one open blocker).

### frontend-console-3
Status: fixed

- `src/pages/DeckListPage.tsx:71` `loadQaPublishPreview(deckId)`: after the Publish click it runs
  `import('../api/qa')` (a dynamic import, so the first-load closure and `qaGate.ts` stay import-free),
  calls `fetchQaStatus` and summarises it with `qaPublishPreviewLine` (`src/lib/qaGate.ts:26`, pure).
  A failure, or no answer within 3 s, returns null and the dialog opens as before.
- `handlePublish` (`DeckListPage.tsx:455-468`) adds "AI QA: N open blocker(s), M card(s) not reviewed. …"
  to the dialog body and passes an "Open AI QA" link. `ConfirmOptions.link`
  (`src/components/ui/ConfirmDialogContext.ts`) is rendered by `ConfirmDialog.tsx:231` as a router
  `<Link>`, and following it answers the dialog "no". `windowConfirmFallback` appends the link as text.
- The deviation comment at the top of `DeckQaPage.tsx` is replaced: the contract §7.10 preview now
  exists on the publish path.
- Limitation: a legacy-path row with no deck id that has not yet been looked up opens the dialog
  without the preview rather than adding a lookup before the dialog. Paginated rows always carry an id.
- Existing tests changed because the dialog now opens after an awaited preview:
  `deckListPageConfirm.test.tsx` uses `findByRole('dialog')` instead of `getByRole`, and mocks
  `src/api/qa` with a clean status. `deckListSplitParity`, `deckListPageActionFailures` and
  `deckListPagePendingActions` mock `src/api/qa` through the new `tests/support/qaStatusMock.ts`, so
  their dialogs never wait on a real network call. No assertion was weakened.
- Tests: `deckListQaGate.test.tsx` › "the publish dialog previews open blockers and unreviewed cards from the QA status",
  "following Open AI QA from the dialog does not publish",
  "the publish dialog falls back to its plain body when the QA status cannot be read",
  "a clean QA status adds nothing to the publish dialog".

### frontend-console-4
Status: fixed

- `src/pages/ReviewQueuePage.tsx:331-336`: after a successful accept (plain or edited), it calls
  `invalidateQueries` on `QueryKeys.cards(deckId)` and `QueryKeys.decks()` (which prefix-matches
  `['decks', id]`) through `useAppQueryClient()`. The invariant list in `src/api/queryClient.ts`
  now names this write.
- Test: `reviewQueuePage.test.tsx` › "invalidates the deck's cards and the deck list after an accept".

### frontend-console-5
Status: fixed

- Review queue `ReviewQueuePage.tsx:276-296`: `onLoadMore` captures `listKey` and the state updater
  drops the page (and its cursor) when `prev.forKey` no longer matches. The verifier was right that
  this page already hid stale rows during a filter refetch (`listItems` is empty until the key matches),
  so no extra indicator was needed here.
- Webhooks `WebhooksPage.tsx:155,233,368`: deliveries carry `forKey` (subscription|status|event).
  Load more drops a result whose key changed. While a filter refetch is in flight the table is dimmed
  and `aria-busy`, "Loading deliveries for the new filter…" is shown, and Load more is disabled.
- Ledger `LedgerPage.tsx:227-233`: events carry `forAutomation`, with the same drop rule and the same
  refetch indicator (`ledger-events-refetching`).
- Tests (each uses deferred promises): `reviewQueuePage.test.tsx` › "drops a Load more page whose filter changed while it was in flight";
  `webhooksPage.test.tsx` › "drops a Load more page whose filter changed while it was in flight, and shows the refetch";
  `ledgerPage.test.tsx` › "drops a Load more page whose automation filter changed while it was in flight".

### frontend-console-6
Status: fixed

- `src/components/ui/Callout.tsx:17` takes an optional `role` (`alert` | `status`) and `id`.
  Error Callouts on Webhooks and Ledger pass `role="alert"`.
- Webhooks: one persistent visually hidden `role="status" aria-live="polite"` region
  (`WebhooksPage.tsx:403`) receives the test-event and redeliver results. The form problem list is
  `role="alert"` with an id, and the Name and URL inputs and the Events fieldset get `aria-invalid` and
  `aria-describedby` pointing at it (`:532`, `:546`, `:582`).
- Ledger: a persistent live region (`LedgerPage.tsx:326`) announces a saved baseline. The range problem,
  server validation error and baseline problem are `role="alert"`. The From/To and Minutes inputs get
  `aria-invalid` and `aria-describedby` (`:382`).
- Review queue: after a decision, focus moves to the outcome message (`role="status"`, `tabIndex=-1`,
  `ReviewQueuePage.tsx:230`), so it no longer falls to `<body>` when the decision panel unmounts. The
  reject-reason problem is `role="alert"` and linked to the select (`:738`). As the verifier noted, that
  problem is rarely reachable.
- Tests: `webhooksPage.test.tsx` › "announces test and redeliver results through one persistent live region",
  "marks invalid form fields and announces the problem list as an alert";
  `ledgerPage.test.tsx` › "announces range and baseline problems as alerts tied to their inputs",
  "announces a saved baseline through the persistent live region";
  `reviewQueuePage.test.tsx` › "moves focus to the outcome after a decision instead of dropping it to the body".

### frontend-console-7
Status: fixed

- New `src/components/console/consoleNav.ts`: `CONSOLE_NAV` lists the global sections (Decks,
  Content Intelligence, Review queue, AI QA, Automation ledger, Webhooks, Admin), and
  `consoleNav(overrides)` merges a page's deck-scoped overrides. Every `<ConsoleShell>` in
  `src/pages/*.tsx` now spreads `consoleNav(...)`. CardListPage, ReviewQueuePage and DeckQaPage pass
  deck-scoped `reviewHref`/`qaHref`, and DeckListPage passes `decksHref: undefined` because it is that
  page. ConsoleShell's own super_admin gate still hides Webhooks and Admin from editors.
- The shell's href-driven API is unchanged, and so is the existing assertion that a bare
  `<ConsoleShell>` renders no AI QA link (`deckQaPage.test.tsx`). This is the finding's alternative
  fix: every page passes the same set.
- Existing expectations updated because the finding makes the old nav wrong:
  `deckListPagePermissionGate.test.tsx`: the control inventories gain `a:AI QA`,
  `a:Automation ledger`, `a:Review queue` (both roles) and `a:Webhooks` (super_admin).
  `contentIntelligencePage.test.tsx`: the nav landmark lists the full set.
  `deckListSplitParity.test.tsx`: B1 hashes re-measured. Before the numbers were touched, a tag-diff
  of the recorded snapshot showed the only delta is the four new `<a>` elements (+588 B for super_admin
  scenarios, +438 B for the editor). The early-return scenarios are unchanged, and the values were
  stable across two processes. The diagnostic snapshot was regenerated.
- Tests: new `consoleNavEverywhere.test.tsx` › "links a super_admin to Review queue, AI QA, Automation ledger and Webhooks",
  "gives an editor the same sections minus the super_admin ones",
  "is what every ConsoleShell under src/pages takes its destinations from".

### frontend-console-8
Status: fixed

- `src/pages/LedgerPage.tsx:473-486`: the SVG is drawn at its natural pixel size
  (`width={chartWidth}`, `height=180`, no `w-full`/`minWidth`/`maxHeight`) inside the existing
  `overflow-x-auto` wrapper, so 90 daily bars scroll instead of shrinking to about 0.27×. Axis labels
  use font size 10 (`AXIS_FONT_SIZE`).
- A `<details>` "Show the chart data as a table" holds a real table (period start, time saved,
  minutes saved, defects caught), and the SVG points at it with `aria-describedby` (`:477`, `:520`).
- Test: `ledgerPage.test.tsx` › "draws a long daily range at natural size and offers the values as a table".

### frontend-console-9
Status: fixed

- `src/lib/draftReview.ts:108-132`: `ReviewClock`, `startReviewClock`, `setReviewClockVisible` and
  `reviewClockMs` count review time only while `document.visibilityState` is visible, capped at
  `REVIEW_MS_CAP` = 30 min. `ReviewQueuePage.tsx` starts the clock when a draft loads, updates it on
  `visibilitychange` (`:223`) and sends `reviewClockMs` as reviewMs (`:314`).
- The ledger definitions label the cap (`src/lib/ledgerView.ts`, "Actual minutes").
- Tests: `draftReview.test.ts` › "counts review time only across visible stretches and caps it";
  `reviewQueuePage.test.tsx` › "counts review time only while the tab is visible", "caps review time at 30 minutes".

### frontend-console-11
Status: fixed

- `src/components/CardForm.tsx:240` adds `variant?: 'card' | 'draft'`. The draft variant hides
  Order in Deck and Revision (`:638`), makes the Source URL and quote `required` with help text saying
  a draft cannot be accepted without both, and refuses a submit without both (`:357`). The default
  `card` variant is unchanged.
- `ReviewQueuePage.tsx:554-555` mounts the form with `variant="draft"` and `onDirtyChange`.
  `openDraft` asks "Discard your edits?" (destructive confirm) before switching away from a dirty
  edit form (`:255`). `draftReview.ts` documents that the hidden order and revision only satisfy the
  form's checks.
- Tests: `reviewQueuePage.test.tsx` › "edits a draft without order or revision fields and requires its source",
  "asks before opening another draft over unsaved edits",
  "switches drafts without asking when the edit form is untouched".

### frontend-console-12
Status: partially fixed

- Today's server does not return the limits: `GET /qa/status` (`src_C/Vpc/Qa/QaRuns.cs` HandleStatus)
  has no `maxCards`, `dailyUsdCap` or `spentTodayUsd`, and src_C is out of scope for this issue. The
  client side is done. `QaStatus` gains the three nullable fields, read when present
  (`src/api/qa.ts:256`). `qaLimits(status)` (`src/lib/qaReview.ts:52`) uses them and falls back to
  `QA_MAX_CARDS`/`QA_DAILY_USD_CAP`, which are now labelled as fallbacks for the env settings.
  `qaCapRemainingUsd` subtracts today's spend when it is known.
- DeckQaPage uses the limits for the Start guard, the run-size warning, the cap warning (which shows
  what is left of today's cap when spend is known) and `qaStartErrorMessage` for
  `AI_QA_TOO_MANY_CARDS` (`DeckQaPage.tsx:310`, `:580-599`).
- Follow-up (server): have HandleStatus return `maxCards`, `dailyUsdCap` and `spentTodayUsd`. The
  console picks them up with no further change.
- Tests: `qaReview.test.ts` › "uses the server run limits when the status carries them, else the labelled defaults";
  `qaApi.test.ts` › "reads the run limits and today's spend from the status response when present";
  `deckQaPage.test.tsx` › "uses the run limits the status reports instead of the built-in defaults".
  In `qaApi.test.ts` › "reads the publish gate preview…", the `toEqual` now includes the three nulls
  because the normalized type grew.

### frontend-console-13
Status: fixed

- New `src/components/console/consoleStyles.ts` holds H1, H2, button, primary button (filled indigo,
  the one primary style), input, invalid input, label, card, th and td classes. The four HITL pages
  import it and no longer redefine the constants. Every H1 uses the console's
  `text-xl font-semibold text-slate-800`. Webhooks' outlined "primary" is gone: Add subscription and
  the Ledger's Apply and Save baseline are primary, while Load more and Cancel are secondary. The AI QA
  past-runs actions column has a visually hidden "Actions" header (`DeckQaPage.tsx:805`).
- Test: new `consoleStylesShared.test.ts` (no page redefines a shared constant, every H1 is the
  console H1, one filled primary style, no empty `<th />`).

### frontend-console-14
Status: fixed

- `tests/e2e/authoringConsole.spec.ts` Smoke 3 "each HITL route loads its own chunk from the built
  bundle and renders its heading": a stubbed super_admin session opens the landing page, checks that
  none of the four chunks is loaded yet, then clicks Review queue, AI QA, Automation ledger and
  Webhooks in the header. For each it asserts the URL, the h1, no chunk-error fallback, and that the
  `ReviewQueuePage-`, `DeckQaPage-`, `LedgerPage-` and `WebhooksPage-` chunks were fetched with 200.
  The API is stubbed with `page.route` and fails on any unexpected call or console error.
- The optional axe-core scan was not added. It needs a new devDependency and lockfile change for an
  optional item; the live-region, alert and label semantics are covered by the vitest tests above.
- Run: `npx playwright test` → 3 passed.
