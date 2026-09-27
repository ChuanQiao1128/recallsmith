# C02 — Automation server round 2b: fixes ledger

Issue #456, wave r18c-s, branch `delivery/r18cs/C02-456`. This is the second fix round of R18A (contract A00 plus the
R18C L-items). It builds on C01 (#455), which is already merged into `delivery/r18c-s`. Every path is under `src_C/`,
and line numbers refer to the branch head.

- No schema change: all columns and reasons used here already exist in 034 or 035. Migrations 034 and 035 are untouched.
- The full integration suite passes: `dotnet test Tests/RecallSmith.Lambda.IntegrationTests` ran 2498 tests, all passing.

Existing assertions changed because the finding makes the old behaviour wrong. Each case is listed under its finding.
No assertion was weakened; each changed test now pins the new, stricter behaviour.

## Findings

### backend-design-15
Status: fixed

- Part 1 (a newer failed evaluation must govern live) is fixed together with automation-13, in
  `Vpc/Automation/EvalGate.cs:115-163`. The details are listed under automation-13.
- Part 2 (a model outside GPT-5.5 must not enable live) is fixed with a model allowlist:
  - `EvalGate.cs:35`: `AutomationGateModels = ["openai.gpt-5.5", "global.openai.gpt-5.5"]`. These are the model id of
    the bedrock-mantle endpoint (L1) and the global profile that Converse uses.
  - `EvalGate.cs:234`: a model outside this list fails the `reviewer.model` check. The comparison is ordinal, so a
    change of case does not pass.
  - This replaces the old "not blank" rule. A blank model still fails.
- Tests:
  - `EvalGateTests.PostGate_ModelOutsideAllowlist_FailsReviewerModel`. Through the POST route, these models all fail
    `reviewer.model` and never make live effective: `global.anthropic.*`, `anthropic.*`, `openai.gpt-4o`,
    upper-case GPT-5.5, and an empty string.
  - `PostGate_FailingReport_IsRecordedAndBlocksLive`, which is also listed under automation-13.

### automation-13
Status: fixed

- `EvalGate.cs:115-163`: every well-formed report is inserted, with `passed = (failures.Count == 0)`.
  - A failing report still answers 400 `EVAL_GATE_FAILED` with the same `failures` envelope as before.
  - The failing row is now the newest row. `AutomationMode.EffectiveAsync`, which applies the unchanged R18B K2
    newest-row rule, therefore drops live to dry_run until a newer passing report is recorded.
  - A malformed report (400 `EVAL_GATE_INVALID`) is still not recorded.
- `EvalGate.cs:134-141`: a report whose sha256 equals that of a revoked gate is refused with 409 `EVAL_GATE_REVOKED`,
  and nothing is inserted. Posting the same bytes again therefore never reinstates a revoked gate. A fresh evaluation
  always has different bytes (its own `createdAt`).
- Tests:
  - `EvalGateTests.PostGate_FailingReport_IsRecordedAndBlocksLive`. It goes through the POST route, not raw SQL: a
    passed gate, then a failing re-run, which is recorded with `passed = false`. The effective mode becomes dry_run
    with `EVAL_GATE_MISSING`, and `current` is null. A newer passing report restores live.
  - `EvalGateTests.PostGate_RevokedReportAgain_Returns409`.
- Existing assertions updated because the old behaviour was the defect:
  - `PostGate_ClaimedPassButFailingCounts_Returns400EvalGateFailed` and `PostGate_EachThreshold_FailsWithItsCheck`
    asserted that the gate count did not change. They now assert that exactly one row was added and that it is
    `passed = false`.
  - `PostGate_WrongProviderOrPromptVersion_Fails` and `PostGate_SecondReviewer_Fails` looked for "no unrevoked row".
    They now look for "no passed unrevoked row".
  - `PassingReport()` now gives every report its own `createdAt`. The test cleanup revokes every gate, and the same
    bytes are now refused after a revoke, which is the point of the fix.

### backend-design-13
Status: fixed (server side of L4)

- `Vpc/Automation/StatusRoutes.cs:53`: `OpenDecisionSql` is the single open-exception predicate:
  `dd.state = 'human' and dd.human_action is null and a.status = 'pending'`.
  - `LoadBacklogAsync` uses it for both the count and `oldestHumanPendingAt`.
  - `HandleDecisions` uses it for `open=true` (`:542`), with the same `(created_at desc, draft_id)` keyset and cursor.
  - `QueryFlag` (`:672`) accepts `true`/`1` and `false`/`0`. Absent or empty means no filter. Anything else answers
    400 `VALIDATION_ERROR`.
- `StatusRoutes.cs:59, :66, :256`: `OpenHumanPublishSql` is the shared humanPublishes predicate. The backlog adds
  `humanPublishItems`: at most 20 (`MaxHumanPublishItems`) items of `{ deckId, deckSlug, reason, since }`, oldest
  first. `since` is the row's `updated_at`, the same timestamp the resolution rule compares against.
- The console side (passing `open=true` and listing the items) belongs to the frontend wave.
- Tests:
  - `AutomationStatusRoutesTests.Decisions_OpenTrue_ListsOnlyOpenExceptions_WithTheBacklogPredicate`. Handled rows
    newer than the open ones fill a first page of `state=human`. `open=true` lists exactly the open ones, pages them
    with the cursor, and matches `backlog.humanPending`.
  - `Status_Backlog_ListsHumanPublishItems`: resolved rows and dry-run rows are excluded, the list is capped at 20,
    and it is ordered oldest first.
- Existing assertion updated: the status contract key list in `AutomationStatusRoutesTests` gained `humanPublishItems`,
  as L4 requires.

### ai-agent-11
Status: partially fixed (the src_C side of L1; the rest belongs to other waves' roots)

- `EvalGate.cs:29`: `AutomationGateProviders = ["openai-mantle", "bedrock-converse"]`. The gate row still pins the
  provider actually used: `reviewer_provider` is stored, and `DraftQaResults` requires provider, model and prompt
  version to match the gate (REVIEWER_NOT_GATED otherwise, unchanged).
- `EvalGate.cs:35`: the model allowlist includes `openai.gpt-5.5`, the model id of the bedrock-mantle endpoint.
- No other provider allowlist exists in `src_C`. I checked with `grep -rn bedrock-converse src_C --include=*.cs`, which
  finds only EvalGate and test fixtures.
- Test: `EvalGateTests.PostGate_OpenAiMantleProvider_IsAcceptedAndPinned`. An `openai-mantle` / `openai.gpt-5.5`
  report is recorded, and `EffectiveAsync` reports exactly that reviewer triple.
- Outside this issue's paths, for the other waves:
  - the `openai-mantle` adapter in `services/ai-qa`;
  - `prod.env.json` keys and prices;
  - the IAM grant in `infra`;
  - `evals` `automation_gate.py`;
  - the owner probes in the runbook.

### backend-design-16
Status: fixed

- Part (1): a decision's `mode` is now the mode that its deciding transaction applied.
  - `Vpc/Automation/DraftDecisions.cs:552-567`: `TransitionAsync` sets the decision's `mode` to the effective mode when
    the transition reaches a decided state (would_accept, auto_accepted, human, superseded) and that mode is
    `dry_run`/`live`. Effective `off` is not a decision mode (`ck_automation_decisions_mode`), so the mode of the
    submit stays in that case. The method now returns the decision's mode after the update.
  - `Vpc/Automation/DraftQaResults.cs:234-238`: the auto_accepted update sets `mode` as well.
- The ledger now follows that applied mode rather than the stale mode of the submit, at these call sites:
  - QA_UNAVAILABLE: `DraftDecisions.cs:289-293`;
  - ENQUEUE_FAILED after send failures: `:436`;
  - QA_TIMEOUT: `Vpc/Automation/AutomationTick.cs:289`;
  - the stuck-qa_pending ENQUEUE_FAILED route: `AutomationTick.cs:329`.

  `DraftQaResults` already used the effective mode.
- Part (2): the cards that live accepted before a revoke are no longer reported as human changes. This is fixed with
  automation-12; see there.
- Tests:
  - `AutomationRound2bTests.Report_DryRunSubmit_DecidedUnderLive_RecordsLiveMode`: the decision reads `live`, and the
    auto-accept ledger row is written.
  - `Report_LiveSubmit_DecidedAfterRevoke_RecordsDryRunMode`: after the revoke the decision is `would_accept` /
    `dry_run`, so the review queue blinds it, and no ledger row is written.
  - `AutomationTickTests.Tick_QaTimeout_AfterGoingLive_RecordsLiveModeAndLedger`.

### automation-12
Status: fixed

- `Vpc/Automation/AutoPublisher.cs:317`: check 6 loads the automation-owned hashes in every mode, not only in live.
- `AutoPublisher.cs:326-344`: when not live, `AcceptedBeforeRollback` (`:408`) separates the live, unchanged,
  automation-accepted pending cards from real human changes.
  - Only such cards pending: route to human with `AUTO_PUBLISH_DISABLED` and the detail
    `live is not effective (gate revoked or missing); auto-accepted before rollback: <uids>`.
  - Human changes as well: route with `DECK_HAS_HUMAN_CHANGES` and the detail
    `cards changed by a human: <uids>; auto-accepted before rollback: <uids>`.
  - The pure `CheckPendingChangeSet` is unchanged, so its truth table and property tests still hold.
- `AutoPublisher.cs:225-230`: the row keeps the `live` label when it routes to a human in dry_run while it holds cards
  accepted in live (`verdict.LiveAcceptedPending`, or a non-empty `card_ids`, which only live auto-accepts fill). The
  row therefore stays in the K7 `humanPublishes` backlog and in `humanPublishItems`, and its `publish_blocked` alert
  is a live alert.
- `Vpc/Automation/Notifications.cs:136-163`: the new optional `labelMode` of `RaiseExceptionAsync` makes that alert a
  live one. The dry-run banner ("nothing was accepted or published") would be false for these cards.
- Tests:
  - `AutomationRound2bTests.Evaluate_AfterRevoke_LiveAcceptedCards_KeepLiveLabelAndTruthfulReason`: the real
    auto-accept path, then a revoke. The row is human / AUTO_PUBLISH_DISABLED / `live`, no publish is enqueued, the
    row is counted by the backlog predicate, and the alert subject has no "(dry run)".
  - `Evaluate_AfterRevoke_HumanChangeAndLiveAcceptedCard_AreToldApart`.
  - `AcceptedBeforeRollback_ListsOnlyLiveUnchangedOwnedCards`.
- The runbook rollback line the audit suggests (list auto_accepted, unpublished cards before the next human publish)
  goes under `docs/runbooks`, which is outside this issue's paths. It is left to the docs wave.

### automation-14
Status: fixed

- `Vpc/Automation/DraftQaResults.cs:396-405`: `auto_accept` stays the carrier of the avoided human review. The
  automated `ai_draft_review` row now records `actual_minutes` equal to the current `auto_accept` baseline, read from
  `automation_baselines`. It therefore nets like a human accept, which nets its measured review time. One
  auto-accepted card saves the `ai_draft_review` baseline (12 minutes), not 15.
- Tests:
  - `AutomationRound2bTests.LiveAutoAccept_CreditsTheDraftReviewBaselineOnce` computes the ledger formula
    (`units × baseline − actual`) over the card's two rows and expects exactly the `ai_draft_review` baseline.
  - `DraftQaResultsTests.Report_LiveAccept_WritesLedgerRowsAndWebhook`: its `Assert.Null(actual_minutes)` was the
    double credit. It now asserts the `auto_accept` baseline.
  - The `ai_qa_review` credit is a separate automation, and it is unchanged.

### automation-15
Status: partially fixed ((a) and (b) fixed; (c) declined)

(a) A `runner_run_failed` email only goes out when a person can act (L6).

- `Vpc/Automation/RunnerRoutes.cs:375-392`: `RunFailureNeedsHuman` returns false when the item failed for good,
  because `queue_item_failed` is then the one email. Otherwise it returns true in two cases:
  - the error starts with an actionable prefix: `AGENT_BLOCKED` (written by the runner per L6),
    `claude could not be started`, or `claude did not run on the subscription login` (a Mac or login problem that
    every retry repeats);
  - the item has been attempted at least twice (`RepeatedFailureAttempts`), which makes it a repeated failure.
- Transient first failures send no email. They are still shown on the Runs tab and in the runner's `lastError`:
  - `timeout`;
  - `not run: lease_short` releases;
  - `AGENT_NO_RESULT`.
- `RunnerRoutes.cs:416` applies the rule.
- Tests:
  - `AutomationNotificationsTests.RunnerComplete_TransientFirstFailure_RaisesNoEmail`;
  - `RunnerComplete_ActionableOrRepeatedFailure_RaisesRunnerRunFailed`;
  - `RunFailureNeedsHuman_FollowsL6`.
- Updated test: `RunnerComplete_Failed_RaisesRunnerRunFailed` covered a third failed attempt and expected two emails.
  It now expects only `queue_item_failed`, which carries the error. The test name was kept, and its comment explains
  the change.

(b) No `publish_blocked` email in dry_run.

- `AutoPublisher.cs:421-443`: `RouteHumanAsync` does nothing for a row whose label is not live. A dry-run row accepted
  nothing, so nobody has to publish anything. The batch summary's "publish would need you" and the Runs tab carry it.
- A dry-run row holding live-accepted cards is labelled live (automation-12), so it still alerts.
- Updated tests, each from asserting a dry-run email to asserting none:
  - `AutoPublisherTests.Evaluate_HumanOutcome_RaisesPublishBlocked`, dry-run half;
  - `AutomationTickTests.Tick_WaitingPublish_TimesOut`.

(c) Declined. As the verifier notes, `agent_note` fires only for a finalised run with notes and no decisions
(`AutomationTick.cs:414-440`), and R18B K3 prescribes exactly that. A structured `flags` field would change the
runner's final JSON, which lives in `tools/author-runner`, outside this issue's paths. L6 covers the actionable part
instead: an agent that could not do the task now completes the run as failed with `AGENT_BLOCKED`, and that raises
`runner_run_failed`.

### backend-design-17
Status: fixed

- `StatusRoutes.cs:420-423, :462`: the Runs API applies the batch summary's rule (`AutomationTick.cs:402, :471`) in
  both the SQL and the per-run filter. A run matches a publish by its `run_id`, or by
  `(p.card_ids || p.deferred_card_ids) && <the run's accepted cards>`.
- Test: `AutomationStatusRoutesTests.Runs_DeferredCards_MatchThePublishLikeTheBatchSummary`. The second run's card is
  deferred on the first run's `publishing` row, and both runs show that row.
- I added it as its own test in the same class, not as a case inside `Runs_ListWithCountsAndPublishes`, so that the
  counts that test pins stay untouched.

### automation-4
Status: fixed (server side)

- The dry-run batch summary never lists a would_accept draft (`Vpc/Automation/EmailTemplates.cs:297-315`):
  - there is no uid or question under DONE AUTOMATICALLY, and no `Draft <uid>: would_accept` line under DETAILS;
  - instead there is one line: `N draft(s) decided by the automation; verdicts hidden until you decide them in the
    review queue (shadow agreement counts blind decisions only)`, plus a count line.
  - This matches the console's blinding. Human-routed drafts keep their reason, as they do in the console.
  - The subject and summary keep the A00 §12 wording and counts. A count reveals no per-draft verdict, and the Runs
    tab shows the same count.
- `DraftDecisions.cs:495, :514`: the `HUMAN_ACTION` event records `blinded`. It is true when the decision was a
  would_accept with mode dry_run, which is exactly what the review queue blinds (`automationBlinded`).
- `StatusRoutes.cs:72, :160-185`: `shadow.agreementRate` is now computed over blind decisions only.
  - `blindDecided` and `blindAccepted` are added.
  - The existing `humanDecided`/`humanAccepted`/... counts still cover every human decision.
  - The runbook's promotion criterion, humanDecided ≥ 100 decided "without looking at the automation's verdict
    first", is therefore now measurable as `blindDecided`.
- Tests:
  - `EmailTemplatesTests.BatchSummary_DryRun_NeverListsAWouldAcceptDraft`;
  - `AutomationRound2bTests.HumanDecision_OnHiddenWouldAccept_IsRecordedBlind`;
  - `AutomationStatusRoutesTests.Status_ShadowAgreement_CountsOnlyBlindDecisions`.
- Existing tests updated:
  - `BatchSummary_GoldenText`: its dry-run golden listed the would_accept drafts.
  - `Status_ShadowAgreement_CountsHumanDecisions`: its raw-SQL decisions now also get blinded `HUMAN_ACTION` events,
    so the same agreement numbers are pinned.
  - The status contract key list gained `blindDecided` and `blindAccepted`.

## Contract

How this issue implements the L-items it touches, all on the src_C side:

- **L1 (GPT-5.5 transport)**
  - `EvalGate.AutomationGateProviders = ["openai-mantle", "bedrock-converse"]`.
  - The gate row pins `reviewer_provider`/`reviewer_model`/`prompt_version`, and live requires the draft-QA report's
    triple to match (unchanged).
  - `EvalGate.AutomationGateModels = ["openai.gpt-5.5", "global.openai.gpt-5.5"]`. This follows owner decision 4
    (backend-design-15).
- **L3 (gate history)**
  - `POST /api/v1/admin/automation/eval-gate` records a failing well-formed report with `passed = false`, and still
    answers 400 `EVAL_GATE_FAILED` with `failures`.
  - A report whose sha256 equals a revoked gate's is refused with 409 `EVAL_GATE_REVOKED`, and nothing is inserted.
  - The K2 newest-row rule in `AutomationMode.EffectiveAsync` is unchanged, and now reachable through the API.
- **L4 (open-exception lists)**
  - `GET /api/v1/admin/automation/decisions?open=true` (also `1`) applies the backlog predicate `OpenDecisionSql`,
    with the same keyset order and cursor.
  - `status.backlog.humanPublishItems`: at most 20 items of `{ "deckId", "deckSlug", "reason", "since" }`, over the
    rows counted in `humanPublishes` (`OpenHumanPublishSql`), oldest first.
- **L6 (runner outcome)**, server side: `runner_run_failed` is raised only by `RunnerRoutes.RunFailureNeedsHuman`:
  - an `AGENT_BLOCKED…` error;
  - a runner Claude start or subscription-login error;
  - an item on its second or later attempt.

  It is never raised when the item failed for good (`queue_item_failed` covers that). Transient first failures,
  including `AGENT_NO_RESULT`, are not emailed.

  `publish_blocked` is raised only for a live-labelled publish row.
- **L2 and L5** are not touched here. L2 was done in C01; L5 is console-only.

## Notes

- Verification that the tests fail on the old code was done by reading them against the old code, not by reverting
  and running (C01 did the latter). Here is why each group fails on the base:
  - Several new tests reference members added by this issue (`StatusRoutes.OpenHumanPublishSql`,
    `MaxHumanPublishItems`, `AutoPublisher.AcceptedBeforeRollback`, `RunnerRoutes.RunFailureNeedsHuman`). They do not
    compile against the base.
  - The route-level tests assert behaviour the base does not have:
    - a failed gate row (the base returns 400 before inserting);
    - 409 on a revoked report (the base answers 200);
    - an accepted `openai-mantle` provider (the base fails `reviewer.provider`);
    - a failing `global.anthropic.*` model (the base passes it);
    - mode `live` after a dry-run submit (the base keeps `dry_run`);
    - `actual_minutes` equal to the auto_accept baseline (the base writes null);
    - no email on a transient failure (the base always emails);
    - no would_accept uid in the dry-run body (the base lists them).
