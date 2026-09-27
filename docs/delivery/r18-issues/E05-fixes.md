# E05: Automation console, fix round 4 (R18E wave C)

Issue #489. The console side of N1 and N5. Scope: `frontend/` and this ledger only. Base: `delivery/r18e-c` = `main` @ ee7d84c.

Gates run on the branch: `npm run lint` (0 errors; the one warning is in the untouched `DeckListPage.tsx`), `npx vitest run`
(146 files, 1367 tests), `npm run build`. Each new test was run against the base `src/` (`git checkout ee7d84c -- src`) and
failed there: 31 of the 53 tests in the four touched or new files failed. It passes with the fix.

## Findings

### frontend-console-30
Status: fixed

The Automation page now hides verdicts the same way the review queue's `automationBlinded` does. A dry-run row that
nobody has decided and that is still pending (not `superseded`, not `auto_accepted`) is hidden, whatever its state.
- `frontend/src/lib/automationRules.ts:241` `decisionVerdictHidden`: the `would_accept|qa_pending|qa_queued` list
  is gone. A pending routed (`human`) row is hidden too.
- `frontend/src/features/automation/DecisionTable.tsx:145-148`: a hidden row also withholds the AI QA reviewer and
  the cost, as well as B/M/m. Whether AI QA ran at all separates a row routed before QA from the others.
  `:159`: every hidden row gets the same Decide link (`hidden || decisionDecidable(d)`), so the link no longer marks
  the routed rows. The drawer already offered "Decide in review queue" on every hidden draft.
- `frontend/src/features/automation/DecisionsTab.tsx:151`: any state or reason filter marks every row of the list as
  seen, not only `would_accept` (`decisionListShowsVerdict`, `automationRules.ts:252`). The filter itself names the
  verdict. The open-exceptions view (`state=human&open=1`) is unchanged: it shows its rows and marks them seen.
  The effect records only the list loaded for the current filters. `:244`: `revealAll` is false while another
  filter's list is loading. Before, the old unfiltered rows flashed their verdicts under a new filter without being
  marked seen.
- `frontend/src/features/automation/RunsTab.tsx:194,283` and `automationRules.ts:270` `runSplitShown`: when the
  effective mode is not live, the Runs table shows only `N submitted` and "split hidden until every draft is decided
  (dry run)", and `—` for In QA. The split appears only once no draft of the run can still be pending. Either the
  counts prove it (every draft superseded or auto-accepted), or the run's decisions are all loaded (no `nextCursor`)
  and none of them is hidden. `frontend/src/pages/AutomationPage.tsx:164-170` passes the status's effective mode.
  An unknown mode (status not loaded) counts as not live.
- Existing assertions updated because the finding makes the old behaviour wrong:
  - `automationRulesRound3.test.ts` "hides a pending dry-run verdict…" is now "hides every pending undecided dry-run
    verdict, a routed one too". `human` pending is now hidden.
  - `automationConsoleRound3.test.tsx` "never offers Decide on a would-accept row" is now "…whose verdict shows". A
    hidden row now gets Decide whatever its state, so the case is checked on the `state=would_accept` list.
  - `automationConsoleFixes.test.tsx` "labels a handled human decision…" and `automationPage.test.tsx` "shows the
    decision detail…" use a live-mode open row. In dry run that row is now hidden. Their subject (handled vs open
    labels, the drawer contents) is unchanged.
- Tests (`frontend/tests/automationConsoleRound4.test.tsx`, "every pending dry-run row hides its verdict alike"):
  - "renders no distinguishing badge, reason, QA counts or Decide link between a would-accept and a routed row":
    every cell of the two rows is identical.
  - "shows a routed row in live mode as before"
  - "hides a pending routed draft in the drawer too"
  - "records the rows of any state-filtered list as seen, the open exceptions too"
  - "records the rows of a reason-filtered list as seen"
  - "shows no split of a dry-run run with pending drafts, the would-accept count included"
  - "shows the split once the run's decisions are all loaded and none is pending"
  - "keeps the split hidden while a page of the run is not loaded"
  - "shows the split in live mode"
- Rule tests in `frontend/tests/automationRulesRound4.test.ts`: "the verdict a list filter shows" and "a run's state
  split".

### frontend-console-31
Status: fixed (console side; the server's `authorConfigId` in `EvalGate.ToGate`/`GateKeys` belongs to src_C under N1)

- `frontend/src/lib/automationRules.ts:49`: `AUTHOR_NOT_GATED` is added to `DECISION_REASONS`, last, as in
  `AutomationReasons.DecisionReasons`. `:137` labels it "Author configuration differs from the eval gate", the email
  template's wording. The Reason select offers it (it iterates the list), `decisionFiltersFrom` keeps
  `?reason=AUTHOR_NOT_GATED`, and tables show the label instead of the raw code.
- `frontend/src/features/automation/EvalGateCard.tsx:226-232`: the gate card always shows an "Author configuration"
  row. It gives the full id (break-all), which the runbook's go-live check compares with the id the runner uses now.
  When the gate has no author id it says "Not recorded (…)". Before, the row simply disappeared. The normalizer
  already kept the key (`src/api/automation.ts:389`).
- `frontend/tests/automationContractDrift.test.ts`: reads `AutomationReasons.DecisionReasons`/`PublishReasons`
  (`src_C/Vpc/Automation/AutomationReasons.cs`) and `StatusRoutes.DecisionStates`/`PublishStates`. It asserts they
  equal `DECISION_REASONS`, `PUBLISH_REASONS`, `DECISION_STATES` and `PUBLISH_STATES`, in order. `TOLERATED.evalGate`
  is now `GATE_KEYS.includes('authorConfigId') ? [] : ['authorConfigId']`. The tolerance ends by itself once src_C
  pins the key under N1, and the check is exact from then on. It is not removed outright because this wave cannot
  edit `EvalGateTests.cs`, and removing it now would fail the test until the src_C side merges.
- Existing assertion updated: `automationRules.test.ts` `CONTRACT_DECISION_REASONS` gains `AUTHOR_NOT_GATED`. The
  contract grew in R18D and the old list was the drift.
- Tests:
  - `automationContractDrift.test.ts` "the console knows every reason and state the server does": 5 tests, one of
    them "keeps the gate author id on the wire (N1)".
  - `automationConsoleRound4.test.tsx`:
    - "offers the reason in the filter, keeps it from the URL and labels it"
    - "shows the current gate's author configuration id in full"
    - "says when the gate records no author configuration"
  - `automationRulesRound4.test.ts` "AUTHOR_NOT_GATED".

### frontend-console-32
Status: fixed

- `frontend/src/lib/automationVerdictSeen.ts`: the reveal record lives in `localStorage`, which every tab of the
  origin shares. It is no longer in per-tab `sessionStorage`.
  - Every read looks at the stored entry again (it re-parses only when the text changed). So a reveal another tab
    writes after this module loaded counts too.
  - A write merges the stored entry first, so it never drops another tab's reveals.
  - The bound (500 ids) and the guards stay. A damaged entry is ignored.
  - Round 3's per-tab `sessionStorage` entry is carried over once, so a reveal made before the deploy still counts.
- `verdictSeenElsewhere` (`automationVerdictSeen.ts:105`) is what `ReviewQueuePage.tsx:100` now sends. It is true
  when a reveal is recorded, or when storage threw on a read or a write. Without storage, a reveal in another tab
  cannot be ruled out, so the decision falls back to "shown" (N5, D01's "never claim blind when unsure"). The page's
  own hiding still uses the in-memory set (`wasVerdictSeen`).
- Tests:
  - `automationRulesRound4.test.ts` "the reveal record is shared across tabs":
    - "a reveal written by one module instance is read by a fresh one"
    - "a reveal another tab writes after this one loaded still counts"
    - "carries round 3's per-tab entry over"
    - "ignores a damaged entry"
    - "falls back to "shown" when storage is unavailable"
  - `reviewVerdictShown.test.tsx` "sends true when another tab of the browser revealed the verdict".

### frontend-console-33
Status: fixed

- `frontend/src/features/automation/DecisionTable.tsx:60-73,124-129`: the revealed row's state cell is a
  `tabIndex=-1` container. An effect keyed on the last revealed id focuses it, so focus no longer falls to `<body>`
  when the Reveal button removes itself.
- `frontend/src/features/automation/DecisionDetail.tsx:63-67,149-155`: the drawer's revealed verdict block is
  focusable and takes focus after "Reveal verdict".
- Tests (`automationConsoleRound4.test.tsx`, "focus after a Reveal control removes itself"):
  - "moves focus to the revealed state in the table"
  - "moves focus to the revealed verdict in the drawer"
  - Both assert `document.activeElement` is not `body` and is the revealed element.

### frontend-console-34
Status: fixed

- `frontend/src/lib/automationRules.ts:627`: `SHADOW_AGREEMENT_TARGET = 0.95` sits next to
  `SHADOW_BLIND_DECISIONS_TARGET`. `:667` `shadowThresholdText` now reads
  `≥ 100 blind decisions (37) and ≥ 95.0% agreement (80.0%)`, or `(no rate yet)` when the server's rate is null.
  `:674` `shadowFloorMet` is true only when both halves pass. Both numbers are the server's.
- `frontend/src/features/automation/OverviewTab.tsx:359-373`: "Go-live floor: …" plus a Met / Not met badge.
- Existing assertions updated: the old floor text named only the count half, which the finding makes wrong.
  - `automationRulesRound3.test.ts`: two `shadowThresholdText` expectations.
  - `automationConsoleRound3.test.tsx`: the floor text. In "shows no rate when nothing was decided blind", the
    no-`%` check is now scoped to the blind line, because the floor names the 95% bar.
- Tests:
  - `automationConsoleRound4.test.tsx`:
    - "reads not met at 100 blind decisions with 80% agreement"
    - "reads met once both halves pass"
  - `automationRulesRound4.test.ts` "the go-live floor has both halves".

## Contract

- **N1** (console side): `authorConfigId` is read from the eval-gate shape (current and history). It was already
  normalized, and is now always shown on the gate card, or marked not recorded. `AUTHOR_NOT_GATED` is in
  `DECISION_REASONS`, the labels and the filters, with the email template's wording. The drift test compares the
  console's reason and state lists with the server source. It becomes exact on `evalGate.authorConfigId` as soon as
  src_C's `GateKeys` pins it.
- **N5**:
  - While a row's mode is `dry_run`, every pending undecided draft row on the Automation page hides its state,
    reason, AI QA counts, reviewer and cost. This covers the Decisions list, run sections and the Overview's
    drill-down links, which open the Decisions list. Each such row carries the same Decide link.
  - The per-run state split on the Runs table shows only when the effective mode is live, or when no draft of the
    run can be pending.
  - State- and reason-filtered lists count as shown and record their rows as seen.
  - Reveals are recorded in `localStorage`, wrapped in try/catch and shared across tabs. When storage is
    unavailable, a decision sends `verdictShown: true`.
  - Focus moves to the revealed verdict after a reveal.
- N2, N3, N4 and N6 are other waves' roots (src_C, the runner, email). This issue does not touch them.

## Deviations and notes

- Row hiding keys on the row's own `mode` (`dry_run`), as the review queue's `automationBlinded` does. The run split
  keys on the status's effective mode, because a run carries no mode. It is hidden in `off` and while the status is
  unknown as well as in `dry_run`: pending dry-run drafts still count as blind in `off`, so that is the safe side.
- The run split is judged from the run's loaded decisions only for the open run (`?runId=`). A run table row cannot
  tell a decided `human`/`would_accept` draft from a pending one without the server's help: both keep their state
  (A00 §5.3). So an unopened dry-run run with any `would_accept` or `human` draft shows only its total. A
  server-side `pending` count per run would lift this. It would be an addition in src_C, not part of this wave.
- The AI QA reviewer and cost cells are hidden on a hidden row too. The audit named state, reason, B/M/m and the
  Decide link, but whether AI QA ran at all would still separate a row routed before QA.
- The gate card shows the full author id instead of the first 12 characters, because the runbook's check compares
  it with the runner's id.
