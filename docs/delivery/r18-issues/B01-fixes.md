# B01 — Automation server fixes 1: fixes per finding

Issue #440, wave r18b-s. Branch `delivery/r18bs/B01-440`. Every path is relative to the repo root.
All tests are in `src_C/Tests/RecallSmith.Lambda.IntegrationTests/` and run against a real Postgres
(Testcontainers).

Migration 034 has not been applied anywhere yet, so it is edited in place (still idempotent,
`create table if not exists`). The only schema change is one new column,
`automation_publishes.deferred_card_ids bigint[] not null default '{}'`
(`src_C/Vpc/Db/Migrations/034_automation.sql`, part 7). No migration 035 was added.

## Publish row lifecycle after this fix

- `card_ids` of an `automation_publishes` row are the cards its build covers. They are appended only while the
  row is `waiting`, before the evaluation binds the snapshot.
- A run that finalises while the deck's open row is `publishing` never changes that row's `card_ids`. Its card
  ids go into `deferred_card_ids`, minus any the row already covers. The run's batch summary treats the deferred
  ids as its own, so it waits for the in-flight row and does not fire early with "no publish".
- Reconcile, job `SUCCESS`: in one transaction, the row becomes `published`. Its `card_ids` are cut to the cards
  the build covered, and `deferred_card_ids` is cleared. The uncovered cards are the deferred ids plus every
  `auto_accepted` card of the deck changed after the job's `deck_publishes.created_at`. They open the deck's next
  `waiting` row, owned by the newest run among them. The open-row unique index allows the new row because the old
  one is now terminal. The same tick then re-evaluates the new row, and a fresh publish starts.
- Reconcile, job `FAILED` with `AI_QA_STALE`: the row returns to `waiting` (reason `AI_QA_STALE`, `attempts + 1`,
  deferred ids merged into `card_ids`) and the same tick re-evaluates it. Once `MaxStaleAttempts` (3) is
  reached, the row goes to `human` / `PUBLISH_FAILED` as before. Any other failure also goes to
  `human` / `PUBLISH_FAILED`; deferred ids are merged into its `card_ids`, so the deferred run's summary reports
  the human route.
- Tick order: `reconcile` now runs before `finalize`. `publishes` still reconciles once more before it
  re-evaluates `waiting` rows.

### automation-1

Status: fixed

- `src_C/Vpc/Automation/AutoPublisher.cs:115` `OpenRowAsync`: appends to `card_ids` only when the row is `waiting`.
  A `publishing` row records the ids in `deferred_card_ids` instead. The insert uses
  `on conflict … do nothing`, so it never throws and is safe inside a transaction.
- `src_C/Vpc/Automation/AutoPublisher.cs:379` `ReconcileAsync` and `:484` `PublishedAsync`: the SUCCESS path
  computes coverage, trims `card_ids`, clears `deferred_card_ids` and opens the next `waiting` row for uncovered
  cards. The FAILED `AI_QA_STALE` path returns the row to `waiting` for re-evaluation, with no exception email.
- `src_C/Vpc/Automation/AutomationTick.cs:164`: a new `reconcile` step runs before `finalize`.
- `src_C/Vpc/Automation/AutomationTick.cs:350,391`: summary gating and listing match on
  `card_ids || deferred_card_ids`.
- Tests: `AutomationTickTests.Tick_RunFinalisedDuringPublish_GetsItsOwnPublishAndSummary` covers the scenario
  the audit asked for. Run A is publishing; run B accepts and finalises (its ids are deferred and A's `card_ids`
  stay `[A]`); no summary is sent while A runs. A's job succeeds: A's row becomes `published` with `[A]`, B gets its
  own row, which reaches `publishing` in the same tick. A's summary says published; B's summary is not sent until
  B's own build succeeds, and then it says published. No `publish_failed` email is raised.
  `AutomationTickTests.Tick_StaleJob_ReEvaluatesThenPublishes` covers the other ordering: B lands while A's job is
  PENDING, and the Worker fails A's job with `AI_QA_STALE`.
- Changed existing test: `Tick_ReconcilesPublishingFailure` still uses an `AI_QA_STALE` error but now starts at
  `attempts = MaxStaleAttempts - 1`. The finding makes the old behaviour (first stale failure ⇒ human) wrong, and
  the test now covers the exhausted-attempts path, which still goes to a human with every old assertion unchanged.
  Its `PublishingAsync` helper gained an optional `attempts` argument.
- Deviation: the brief asks that a stale failure re-evaluate "when every changed card is automation-owned". The
  row goes back to `waiting` unconditionally, and the re-evaluation's check 6 decides: automation-only changes
  publish again, while any human change routes to a human as `DECK_HAS_HUMAN_CHANGES` and lists the human-changed
  uids. That reason is more precise than `PUBLISH_FAILED` and uses exactly the same ownership rule.

### backend-design-1

Status: fixed

Same root cause and change as automation-1 (see above). The summary for B no longer picks up A's row, because
A's `card_ids` never contain B's cards and its `deferred_card_ids` are cleared once B's cards move to their own
row. The published row's `card_ids` are exactly what the snapshot covered.
Tests: `Tick_RunFinalisedDuringPublish_GetsItsOwnPublishAndSummary`, `Tick_StaleJob_ReEvaluatesThenPublishes`.
Existing tests still pass: `AutoPublisherTests.Evaluate_OpenRow_IsReusedAcrossRuns` (the `waiting` reuse) and
`Tick_ReconcilesPublishingSuccess`.

### backend-design-2

Status: fixed

- `src_C/Vpc/Automation/AutomationRuns.cs:44-66`: the transaction that sets `finalized_at` also opens (or appends
  to) the deck's `automation_publishes` row for every deck with an `auto_accepted`/`would_accept` decision
  (`AutoPublisher.OpenRunRowAsync`, `AutoPublisher.cs:96`). The evaluation still runs after the commit. If it is
  lost to a crash, a timeout or a swallowed error, a `waiting` row remains, and tick step `publishes` re-evaluates
  it. A test seam `AutomationRuns.TestAfterCommitSeam` sits between the commit and the evaluation.
- Test: `AutomationTickTests.Tick_EvaluationLostAfterFinalisation_IsRetried`. The seam throws after the
  finalisation commit. The run is finalised, a `waiting` row with the run's card exists, one
  `AutomationStepFailures` gauge is emitted, and nothing is published. The next tick then starts the publish, and
  the batch summary waits for it.

### automation-2

Status: fixed

Same change and test as backend-design-2. The window between the `finalized_at` commit and the insert of the
publish row no longer exists, because both are in one transaction.

### backend-design-3

Status: fixed

- New `src_C/Vpc/Automation/AutomationFailures.cs`. `Record()` emits
  `RouteMetrics.EmitGauge("AutomationStepFailures", 1)`, which has the same namespace and the same dimensionless
  convention as `AutomationNotifyEnqueueFailures`. Inside a tick it also adds the running step's name to
  `failedSteps`, through an `AsyncLocal` sink, so failures a step swallows internally are named too.
- It is called from:
  - every tick step catch (`AutomationTick.cs:151`);
  - the tick's inner swallows: batch summary, `source_changed`, weekly digest;
  - `AutomationRuns.TryFinalizeAsync`, both catches;
  - `AutoPublisher.LogFailure` (evaluate, re-evaluate and reconcile, including `schema_not_ready`);
  - `DraftQaResults` after-commit (`DraftQaResults.cs:327`).
- The tick response gains `"failedSteps": [string]`, which is `[]` when nothing failed (also for `off` and
  `locked`). The tick log event is `warn` when the list is non-empty.
- Tests: `AutomationTickTests.Tick_SwallowedFailures_EmitMetricAndFailedSteps`. Triggers make updates fail; a step
  that throws (`finalize`) and a failure swallowed inside a step (`reconcile`) both appear in `failedSteps` and
  emit the gauge. `Tick_NoFailures_AnswersEmptyFailedSteps` checks the empty list and that no gauge is emitted.
  `Tick_EvaluationLostAfterFinalisation_IsRetried` covers the finalisation gauge.
- Changed existing fixture: `A04Kit.ContractTickResponseJson` gains `"failedSteps": []` (K4), so the key-shape
  assertion in `Tick_ModeOff_IsSkipped` pins the new field.
- Not in this issue's paths: the alarm (infra) and the notifier's warn log. Those are the other waves' side of K4.

### backend-design-6

Status: fixed

- `src_C/Vpc/Automation/AutomationTick.cs:128-169`: `Spent()` is checked before every step and before every item
  of each step's loop: leases, QA retry, QA timeout, reconcile (`ReconcileAsync(..., stop:)`), finalise,
  re-evaluation, summaries, source events and runner health. When the budget is spent, the rest is left for the
  next tick, and the tick lists `"budget_exhausted"` (`AutomationTick.BudgetExhausted`) in `failedSteps`. Budget
  exhaustion does not emit `AutomationStepFailures`, because it is not a failure.
- Test: `AutomationTickTests.Tick_Budget_StopsInsideAStepLoop`. Three `qa_pending` drafts, every QA send is slower
  than a shortened budget: `qaRetried = 1`, `failedSteps` contains `budget_exhausted`, two drafts remain, and the
  next tick with the normal budget retries both.
- Out of scope: `SourceWatchRoutes.RetryWaitingRechecksAsync` (A05's loop, capped at 20) and
  `Notifications.ResendAsync` (K6 belongs to another issue) are called unchanged. Each is still guarded by the
  step-entry check.

### backend-design-7

Status: fixed

- `src_C/Tests/RecallSmith.Lambda.IntegrationTests/AutoPublisherTests.cs`: the check-6 oracle is now an explicit
  truth table (`MayAutoPublish`, 2 modes × 6 card kinds), written case by case from A00 §6.2 / §0 and not derived
  from the implementation's predicate. `PendingChangeSet_OneCard_FollowsTheTruthTable` checks each row, and
  `PendingChangeSet_Property_MatchesCheck6` (60 generated change sets) looks up the expectation of each card in
  the table.
- Races (`Task.WhenAll`):
  - `Evaluate_ConcurrentOnOneDeck_StartsOnePublish`: three concurrent evaluations of one deck give exactly one
    `automation_publishes` row, one PENDING `deck_publishes` row and one SQS send.
  - `HumanAccept_RacingAutoAccept_YieldsOneCardAndAConsistentDecision`: four rounds of a human accept racing the
    passing draft-QA report on the same draft. Each round gives exactly one card and an accepted draft. The
    decision is either `auto_accepted` pointing at that card, or `superseded` / `DECIDED_BY_HUMAN` with
    `human_action = accepted`.
- The `publishing`-row path and the finalise-crash path are covered by the tests listed under automation-1 and
  backend-design-2.

## Contract

- K4 (server side): `AutomationStepFailures` gauge via `RouteMetrics.EmitGauge(name, 1)`. It is emitted from every
  swallowed automation failure listed under backend-design-3. The tick response carries
  `failedSteps: [string]` (`[]` when none). Its entries are step names (`digest`, `leases`, `qa_retry`,
  `qa_timeout`, `reconcile`, `finalize`, `publishes`, `summaries`, `source_events`, `runner_health`, `eval_gate`,
  `resend`) plus `budget_exhausted` when the 20 s budget stopped the tick early.
- A00 §6.2 (open-row append) is changed by the design fix. The deck's open row takes new card ids only while it is
  `waiting`; a `publishing` row defers them to `deferred_card_ids`, and the reconcile opens the next `waiting`
  row for them. A00 §6.5 (reconcile) gains the coverage check on SUCCESS and the `AI_QA_STALE` re-evaluation.
  §12.6 gains the `reconcile` step before `finalize`.
- K1–K3 and K5–K7 are not touched by this issue.
