# G01 — Automation server round 6: fixes ledger

Issue #504, wave r18g-s, branch `delivery/r18gs/G01-504`. This is the sixth and final fix round of R18A (contract A00,
plus the K, L, M, N and O items of rounds B to F, and the P-items of R18G). Every code path is under `src_C/`; the one
other file is the shared fixture `services/ai-qa/tests/fixtures/automation_report.json`. Line numbers refer to the
branch head.

- No schema change and no migration 037. P1 reuses the `runner_stalled` subkind and P2 the `queue_item_failed` subkind
  (both already in the CHECKed subkind list), each under a new dedupe key. The new `RUN_FAILED_AFTER_DRAFTS` text goes
  into `authoring_queue_items.last_error`, a free-text column of at most 500 characters.
- The runbook lines the audit suggests (runner_stalled, runner_unavailable) are not written here:
  `docs/runbooks/` is another wave's root (the brief's Do NOT list). The texts they should describe are in the
  Contract section below.

Existing assertions changed because the finding makes the old behaviour wrong (none was weakened):

- `EmailTemplatesTests.WeeklyDigest_GoldenText`: the runner line now reads `Runner owner-mac: state idle, last
  heartbeat …` (automation-37: the digest must show the runner's state).
- `EvalGateTests.PostGate_RecordsTheReviewerEffort_AndLiveReadsIt`: its second half posted a report without
  `reviewer.effectiveEffort` and expected it to be recorded with no effort bound. It now expects 400
  `EVAL_GATE_INVALID` and that the earlier effort still binds (backend-design-26).
- `EvalGateTests.PassingReport()` now carries `reviewer.effectiveEffort = "high"`, as every evals report does
  (automation_gate.py writes it). The two tests that compared the live reviewer with a `GateReviewer` without an effort
  (`PostGate_PassingReport_IsRecorded`, `PostGate_OpenAiMantleProvider_IsAcceptedAndPinned`) now expect `"high"`.
  The verbatim A00 §15.4 constant `ContractReportJson` is unchanged.
- `AutomationRound5Tests.AiQaAutomationReportJson` is no longer an inline constant. It is read from the shared
  fixture file (backend-design-27). The tests that use it are unchanged.

## Findings

### automation-37
Status: fixed

- `src_C/Vpc/Automation/AutomationTick.cs:676-684`: `RunnerHealthAsync` also selects `state` and `last_error`. For each
  runner it selects the count of due queued items (`status = 'queued' and not_before <= now()`) and whether that runner
  started a run in the last `ErrorRunnerIdleHours` = 2 h (`:39`).
- `AutomationTick.cs:728-743`: a runner that is not stale but `IsStalledInError` (`:761`) raises `runner_stalled` under
  `exception:runner_stalled:{runnerId}:error:{UTC date}`. `IsStalledInError` means state = `error`, last_error not
  starting with `RUNNER_UNAVAILABLE`, at least one due item, and no run in 2 h. The facts carry `state = "error"`,
  `lastError`, and the due count as `queued`.
- `src_C/Vpc/Automation/EmailTemplates.cs:198-207`: the `runner_stalled` template has a `state == "error"` variant.
  - Subject: `Action needed: authoring runner X is running but cannot work`.
  - Summary: `… is running but cannot work: <last_error>. It started no run in 2 h while N due queue item(s) are
    waiting.`
  - Action line: rebuild tools/mcp-server and tools/author-runner, then run `status`.
- Digest: `AutomationTick.cs` (the digest's runner query) and `EmailTemplates.cs:31` (`DigestRunner` has `State` and
  `LastError`), `:503-506`. The runner line now reads `Runner X: state S, last heartbeat …, login expires …[, last
  error: …]`.
- Tests:
  - `AutomationTickTests.Tick_RunnerAliveInError_WithDueQueuedItems_AlertsOncePerDay`. Setup: an error heartbeat 1 min
    ago with an author config error, a due item, a second runner in error with a RUNNER_UNAVAILABLE last_error, and an
    idle runner. Exactly one email is sent, for the first runner, under the new key, and it names the last error. No
    email goes to the RUNNER_UNAVAILABLE or idle runner. A second tick sends nothing.
  - `AutomationTickTests.Tick_RunnerInError_DoesNotAlert_WhenNothingIsDue_OrItStartedARunRecently`. There is no alert
    while the only item is not yet due, and none while the runner started a run 30 min ago. There is one alert once that
    run is 3 h old.
  - `EmailTemplatesTests.Exception_RunnerStalledInError_NamesTheLastErrorAndTheFix`,
    `EmailTemplatesTests.WeeklyDigest_RunnerLine_ShowsStateAndLastError`, and the new `ExceptionCases` row.

### automation-36
Status: fixed

- `src_C/Vpc/Automation/RunnerRoutes.cs:620-625`: `AfterCompleteAsync` handles a failed complete that finished its item
  as `done` with a `RUNNER_UNAVAILABLE_AFTER_DRAFTS` (or, from backend-design-25, `RUN_FAILED_AFTER_DRAFTS`) last_error.
  It raises `RaiseItemPartialAsync` (`:645-652`): subkind `queue_item_failed`, dedupe `exception:queue_item_partial:{itemId}`.
- `src_C/Vpc/Automation/EmailTemplates.cs:242-250`: the `queue_item_failed` case has a
  `when RunnerRoutes.IsFinishedAfterDrafts(lastError)` variant.
  - Subject: `Action needed: queue item N stopped after submitting drafts`.
  - Body: the item is finished and will not be authored again. Its drafts are in the review queue, and any part of the
    page it had not drafted yet was not authored. It tells the owner to review the drafts, then re-add the URL in the
    Queue tab to author the remaining facts, with the `tab=queue` link. Re-adding a URL whose item is done is allowed
    (QueueRoutes only refuses a queued or claimed duplicate).
- The runner_unavailable text is fixed under cloud-security-resilience-1.
- Tests:
  - `AutomationNotificationsTests.RunnerComplete_RunnerUnavailableAfterDraftsWereSubmitted_FinishesTheItem_WithoutARequeue`
    (extended). It checks the partial email (subkind, subject, the re-add sentence and the Queue link), the
    runner_unavailable body for a done item, and that no notification of the run contains "put back". It also checks
    that exactly two messages are sent.
  - `EmailTemplatesTests.Exception_QueueItemPartial_TellsHowToAuthorTheRest` and the new `ExceptionCases` row.

### backend-design-25
Status: fixed

- `src_C/Vpc/Automation/RunnerRoutes.cs:435-446`: a failed complete that would be requeued checks `RunSubmittedDraftsAsync`
  first. That is the generic retry branch: not `RUNNER_UNAVAILABLE`, not `AGENT_BLOCKED`, attempts < 3. If the run
  submitted drafts, the item is finished as `done` with its attempt kept, and last_error is `RUN_FAILED_AFTER_DRAFTS:
  the run submitted draft(s) before it failed, so the item is not authored again; last: <error>`. That text is capped
  at 500 (`RunFailedAfterDraftsError`, `:515`; constant `:58`). `RunSubmittedDraftsAsync` is now `internal`.
- Branches that never requeue keep their behaviour: `AGENT_BLOCKED`, which fails the item at once, and the third
  attempt, which fails it.
- `runner_run_failed` still follows `RunFailureNeedsHuman`, which is unchanged. A first timeout sends none, and a
  repeated or actionable failure still sends one. The owner is told about the finished item by the P2 per-item email.
- `src_C/Vpc/Automation/AutomationTick.cs:222-234`: `ExpireLeasesAsync` reads the item's `last_run_id`. When a lease
  that would be requeued (attempts < 3) belongs to a run that submitted drafts, the item is finished as `done`. Its
  attempt is kept, and last_error is `RUN_FAILED_AFTER_DRAFTS: …; last: LEASE_EXPIRED`. The run is abandoned as
  before. After the commit the same P2 per-item email is raised (`:263-267`).
- Tests:
  - `AutomationNotificationsTests.RunnerComplete_TimeoutAfterDraftsWereSubmitted_FinishesTheItem_WithoutARequeue`. A
    `timeout` complete after a submitted draft leaves the item done with 1 attempt kept, no lease, the run finalised,
    no runner_run_failed email and one partial email. A timeout without drafts still requeues.
  - `AutomationTickTests.Tick_ExpiredLease_AfterASubmittedDraft_FinishesTheItem_WithoutARequeue`. A lease expiry after a
    submitted draft does not requeue: the item is done, the run is abandoned, and the partial email is sent. The run
    without drafts is still requeued.
  - `AutomationNotificationsTests.RunFailedAfterDraftsError_IsCappedAt500`.
  - The existing `Tick_ExpiredLease_RequeuesThenFails` and `RunnerComplete_TransientFirstFailure_RaisesNoEmail` still
    pass unchanged.

### backend-design-26
Status: fixed

- `src_C/Vpc/Automation/EvalGate.cs:350-352, 375-405`: `GateReport.Read` parses `reviewer.effectiveEffort`
  (`EffectiveEffortOf`).
  - When present it must be a string of 1..`AiQaResults.MaxLabelLength` (100) characters, else 400 `EVAL_GATE_INVALID`.
    The limit is the most a QA report's `effectiveEffort` can carry, so a longer gate effort could never match. This is
    a deliberate choice instead of the audit's suggested 128.
  - It is required when `reviewer.provider` is an automation gate provider (`openai-mantle`, `bedrock-converse`). A
    report without it is refused with 400 `EVAL_GATE_INVALID`, as the specific direction says, and nothing is recorded.
  - For another provider it stays optional. That report is still recorded as failing on `reviewer.provider`.
- Evaluate and `CheckNames` are unchanged. A passing report must have an automation provider, so every recorded passing
  gate now carries an effort.
- `DraftQaResults.cs:182` keeps `reviewer.Effort is null || …`. The only way a gate row is written is this POST, which
  now refuses a report without an effort. So the leniency applies only to a row recorded before this change (none
  passed in production), or to a row inserted directly by the SQL test fixtures (`AutomationTestKit.InsertGateAsync`).
  `AutomationRound4Tests.LiveReport_GateWithoutEffort_BindsNone` still pins that legacy-row behaviour. It is kept, not
  deleted.
- Tests:
  - `EvalGateTests.PostGate_AutomationReviewerWithoutEffectiveEffort_Returns400Invalid_AndRecordsNothing`. For both
    automation providers it posts a report with the effort missing, null, empty, a number, or too long. Each is 400
    `EVAL_GATE_INVALID` naming `reviewer.effectiveEffort`, and the gate count is unchanged. A report from another
    provider without an effort is recorded as failing on `reviewer.provider`.
  - `EvalGateTests.PostGate_RecordsTheReviewerEffort_AndLiveReadsIt` (updated, see above).

### backend-design-27
Status: fixed (the src_C side; the ai-qa suite's assertion on the same file lands in G02)

- New shared golden file `services/ai-qa/tests/fixtures/automation_report.json`. It is the ai-qa automation draft report
  exactly as `handler._report` serializes it (json.dumps, sort_keys, compact separators), with representative values:
  the production reviewer `openai-mantle` / `openai.gpt-5.5`, `qa-v4-auto`, effort `high`, and placeholder
  `<run_id>`, `<sha256>`, `<request_id>`.
- `src_C/Tests/RecallSmith.Lambda.IntegrationTests/AutomationRound5Tests.cs:24-72`: the inline
  `AiQaAutomationReportJson` constant is gone. The test reads the file from the repository (`RepoRoot()` walks up to
  it). `AiQaReport` puts the draft's values into the fixture's existing keys. `Set` fails when a key is missing or its
  JSON value kind changes, so a producer-side rename or type change that updates the fixture fails here.
- Tests:
  - `AutomationRound5Tests.AiQaReportFixture_IsTheSharedFile_WithTheProducersSerialization` (new): the file is compact
    with keys sorted at every level (the producer's serialization), has profile `automation`, target `draft` and v 1,
    and has the done-item key set.
  - `AiQaReportFixture_HasTheAutomationReportKeys`, `LiveAiQaReport_WithTheGatesEffort_IsAutoAccepted`,
    `LiveAiQaReport_WithoutEffectiveEffort_FailsClosed`, and
    `DryRunAiQaReport_WithTheGatesEffort_RecordsThatTheReviewerMatchesTheGate` now all run on the shared file.

### cloud-security-resilience-1
Status: fixed

- `src_C/Vpc/Automation/RunnerRoutes.cs:606`: the `runner_unavailable` facts carry `itemStatus`.
- `src_C/Vpc/Automation/EmailTemplates.cs:302-309`: the summary depends on it.
  - `done`: `Queue item N had submitted drafts before it stopped: its drafts are in the review queue and the item is not
    authored again.`
  - `failed` (the N3 third-in-a-row case, which was also mis-described): `Queue item N was not put back: it failed for a
    person to look at.`
  - `queued`, or a caller without the fact: the old `was put back without using an attempt.`
  - `itemStatus` is listed in the DETAILS facts.
- Together with the P2 per-item email (automation-36), the owner of a partly authored page gets the correct instruction.
- Tests: `EmailTemplatesTests.Exception_RunnerUnavailable_SaysPutBackOnlyForARequeuedItem` and the extended
  `AutomationNotificationsTests.RunnerComplete_RunnerUnavailableAfterDraftsWereSubmitted_FinishesTheItem_WithoutARequeue`
  (no notification of the run says "put back").

## Contract

- P1 (stalled runner): implemented as specified. The tick raises `runner_stalled` under
  `exception:runner_stalled:{runnerId}:error:{UTC date}` when all of these hold:
  - the runner's heartbeat is fresh (not stale);
  - its state is `error`;
  - its last_error does not start with `RUNNER_UNAVAILABLE`;
  - queue items are due (`queued`, `not_before <= now()`);
  - it started no run in the last 2 h.

  The email names last_error. The stale-heartbeat alert and its key `exception:runner_stalled:{runnerId}:{date}` are
  unchanged. The digest's runner line shows state and last error. Runbook text for the docs wave: "runner is running
  but cannot work: read last_error; for `author config: …` rebuild tools/mcp-server and tools/author-runner and run
  `status`".
- P2 (partial item): an item finished `done` by a `RUNNER_UNAVAILABLE`-after-drafts complete raises the
  `queue_item_failed` partial variant under `exception:queue_item_partial:{itemId}`. The same email is sent for an item
  finished after drafts by another failure or a lease expiry (`RUN_FAILED_AFTER_DRAFTS`, backend-design-25). The
  runner_unavailable email says "put back" only for a requeued item. Runbook text for the docs wave: under
  runner_unavailable, "RUNNER_UNAVAILABLE_AFTER_DRAFTS / RUN_FAILED_AFTER_DRAFTS: the item is done and not re-authored;
  review its drafts, then re-add the URL in the Queue tab if the page has more to author".
- P3 (no local sources in automation): not touched here. It is the MCP server's side (tools wave).
- P4 (one neutral blind panel): not touched here. It is the console's side (frontend wave). The server's decision and
  review routes are unchanged.
- K1-K7, L1-L6, M1-M6, N1-N6 and O1-O2 stay in force. N2 is now fail-closed at gate intake as well (backend-design-26).
  O1's report shape is pinned by the shared fixture (backend-design-27).
