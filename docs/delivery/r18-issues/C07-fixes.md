# C07 — Automation console round 2: per-finding fixes ledger

Issue #461, R18A fix round 2 (R18C), wave C (console). Scope: `frontend/` and
this ledger only. Every fix below is pinned by a test that fails on the base
(`delivery/r18c-c` @ e9e866c) and passes after it; the new console tests live in
`frontend/tests/automationConsoleRound2.test.tsx` (checked against the base
source: 28 of its tests fail there). Paths are relative to `frontend/`.

Gates run: `npm run lint` (0 errors; the one warning is the pre-existing
`DeckListPage.tsx:620`), `npx vitest run` (140 files, 1287 tests, all pass),
`npm run build`, and `npx playwright test tests/e2e/automationConsole.spec.ts`
(10 passed, against the built bundle with the API stubbed).

## Contract

- **L3 (console side).** The eval-gate card states K2 plainly under its heading
  ("Only the newest evaluation counts: if it failed or is revoked, live mode
  runs as a dry run, and revoking the effective gate stops live at once").
  `evalGateSummary` (`src/lib/automationRules.ts:481`) reads the newest history
  row by `gateId`: `effective` when it is the current gate, `revoked`, or
  `failed`. A failed newest evaluation shows a warning callout that says it
  blocks live mode. A new Status column (`evalGateRowStatus`, `:516`) marks each
  row `Effective`, `Superseded` (every row older than the newest),
  `Revoked <time>` or `Failed: blocks live`. The console still refuses to *send*
  a report whose `passed` is not true (`evalGateReportProblem`, unchanged), so
  failed rows come from the server-side L3 recording (dc-evals / API), not from
  this form.
- **L4 (console side).** `listAutomationDecisions` takes `open?: boolean`
  (`src/api/automation.ts:747`). The Decisions tab sends `open: true` only when
  "Open only" is on (`DecisionsTab.tsx:58`) and keys the list on it. The
  console URL keeps `open=1`, so existing links keep working, and also reads
  `open=true` (`automationRules.ts:430`). The client check `isOpenDecision`
  stays only as a guard for an older server that ignores the parameter.
  `AutomationBacklog.humanPublishItems` is `HumanPublishItem[] | null`
  (`{ deckId, deckSlug, reason, since }`, normalised field by field, items
  without a positive `deckId` dropped, null when the server predates the
  field). The Overview lists at most 20 of them (`HUMAN_PUBLISH_ITEMS_MAX`).
- **L5.** `AutomationStatus.notifications.unconfirmed` (the field name
  `StatusRoutes.cs:210` returns) is normalised as a number, 0 when absent
  (`src/api/automation.ts:424`), and shown on the Email card next to the other
  email-health numbers.

## Findings

### automation-19

Status: partially fixed

- Console side (the inbox disagreeing with the server's counts): fixed together
  with frontend-console-13 below. "Open only" is now a server filter (`open=true`)
  with the backlog's predicate, so the Overview link and the count agree
  (`DecisionsTab.tsx:58`, `:84-101`).
- The second half (HandleRuns in `src_C/Vpc/Automation/StatusRoutes.cs:372`
  should also match `deferred_card_ids` and return `deferredCardIds`) is a
  server change in `src_C/`, outside this issue's allowed paths
  (`frontend/.*`, `docs/delivery/r18-issues/.*`). It is not an L-item, so no
  console-side shape is defined for it. It is declined here and left for the
  src_C wave. The Runs tab already renders whatever publishes the server links
  to a run.
- Tests: `automationConsoleRound2.test.tsx` › "open exceptions come from the
  server …" (all three cases); `automationApiWire.test.ts` › "sends open=true
  only when asked".

### frontend-console-13

Status: fixed

- `DecisionsTab.tsx`: the request carries `open: true` when "Open only" is set
  (`:58`). The list key includes `openOnly` (`:84`), so toggling it refetches
  from the server in keyset order. Load more keeps `open: true` with its cursor.
  The header comment no longer says the route lacks the parameter.
- The client filter stays as a guard for an older server. Its note is now
  pluralised (`hiddenDecidedText`, `automationRules.ts:455`) and uses
  `text-slate-600`.
- Updated existing assertion (the finding makes the old behaviour wrong):
  `automationConsoleFixes.test.tsx` › "reads its filters from the URL … filters
  to open items" used to assert "Client-side: no new request". It now asserts
  the new request `{ …, open: true, limit: 50 }`. Its mock answers like an older
  server, so the guard still hides the handled row, and the note now reads
  "1 … is hidden".
- Tests: `automationConsoleRound2.test.tsx` › "reaches the only open item
  although it sits on the unfiltered list's second page" (two pages, the only
  open item on page 2), "asks page 2 of the open list with open=true and its
  cursor", "never sends open when the box is clear, and reads open=true in a
  link".

### frontend-console-15

Status: fixed

- `OverviewTab.tsx:136-180`: "Publishes waiting for you" links to the Runs tab
  when above 0, with an accessible name. Below the counts, a list shows each
  `humanPublishItems` entry with its deck slug, the labelled reason
  (`publishReasonLabel`), the time since, and a link to the deck's AI QA page
  (`qaPageHref`, `/decks/qa?deckId=`). On a server without the field, it says
  where to look: the Publishes column of the Runs tab. The L4 item shape has no
  runId, so the per-item link goes to the deck and the count goes to the Runs
  tab.
- `tests/support/automationFixtures.ts`: `statusFixture` carries one
  `humanPublishItems` entry and `unconfirmed: 0`.
- Tests: `automationConsoleRound2.test.tsx` › "lists each deck and reason and
  links its AI QA page and the Runs tab", "points at the Runs tab when the
  server does not list the decks yet"; `automationApiWire.test.ts` › "reads
  backlog.humanPublishItems field by field …". Updated existing assertion:
  `automationApiWire.test.ts` › "reads backlog.humanPending, …" now expects the
  new `humanPublishItems: null` key for a server that does not send it.

### frontend-console-16

Status: fixed

- `src/api/automation.ts:73-80, :420-426`: `notifications.unconfirmed` is typed and
  normalised.
- `OverviewTab.tsx:355-368`: the Email card shows "Unconfirmed (sent, no
  delivery report after 1 h)". Above 0, it shows a warning Badge and a link to
  `?tab=email&status=queued` (`QUEUED_EMAIL_SEARCH`).
- `EmailTab.tsx:61-64`: the log starts on a `?status=` a link names (only a
  known status is accepted), so that link lands on the queued emails.
- Tests: `automationConsoleRound2.test.tsx` › "shows the count with a warning
  and links the queued emails", "shows 0 without a warning or link", "opens the
  Email log on the status the link names"; `automationApiWire.test.ts` › "reads
  notifications.unconfirmed as a number, 0 when an older server omits it".

### frontend-console-17

Status: fixed

- `EvalGateCard.tsx:146-171`: the false "No passed eval gate is recorded" is
  gone. With history [revoked #2, passed #1] and no current gate, the card says
  "The newest eval gate (#2) is revoked. Only the newest evaluation counts, so
  live mode runs as a dry run. Record a new report to go live." A failed newest
  evaluation is shown as blocking. With no history, it says "No eval gate is
  recorded …".
- `EvalGateCard.tsx:212-240`: a Status column ("Effective", "Superseded",
  "Revoked <time>", "Failed: blocks live").
- Logic: `automationRules.ts:476-527` (`evalGateSummary`, `evalGateSummaryText`,
  `evalGateRowStatus`). These pick the newest row by `gateId`, so the history
  order does not matter.
- Tests: `automationConsoleRound2.test.tsx` › "names a revoked newest gate and
  marks the older passed one superseded", "shows a failed newest evaluation as
  blocking live", "marks the current gate effective, labels its metrics and
  offers Revoke", "computes the summary from the newest row, whatever order
  history arrives in".

### frontend-console-14

Status: fixed

- `src/lib/automationSurfaces.ts:34-50`: `automationBlinded` is true for every
  dry-run draft that is still pending with no human action, whatever its state
  (would_accept, human, qa_*). The list and the panel therefore show one neutral
  badge, "Automation: dry run — verdict hidden until you decide", with no state
  and no reason. The list badge (`ReviewQueuePage.tsx:623-624`) and the detail
  panel (`:715`) both call this one predicate, so list and detail stay
  consistent. After the draft is decided, and always in live mode, the state,
  reason, findings and the "Open in Automation" link show.
- `DraftAutomationPanel.tsx:37-48`: the blinded copy now matches what is hidden
  ("… are hidden for every dry-run draft until you accept or reject it").
- Trade-off, stated because the verifier raised it: a human-routed dry-run
  draft now hides its QA findings until the person decides. A dry-run draft is
  never accepted by the automation, so the person reviews every such draft in
  full anyway. This follows the issue's specific direction ("blind every pending
  dry-run draft's automation verdict (would_accept AND human-routed)").
- Updated existing assertions (the finding makes the old behaviour wrong):
  - `reviewBlindShadow.test.tsx` › "keeps the reason of a human-routed draft
    visible" is now "keeps the reason of a live human-routed draft visible"
    (mode `live`).
  - In "reveals the verdict once a person has decided the draft",
    `automationBlinded({state:'human'})` and `({state:'qa_queued'})` in dry run
    are now `true`. New cases cover live human (false) and a decided human
    draft (false).
  - `reviewAutomationBadge.test.tsx`: `LIST_AUTOMATION` and
    `DETAIL_AUTOMATION` use mode `live`, since a pending dry-run draft is now
    blind. The dry-run badge text is still asserted through the pure function.
- Tests: `reviewBlindShadow.test.tsx` › "blinds a pending human-routed dry-run
  draft exactly like a would-accept one (C07 frontend-console-14)" asserts that
  the two list badges have identical text and class, and that the panel shows no
  reason or findings.

### frontend-console-18

Status: fixed

- Close: `DecisionsTab.tsx:104-110`. When `draftId` goes from a number to null,
  focus moves to that row's "Details of draft N" button, or to the Decisions
  heading (now `tabIndex=-1`) when that row is not loaded.
- Hide: `EmailTab.tsx:151-158`. Focus returns to the originating "Show email …"
  button, or to the Email log heading (`tabIndex=-1`) when that row is gone.
- Edit / Save / Cancel: `WatchTab.tsx:120-132`. An effect keyed on the edited
  target focuses the pattern input when the editor opens. When the editor
  closes (Save or Cancel), focus returns to that row's "Edit target N" button.
- Tests: `automationConsoleRound2.test.tsx` › "Close returns focus to the Details
  button of the row", "Close falls back to the Decisions heading when the row is
  not loaded", "Hide returns focus to the Show button it came from", "Edit
  focuses the pattern field, and Cancel and Save return to the Edit button";
  e2e `automationConsole.spec.ts` › "the linked watch row … open editor"
  (asserts that the pattern field is focused after Edit).

### frontend-console-19

Status: fixed

- (a) `WatchTab.tsx:427`: the title pattern uses `text-slate-600` (#475569 on
  #eef2ff is about 7:1; slate-500 was 4.26:1).
- (b) `WatchTab.tsx:254-264`: once the list holds the linked target, its row
  scrolls into view (once per target). `:380-386`: when the target is not on the
  loaded pages, a status line says "Target N is not on the loaded pages. Load
  more to look further." (or "… is not in the list." when there is no next
  page).
- (c) `OverviewTab.tsx:129`: the drafts backlog link's accessible name is
  "N drafts waiting for you: show open exceptions" (`backlogLinkLabel`). The
  publishes link has an accessible name too.
- The axe e2e now opens `/automation?tab=watch&targetId=3` with a title pattern
  set, before and after opening the editor.
- Tests: `automationConsoleRound2.test.tsx` › "scrolls the marked row into view
  and keeps its pattern text at AA contrast", "says so when the linked target is
  not on the loaded pages", "names the drafts link by what it opens, not by its
  digit"; e2e › "the linked watch row with a title pattern and its open editor
  has no axe violation".

### frontend-console-11

Status: fixed

- Run kind: `RunsTab.tsx:213` uses `QUEUE_ITEM_KIND_LABELS`.
- Watch target kind: `WatchTab.tsx:421` uses a new `WATCH_KIND_LABELS` (feed →
  "Feed", page → "Cited page"). Feed format, in the table (`:430`) and in the
  add form's options (`:297`), uses a new `FEED_FORMAT_LABELS`.
- Review-queue panel: the mode goes through `MODE_LABELS`, and the finding
  severity through `FINDING_SEVERITY_LABELS` with `findingSeverityTone`
  (`DraftAutomationPanel.tsx:69, :85`).
- Decision detail: the finding severity is a labelled Badge
  (`DecisionDetail.tsx:173-177`).
- Eval-gate metrics: a new `EVAL_METRIC_LABELS` map, keyed by the names
  `EvalGate.cs:119-130` stores, with a raw fallback for any other key
  (`EvalGateCard.tsx:193`).
- The hidden-count sentence is pluralised (`hiddenDecidedText`).
- Maps: `automationRules.ts:300-325`.
- Tests: `automationConsoleRound2.test.tsx` › "labels the run kind, the watch
  kind and feed format, and a finding severity", "labels the mode and severity
  in the review queue's automation panel", "marks the current gate effective,
  labels its metrics …" (including a raw unknown key), "pluralises the
  hidden-count note".

### frontend-console-20

Status: fixed

- Queue, Watch and Email use the Decisions pattern. A Load more failure goes
  to `moreError: { forKey, text }`, shown inside the list's card next to Load
  more, and only while `forKey` is the current list key. It is no longer in the
  page-level `writeError` slot (`QueueTab.tsx:92-105, :322-328`;
  `WatchTab.tsx:154-168, :531-537`; `EmailTab.tsx:111-129, :280-286`).
- The shared `loadingMore` boolean is replaced by `loadingMoreKey` in all five
  lists (Decisions and Runs too). A Load more shows busy only for the key it
  was started for, and it is cleared only if it still belongs to that key.
- Tests: `automationConsoleRound2.test.tsx` › "queue|watch|email: shows the
  failure by its Load more and drops it with the list", "queue: a new filter
  does not show the abandoned Load more as busy". The existing "Load more never
  mixes two lists" tests still pass.

### frontend-console-21

Status: fixed

- e2e (`tests/e2e/automationConsole.spec.ts`): a dense stub adds:
  - a current gate with metrics and a revoked older gate (Revoke button shown);
  - `liveBlockedReason`, and a failing, stale runner with a last error;
  - a backlog above 0 with two `humanPublishItems`, and `unconfirmed: 2`;
  - a decision with two findings and three events;
  - a watch target with a title pattern.

  Three new axe scans run on it: the dense Overview, `?draftId=41`, and
  `?tab=watch&targetId=3` before and after opening the inline editor. 10 of 10
  pass locally.
- RTL: multi-page Open only, focus return (Close, Hide, Edit, Save, Cancel),
  the unconfirmed stat, the publish list, the gate history states and the
  targetId row. All are in `automationConsoleRound2.test.tsx`.
