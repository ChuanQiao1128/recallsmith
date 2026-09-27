# B07 — Automation console fixes: fixes per finding

Issue #446, wave r18b-c (R18A fix round 1, console side). Branch `delivery/r18bc/B07-446`. Paths are
relative to `frontend/` unless they start with `docs/`. Only `frontend/` and `docs/delivery/r18-issues/`
changed; the server, notifier and runner sides of K3/K7 land in the parallel waves.

New test files (each fails on the pre-fix source, checked by running them against `e3dc75f`'s `src/`):

- `tests/automationConsoleFixes.test.tsx` — the page-level fixes (28 cases).
- `tests/automationConsoleRules.test.ts` — the pure rules behind them (9 cases).
- `tests/automationApiWire.test.ts` — `src/api/automation.ts` through the real axios instance (5 cases).
- `tests/reviewBlindShadow.test.tsx` — the blind dry-run review in the review queue (3 cases).
- `tests/e2e/automationConsole.spec.ts` — Playwright + axe WCAG 2 A/AA on every Automation tab (7 cases).

Gates: `npm run lint` (0 errors; the one warning, `DeckListPage.tsx:620`, is on the base),
`npx vitest run` (139 files, 1257 tests), `npm run build`, `npx playwright test` (11 passed).

## Contract

- **K3 (agent notes), console side.** `AutomationRun.summary: string | null` is read from each item of
  GET …/automation/runs (`src/api/automation.ts:129`, `normalizeSummary` at `:430`): trimmed, empty → null,
  capped at `RUN_SUMMARY_MAX = 2000` whatever arrives, null on a server that does not send it. The Runs
  tab shows it in an "Agent notes" column (`src/features/automation/RunsTab.tsx:199`) as a React text node
  in a `whitespace-pre-wrap` paragraph — never markup, so `<img onerror>` in the notes renders as text.
- **K7 (open backlog), console side.** `AutomationStatus.backlog: { humanPending, oldestHumanPendingAt,
  humanPublishes } | null` (`src/api/automation.ts:75`, `normalizeBacklog` at `:418`); null when the
  server predates the field, and the Overview then says so instead of showing zeros. The Overview's
  "Open exceptions" card (`src/features/automation/OverviewTab.tsx:111`) shows the three values and links
  `humanPending` to `/automation?tab=decisions&state=human&open=1`. The definition of `humanPublishes`
  belongs to the server wave; the console only displays it. A `human` decision whose `humanAction` is set
  is labelled "Handled: accepted / edited and accepted / rejected" instead of "Needs you"
  (`decisionBadge`, `src/lib/automationRules.ts:213`).
- No other K-item has a console side. No route, table or env key was renamed; no request shape changed
  except the eval-gate body, which is now sent unchanged as the contract (§15.4 step 4) always required.

## Findings

### frontend-console-1

Status: fixed

- `src/lib/automationRules.ts:198` `HUMAN_ACTION_LABELS` (shared; `DraftAutomationPanel` now uses it too)
  and `:213` `decisionBadge`: a `human` decision with a `humanAction` reads "Handled: …" in a neutral tone.
- `src/features/automation/DecisionTable.tsx:50` new "Person" column (action + reason);
  `DecisionDetail.tsx` shows the badge and a "Person:" line.
- The Decisions filters live in the URL: `decisionFiltersFrom` / `withDecisionFilters`
  (`src/lib/automationRules.ts:397`), read and written by `src/features/automation/DecisionsTab.tsx`;
  unknown codes are ignored. An "Open only (no person has decided)" checkbox (`open=1`) filters the loaded
  pages client-side on `humanAction === null` and says how many rows it hid (the list route has no such
  parameter yet; a server `open=1` is a follow-up). Opening a detail keeps the filters, and Close returns
  to them (`src/pages/AutomationPage.tsx`, `openDecision`).
- Overview: the backlog card (see K7), and the 24-hour `human` row now reads "Routed to a person" and
  links `/automation?tab=decisions&state=human` (`OverviewTab.tsx:56`), because that count mixes handled
  and open decisions.
- Tests: `automationConsoleFixes.test.tsx` › "labels a handled human decision and shows who decided in a
  Person column", "reads its filters from the URL, writes them back, and filters to open items", "shows
  the open backlog on the Overview and links it to the open exceptions", "tolerates a server without the
  backlog field"; `automationConsoleRules.test.ts` › "handled vs open decisions (frontend-console-1, K7)".

### frontend-console-2

Status: fixed

Every Load more (`DecisionsTab.tsx:102`, `RunsTab.tsx:127`, `QueueTab.tsx:89`, `EmailTab.tsx:96`,
`WatchTab.tsx:128`) captures the list key when it starts and appends only if `prev.forKey` still equals it
(the `keyAtClick` pattern of `ReviewQueuePage`). Load more is also not offered, and refuses to run, while a
new filter's first page is loading, because the cursor on screen then belongs to the old list. A Load-more
error is tied to its key and hidden once the filter changed.
Tests: `automationConsoleFixes.test.tsx` › "Load more never mixes two lists (frontend-console-2)" — one
filter-change-while-pending case per tab (Decisions, Runs, Queue, Email log) plus the Decisions happy path
with the filter-to-param mapping.

### frontend-console-3

Status: fixed

`src/api/automation.ts:764` passes `transformRequest: [(data) => data]`, so axios no longer JSON-parses
and trims the string body; the doc comment above it says why. The server's `report_sha256` now covers the
exact pasted bytes, trailing newline included.
Tests: `automationApiWire.test.ts` › "keeps the trailing newline and the spacing dc-evals wrote", "does not
trim leading whitespace either" (real `http` instance, only the adapter replaced).
`automationApi.test.ts` › "sends the pasted eval gate report unchanged…" was updated: it pinned the exact
config object, which the fix changes; it now also asserts the transform is the identity. The optional
in-browser SHA-256 display was not added (the finding marks it optional).

### frontend-console-4

Status: fixed

The decision heading (`DecisionDetail.tsx:49`), the run-decisions heading (`RunsTab.tsx:119`) and the email
body heading (`EmailTab.tsx:90`) have `tabIndex={-1}`; when opened from the page they take focus and
`scrollIntoView({ block: 'start' })`. `AutomationPage` sets `focusOnOpen` only in `openDecision` /
`openRun` (`src/pages/AutomationPage.tsx:102,107`), so a deep link (email, webhook) loads unfocused.
Tests: `automationConsoleFixes.test.tsx` › "focuses the decision heading after Details, but not on a deep
link", "focuses a run's decisions after Decisions", "focuses the email body after Show"
(`document.activeElement`); `e2e/automationConsole.spec.ts` › "Details moves focus to the opened decision"
(focused and in the viewport in a real browser).

### frontend-console-5

Status: fixed

New test files as listed at the top: (a) pagination per tab, filter change during a pending Load more, and
the Decisions filter-to-param mapping; (b) the watch edit happy path, the client-side interval refusal and
the `WATCH_PATTERN_INVALID` refusal (`automationConsoleFixes.test.tsx` › "the watch edit
(frontend-console-5)"); (c) `tests/e2e/automationConsole.spec.ts`, an axe WCAG 2 A/AA scan of all six tabs
with mocked routes (a separate spec, because `authoringConsole.spec.ts` navigates from the landing-page
nav); (d) the real-axios adapter test of frontend-console-3.

### frontend-console-6

Status: fixed

`DecisionDetail.tsx` offers "Decide in review queue" whenever `decisionAwaitsPerson(d)`
(`src/lib/automationRules.ts:221`): state `human` or `would_accept`, and `humanAction === null`.
Tests: `automationConsoleFixes.test.tsx` › "offers \"Decide in review queue\" for an undecided dry-run
would-accept draft", "shows who decided a handled decision instead of a review link";
`automationConsoleRules.test.ts` › "the review link of a decision (frontend-console-6)".
`automationPage.test.tsx` › "shows the decision detail…" was updated because it pinned the omission the
finding names (a would_accept draft without a link) and the old link name; it now pins that a decided
would_accept draft has no link.

### frontend-console-7

Status: partially fixed

Short-term fix done: `automationQaRunLabel` (`src/lib/automationSurfaces.ts:20`) also requires
`estimatedCostUsd === 0`, since the mirror run is inserted with cost 0 (A00 §5.6) and a re-check calls the
reviewer. The durable fix — persisting and exposing the run's trigger from `QaRuns.StartCardsRunAsync` —
is server-side (`src_C`), outside this issue's paths; it stays a follow-up for the server wave.
Tests: `automationConsoleRules.test.ts` › "calls only a zero-cost one-card run the auto-accept mirror".
`deckQaAutomationRuns.test.tsx` › "labels an automation mirror run…" now gives its mirror fixture
`estimatedCostUsd: 0` (the shared QA fixture defaults to 0.135, which a real mirror never has).

### frontend-console-8

Status: fixed

`EmailTab.tsx` `onShow` records the requested id in a ref and drops any answer for another id
(`EmailTab.tsx:124`); the row's Show button is `loading` (disabled, spinner) while its body loads
(`:240`).
Tests: `automationConsoleFixes.test.tsx` › "ignores an older answer and marks the button busy while
loading".

### frontend-console-9

Status: fixed

- Watch rows: "Deactivate/Activate target N", "Edit target N", and in the inline edit "Save target N" /
  "Cancel editing target N" (`WatchTab.tsx:411` and around).
- The checks return field keys: `queueItemFieldProblems`, `watchTargetFieldProblems`, `watchEditProblem`
  (`src/lib/automationRules.ts:492,524,556`; the string-list functions remain and derive from them). Each
  failing field gets `aria-invalid`, `INPUT_INVALID_CLASS` and `aria-describedby` to the problem list, in
  the Queue form, the Watch add form and the inline edit. A server `WATCH_PATTERN_INVALID` is attached to
  the pattern field (`WatchTab.tsx:173,214`).
- Tests: `automationConsoleFixes.test.tsx` › "names each watch row button after its target", "marks every
  queue field that fails its check", "marks the watch fields that fail, in the add form", "shows
  WATCH_PATTERN_INVALID on the pattern field and keeps the edit open"; `automationConsoleRules.test.ts` ›
  "field-keyed form checks (frontend-console-9)". `automationPage.test.tsx` › "adds a feed and toggles…"
  clicks the button by its new name, and the editor test's `MUTATING` list gained the new names.

### frontend-console-10

Status: fixed

New `src/features/automation/DeckSelect.tsx` owns the deck fetch for the Decisions, Queue and Watch deck
selects. A failed fetch renders a danger Callout "Could not load the deck list: …" with a "Retry loading
decks" button that re-fetches. (A component rather than a hook, so `hookWiring.test.ts`'s accounting of
hooks outside `src/hooks` stays unchanged.)
Tests: `automationConsoleFixes.test.tsx` › "a failed deck list is shown with a retry
(frontend-console-10)", one case per tab.

### frontend-console-11

Status: fixed

- `decisionReasonDetailText` (`src/lib/automationRules.ts:226`) routes a `QA_ERROR` detail through
  `qaItemErrorLabel` in `DecisionTable`, `DecisionDetail` and `DraftAutomationPanel` (one rule for all).
- Label maps for every enumeration (`MODE_LABELS` … `RUNNER_STATE_LABELS`, `:231`) with `codeLabel`
  (`:302`, raw-code fallback), used for mode, run status/outcome, queue kind/status, watch status, watch
  event kind, re-check state, notification kind/status and the filter options.
- Runner state renders as a Badge with `runnerStateTone` (`:307`; error / login_expired are danger).
- The mode banner carries a mode badge (`modeBadge`, `:314`: OFF neutral, DRY RUN warning, LIVE success;
  `ModeBannerCallout.tsx:17`), so off and dry run no longer look alike. `modeBanner` itself is unchanged
  (its tones are pinned by `automationRules.test.ts`, and `ui/Callout` has no neutral tone).
- Tests: `automationConsoleFixes.test.tsx` › "labels a QA_ERROR detail, the mode and the statuses", "shows
  a failing runner as a danger badge and marks the mode with its own badge"; `automationConsoleRules.test.ts`
  › "machine codes read as words (frontend-console-11)".

### frontend-console-12

Status: fixed

`CONSOLE_NAV` gained `automationHref: '/automation'` (`src/components/console/consoleNav.ts:33`), so every
ConsoleShell page links Automation after the ledger; `AUTOMATION_HREF` and the four explicit
`automationHref={AUTOMATION_HREF}` props were removed. Like the ledger link it is not role-gated (the
read routes are RequireAdmin); a super_admin sees it everywhere. The A16 decision this reverses is marked
superseded in `docs/delivery/r18-issues/A16-notes.md`.
Pinned tests updated because the finding makes the old link set wrong (a named §18.3-style exception):
`consoleNavEverywhere.test.tsx` (landing-page link sets, order, CONSOLE_NAV keys, the current-section
table gains `/automation`, the hard-coded-destination regex gains `automationHref`),
`contentIntelligencePage.test.tsx` (link order), `deckListPagePermissionGate.test.tsx` (`a:Automation` for
both roles, re-measure note added), and `deckListSplitParity.test.tsx` (nine B1 hashes re-measured,
+226 B each = one `<a>`; verified by word-diffing the snapshot before touching the numbers, stable across
two processes; the two early returns unchanged; note added) plus
`__snapshots__/deckListSuperAdminPaginated.html`. `e2e/automationConsole.spec.ts` checks the link is the
current section on every tab.

### automation-3

Status: fixed (console side of K3)

Runs tab "Agent notes" column and `summary` on `AutomationRun`; see Contract › K3. The batch-summary
"Agent notes:" line, the `agent_note` exception, the status route field and the prompt/skill wording are
the server, notifier and runner waves' side.
Tests: `automationConsoleFixes.test.tsx` › "shows the notes as plain text, never as markup", "shows a dash
for a run without notes"; `automationApiWire.test.ts` › "reads summary as plain text, null when empty or
absent, capped at 2000 characters"; `e2e/automationConsole.spec.ts` (Runs tab with notes, axe).

### automation-4

Status: fixed (console side)

`automationBlinded(a, draftStatus)` (`src/lib/automationSurfaces.ts:45`): a dry-run `would_accept` draft
that is still `pending` and has no `humanAction` is blinded. The review queue list badge then reads
"Automation: decided (hidden until you decide)" in a neutral tone (`src/pages/ReviewQueuePage.tsx:623`),
and `DraftAutomationPanel` (`:29`) shows only that line and a sentence; the verdict, the QA reviewer,
counts and findings, and the "Open in Automation" link (one click from the verdict) appear once the
person decides. Human-routed drafts keep their reason and findings, as the finding asks.
The server has no "reveal and mark non-blind" flag, so there is no reveal control; the Automation console
itself (an audit log) still shows would_accept. Known limit: while blinded, a draft with no reason badge
is distinguishable from a human-routed one by the missing reason — the finding explicitly keeps
human-routed reasons visible, so full blinding would need the server to randomise it. The batch email
still lists would-accept drafts (server side).
Tests: `reviewBlindShadow.test.tsx` › "hides a pending would-accept verdict in the list and in the
detail", "keeps the reason of a human-routed draft visible", "reveals the verdict once a person has
decided the draft".

### automation-10

Status: fixed (console side of K7)

The Overview shows the open backlog (`humanPending` with its link, the oldest pending age,
`humanPublishes`) from `status.backlog`, and tolerates its absence; the 24-hour `human` count is
relabelled so it no longer reads as the backlog. Resolving human publish rows and the digest's count are
server-side (K7 server wave).
Tests: `automationConsoleFixes.test.tsx` › "shows the open backlog on the Overview and links it to the open
exceptions", "tolerates a server without the backlog field"; `automationApiWire.test.ts` › "reads
backlog.humanPending, oldestHumanPendingAt and humanPublishes", "is null on an older server that does not
send it".
