# Y07 — console round 2: per-finding record

Release 1.8.0 fix wave r18y-c, issue #375. Every source path below is under `frontend/`.
Line numbers are for the branch head at the time of writing.

Gates run locally: `npx tsc -b` (clean), `npx eslint src tests` (only the known
`react-hooks/exhaustive-deps` warning in DeckListPage.tsx), `npx vitest run` (127 files,
1149 tests, all green), and `npx playwright test` (3/3 against the built `--mode e2e` bundle,
with `PLAYWRIGHT_BROWSERS_PATH` pointed at the local browser cache).

Cross-wave contract used here: `GET /api/v1/authoring/qa/status` returns
`data.limits = { maxCards, dailyUsdCap, spentTodayUsd, reservedTodayUsd }` (the server half
is Y02). The console reads it and falls back to its labelled defaults when it is absent.

### automation-4
Status: fixed

- `src/lib/ledgerView.ts:142-196` `LEDGER_DEFINITIONS` now describes what
  `src_C/Vpc/Ledger/LedgerRoutes.cs` computes:
  - Minutes saved (`:162`): "Per automation and source (live or inferred from history):
    max(0, Σ units × baseline − Σ actual minutes) over successful and partial events, where
    actual minutes include review time on rejected drafts." The chart applies the same rule
    per period.
  - Defects caught before publish (`:172`): exactly two things, (a) an AI QA blocker or major
    finding resolved as fixed and (b) an MCQ-gate refusal. It says that a rejected AI draft is
    not a defect caught.
  - Actual minutes now says it includes review time on every rejected draft. There are two new
    terms: "Live and inferred from history" and "AI draft quality" (acceptance rate,
    edited-accept rate, defect rate, average review minutes, defined as `AgentDraftQualityAsync`
    computes them).
- `src/api/ledger.ts:13-56`: new types `LedgerSourceTotals`, `LedgerTotals.bySource`,
  `LedgerTotals.byBaselineSource` and `LedgerReport.agentDrafts` (`LedgerAgentDrafts`). The
  normalisers are at `:180-218`. Each field is null when an older server does not send it,
  never invented zeros.
- `src/pages/LedgerPage.tsx:356-392`: the "Hours saved" tile shows the live/backfill split and
  the measured/default-baseline split. A new "AI draft quality" tile (`:367`) shows the
  acceptance rate, decided/accepted/rejected counts, edited-accept rate, defect rate with the
  defect-reject count, and average review minutes. With no decided drafts it reads "No AI
  drafts decided in this range." instead of printing 0% rates.
- `src/types/draft.ts` and `src/lib/draftReview.ts`: the comments that still called the four
  defect reject reasons "defects caught" (§9.1b) now say they count in the agent's defect rate.
- Existing assertions changed because the finding makes them wrong:
  - The definitions term list in `ledgerView.test.ts` › "lists the definitions the ledger
    totals use" and `ledgerPage.test.tsx` › "prints how the numbers are computed" gains the
    two new terms (9 → 11).
  - `ledgerApi.test.ts` › "coerces numeric strings in the ledger totals to numbers" expects
    `bySource: null, byBaselineSource: null` in its exact `toEqual` of the totals.
- Tests: `ledgerView.test.ts` › "states the rules the server computes, not the first draft
  (automation-4)"; `ledgerPage.test.tsx` › "prints how the numbers are computed" (asserts the new
  text and that the old "(b) an AI draft rejected" clause is gone), "shows the AI draft quality
  tile from agentDrafts (automation-4)", "says no drafts were decided rather than printing 0%
  rates", "leaves the split out when the server does not send it"; `ledgerApi.test.ts` › "keeps
  the live/backfill split, the baseline split and agentDrafts (automation-4, automation-11)".

### automation-11
Status: partially fixed

- `src/pages/LedgerPage.tsx:356-364`: under "Hours saved" the tile shows "Live (measured): X h"
  and "of which inferred from history: Y h" from `totals.bySource`, plus "On measured
  baselines: … · on default baselines: …" from `totals.byBaselineSource`. The headline no longer
  mixes inferred history into measured data without saying so.
- `src/pages/LedgerPage.tsx:287-306,773-818`: a super_admin "Backfill history" panel (an h3
  inside the Baselines section). "Dry run" first. "Apply backfill" stays disabled until a dry
  run has returned. The dry-run counts per automation are shown and announced in the live
  region. Apply shows inserted and skipped counts, reloads the ledger, and spends the preview,
  so another apply needs another dry run. A refusal is shown as a danger Callout with
  role="alert". Editors do not see the panel.
- `src/api/ledger.ts:366` `runAutomationBackfill(dryRun)`: POST
  /api/v1/admin/automation/backfill with `{ dryRun }`. It reads `{ dryRun, inserted, skipped }`.
- Partial: the finding also asks for the backfill and sweep runbook to move into
  `infra/RUNBOOK.md` (a new §8) with a link from `services/webhook-dispatcher/README.md`. Both
  files are outside this issue's allowed paths (`frontend/`, `docs/delivery/r18-issues/`), and
  the brief's "Do NOT" list names infra and services as other waves' roots. The runbook stays at
  `docs/delivery/r18-issues/X01-ledger-runbook.md`, and the new panel names that path.
  Follow-up (infra wave): copy it into `infra/RUNBOOK.md` §8 and link it from the dispatcher
  README.
- Tests: `ledgerPage.test.tsx` › "splits hours saved into live and inferred history, and
  measured and default baselines (automation-11)", "lets a super_admin dry-run the backfill,
  then apply it (automation-11)", "shows a backfill refusal and offers the panel to a
  super_admin only"; `ledgerApi.test.ts` › "posts the backfill with dryRun and reads its counts
  (automation-11)".

### frontend-console-12
Status: fixed

- `src/api/qa.ts:253-266`: `normalizeStatus` reads the limits from `data.limits` (the
  cross-wave contract), including the new `reservedTodayUsd` (`QaStatus`, `:72-91`). Stray
  top-level keys are ignored.
- `src/lib/qaReview.ts:43-80`: `QaLimits.reservedTodayUsd`. `qaCapRemainingUsd` subtracts both
  spent and reserved spend.
- `src/lib/qaReview.ts:225`: for `AI_QA_TOO_MANY_CARDS`, `qaStartErrorMessage` quotes the limit
  only when it came from the server (`limits.fromServer`). Otherwise it shows the server's own
  message, which names the real `AI_QA_MAX_CARDS`, so the page no longer says "the limit is 200"
  when the cap is 100.
- `src/pages/DeckQaPage.tsx:673-697`: when the defaults are in use, the run-size and cap warnings
  say "(the default; the server did not report its limit/cap)". With server limits, a line
  shows the limits, today's spend and the spend reserved by running runs.
- Existing assertion changed because the finding makes it wrong: `qaReview.test.ts` › "uses the
  server run limits when the status carries them, else the labelled defaults" expected
  `'the limit is 200'` with no server limits. It now expects the server's message.
  `qaApi.test.ts` › "reads the run limits and today's spend from the status response when
  present" now sends them under `limits` (the contract shape) rather than at the top level. The
  exact status `toEqual` in "reads the publish gate preview…" and the two status fixtures gain
  `reservedTodayUsd: null`.
- Tests: `qaReview.test.ts` › "subtracts spend reserved by running runs from what is left of the
  cap (frontend-console-12)"; `qaApi.test.ts` (above); `deckQaPage.test.tsx` › "shows the
  server's run-size refusal when the page only knows its default limit (frontend-console-12)",
  "reads the limits from data.limits, including spend reserved by running runs
  (frontend-console-12)".

### frontend-console-15
Status: fixed

- `src/lib/qaGate.ts:20-46`: `qaPublishPreviewLine` takes `enabled` and returns null when AI QA
  is switched off. The publish dialog then has no QA line and no "Open AI QA" link, which would
  lead to a page where Start is disabled.
- `src/pages/DeckQaPage.tsx:565-578`: with QA off, the gate panel keeps the "switched off" info
  callout. Instead of the "(advisory — publishing is not blocked)" warning it shows one neutral
  line: "AI QA is off — N card(s) have no review at their current content" (plus any open
  blockers from earlier runs).
- Tests: `deckListQaGate.test.tsx` › "adds no QA line or link when AI QA is switched off on the
  server (frontend-console-15)" (enabled:false, missing.length>0); `deckQaPage.test.tsx` › "shows
  no advisory warning while AI QA is off, only the counts (frontend-console-15)".

### frontend-console-16
Status: fixed

- AI QA page: `src/pages/DeckQaPage.tsx:71-83` `RunsState.generation` changes every time the
  list is replaced by a fresh first page (a deck switch, a run turning terminal, a new run, or
  the in-progress recovery). `onLoadMore` (`:407-426`) records the deck and generation at click
  time and drops the page (and its error) in the `setRunsState` updater if either has changed.
  This is the same pattern as ReviewQueuePage's `keyAtClick`.
- Ledger: `src/pages/LedgerPage.tsx:175,353` `LedgerState.forKey` records the request the data
  answers. After Apply (or a saved baseline, or an applied backfill) the old totals, the
  by-automation table and the chart stay on screen, dimmed, with `aria-busy="true"` and a
  "Loading the new range…" note until the new response lands.
- Tests: `deckQaPage.test.tsx` › "drops a Load more page when the runs list was refreshed while
  it was in flight (frontend-console-16)" (also checks that the next cursor is the fresh
  list's). It fails with the guard disabled. `ledgerPage.test.tsx` › "marks the totals and chart
  busy while an applied range loads (frontend-console-16)".

### frontend-console-17
Status: fixed

- `src/lib/ledgerView.ts:121-133`: `ledgerAxisLabel` shortens an ISO period start to `MM-DD`.
  `ledgerLabelEvery(slot, chars, fontSize)` derives the label step from the estimated label width
  (about 0.6 em per character plus a gap).
- `src/pages/LedgerPage.tsx:344,608`: axis labels are `MM-DD` (30 px at 10 px font in a 40 px
  slot), so every weekly bar is labelled with no overlap and the first label starts inside the
  SVG. The full date stays in each bar's `<title>` and in the data table.
- Tests: `ledgerPage.test.tsx` › "labels the weekly chart with short dates that do not overlap
  (frontend-console-17)" (12 weekly bars: label spacing is greater than the label width and the
  first label's left edge is ≥ 0); `ledgerView.test.ts` › "keeps chart axis labels short and
  spaced so they never overlap (frontend-console-17)".

### frontend-console-18
Status: fixed

- (a) `src/pages/DeckQaPage.tsx:438-444` `moveFocusAfterResolve`: after Mark fixed or Dismiss
  (and after "already resolved elsewhere"), focus moves to the next open finding's note input in
  the same card, or else to the card's heading. The heading is now an `<h3 tabIndex={-1}>`
  (`:812`), so focus never falls to `<body>` when the buttons unmount.
- (b) `src/pages/DeckQaPage.tsx:498`: a persistent sr-only `role="status"` live region. Resolve
  results are written to it ("Finding 501 marked fixed."). The visible resolve note (`:790`) is
  a plain info Callout, and a failure is a danger Callout with role="alert", which is announced
  when inserted.
- (c) `src/pages/DeckQaPage.tsx:129,308`: when a watched run turns terminal, the live region
  says "Run finished: N blocker(s), M major, K minor." (or the terminal status).
- (d) `src/pages/WebhooksPage.tsx:250-260`: `startEdit` moves focus to the Name input and
  announces "Editing subscription <name>." in the page's existing live region.
- Tests: `deckQaPage.test.tsx` › "keeps keyboard focus and announces the result after Mark fixed
  (frontend-console-18)", "announces when a watched run finishes (frontend-console-18)";
  `webhooksPage.test.tsx` › "moves focus to the form and announces it when Edit is clicked
  (frontend-console-18)".

### frontend-console-19
Status: fixed

- `src/pages/ReviewQueuePage.tsx:254`: the page tracks `editDirty` in state (from CardForm's
  `onDirtyChange`) and calls the existing `useUnsavedChangesGuard(editingId !== null &&
  editDirty)`. Header links, browser Back and in-app navigation go through the console's confirm
  dialog, and reload or tab close get the browser's beforeunload prompt.
- `decide()` calls `guard.allowNextNavigation()` before its `setSearchParams` (`:384`), because
  the accepted edit discards nothing. `openDraft` keeps its own discard confirm and then calls it
  too (`:289`), so the user is never asked twice.
- `onStatusChange` (`:293-309`): with no draftId in the URL, the open draft is the filter's first
  pending one, so a filter change while editing asks before it can swap the draft out. On
  "keep", the filter does not change.
- `src/hooks/useUnsavedChangesGuard.ts:48-56`: `allowNextNavigation` is now one-shot. The
  navigation it lets through clears it. Before, it stayed set for the life of the page, which
  was harmless on the editors (they navigate away after saving) but would have disarmed the
  guard on the review queue, which stays mounted after an accept.
- Tests: `reviewQueuePage.test.tsx` › "guards unsaved edits against header links, reload and the
  status filter (frontend-console-19)", "does not ask again after the edits are accepted
  (frontend-console-19)"; `unsavedChangesGuard.test.tsx` › "lets exactly one navigation through
  after allowNextNavigation (frontend-console-19)". The existing "asks before opening another
  draft over unsaved edits" still passes unchanged: one prompt per click.

### frontend-console-20
Status: fixed

- The verifier notes that the server rejects invalid MCQ blobs at draft creation, so the "dead
  end" is mostly theoretical. The advice is still wrong for any option-level issue the client
  lint reports, and the fix is small, so it is made:
  `src/lib/draftReview.ts:63-84` `draftLintAdvice` checks whether any MCQ_* issue is one the form
  cannot fix. Only the qualifier-in-stem, choose-N wording and difficulty are editable in the
  form. For those option issues the decision panel says "The options cannot be edited here;
  reject with reason Incorrect or Ambiguous, or fix the source deck." Otherwise it keeps "Fix the
  lint issues with Edit, then Accept with edits." (`src/pages/ReviewQueuePage.tsx:751`).
- `src/lib/draftReview.ts:86` `draftListEmptyText`: the empty list depends on the filter ("No
  drafts waiting for review.", "No accepted drafts.", "No rejected drafts.", "No drafts for this
  deck yet."), used at `src/pages/ReviewQueuePage.tsx:545`.
- Tests: `reviewQueuePage.test.tsx` › "points to Reject, not Edit, when an MCQ option fails lint
  (frontend-console-20)", "says what the empty list means for each status filter
  (frontend-console-20)"; `draftReview.test.ts` › "advises Reject for option lint issues and Edit
  for the rest (frontend-console-20)", "names the empty list by its status filter
  (frontend-console-20)".
- Also from the brief's specific direction: when a draft carries `source.grounding` (Y06
  contract `{ chunkId, sourceId, matched, quoteChars }`), the review queue's Source panel shows
  it (`src/pages/ReviewQueuePage.tsx:653`, normalised in `src/api/drafts.ts:91`, type
  `src/types/draft.ts:29`). When it is absent, nothing is shown. Tests: `reviewQueuePage.test.tsx`
  › "shows where the quote was grounded when the draft carries it, and nothing otherwise";
  `draftsApi.test.ts` › "keeps source.grounding when the draft carries it (Y06 contract), and
  adds nothing otherwise".

### frontend-console-21
Status: fixed

- `src/pages/DeckListPage.tsx:164-165,469-490`: the Publish click sets a per-row
  `checkingQaSlug` (and a ref guard) before `loadQaPublishPreview`, and clears it when the dialog
  answers (`finally`). While it is set, that row's button is disabled and reads "Checking AI
  QA…" (`src/features/deckList/components/DeckRowsTable.tsx:185-199`, the same per-row
  `=== row.slug` comparison as `publishingSlug`, so other rows are untouched). A second click
  starts no second preview or dialog.
- Existing pinned tests updated for the two new hooks, with dated notes: `deckListHookOrder.test.ts`
  (sequence gains `useState`, `useRef` after `publishingSlug`, and the length goes from 37 to 39)
  and `deckListSplitParity.test.tsx` (the publish step gains one commit, the "Checking AI QA…"
  state; `buildViewRows` counts are unchanged).
- Tests: `deckListQaGate.test.tsx` › "shows the row busy while the QA preview loads, and opens the
  plain dialog when it hangs (frontend-console-21)". This is a fake-timer test in which
  `fetchQaStatus` never resolves: the row is busy and a second click is a no-op. The plain dialog
  opens after `QA_PREVIEW_TIMEOUT_MS`, and Cancel re-enables Publish.

### frontend-console-22
Status: fixed

- `src/components/ui/Button.tsx:14-72`: the primitive passes through native button attributes
  (aria-label, title, data-*), adds the `outline` variant (the HITL secondary look) and the `xs`
  size, and its focus-visible ring is now `focus-visible:outline-none focus-visible:ring-2
  focus-visible:ring-indigo-500 focus-visible:ring-offset-2`.
- `src/components/console/consoleStyles.ts`: `BUTTON_CLASS` and `PRIMARY_BUTTON_CLASS` are
  removed. Every action on the four HITL pages (ReviewQueuePage, DeckQaPage, LedgerPage,
  WebhooksPage) renders `ui/Button` (`variant="primary"` or `"outline"`, `size="xs"`). The only
  raw `<button>` left is the review queue's selectable draft row, which gets the same ring
  (`src/pages/ReviewQueuePage.tsx:82`).
- `consoleStyles.ts:19-26`: `INPUT_CLASS` has `focus:outline-none focus:ring-2
  focus:ring-indigo-500 focus:border-indigo-500`, the same ring as CardForm and CardListPage, and
  `INPUT_INVALID_CLASS` has a red ring.
- Error surfaces are unified. Page-level errors on DeckQaPage and ReviewQueuePage, which were
  plain red divs and red-50 boxes, are now `Callout tone="danger" role="alert"`, like Webhooks and
  Ledger. A field's one-line validation message uses the shared `FIELD_ERROR_CLASS`
  (`consoleStyles.ts:28`).
- Existing assertion changed because the finding makes it wrong: `consoleStylesShared.test.ts` ›
  "has one primary action style, filled" imported `PRIMARY_BUTTON_CLASS`, the parallel constant
  the finding removes. It now asserts that the constants are gone, that ui/Button's primary is
  filled indigo, and that each page imports ui/Button and uses no `*BUTTON_CLASS`.
- Tests: `consoleStylesShared.test.ts` › "has one primary action style, filled: ui/Button
  primary", "gives buttons and inputs the console focus ring (frontend-console-22)", "styles page
  errors one way: a danger Callout (frontend-console-22)".
