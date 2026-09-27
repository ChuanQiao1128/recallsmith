# D07 — Automation console round 3: per-finding fixes ledger

Issue #476, R18A fix round 3 (R18D), wave C (console). Scope: `frontend/` and
this ledger only. Paths are relative to `frontend/`. Every fix is pinned by a
test that fails on the base (`delivery/r18d-c` = `main` @ 240e0a3) and passes
after it. The new tests live in four files; run against the base source, 38 of
their 44 tests fail:

- `tests/automationConsoleRound3.test.tsx`: page wiring (Overview, eval-gate card, Runs, Decisions).
- `tests/reviewVerdictShown.test.tsx`: the review queue (verdictShown, QA-flagged findings, the verdict told after a decision).
- `tests/automationContractDrift.test.ts`: the normalizers checked against the server's pinned shapes.
- `tests/automationRulesRound3.test.ts`: the pure rules.

Gates run: `npm run lint` (0 errors; the one warning is the existing
`DeckListPage.tsx:620`), `npx vitest run` (144 files, 1331 tests, all pass),
`npm run build`.

## Contract

- **M3 (console side).** `AutomationStatus.shadow` gains `blindDecided` and
  `blindAccepted` (`number | null`; null when an older server does not send
  them), normalised at `src/api/automation.ts:427`. `shadowAgreementText`
  (`src/lib/automationRules.ts:596`) prints
  `X of Y would-accept drafts decided blind were accepted unedited (Z%)` from
  blindAccepted, blindDecided and the server's `agreementRate`. It never
  computes a rate itself. A null rate next to a non-zero blindDecided reads
  "rate not reported". When blindDecided is 0 it prints "No blind decision
  yet.", and when an older server sends no blind counts it says so.
  `shadowTotalsText` (`:606`) is the second line:
  `N decided in all, M of them after seeing the verdict`, where M =
  humanDecided − blindDecided. Per the D01 rule, a decision without a recorded
  `verdictShown` counts as not blind, so M includes those.
  `shadowThresholdText` (`:613`) shows the runbook floor as `B / 100 blind
  decisions` (`SHADOW_BLIND_DECISIONS_TARGET`, `:581`). The Overview renders all
  three lines (`OverviewTab.tsx:351`).
- **M2 (console side).** `AutomationStatus.live: AutomationLive | null`
  (`{ autoAccepted30d, deletedByPerson, editedByPerson, overrideRate }`,
  normalised at `src/api/automation.ts:456`, null when absent). The Overview
  has a "Live quality (30 days)" card with the four numbers
  (`OverviewTab.tsx:364`). The override rate is a percentage, or "—" when the
  server sends null. An older server gets one line: "This server does not
  report live quality yet."
- **M4 (console side).** Covered under frontend-console-23 below. The console
  records failed reports after a confirm, refreshes after
  `400 EVAL_GATE_FAILED` just as after a success, and maps `EVAL_GATE_REVOKED`
  (by context) and `EVAL_GATE_STALE`.
- **M1 (console side, display only).** `EvalGate.authorConfigId`
  (`string | null`, `src/api/automation.ts:389`) is read when the server sends
  it, and the card shows it as "Author configuration" (`EvalGateCard.tsx:222`).
  Nothing depends on it.
- **automation-4 (console side, D01 contract).** Every accept and reject from
  the review queue of a draft that has an automatic decision sends
  `verdictShown: boolean` (`src/api/drafts.ts:279,311`;
  `ReviewQueuePage.tsx:98`, `withVerdictShown`). The rule is
  `verdictShownFor` (`src/lib/automationSurfaces.ts:71`), which returns true
  when any of these holds:
  - the panel was not blinded (live, or already decided);
  - the QA findings of a flagged draft were shown (frontend-console-26);
  - the person revealed the verdict on the Automation page first
    (`src/lib/automationVerdictSeen.ts`, frontend-console-25).

  Otherwise it returns false. A draft with no automatic decision has no verdict
  and its body is unchanged. The review queue is the only page in `frontend/`
  that accepts or rejects drafts (`acceptDraft`/`rejectDraft` have no other
  caller).

## Findings

### frontend-console-22

Status: fixed

- `src/api/automation.ts:62-80,427-430`: `blindDecided`/`blindAccepted` are
  part of the type and are normalised (null when absent).
- `src/lib/automationRules.ts:581-617`: `shadowAgreementText` prints the blind
  pair with the server rate and never falls back to humanAccepted/humanDecided.
  It says "No blind decision yet." when blindDecided is 0. `shadowTotalsText`
  and `shadowThresholdText` add the totals line and `B / 100 blind decisions`.
- `OverviewTab.tsx:349-362` renders the three lines.
- `tests/support/automationFixtures.ts`: the status fixture carries the blind
  pair and a rate that is blind-derived (4/5 = 0.8), not humanAccepted/humanDecided.
- Updated an existing assertion because the finding makes the old behaviour
  wrong: `tests/automationRules.test.ts` ("formats the runner and shadow
  numbers" block) pinned `'7 of 8 … accepted unedited by a person (87.5%)'` and
  `'No person has decided a would-accept draft yet.'`. It now pins the blind
  wording.
- Tests:
  - `automationConsoleRound3.test.tsx` › "shows the blind pair with the server
    rate, the totals and the go-live floor", "shows no rate when nothing was
    decided blind, whatever the non-blind counts say", "renders an older server
    without the blind counts and without live";
  - `automationRulesRound3.test.ts` › the four "shadow agreement" tests;
  - `automationContractDrift.test.ts` › "keeps blindDecided and blindAccepted,
    coercing numeric strings", "defaults both blind keys and live to null on an
    older server" (the wire test for the two new keys).

### frontend-console-23

Status: fixed

- (a) `evalGateReportProblem` (`src/lib/automationRules.ts:736`) no longer
  refuses `passed !== true`. It checks only JSON, `kind` and `v`.
  `evalGateReportFailed` (`:751`) detects a failed report, and
  `EvalGateCard.tsx:130` asks first with `EVAL_GATE_FAILED_CONFIRM`: "This
  report failed. Recording it makes it the newest evaluation, which blocks live
  mode."
- (b) On `400 EVAL_GATE_FAILED`, `EvalGateCard.tsx:142` clears the text, calls
  `setNonce(n => n + 1)` and `onChanged()` as on success, then shows
  `Recorded as gate #N (failed): live mode now runs as a dry run.` followed by
  the server's words. N is the newest gate of the reloaded history
  (`newestGateId`, `automationRules.ts:530`), because the 400 body carries no
  gate id (`src_C/Vpc/Automation/EvalGate.cs:150-160`). The old gate no longer
  shows as Effective with a Revoke button.
- (c) `evalGateRecordErrorMessage` (`:798`) maps `EVAL_GATE_REVOKED` on the
  record path to the L3 wording, "This report belongs to a revoked eval gate;
  run the evaluation again." On a revoke, `automationErrorMessage` still says
  "already revoked". `EVAL_GATE_STALE` is mapped (M4).
- `EVAL_GATE_FAILED` stays on the "mapped + server message" list, with L3
  wording: "…it is recorded as the newest evaluation, so live mode runs as a dry
  run."
- Updated existing assertions because the finding makes the old behaviour
  wrong:
  - `tests/automationRules.test.ts` ("checks a pasted eval gate report before
    sending it"): `passed:false` / `passed:"true"` are no longer refused.
  - `tests/automationRules.test.ts` ("maps the automation error codes…"): the
    `EVAL_GATE_FAILED` wording.
  - `tests/automationPage.test.tsx` ("records an eval gate report as a
    super_admin"): the failed report now opens the confirm (and Cancel sends
    nothing), and the refusal example uses `EVAL_GATE_INVALID`, since
    `EVAL_GATE_FAILED` now records.
- Tests:
  - `automationConsoleRound3.test.tsx` › "posts a failed report after the
    confirm and reloads after 400 EVAL_GATE_FAILED", "reloads after a
    server-recomputed failure of a report that claimed to pass", "says a
    re-posted revoked report needs a new evaluation, and maps a stale report";
  - `automationRulesRound3.test.ts` › the three "eval-gate card" tests.

### automation-21

Status: fixed (console side). The digest's agreement line (`AutomationTick.cs`,
`EmailTemplates.cs`) is in `src_C`, which is outside this issue's paths. It is
D01's side of M3.

- The console now has one definition: blindAccepted/blindDecided with the
  server rate (see frontend-console-22). The numbers on screen give the
  percentage shown.
- Tests: `automationRulesRound3.test.ts` › "renders blind 10/10 next to all
  40/50 as the blind figure" (the finding's own example: `'10 of 10 … (100.0%)'`
  plus `'50 decided in all, 40 of them after seeing the verdict.'`).

### frontend-console-24

Status: fixed

- `RunsTab.tsx:250-264`: the Outcome cell shows `r.error` under the outcome
  (`text-xs text-slate-600 break-words`), cut to 200 characters
  (`RUN_ERROR_CELL_MAX`, `:47`). `RunsTab.tsx:335-342`: the run's Decisions
  section, where the `?runId=` deep link of the runner_run_failed email lands,
  shows the full error in a "Why this run failed" callout.
- Tests: `automationConsoleRound3.test.tsx` › "shows the error under the
  outcome and in full in the run section" (fixture error `AGENT_BLOCKED: the
  source page needs a login`), "clips a long error in the table and keeps it
  whole in the run section".

### frontend-console-25

Status: fixed. The path is closed, and a reveal sends `verdictShown: true`.

- `decisionVerdictHidden` (`automationRules.ts:233`) is true for a dry-run
  decision nobody has decided that is `would_accept`, `qa_pending` or
  `qa_queued`.
- `DecisionTable.tsx` shows the neutral badge "Verdict hidden until you
  decide". It blanks the reason and the B/M/m counts, and adds a Reveal button
  (`:101`).
- `DecisionDetail.tsx:124` hides the state, reason, AI QA findings and events
  behind "Reveal verdict", with a warning that revealing counts the decision as
  not blind. Its "Decide in review queue" link stays, because deciding without
  revealing is a blind decision.
- A reveal is recorded by `markVerdictSeen` (`src/lib/automationVerdictSeen.ts`:
  kept in memory and mirrored to sessionStorage, with every access guarded). The
  review queue then sends `verdictShown: true` for that draft.
- A Decisions list filtered by state "Would be accepted" shows every verdict by
  its nature, so its rows are recorded as seen, and a note says so
  (`DecisionsTab.tsx:151,243`).
- A routed (`human`) row stays visible: it is the exception inbox, and its
  reason is why a person is involved. That row's verdict (human) is not in the
  would-accept population the blind rate measures.
- Tests:
  - `automationConsoleRound3.test.tsx` › "hides the verdict in the table until
    revealed, and records the reveal", "hides the verdict, findings and events in
    the drawer until revealed", "counts a list filtered by the would-accept state
    as seen";
  - `reviewVerdictShown.test.tsx` › "sends true when the verdict was revealed on
    the Automation page first (frontend-console-25)", "sends false for a blinded
    would-accept draft";
  - `automationRulesRound3.test.ts` › "hides a pending dry-run verdict that is
    not routed to a person".

### frontend-console-26

Status: fixed

- Before the decision: `automationQaFindingsShown`
  (`automationSurfaces.ts:59`) is true for a blinded dry-run draft in state
  `human` with reason `QA_FLAGGED` and blocker + major > 0.
  `DraftAutomationPanel.tsx:63` then shows "routed to you · AI QA found a
  blocker or major issue", the reviewer, the counts and every finding. The
  would-accept verdict and the decision link stay hidden. Blinding applies to
  the would_accept verdict, not to the findings that are the reason a person is
  involved.
- After the decision: `revealedVerdict` (`automationSurfaces.ts:82`) and
  `ReviewQueuePage.tsx:103,622` add the hidden verdict to the outcome callout,
  for example "The automation had routed this draft to you: AI QA found a
  blocker or major issue (AI QA: 1 blocker, 1 major, 0 minor)." with an "Open in
  Automation" link. The callout uses the warning tone after accepting a draft
  with blocker + major > 0.
- The existing C07 test "blinds a pending human-routed dry-run draft exactly
  like a would-accept one" is unchanged and still passes: its QA_FLAGGED
  fixture has 0 blocker / 0 major.
- Tests: `reviewVerdictShown.test.tsx` › "shows the blocker and major findings
  before the decision, without the decision link", "warns after accepting a
  blinded QA-flagged draft and names what the automation found", "tells the
  hidden would-accept verdict after a reject, without a warning", "keeps a
  would-accept draft and a flagged draft without serious findings blinded".

### frontend-console-27

Status: fixed

- (a) `DecisionsTab.tsx:223`: the checkbox reads "Open exceptions only (routed
  to you, still pending)". `OverviewTab.tsx:185-193`: in dry run, a line under
  the backlog says "Dry run: every pending draft also waits for you in the
  review queue.", linking `/review` (shown only when the server reports the
  backlog).
- (b) `DecisionTable.tsx:138`: an open routed row (`decisionDecidable`, state
  `human`, no human action, `automationRules.ts:248`) has a "Decide" link to
  `/review?deckId=…&draftId=…` next to Details. A would-accept row never gets
  one (see frontend-console-25).
- Updated existing label lookups (the label text changed on purpose):
  `tests/automationConsoleFixes.test.tsx` and
  `tests/automationConsoleRound2.test.tsx`.
- Tests: `automationConsoleRound3.test.tsx` › "labels the open filter by what
  the server applies and links an open routed row to Decide", "never offers
  Decide on a would-accept row", "says under the backlog that in dry run every
  pending draft waits in the review queue"; `automationRulesRound3.test.ts` ›
  "offers Decide only on an open routed decision".

### frontend-console-28

Status: fixed

- `RunsTab.tsx:163-181,357-372`: the run-decisions section pages with "Load
  more decisions", using the Decisions pattern (startKey plus a busy flag per
  key; a page for another run is dropped). It shows "N shown; this run has
  more." while a cursor remains.
- a11y: every problem message has its own id (`problemId`, `QueueTab.tsx:47`,
  `WatchTab.tsx:60`: `automation-queue-problems-<field>` /
  `automation-watch-problems-<field>`), and each invalid field's
  `aria-describedby` points at its own message.
- Updated an existing assertion because the finding makes the old behaviour
  wrong: `tests/automationConsoleFixes.test.tsx` ("marks every queue field that
  fails its check") now expects the per-field id.
- Tests: `automationConsoleRound3.test.tsx` › "loads the next page of a run
  with more than 50 decisions"; `automationConsoleFixes.test.tsx` › "marks every
  queue field that fails its check".

### frontend-console-29

Status: fixed

- `tests/automationContractDrift.test.ts` reads the server's pinned shapes
  straight from the src_C contract tests:
  - `StatusContractJson`, `RunnerKeys`, `RunKeys`, `RunCountKeys`,
    `PublishKeys`, `DecisionKeys` and `QaKeys` in
    `AutomationStatusRoutesTests.cs`;
  - `GateKeys` in `EvalGateTests.cs`;
  - `QueueItemKeys` in `AutomationQueueRoutesTests.cs`;
  - `WatchTargetKeys` / `WatchEventKeys` in `WatchAdminRoutesTests.cs`;
  - `NotificationKeys` in `AutomationNotificationsTests.cs`.

  The golden is the one the server asserts against, not a copy.
- The test builds raw responses from those pins and runs them through the real
  normalizers over the real `http` instance, with only the adapter replaced. It
  fails when a pinned server key is dropped without being listed in `IGNORED`
  (empty today). It also fails when the console reads a key the server does not
  pin without being listed in `TOLERATED` (only `status.live` and
  `evalGate.authorConfigId`, the optional R18D keys).
- A sanity test checks that the extraction found the pins, so the checks are
  never vacuous. Checked: with the base `src/api/automation.ts` restored, the
  status test fails with `shadow: server keys the console drops: [
  'blindDecided', 'blindAccepted' ]`.
- Tests: `automationContractDrift.test.ts` (9 tests).

## Deviations and notes

- **The status and gate pins come from D01's side.** The status test reads
  `StatusContractJson` from the src_C tests. When D01 adds `live` there, the
  check covers it: the console reads every M2 key. If D01 adds a key the console
  does not read (for example a new gate field), this test fails after the merge
  on purpose. The fix is to normalise the key or list it in `IGNORED` with a
  reason.
- **The run section's full error needs the run on the loaded page.** It comes
  from the loaded runs list. A deep link to a run past the first page of runs
  still shows the error in the run's row once that page is loaded.
- **What a hidden row still gives away.** On the Decisions tab, a pending
  dry-run row is either routed (visible) or hidden. A hidden row is a
  would-accept verdict or one still in AI QA. The review queue, where the
  person decides, stays fully blinded apart from the QA-flagged findings the
  issue direction requires.
