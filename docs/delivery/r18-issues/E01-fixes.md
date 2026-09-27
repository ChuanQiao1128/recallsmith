# E01 — Automation server round 4: fixes ledger

Issue #485, wave r18e-s, branch `delivery/r18es/E01-485`. This is the fourth and last fix round of R18A (contract A00,
the R18B K-items, the R18C L-items, the R18D M-items and the R18E N-items). Every path is under `src_C/`. Line numbers
refer to the branch head.

- No schema change. Migration 037 is not needed: the gate's author reuses the column of 036, and its fallback
  (`AutomationMode.GateAuthorSql`), and the gate's reviewer effort is read from the stored report jsonb. No new reason
  or status value goes into a CHECKed column: `RUNNER_UNAVAILABLE_REPEATED` goes into `authoring_queue_items.last_error`,
  which is free text of at most 500 characters. Migrations 034 to 036 are untouched.
- The full integration suite passes: `dotnet test Tests/RecallSmith.Lambda.IntegrationTests` (2561 tests).

Some existing assertions changed because the finding makes the old behaviour wrong. Each case is listed under its
finding. No assertion was weakened; each changed test now pins the new, stricter behaviour.

## Findings

### backend-design-21
Status: fixed (server side of N1)

- `Vpc/Automation/EvalGate.cs:77` `GateColumns(authorColumn)` selects
  `AutomationMode.GateAuthorSql(authorColumn) as author_config_id` over the row alias `g`. This is the stored
  `author_config_id`, else the report's `authored.author.authorConfigId`. It is the same expression the mode resolver
  compares with, so the card shows exactly the author that live enforces.
  - Every gate query uses it: GET history (:100), both insert `RETURNING` clauses (`insert ... as g`), revoke (:248,
    `update ... g`), and `LoadCurrentAsync` (:470), which also feeds `status.evalGate`.
  - The column is probed (`AuthorColumnAsync`, which now takes an optional transaction), so a database at 035 answers
    the id from the report.
- `EvalGate.cs:529` `ToGate` emits `authorConfigId` (string or null).
- `Vpc/Automation/DraftQaResults.cs:52` `AuthorNotGatedDetail`: the AUTHOR_NOT_GATED `reason_detail` now reads
  `draft author X, gate author Y`. It says `draft has no authorConfigId` or `gate names no author` when one side is
  missing. Two 128-character ids make 283 characters, under the 300 CHECK.
- Tests:
  - `EvalGateTests.PostGate_StoresTheAuthorConfigId_AndLiveReadsIt` asserts `authorConfigId` on the POST answer, on
    GET current and history, and on the revoke answer. It is null for the unbound gate.
  - `EvalGateTests.EffectiveMode_Before036_ReadsTheGatedAuthorFromTheStoredReport` asserts the report fallback on the
    POST answer and on GET current.
  - `GateKeys` (EvalGateTests.cs:45) now pins `authorConfigId`. The console's contract-drift test reads this list, so the
    key is pinned rather than only TOLERATED. Removing it from the console's TOLERATED list is the console wave's side.
  - `AutomationRound4Tests.AuthorNotGatedDetail_NamesBothAuthors` and
    `AuthorNotGatedDetail_OfTwoMaximalIds_FitsTheReasonDetailColumn` cover the detail.
  - Updated assertions: `AutomationRound3Tests.LiveReport_DraftOfAnotherAuthor_RoutesHumanAuthorNotGated` and
    `LiveReport_DraftWithoutAuthorConfigId_RoutesHumanAuthorNotGated`. They pinned the draft-only detail, which this
    finding asks to extend. `LiveReport_GateWithoutAuthor_RoutesHumanAuthorNotGated` gains a detail assertion.

### automation-28
Status: fixed (server side; the same change as backend-design-21)

- The gate shape carries `authorConfigId` on every surface: GET current and history, the POST answer, revoke, and
  `status.evalGate`. The card's 'Author configuration' row and runbook step 5 can now be checked.
- Declined here, as out of this issue's paths: the runner's `status` command and heartbeat reporting its own
  authorConfigId (`tools/author-runner`, the runner wave). The heartbeat route was left unchanged: the contract N-items
  add no heartbeat field, and a key the runner does not send would stay null.
- Tests: the same as backend-design-21.

### ai-agent-26
Status: fixed (server side of N2)

- The field name comes from services/ai-qa. `providers.effective_effort(cfg)` is what the handler logs as
  `effectiveEffort` (`handler.py:491-502`), and the gate report records the same value as `reviewer.effectiveEffort`
  (`evals/.../automation_gate.py:129-133`). Core reads a top-level optional `effectiveEffort` string (at most 100
  characters) on the draft-QA report.
  - `Vpc/Internal/AiQaResults.cs:488`: parsed into `Report.EffectiveEffort`. A non-string value is 400.
- `Vpc/Automation/AutomationMode.cs:111` `GateEffortSql` reads the gate's `report #>> '{reviewer,effectiveEffort}'`.
  `GateReviewer` (:125) gains `Effort` (null when the gate recorded none).
- `Vpc/Automation/DraftQaResults.cs:178-182`: `reviewerMatchesGate` also requires
  `reviewer.Effort is null || reviewer.Effort == report.EffectiveEffort`.
  - At live, a mismatch goes to a human with the existing `REVIEWER_NOT_GATED` reason.
  - A report without the field fails closed against a gate that recorded an effort.
  - Dry run records the result in `reviewerMatchesGate`.
- Tests:
  - `AutomationRound4Tests.LiveReport_EffortOtherThanTheGates_RoutesHumanReviewerNotGated` (`high` and a missing
    effort).
  - `LiveReport_EffortOfTheGate_IsAutoAccepted`.
  - `LiveReport_GateWithoutEffort_BindsNone`.
  - `DryRunReport_RecordsThatTheEffortDoesNotMatchTheGate`.
  - `Report_EffectiveEffortThatIsNotAString_Returns400`.
  - `EvalGateTests.PostGate_RecordsTheReviewerEffort_AndLiveReadsIt`.

### automation-31
Status: fixed (server side of N3)

- `Vpc/Automation/RunnerRoutes.cs:374-399`. A `RUNNER_UNAVAILABLE` complete still gives the claim's attempt back.
  - The item is requeued with `not_before = now() + min(15 min × 2^(n-1), 24 h)` (`RunnerUnavailableBackoff`, :452).
  - n (`ConsecutiveRunnerUnavailableAsync`, :466) counts the item's newest terminal runs, newest first, that are
    `failed` with a `RUNNER_UNAVAILABLE:` error, and stops at the first run that is not. The current run counts.
  - At n >= 3 (`MaxRunnerUnavailableCompletes`), the item is not requeued. It goes to the terminal `failed` state with
    `last_error = 'RUNNER_UNAVAILABLE_REPEATED: 3 runs in a row could not run; last: <error>'`, capped at 500.
- Email, deduplicated:
  - `AfterCompleteAsync` raises the existing per-item `queue_item_failed` exception (`exception:queue_item_failed:<id>`).
  - `Vpc/Automation/EmailTemplates.cs:223` gives it its own wording: "queue item N could not run 3 times in a row".
    That points the owner at the item, not only at the Mac.
  - The daily `runner_unavailable` email stays.
  - No per-run `runner_run_failed` email is sent, because the item failed.
- Out of this issue's paths: tightening the runner's usage-limit regex (`tools/author-runner`, the runner wave).
- Tests:
  - `AutomationNotificationsTests.RunnerComplete_RunnerUnavailable_BacksOffExponentially_AndFailsTheItemOnTheThirdInARow`
    (15 min, then 30 min, then failed, with one deduplicated exception).
  - `RunnerComplete_RunnerUnavailable_CountsOnlyConsecutiveCompletes`.
  - `RunnerUnavailableBackoff_Doubles_UpToADay`.
  - Updated assertion: `RunnerComplete_RunnerUnavailable_RequeuesWithoutAnAttempt_AndAlertsOncePerDay` asserted that
    the item was due at once. N3 makes that wrong, so it now asserts the item is not yet due.

### automation-4
Status: fixed (server side of N6)

- `Vpc/Automation/EmailTemplates.cs:330-384` `BatchSummary`. `BatchDraft` gains `Decided`, and an unknown value counts
  as pending. In dry_run, while any draft of the run is undecided, the email is state-free:
  - The subject is `Batch <id> <deck>: N draft(s) wait for you`.
  - The summary gives only the submitted and waiting totals.
  - DETAILS has neither 'Drafts by state' nor 'Routed to you by reason'.
  - The publish outcome is hidden: a publish row exists only when some draft would be accepted, so "no publish" or
    "would publish" reveals the verdict on a small run. DETAILS says `Publish: hidden until every draft of this run
    is decided`.
  - Once every draft is decided, the counts come back.
- `Vpc/Automation/StatusRoutes.cs:60` `UndecidedDraftSql` defines undecided: no human action, a state a person still
  has to decide, and the draft still `pending`. `Vpc/Automation/AutomationTick.cs:468` computes `decided` per draft for
  the summary.
- Digest (`AutomationTick.cs:769-790`, `EmailTemplates.cs:424`). In dry_run:
  - The per-state and per-reason counts, and the would-accept total, leave out the decisions of runs that still have
    an undecided draft. A DETAILS line says how many runs were left out.
  - The needs-you line counts every waiting draft, not the ones routed to a person, which would reveal the rest by
    elimination.
  - The human-decided agreement numbers are unchanged. They keep the status's definition, and a decided draft is no
    longer blind.
- Out of this issue's paths: recording reveals on the server beyond the existing `verdictShown` (the console wave, N5).
- Tests:
  - `EmailTemplatesTests.BatchSummary_DryRun_NoVerdictLeaksWhileADraftIsUndecided` covers a one-draft run, a
    single-verdict run and a partly decided run: neither 'would_accept' nor 'auto-accepted' nor any count, reason or
    publish label appears in the subject or body.
  - `BatchSummary_DryRun_AllDecided_ShowsTheCounts`.
  - `WeeklyDigest_DryRun_CountsOnlyTheWaitingDrafts`.
  - Updated assertions, which pinned the leaking counts this finding asks to remove:
    - `BatchSummary_GoldenText`: the dry-run golden is now the state-free text. The dry-run "publish would need you"
      subject check uses decided drafts.
    - `BatchSummary_DryRun_ListsNoDraftOfTheRun`: 'Drafts by state' is now absent.
    - `AutomationTickTests.Tick_FinalRun_EnqueuesOneBatchSummary` (the batch summary subject, and `QA_FLAGGED` now absent).
    - `Tick_Digest_ReportsTheOpenBacklog_NotTheWeeksHumanRows`: the dry-run needs-you line, plus the left-out-runs line.
  - `AutomationNotificationsTests.Request` now renders `EmailTemplatesTests.DecidedBatch()`, so the literal A00 §12.5
    SQS contract subject still matches.

### automation-29
Status: fixed

- `Vpc/Automation/StatusRoutes.cs:343-385` `LoadLiveQualityAsync`. An auto-accepted card is not counted as edited or
  deleted by a person when the source watch recorded its cited page (`cards.source->>'url'` equal to
  `source_watch_targets.url`) as `changed` or `gone`. The event must come after the accept (`decided_at`) and no later
  than the card's last change (`updated_at`), as defined by `SourceChangedBeforeUpdateSql`. Such cards are reported as
  `LiveQuality.EditedAfterSourceChange` and left out of `overrideRate`. An edit before the change still counts.
- The rule is documented on the method. The digest's live-quality line reports the number: `EmailTemplates.cs:471`,
  "N updated after a source change (not counted)".
- Deviation: the status route's `live` object does not gain the number. Its keys are pinned by
  `AutomationStatusRoutesTests.StatusContractJson`, and the console's drift test fails on a pinned key the console
  drops. The console wave (E05) was not asked to add it. The number is in the digest and in `LiveQuality`.
- The optional spot-check sample was not added: it is not in the N-items or the specific direction.
- Tests:
  - `AutomationStatusRoutesTests.Status_Live_AnEditAfterASourceChange_IsNotAnOverride`: an edit after the change and a
    delete after the change are not counted, while an edit before the change and an edit of a card of another page are.
  - `EmailTemplatesTests.WeeklyDigest_GoldenText`: the live-quality line gains the count.

### automation-16
Status: fixed (server side)

- `Vpc/Automation/RunnerRoutes.cs:320-333` `HandleComplete`. When the run is `abandoned` (the tick's lease expiry) and
  has no outcome, a replayed kept complete:
  - stores only `error` and `summary` (coalesced), and leaves the run's status and outcome, the item and its attempts
    as the lease expiry left them;
  - calls `AutomationRuns.TryFinalizeAsync`, so the tick's `agent_note` step mails the notes of a run without
    decisions, and a run with decisions carries them in its batch summary if that summary is not sent yet;
  - answers 200 with `replayed: true` and `runStatus: abandoned`. The runner therefore stops treating the file as a
    permanent 409 and deletes it only after the notes are stored.
- A run that completed with another outcome still gets 409 `RUN_NOT_RUNNING`.
- Test: `AutomationNotificationsTests.RunnerComplete_KeptCompleteOfAnAbandonedRun_StoresTheNotes_AndAnswers200` (lease
  expiry, then abandoned, then a replay with notes: stored, 200, the item unchanged, finalised, and a second replay
  also 200).

### automation-24
Status: fixed

- `Vpc/Ledger/LedgerRoutes.cs:283-356` `AgentDraftQualityAsync`. A decision counts as an eval decision when its
  `ai_review_events.note` starts with `eval:` (`EvalNotePrefix`, :287), or when the draft belongs to an automation run
  whose queue item's note starts with `eval:`. The second check runs only when migration 034's tables exist.
  - Eval decisions are left out of `decided`, `accepted`, `editedAccepted`, `rejected`, `defectRejects`, every rate,
    the review-time average and `reviewNotMeasured`.
  - Eval rejects are reported as `evalRejects`.
- The `ai_draft_review` ledger rows of eval rejects already carry 0 units (`Drafts.cs:641`), so the savings figures
  are unaffected.
- Tests:
  - `AutomationLedgerTests.Ledger_AgentDraftQuality_LeavesEvalDraftsOut` covers rejects tagged by note and one tagged
    only through its queue item: `decided`, `rejected` and `acceptanceRate` are unchanged, and `evalRejects` is 3.
  - `Ledger_ReportsAgentDraftQuality` pins the added key.

## Contract

- **N1**: the eval-gate shape (GET current and history, the POST answer, revoke, `status.evalGate`) has
  `"authorConfigId": string|null` = `coalesce(author_config_id, report #>> '{authored,author,authorConfigId}')`, read
  with the column probe of `AutomationMode.GateAuthorSql`. AUTHOR_NOT_GATED details name both authors.
- **N2**: the draft-QA report may carry a top-level `"effectiveEffort": string` (ai-qa's `providers.effective_effort`).
  When the current gate's stored report has `reviewer.effectiveEffort`, a live auto-accept requires the two to be
  equal. Otherwise the draft goes to a human with `REVIEWER_NOT_GATED`, and a missing field fails closed. ai-qa does
  not send the field yet, and no R18E wave owns services/ai-qa. Until it sends it, a gate whose report recorded an
  effort routes every live draft to a person (fail closed; production runs dry_run).
- **N3** (src_C side): the backoff is `min(15 min × 2^(n-1), 24 h)`, n = consecutive `RUNNER_UNAVAILABLE` completes
  of the item. At n >= 3 the item goes to `failed` with `last_error` starting `RUNNER_UNAVAILABLE_REPEATED`, and one
  deduplicated `queue_item_failed` exception is sent with its own wording, besides the daily `runner_unavailable` email.
- **N6**: dry-run batch summaries show no per-state or per-reason count and no publish outcome while any draft of the
  run is undecided. Dry-run digests leave the decisions of such runs out of their counts and count waiting drafts in
  total.
