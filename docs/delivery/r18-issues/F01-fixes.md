# F01 — Automation server round 5: fixes ledger

Issue #496, wave r18f-s, branch `delivery/r18fs/F01-496`. This is the fifth and final fix round of R18A (contract A00,
plus the K, L, M and N items of rounds B to E, and the O-items of R18F). Every code path is under `src_C/`. Line numbers
refer to the branch head.

- No schema change and no migration 037. The new `RUNNER_UNAVAILABLE_AFTER_DRAFTS` text goes into
  `authoring_queue_items.last_error`, a free-text column of at most 500 characters. It is not a CHECKed value.
  Migrations 034 to 036 are untouched.
- Full integration suite: `dotnet test Tests/RecallSmith.Lambda.IntegrationTests` (result under "Verification").

One existing assertion changed because the finding makes the old behaviour wrong: the `BatchSummary_GoldenText` blind
dry-run body (automation-34). It is listed under that finding. No assertion was weakened.

## Findings

### backend-design-22
Status: partially fixed (the src_C side of O1; the producer half is services/ai-qa, another wave's root)

- The fail-closed rule is unchanged. `Vpc/Automation/DraftQaResults.cs:178-182` still requires
  `reviewer.Effort is null || reviewer.Effort == report.EffectiveEffort`. `Vpc/Internal/AiQaResults.cs:488` already
  parses the optional top-level `effectiveEffort`, so src_C needed no code change.
- New cross-service contract test `Tests/RecallSmith.Lambda.IntegrationTests/AutomationRound5Tests.cs`:
  - Its fixture is `AiQaAutomationReportJson`. It is the exact body that services/ai-qa `handler._report` posts for an
    automation-profile draft review: json.dumps with `sort_keys` and compact separators. The keys are v, runId, chunk,
    provider, model, promptVersion, items, target, profile and, per O1, effectiveEffort.
  - The item has the done-item shape from services/ai-qa `tests/test_profiles.py`.
  - The reviewer is the production automation reviewer (`openai-mantle`, `openai.gpt-5.5`, from
    services/ai-qa/env/prod.env.json). The effort is `high`: `providers.effective_effort` returns
    `REASONING_EFFORTS["high"]` for openai-mantle at the production `AI_EFFORT=high`.
  - The fixture goes through the signed `POST /api/internal/ai-qa/results` handler, so `AiQaResults.Parse` reads it.
    - `AiQaReportFixture_HasTheAutomationReportKeys` pins the top-level key set.
    - `LiveAiQaReport_WithTheGatesEffort_IsAutoAccepted`: a matching effort passes, and the card is created.
    - `LiveAiQaReport_WithoutEffectiveEffort_FailsClosed`: the same report without the key routes to `human` /
      `REVIEWER_NOT_GATED`, and no card is created. This is today's ai-qa.
    - `DryRunAiQaReport_WithTheGatesEffort_RecordsThatTheReviewerMatchesTheGate`: the shadow evidence records
      `reviewerMatchesGate=true` once ai-qa sends the field.
- Not done here, because it is out of this issue's paths: the services/ai-qa change that sets
  `body["effectiveEffort"] = effective_effort(cfg_used)` for the automation profile, and the runbook's go-live note.
  Live auto-accept stays at 0% until that ai-qa change deploys. That is safe, because it fails closed.

### backend-design-23
Status: fixed

- `Vpc/Automation/AutomationTick.cs:789-795`: in dry_run, the weekly digest's `publishesByState` now applies the N6
  blind rule. A publish row whose run still has an undecided draft (`StatusRoutes.UndecidedDraftSql`) is left out.
  A row without a run (`p.run_id is null`) is still counted. Live is unchanged.
- The digest's "would be published" count and its "Publishes by state" line both read these counts, so both are blind
  now. `humanPublishes` (the backlog) was already live-only (`StatusRoutes.OpenHumanPublishSql`: `p.mode = 'live'`).
- Test: `AutomationTickTests.Tick_Digest_DryRun_LeavesOutThePublishesOfARunWithAnUndecidedDraft`. A blind run has a
  `would_publish` row and a `human` row. A decided run has a `would_publish` row, and one more row has no run. The
  digest says `2 would be published` and `Publishes by state: would_publish 2`, and has no `human 1`. The base code
  printed 3 would-publish and `human 1`.

### automation-34
Status: fixed

- Side channel (1): `Vpc/Automation/EmailTemplates.cs:388-390`. While the dry-run batch summary is blind (a draft is
  still undecided), the per-run spend line reads `Draft QA spend: hidden until every draft of this run is decided`. The
  sum is no longer printed. Once every draft is decided, the sum comes back. The doc comment on `BatchSummary` says so.
- Side channel (2), the digest's would-publish count and its publishes by state: fixed under backend-design-23.
- Tests:
  - `EmailTemplatesTests.BatchSummary_DryRun_NoVerdictLeaksWhileADraftIsUndecided` (extended). No blind variant has
    a `$` in its subject or body, the hidden spend line is present, and a one-draft run with a $0 spend shows no
    amount.
  - `EmailTemplatesTests.BatchSummary_DryRun_AllDecided_ShowsTheCounts` (extended). Once the run is decided,
    `Draft QA spend: $0.0012` is back.
  - `EmailTemplatesTests.BatchSummary_GoldenText`. The blind golden line `Draft QA spend: $0.0012` changed to the
    hidden text, because this finding makes the old line a verdict leak.
  - `AutomationTickTests.Tick_Digest_DryRun_LeavesOutThePublishesOfARunWithAnUndecidedDraft` covers the digest.

### ai-agent-23
Status: fixed

- `Vpc/Automation/RunnerRoutes.cs:380-391`: a `RUNNER_UNAVAILABLE` complete checks first whether the run already
  submitted drafts (`RunSubmittedDraftsAsync`, :494). That means an `ai_drafts` row whose `agent.runId` names the run,
  submitted by the run's owner, which is the join `DraftDecisions.SweepMissingAsync` uses.
- If the run did submit drafts, the item is finished as `done`. The claim's attempt is kept and nothing is requeued.
  `last_error` reads `RUNNER_UNAVAILABLE_AFTER_DRAFTS: the run submitted draft(s) before it stopped, so the item is not
  authored again; last: <error>`, capped at 500 (`RunnerUnavailableAfterDraftsError`, :484; constant :51).
- The run is finalised as usual (`AfterCompleteAsync` → `AutomationRuns.TryFinalizeAsync`), so its drafts are decided
  and reviewed. The daily `runner_unavailable` alert is still raised. No `runner_run_failed` or `queue_item_failed`
  email is sent.
- Only a run that submitted nothing takes the N3 path: the attempt is refunded, then a 15 min × 2^(n-1) backoff, and at
  n >= 3 the item fails.
- Tests (in `AutomationNotificationsTests`):
  - `RunnerComplete_RunnerUnavailableAfterDraftsWereSubmitted_FinishesTheItem_WithoutARequeue`: the item is done with
    its attempt kept, there is no lease, the run is finalised, and no per-run or per-item email is sent.
  - `RunnerComplete_RunnerUnavailableWithoutDrafts_StillBacksOffAndRequeues`: the other path. It still requeues with
    the 15 min backoff and the attempt refunded, and a draft naming the run but submitted by another sub does not
    count.
  - `RunnerUnavailableAfterDraftsError_IsCappedAt500`.
  - The existing N3 tests (`RunnerComplete_RunnerUnavailable_*`) still pass unchanged.

### backend-design-24
Status: fixed

- `Vpc/Ledger/LedgerRoutes.cs:275-276`: `EvalNotePrefix` and its one-line summary now sit above the method's doc block.
  The long summary, with the eval-exclusion rule, directly precedes `AgentDraftQualityAsync` (:289).
- Test: `AutomationRound5Tests.AgentDraftQualityAsync_CarriesItsOwnDocComment`. It reads the source and asserts that
  the `///` block right above the method has one `<summary>`, contains the eval rule, and is not the constant's
  summary. It fails on the base tree.

## Contract

- O1 (effort in the QA report, completes N2). src_C side: no parser or decision change was needed. `AiQaResults`
  parses the optional `effectiveEffort` (a string of at most 128 characters, else 400), and a live auto-accept compares
  it with the gate's `reviewer.effectiveEffort` whenever the gate recorded one, failing closed when it is missing. The
  new contract test (`AutomationRound5Tests`) pins the ai-qa automation report shape with the key. It proves that the
  production reviewer's effort passes and that a report without the key routes to `REVIEWER_NOT_GATED`. The producer
  change in services/ai-qa belongs to the services wave.
- O2 (blind Runs table): not touched here. It is the console (frontend) wave's side. The server's run list and run
  detail are unchanged by this issue.
- N6 (blind dry-run emails) now also covers the digest's publish counts and the batch summary's per-run QA spend.

## Verification

- `dotnet build Tests/RecallSmith.Lambda.IntegrationTests`: 0 errors. The only warnings are the existing NU1901
  advisory for AWSSDK.Core.
- `dotnet test Tests/RecallSmith.Lambda.IntegrationTests`: see the run recorded in the issue's worker report.
- `bash /Users/qc/.rimv-delivery/r18f-s/briefs/F01.verify.sh`: `F01 VERIFY OK`.
