# B02 — Automation server fixes 2: fixes per finding

Issue #441, wave r18b-s. Branch `delivery/r18bs/B02-441`, built on B01 (#440). Every path is relative to the repo
root. Every test is in `src_C/Tests/RecallSmith.Lambda.IntegrationTests/` and runs against a real Postgres
(Testcontainers).

Migration 034 has not been applied anywhere yet, so it is edited in place. It stays idempotent, and no migration 035
was added. The schema changes are:

- a new table `automation_qa_spend` with index `idx_automation_qa_spend_spent` (part 6, `034_automation.sql:240`);
- the AWS What's New feed is seeded with `active = false` (part 11, `:377`);
- the `source_watch` baseline unit is now `detected change` (part 9, `:359`).

## Contract

- **K1 (automation prompt version).** `QaRuns.AutomationPromptVersion = "qa-v4-auto"`
  (`src_C/Vpc/Qa/QaRuns.cs:38`). `QaRuns.PromptVersionFor(profile)` (`:42`) selects it for `profile = "automation"`.
  - Every profile=automation message carries it: draft QA (`DraftDecisions.cs:291`) and the source watch's
    `scope=cards` re-checks (`QaRuns.cs:267`, through `StartCardsRunAsync`).
  - `QaRuns.PromptVersion` stays `"qa-v4"` for human-run QA. Its message is byte-identical.
  - The version the Lambda echoes in its report is what core stores: `automation_draft_decisions.qa_prompt_version`,
    the QA mirror's `ai_qa_runs.prompt_version`, and the re-check run's `prompt_version`. This follows the existing
    rule that core never pins a run's version before the report (backend-design-12).
  - The eval gate now requires `reviewer.promptVersion == "qa-v4-auto"` (`EvalGate.cs:212`), so the live reviewer
    triple is (bedrock-converse, global.openai.gpt-5.5, qa-v4-auto). Step 8 of the draft-QA ladder compares the
    report's triple with the gate's triple, and that check is unchanged.
- **K2 (eval gate semantics).** `EvalGate.NewestGateSql` (`EvalGate.cs:39`) selects the newest row whatever its
  state. `AutomationMode.EffectiveAsync` (`AutomationMode.cs:70`) and `EvalGate.LoadCurrentAsync` (`EvalGate.cs:360`)
  treat that row as effective only when `passed and revoked_at is null`. A revoke, or a newer failed row, drops live
  to dry_run on the next request, and an older passed gate never takes over.
- **K3 (agent notes).**
  - Each item of `GET /api/v1/admin/automation/runs` gains `"summary": string|null` (`StatusRoutes.cs:329`, item
    shape after `error`). It is plain text of at most 2000 characters, the limit `ck_automation_runs_text` enforces.
    A blank value is returned as null.
  - The batch summary's DETAILS gains `Agent notes: <notes>` when the notes are not blank (`EmailTemplates.cs:307`).
    The notes are put on one line, whitespace runs are collapsed, and the line is capped at 900 characters by
    `AgentNotesLine` (`EmailTemplates.cs:85`).
  - A finalised run with non-blank notes and no decisions raises exception subkind `agent_note` with dedupe key
    `exception:agent_note:<runId>` (`AutomationTick.cs:363-385`, in the summaries step). The subject is
    `Action needed: agent note on <host/path>`, and the notes are in NEEDS YOU.
- **K6 (email re-send policy).**
  - `Notifications.ResendAsync` re-sends only `enqueue_failed` rows (`Notifications.cs:168`). A `queued` row, whose
    SQS send succeeded, is never sent again; SQS redelivery and the notify DLQ own its retries.
  - The NOT_CONFIGURED path counts an attempt (`:204`), so `MaxSendAttempts` bounds it.
  - `GET /automation/status` → `notifications.unconfirmed` (`StatusRoutes.cs:204-210`) counts rows still `queued`
    60 minutes (`Notifications.UnconfirmedAfterMinutes`) after a successful send (`attempts > 0`) with no report.
    They are still included in `queued`.
- **K7 (open-exception backlog).** `GET /automation/status` gains
  `"backlog": { "humanPending", "oldestHumanPendingAt", "humanPublishes" }`, computed by
  `StatusRoutes.LoadBacklogAsync` (`StatusRoutes.cs:263`).
  - `humanPending` counts decisions in state `human` whose `human_action` is null and whose draft is still `pending`.
  - `oldestHumanPendingAt` is the earliest `coalesce(decided_at, created_at)` among those decisions.
  - `humanPublishes` counts **live** `automation_publishes` rows in state `human` that no `deck_publishes` row of the
    same deck with status `SUCCESS`, created after the row's `updated_at`, resolved. The row never leaves `human`,
    because the person publishes from the console and not through the row. A later successful publish of the deck
    is therefore the resolution, and a newer automation publish that reached `published` implies one. A dry-run
    `human` row accepted nothing and is not counted.
  - The weekly digest's "draft(s) routed to you are still pending" and "publish(es) need you" lines now come from the
    same backlog (`AutomationTick.cs:725`), not from the week's rows in state `human`.
- K4 and K5 are not touched by B02. (B01 implemented K4's core side.)

### cloud-security-resilience-1

Status: fixed (K2 side; the runbook part belongs to B04)

- `src_C/Vpc/Automation/AutomationMode.cs:70`: the effective gate is the newest row, and it is effective only when
  passed and unrevoked. `src_C/Vpc/Automation/EvalGate.cs:39,360`: the same rule applies to the gate API's `current`.
- Tests:
  - `AutomationModeTests.Effective_Live_RevokingNewestGate_NeverFallsBackToOlderPassedGate`: an older passed gate
    plus a revoked newest gate gives dry_run / `EVAL_GATE_MISSING`, with no gate reported in dry_run either.
  - `AutomationModeTests.Effective_Live_NewerFailedGate_BlocksLive`: a newer failed gate blocks live.
- Changed existing assertions: the finding makes the old fallback wrong.
  - `AutomationModeTests.Effective_Live_WithPassedGate_IsLive` asserted that revoking the latest gate fell back to
    the older one. That assertion was removed; the new test above covers that path.
  - `EvalGateTests.GetGate_ReturnsCurrentAndHistory` asserted "revoking the latest makes the earlier unrevoked one
    current". It now asserts that `current` is null and that effective live is dry_run.

### automation-3

Status: fixed (K3 server side)

- Runs API `summary`: `src_C/Vpc/Automation/StatusRoutes.cs:329` (select) and the item shape.
- Batch summary `Agent notes:` line: `src_C/Vpc/Automation/EmailTemplates.cs:307`. `BatchSummaryData.AgentNotes`
  (optional last parameter) is filled from `automation_runs.summary` (`AutomationTick.cs:397`).
- The `agent_note` exception for a finalised run with notes and no decisions: `AutomationTick.cs:363-385` and the
  template case at `EmailTemplates.cs:244`. `agent_note` was appended to `EmailTemplates.ExceptionSubkinds`.
- Tests:
  - `AutomationStatusRoutesTests.Runs_ListWithCountsAndPublishes` (`summary` key and values).
  - `AutomationTickTests.Tick_RunWithNotesAndNoDecisions_RaisesOneAgentNote`: one email per run; runs with no notes
    or blank notes send nothing.
  - `AutomationTickTests.Tick_FinalRun_EnqueuesOneBatchSummary`: the `Agent notes:` DETAILS line appears, and no
    `agent_note` email is sent for a run that has drafts.
  - `EmailTemplatesTests.BatchSummary_AgentNotes_AreOneCappedDetailsLine`.
  - `EmailTemplatesTests.Exception_Subjects_MatchTheContract` (new `agent_note` case).
- The console Runs tab (frontend) and the runner prompt and skill wording belong to other waves.

### ai-agent-5

Status: partially fixed (K1 server side; the prompt text is B03's and the new-facts dataset stratum is B06's)

- `src_C/Vpc/Qa/QaRuns.cs:38-43,267`, `src_C/Vpc/Automation/DraftDecisions.cs:291`, and
  `src_C/Vpc/Automation/EvalGate.cs:212`: see K1 above.
- Tests:
  - `DraftDecisionsTests` contract-message test: `promptVersion` is `qa-v4-auto`.
  - `SourceRecheckTests` and `SourceWatchRoutesTests`: the re-check message carries `qa-v4-auto`.
  - `EvalGateTests.PostGate_WrongProviderOrPromptVersion_Fails`: a gate report with the human `qa-v4` now fails
    `reviewer.promptVersion`.
  - `EvalGateTests.PostGate_*`: the recorded gate triple is `qa-v4-auto`.
  - `AiQaRunsTests.PromptVersion_MatchesTheAiQaLambda` still pins the human `qa-v4`.
- Changed existing fixtures: `AutomationTestKit.InsertGateAsync` and `DraftReport` now default to
  `QaRuns.AutomationPromptVersion`, because a profile=automation report echoes it. The verbatim §9.2 and §15.4 JSON
  literals in the tests were updated to `qa-v4-auto`, as K1 amends them.

### backend-design-4

Status: fixed

- New table `automation_qa_spend` (`034_automation.sql:240`). It holds one row per QA attempt, keyed by
  (`qa_job_id`, request id), and `spent_at` is the time the report arrived.
- `DraftQaResults.RecordSpendAsync` (`src_C/Vpc/Automation/DraftQaResults.cs:303`) upserts the attempt and adds the
  change to the decision's cost columns. A new request id adds; a replayed one keeps the greater values. This is the
  former IsNewAttempt rule, now applied per attempt.
- It runs for three kinds of report:
  - (a) an in-flight report (`:105`);
  - (b) a report whose decision already left `qa_queued`, such as after QA_TIMEOUT, a released send or a human
    decision (`:92`). Only the cost columns change: no transition and no `updated_at`;
  - (c) a report of a job that was released after an ambiguous send and then replaced by a fresh job id (`:66-83`).
    The decision's append-only event log names the old job (`details.qaJobId`), which proves it was ours.
- `QaRuns.SpendTodayAsync` (`src_C/Vpc/Qa/QaRuns.cs:581`) sums `automation_qa_spend` by `spent_at` of the UTC day
  instead of decisions by `created_at`. The status API's `automationTodayUsd` (`StatusRoutes.cs:164`) and the digest's
  automation spend (`AutomationTick.cs:722`) read the same dated rows.
- Tests:
  - `DraftQaResultsTests.Report_AfterQaTimeout_StillReachesTheDailyCap_WithoutATransition`: counted, not replayed
    twice, and a second attempt adds.
  - `DraftQaResultsTests.Report_OfAReleasedJobReplacedByAFreshOne_StillReachesTheDailyCap`.
  - `DraftQaResultsTests.Report_SpendIsDatedWhenReported_NotWhenTheDecisionWasCreated`.
  - `DraftQaResultsTests.Report_Replay_IsNoOp` still holds.
  - `AutomationSchemaTests` lists the new table and index.
- Changed test fixtures: the helpers `AutomationSpendCapTests.InsertDecisionAsync` and
  `AutomationStatusRoutesTests.Db.NewDecisionAsync` insert decisions with a cost directly. They now also insert the
  matching spend row, dated like the decision. No assertion changed.

### backend-design-5

Status: fixed (K6)

- `src_C/Vpc/Automation/Notifications.cs:168`: only `enqueue_failed` rows are re-sent. `:204`: the NOT_CONFIGURED
  path increments `attempts`.
- Tests:
  - `AutomationTickTests.Tick_NeverResendsAQueuedNotification`: a row still `queued` 3 hours after its send is not
    re-sent.
  - `AutomationTickTests.Tick_NotConfiguredResends_AreBoundedByMaxSendAttempts`: at most `MaxSendAttempts` attempts
    and 4 retry gauges, then silence.
  - `AutomationStatusRoutesTests.Status_ReportsModeRunnersQueueAndSpend`: `unconfirmed`.
- Changed existing assertions: the finding makes "a NOT_CONFIGURED send is not an attempt" wrong.
  - `AutomationNotificationsTests.Enqueue_NoQueueUrl_IsEnqueueFailedNotConfigured`: `attempts` goes from 0 to 1.
  - `AutomationTickTests.Tick_ResendsEnqueueFailedNotifications`: `attempts` after the resend goes from 1 to 2.

### cloud-security-resilience-2

Status: fixed (K6 core side; the notifier's report retry and `NotifierReportFailures` belong to the services wave,
and the runbook note belongs to B04)

- Core no longer re-enqueues a row whose SQS send succeeded (`Notifications.cs:168`). A report lost after the email
  went out, or the ESM being disabled while the tick keeps running, therefore can no longer make a second container
  send the same email. Such a row shows as `unconfirmed` in email health (`StatusRoutes.cs:204-210`).
- Tests: `AutomationTickTests.Tick_NeverResendsAQueuedNotification`, and
  `AutomationStatusRoutesTests.Status_ReportsModeRunnersQueueAndSpend` (`unconfirmed = 1`, still counted in `queued`).

### automation-6

Status: fixed

- Draft QA, dry run (`src_C/Vpc/Automation/DraftQaResults.cs:175-186,254`): `DryRunAcceptRouteAsync` runs step 10's
  at-accept checks read-only before recording `would_accept`. It locks the deck row as the live accept does, so the
  reports of one batch serialise. The checks are:
  - deck gone → `DECK_DELETED`;
  - stable uid taken → `EXISTING_CARD`;
  - `CardSimilarity.FindAsync` over the deck → `LIKELY_DUPLICATE` (`at accept: <uid>`);
  - the deck's other pending `would_accept` drafts, which live would already have made cards, compared with the same
    trigram score and 0.6 threshold → `LIKELY_DUPLICATE`;
  - the draft's current content hash differs from the reviewed one → `QA_HASH_MISMATCH`.

  A failed check routes the draft to `human` with that reason, and the event details carry `"check": "at_accept"`.
- Auto-publish, dry run (`src_C/Vpc/Automation/AutoPublisher.cs:318,336`): `DryRunGateRefusalAsync` evaluates check
  9's gates read-only before `would_publish`: the MCQ publish gate (`Publish.FirstMcqGateFailure` over the export
  rows), then, when enforced, the AI QA gate (`QaGate.ComputeAsync`: `AI_QA_REQUIRED` / `AI_QA_BLOCKED`). It has
  none of the publish path's side effects: no gate-defect ledger row, no refusal gauge and no chained QA run. A
  refusal ends in `human` with its code.
- Tests:
  - `DraftQaResultsTests.Report_DryRun_TwoNearIdenticalDraftsInOneBatch_SecondIsLikelyDuplicate`.
  - `DraftQaResultsTests.Report_DryRun_StableUidTakenSinceSubmit_IsExistingCard`.
  - `AutoPublisherTests.Evaluate_DryRun_GateRefusal_RoutesHumanWithCode`.
  - `AutoPublisherTests.Evaluate_DryRun_IsWouldPublish` is unchanged and still passes.

### automation-5

Status: fixed

- `src_C/Vpc/Db/Migrations/034_automation.sql:370-377`: the AWS What's New feed is seeded `active = false` even when
  the aws-saa-c03 deck exists. The comment documents the choice: the pattern matches nearly every core service, the
  deck is tied to a fixed exam guide, and no check measures exam relevance. The owner enables it with
  `PUT /api/v1/admin/automation/watch/targets/:id {"active": true}` after measuring, in dry run, how many of its
  `feed_item` drafts humans reject. The Claude release-notes feed is unchanged.
- Test: `AutomationSchemaTests.Seed_WithDecks_LinksTheDecks_AwsFeedStaysInactive`. This is the former
  `Seed_WithDecks_CreatesActiveFeedTargets`: its AWS `active` assertion was inverted by this finding, and it was
  renamed to match.

### automation-9

Status: fixed

- `src_C/Vpc/Automation/SourceWatchRoutes.cs:373,390,664`: a report's `source_watch` ledger units are detections
  only, meaning a cited page found changed or newly gone and a new feed item queued for authoring. Routine checks of
  unchanged pages, 304s and feed polls earn no units. Their count moves to the row's details as `checks`.
- The digest's "source check(s)" figure now sums `details.checks` (`AutomationTick.cs`, DigestAsync), so it still
  counts checks.
- Baseline unit `detected change` (`034_automation.sql:359`); the note says routine checks earn nothing.
- Counterfactual: before automation nobody re-read every cited page weekly or polled the feeds every two hours, so
  those checks replace no human minutes. What a person did do was notice a changed or vanished source, or a new
  announcement, and act on it. Each such detection is credited 0.5 min until a measured baseline replaces the
  placeholder.
- Tests:
  - `SourceWatchRoutesTests.Report_LedgerCreditsDetectionsOnly`: routine checks give 0 units; changed plus gone give
    2; still-gone gives 0; a feed baseline gives 0; two queued feed items give 2.
  - `AutomationSchemaTests` checks the baseline unit.
- Changed existing assertions, because the finding makes check-units wrong:
  - `SourceWatchRoutesTests.Report_RecordsSourceWatchLedgerRow`: units 2 → 0 and (2, 0, 1) → (0, 0, 0), plus
    `checks = 2`.
  - `AutomationTickTests.Tick_Digest_EnqueuesWeeklyDigest`: its ledger row now carries `checks = 40`, and the digest
    shows `40 check(s)`.

### automation-10

Status: fixed (K7 server side; the console Overview and the Decisions label belong to the frontend wave)

- `src_C/Vpc/Automation/StatusRoutes.cs:263` `LoadBacklogAsync` and the new `backlog` object of the status response.
  `AutomationTick.cs:725`: the digest uses it, so a publish the owner already made by hand no longer reads as
  "needs you".
- Tests:
  - `AutomationStatusRoutesTests.Status_Backlog_CountsOnlyOpenExceptions_WhenEverRaised`: a 20-day-old open draft is
    counted; handled and decided drafts are not; an unresolved live human publish is counted; a publish resolved
    later is not, and neither is one resolved only before it went human; a dry-run human row is not counted.
  - `AutomationStatusRoutesTests.Status_ReportsModeRunnersQueueAndSpend`: the `backlog` shape.
  - `AutomationTickTests.Tick_Digest_ReportsTheOpenBacklog_NotTheWeeksHumanRows`: two resolved rows from this week
    and one unresolved row from 20 days ago give "1 publish(es) need you". The old code said 2.
