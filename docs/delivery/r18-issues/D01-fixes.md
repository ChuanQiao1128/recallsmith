# D01 — Automation server round 3a: fixes ledger

Issue #470, wave r18d-s, branch `delivery/r18ds/D01-470`. This is the third fix round of R18A (contract A00, the R18B
K-items, the R18C L-items and the R18D M-items). Every path is under `src_C/`, and line numbers refer to the branch head.

- One schema change: the new migration `Vpc/Db/Migrations/036_automation_author_gate.sql`. It is additive and
  idempotent. Migrations 034 and 035 are untouched. The code works before 036 is applied (see automation-20).
- The full integration suite passes: `dotnet test Tests/RecallSmith.Lambda.IntegrationTests`.

Some existing assertions changed because the finding makes the old behaviour wrong. Each case is listed under its
finding. No assertion was weakened; each changed test now pins the new, stricter behaviour.

## Findings

### automation-20
Status: fixed (server side of M1)

- `Vpc/Db/Migrations/036_automation_author_gate.sql`:
  - adds `automation_eval_gates.author_config_id text null`, checked to 1..128 characters;
  - widens `ck_automation_decisions_reason` with `AUTHOR_NOT_GATED`, appended last. The new CHECK is strictly weaker:
    every row that was valid before stays valid.
- `Vpc/Review/Drafts.cs:38-40`: `AgentKeys` accepts `authorConfigId`, at most `MaxAuthorConfigIdLength` = 128
  characters. The other agent keys keep their 200 limit. The value is stored in `ai_drafts.agent` like the others.
- `Vpc/Automation/EvalGate.cs:372` (`AuthorConfigIdOf`): the gate reads `report.authored.author.authorConfigId`.
  - It is optional in general. When present, it must be a string of 1..128 characters.
  - It is required when the report measured a new-facts stratum (`authored.strata["new-facts"].rows > 0`). If it is
    missing, the POST answers 400 `EVAL_GATE_INVALID` and records nothing.
  - `EvalGate.cs:188` stores it in `author_config_id` once 036 exists. Before 036, the row is inserted without the
    column, and the id stays readable in the stored report jsonb.
- `Vpc/Automation/AutomationMode.cs:61-111`: `EffectiveAsync` reads the current gate's author into
  `EffectiveMode.GateAuthorConfigId`.
  - It probes the column in the same round trip as the table probe.
  - With the column, it reads `coalesce(author_config_id, report #>> '{authored,author,authorConfigId}')`. Without the
    column (a database at 035), it reads the jsonb path only (`GateAuthorSql`, :101). The binding therefore holds
    whichever of code and migration deploys first.
- `Vpc/Automation/DraftQaResults.cs:172-182`, step 8. A live auto-accept requires the draft's
  `agent.authorConfigId` to equal the gate's id, compared ordinally. Otherwise the draft goes to a human with reason
  `AUTHOR_NOT_GATED`, and `reason_detail` names the draft's author, or says the draft has none.
  - A gate that names no author binds none, so it fails closed. This includes every gate recorded before R18D.
  - The ledger route row is `success`: the draft was routed as designed.
  - Dry run records `authorMatchesGate` next to `reviewerMatchesGate` in the event details.
- The version rule: the id excludes the CLI and runner versions, as the runner computes it (M1). The runbook and the
  promotion checklist are docs/runbooks, which belong to the D04 wave.
- `EmailTemplates.cs`: a reason label for `AUTHOR_NOT_GATED`. `AutomationReasons.DecisionReasons` ends with
  `AUTHOR_NOT_GATED`, in constraint order.
- Tests:
  - `AutomationRound3Tests.LiveReport_DraftOfAnotherAuthor_RoutesHumanAuthorNotGated`: a new authorConfigId after the
    gate ends as human / `AUTHOR_NOT_GATED`, with no card.
  - `LiveReport_GateWithoutAuthor_RoutesHumanAuthorNotGated`
  - `LiveReport_DraftWithoutAuthorConfigId_RoutesHumanAuthorNotGated`
  - `LiveReport_DraftOfTheGatedAuthor_IsAutoAccepted`
  - `DryRunReport_RecordsWhetherTheAuthorMatchesTheGate`
  - `Submit_AgentAuthorConfigId_IsStored_AndCappedAt128`
  - `EvalGateTests.PostGate_StoresTheAuthorConfigId_AndLiveReadsIt`
  - `PostGate_NewFactsStratumWithoutAuthorConfigId_Returns400Invalid`
  - `EffectiveMode_Before036_ReadsTheGatedAuthorFromTheStoredReport`, which covers a scratch database migrated to 035
  - `DraftDecisionsTests.ReasonLists_MatchTheMigrationConstraints`, unchanged, now against 036's constraint.
- Test fixtures updated, because the old behaviour was the defect (a gate did not bind an author):
  - `AutomationTestKit.Agent` now carries `authorConfigId = AutomationTestKit.AuthorConfigId`.
  - `AutomationTestKit.InsertGateAsync` and `A04Kit.Scope.GateAsync` store that id in `author_config_id`. The existing
    live auto-accept tests therefore run under a gate that measured their author.
  - `DraftDecisionsTests.Submit_AgentRunKeys_AreAccepted_UnknownKeyStill400` expects the new validation message, which names `authorConfigId`.

### automation-22
Status: fixed (server side of M2)

- `Vpc/Automation/StatusRoutes.cs:329` (`LoadLiveQualityAsync`) measures the `auto_accepted` decisions of the last 30
  days (`decided_at`):
  - A card counts as `deletedByPerson` when it is deleted (`is_deleted`) or gone.
  - A card counts as `editedByPerson` when it changed after the accept (`updated_at > decided_at`) and its current
    `CardContentHash` differs from `accepted_content_sha256`. Nothing but a person edits an accepted card's content, so
    a touch without a content change is not an override: order, revision, or a re-save of the same text.
  - `overrideRate` = (deleted + edited) / autoAccepted30d, four decimals, null when 0.
- `StatusRoutes.cs:199`: `GET /api/v1/admin/automation/status` gains
  `live: { autoAccepted30d, deletedByPerson, editedByPerson, overrideRate }`.
- `Vpc/Automation/AutomationTick.cs:180, :718`: the tick step `live_quality` raises the `live_override_high`
  exception when overrideRate > 0.05 and autoAccepted30d >= 20 (`LiveQuality.OverrideHigh`). The dedupe key is
  `exception:live_override_high:<ISO year>-W<week>`.
- `AutomationTick.cs:781, :821`, `EmailTemplates.cs:42, :432`: the weekly digest adds the line
  `Live quality (30 days): …`. It also adds a NEEDS YOU line when the alarm condition holds.
- `EmailTemplates.cs:272`: the `live_override_high` template.
- The optional post-publish spot check was not added; the brief's M2 does not ask for it. The Overview's four numbers
  are the console wave's (D07).
- Tests:
  - `AutomationStatusRoutesTests.Status_Live_CountsPersonDeletesAndEdits_NotAnAutomationRehash`: a deleted card and a
    human edit are counted; an order/revision touch and a card accepted 40 days ago are not.
  - `AutomationTickTests.Tick_LiveOverrideAboveFivePercent_RaisesLiveOverrideHighOncePerWeek`: 1/20 does not alarm,
    2/20 does, once. The digest shows the same numbers.
  - `Tick_LiveOverride_BelowTwentyAutoAccepts_RaisesNothing`
  - `EmailTemplatesTests.Exception_Subjects_MatchTheContract`, with a `live_override_high` case.
  - `WeeklyDigest_GoldenText`
- Existing assertion updated: the status contract key list in `AutomationStatusRoutesTests` gained the `live` block, as
  M2 requires.

### automation-4
Status: fixed (server side of M3; the console sends `verdictShown`, D07)

- Blindness is now a fact the deciding client reports, never inferred from the state:
  - `Vpc/Review/Drafts.cs:701` (`ParseVerdictShown`): accept and reject take an optional boolean `verdictShown`. It is
    true when the automation's verdict (state, reason, findings) was visible to the person before the decision.
    Absent or null means unknown. Any other type is 400 `VALIDATION_ERROR` "verdictShown must be a boolean".
  - `Vpc/Automation/DraftDecisions.cs:480-496`: the `HUMAN_ACTION` event records `verdictShown` as sent, and
    `blinded = (verdictShown == false)`. The old `blinded = state == would_accept && mode == dry_run` was true by
    construction.
  - `Vpc/Automation/StatusRoutes.cs:83`: `BlindDecidedSql` counts a decision as blind only when its event has
    `verdictShown: false`. Events written before R18D carry an inferred `blinded` flag and no `verdictShown`, so they are
    not blind: they measured nothing.
- Rule for the console (D07): send `verdictShown: false` only from a surface that did not show the verdict of that
  draft before the decision (the blinded review queue). Send `true` from any view that showed it (the decision drawer,
  the Decisions tab, a run page). Send nothing when unsure.
- `Vpc/Automation/EmailTemplates.cs:308-345`: the dry-run batch summary lists no draft of the run at all. It gives one
  NEEDS YOU line with the count of drafts waiting for a decision and a review-queue link. DETAILS gives the counts by
  state and the human routes by reason. This removes the by-elimination leak (a human-routed uid shown means the
  missing ones are would_accept). The live summary is unchanged.
- Tests:
  - `AutomationRound3Tests.HumanDecision_WithoutVerdictShown_IsNotBlind`
  - `HumanDecision_RejectWithVerdictShownFalse_IsBlind`
  - `Decide_VerdictShownNotABoolean_Returns400`
  - `EmailTemplatesTests.BatchSummary_DryRun_ListsNoDraftOfTheRun`: a dry-run body contains no stable uid or question
    of the run.
  - `BatchSummary_GoldenText`
  - `AutomationStatusRoutesTests.Status_ShadowAgreement_CountsOnlyBlindDecisions`: a pre-R18D `{"blinded":true}` event
    is not blind.
- Existing assertions updated because the old behaviour was the defect:
  - `AutomationRound2bTests.HumanDecision_OnHiddenWouldAccept_IsRecordedBlind` now sends `verdictShown: false` or
    `true` and asserts both fields. Before, it asserted that an accept without any report was blind.
  - The `blinded`-only event fixtures of `Status_ShadowAgreement_CountsHumanDecisions` and
    `Status_ShadowAgreement_CountsOnlyBlindDecisions` now write `verdictShown: false`. The latter gained the pre-R18D
    case, so it now counts 6 decided and 4 accepted.
  - `EmailTemplatesTests.BatchSummary_DryRun_NeverListsAWouldAcceptDraft` became `BatchSummary_DryRun_ListsNoDraftOfTheRun`.
    It asserted that the human-routed uid was listed, which is the leak. The dry-run part of `BatchSummary_GoldenText`
    is re-pinned accordingly.
  - The decisions and runs APIs are unchanged: the console reports what it showed through `verdictShown`, which is
    the alternative the finding offers.

### automation-26
Status: fixed (server side of M4)

- `Vpc/Automation/EvalGate.cs:143-178`:
  - The report's generation time is `generatedAt`, else `createdAt` (what `dc-evals automation-gate` writes;
    `ReportTimestamp`, :471). It must be an ISO-8601 timestamp with an offset, otherwise 400 `EVAL_GATE_INVALID`.
  - A report generated before the newest recorded gate's report (read from that row's report jsonb) is refused with
    409 `EVAL_GATE_STALE` and not recorded.
  - The revoke check (409 `EVAL_GATE_REVOKED`, :165) still runs first.
  - The check and the insert run in one transaction under an advisory lock (`RecordLockKey`, :54), so two concurrent
    posts cannot both pass the check.
  - A row without a readable time (raw test rows with `{}`) is not compared.
- Tests:
  - `EvalGateTests.PostGate_OlderPassingReportAfterNewerFailure_Returns409Stale`: pass, then fail, then the first report
    again gives 409 and the effective mode stays dry_run. An older `generatedAt` is refused too, and a newer report
    restores live.
  - `PostGate_WithoutAGenerationTime_Returns400Invalid`
- Existing fixture updated: `EvalGateTests.PassingReport()` now gives every report a strictly later `createdAt`, as
  real re-runs have. `GetGate_ReturnsCurrentAndHistory` used a hand-written later time for its second report; it now
  takes the next one from `PassingReport()`. Its assertions are unchanged.

### automation-27
Status: fixed (server side of M5)

- `Vpc/Automation/RunnerRoutes.cs:37, :44`: `RunnerUnavailablePrefix = "RUNNER_UNAVAILABLE:"` and
  `AgentBlockedPrefix = "AGENT_BLOCKED"`.
- `RunnerRoutes.cs:333-370`, complete of a failed run:
  - `RUNNER_UNAVAILABLE:` returns the item to `queued` without charging an attempt (`attempts - 1`, the claim's
    increment given back). The item is due at once: the runner stopped its loop, so the next claim comes from its
    next start. `last_error` keeps the reason.
  - `AGENT_BLOCKED` fails the item on the first attempt. This is terminal: a person resolves it, and there is no
    automatic retry.
- `RunnerRoutes.cs:424, :452-466`, after the complete:
  - `RUNNER_UNAVAILABLE` raises the `runner_unavailable` exception, deduped per UTC day
    (`exception:runner_unavailable:<date>`), and never `runner_run_failed`.
  - A blocked item raises exactly one email, `queue_item_failed`, carrying the reason. `RunFailureNeedsHuman` already
    returns false for a failed item.
- `EmailTemplates.cs:212, :266`: `queue_item_failed` for a blocked agent reads "agent blocked on queue item N" instead
  of "failed 3 times". There is a new `runner_unavailable` template.
- Tests:
  - `AutomationNotificationsTests.RunnerComplete_AgentBlocked_FailsTheItemAtOnce_WithExactlyOneException`
  - `RunnerComplete_RunnerUnavailable_RequeuesWithoutAnAttempt_AndAlertsOncePerDay`: two releases, attempts 2→1 and
    3→2, one email.
  - `RunFailureNeedsHuman_FollowsL6`, with a new `RUNNER_UNAVAILABLE` case.
  - `EmailTemplatesTests.Exception_Subjects_MatchTheContract`, with new `runner_unavailable` and blocked
    `queue_item_failed` cases.
- Existing assertion updated: `RunnerComplete_ActionableOrRepeatedFailure_RaisesRunnerRunFailed` dropped its
  `AGENT_BLOCKED` case. That case asserted the requeue plus a `runner_run_failed` email, which is the behaviour the
  finding makes wrong. The other cases are unchanged.

### automation-21
Status: fixed (server side of M3; the console rendering is D07)

- One definition, blind (`StatusRoutes.BlindDecidedSql`), on every server surface:
  - Status: `shadow.agreementRate = blindAccepted / blindDecided`, as before, now over the reported fact (see
    automation-4).
  - Weekly digest: `AutomationTick.cs:776` counts `blind_decided` and `blind_accepted` with the same SQL.
    `EmailTemplates.cs:425-431` computes the agreement from them, to four decimals like the status, and shows the
    blind counts next to the totals: `…; decided blind N, accepted unedited M, agreement R`.
  - The batch summary shows no rate. It names the blind rule in its dry-run line.
- The runbook's go-live criterion is docs/runbooks, which belong to the D04 wave.
- Tests:
  - `AutomationTickTests.Tick_Digest_AgreementIsTheBlindRate`: 5 decided, 2 blind and 1 of them accepted gives 0.5000.
    Seen, pre-R18D and event-less decisions are excluded.
  - `EmailTemplatesTests.WeeklyDigest_GoldenText`
  - `AutomationStatusRoutesTests.Status_ShadowAgreement_CountsOnlyBlindDecisions`
- Existing assertion updated: the digest golden line computed the agreement over every human decision (0.75), which is
  the defect. It now pins the blind rate from new fixture fields (blind 3, accepted 2, so 0.6667).

## Contract

How this issue implements its side of each R18D M-item:

- **M1**
  - `ai_drafts.agent.authorConfigId`: at most 128 characters, accepted by `Drafts.AgentKeys`.
  - `automation_eval_gates.author_config_id`: migration 036, filled from `report.authored.author.authorConfigId`.
  - 400 `EVAL_GATE_INVALID` when a report with a new-facts stratum lacks the id.
  - At a live auto-accept, `DraftQaResults` requires the draft's id to equal the gate's, else human / `AUTHOR_NOT_GATED`.
    A gate without an id fails closed.
  - Before 036, the id is read from the stored report jsonb.
- **M2**
  - `status.live = { autoAccepted30d, deletedByPerson, editedByPerson, overrideRate }`, as specified.
  - The digest line.
  - The `live_override_high` exception (rate > 0.05 with at least 20 auto-accepts, one per ISO week).
- **M3**
  - `shadow.agreementRate = blindAccepted / blindDecided`, where blind means the person reported `verdictShown: false`
    on accept or reject.
  - The digest uses the same SQL, and the dry-run batch summary lists no per-draft verdict.
  - The console sends `verdictShown` (D07): absent means unknown, which is not blind.
- **M4**: 409 `EVAL_GATE_STALE` for a report whose `generatedAt` (else `createdAt`) is older than the newest recorded
  gate's.
- **M5**
  - A `RUNNER_UNAVAILABLE:` complete returns the item to `queued` without charging an attempt, and raises
    `runner_unavailable` once per UTC day.
  - An `AGENT_BLOCKED` complete fails the item at once, with one `queue_item_failed` email and no automatic retry.
