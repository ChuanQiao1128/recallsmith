# C01 — Automation server round 2a: fixes ledger

Issue #455, wave r18c-s, branch `delivery/r18cs/C01-455`. Second fix round of R18A (contract A00 + the R18C L-items).
Every fix has a test that fails on the code before it. I checked this by reverting each behavioural change in a scratch
copy and running `AutomationRound2Tests`: 12 of its 13 tests failed. The 13th pins the new column's content, and that
column does not exist before this change. All paths are under `src_C/`. Line numbers refer to the branch head.

Schema: the only schema change is the new additive migration `Vpc/Db/Migrations/035_automation_fixes.sql`. It adds two
nullable columns, `deck_publishes.card_ids bigint[]` and `deck_publishes.deck_updated_at timestamptz`. It is idempotent
(`add column if not exists`). Old code never reads or writes the new columns, so applying the migration before the code
changes nothing. Migration 034 is untouched.

## Findings

### cloud-security-resilience-9
Status: fixed (server side; the release-checklist step is recorded below for the supervisor)

- `Shared/RecallSmith.Lambda.Common/Auth.cs:527` — `VerifyInternalSignatureStrict` answers `Missing <env>` when the
  route secret is not provisioned. `Auth.IsProvisionedSecret` (`:543`) defines "provisioned": not empty, not starting
  with `PLACEHOLDER-` (`PlaceholderSecretPrefix`) and at least 32 characters long (`MinStrictSecretLength`).
- `Auth.cs:566` — in the strict check, the `_PREVIOUS` companion follows the same rule: an unprovisioned previous
  secret is ignored. The lenient `VerifyInternalSignature`, used by the pre-R18A routes, is unchanged, as L2 scopes it.
- `scripts/merge-env.sh:20-27,75-88` — the new `drop_placeholder_secrets` removes every internal-secret leaf (the rows
  of `SSM_TO_ENV_INTERNAL`) whose value is a placeholder or shorter than 32 characters. It prints one warning per key
  on stderr, naming the key and never the value. Other leaves (`pg-password`, …) are not touched.
- `deploy.sh:46-48` — the decrypted SSM values pass through `drop_placeholder_secrets` before the overlay. The key is
  then missing from the secrets, so the existing `drop_absent_optional` also removes a placeholder copy that is already
  in the live environment.
- Tests: `InternalSignatureStrictTests.Strict_TerraformPlaceholder_IsRefusedAsMissing`,
  `Strict_ShortSecret_IsRefusedAsMissing`, `Strict_PlaceholderPreviousSecret_IsIgnored`,
  `IsProvisionedSecret_FollowsL2`; `scripts/merge-env.test.sh` (q) `test_drop_placeholder_secrets` and (r)
  `test_placeholder_leaf_never_deployed`.
- Existing test values changed because the finding makes them wrong: the strict routes' fake secrets were shorter than
  32 characters and would now count as missing. These values were lengthened:
  - `InternalSignatureStrictTests` `Notifier`/`NotifierPrevious`;
  - `A04Kit.FakeSecret` (AutoPublisherTests.cs:30);
  - the source-watch secret in `A05Kit.WithScopeAsync`.

  `Strict_ContractVector_Matches` still checks the A00 §8.3 vector with `test-secret` (the raw formula). Its strict-check
  half now asserts that this 11-character secret counts as missing, and runs the accepted case with a 32+ character
  secret. No assertion was weakened.
- Fixtures: the provisioned values in the new merge-env tests use obviously fake `fixture-…` strings rather than
  `PLACEHOLDER-…`, because a `PLACEHOLDER-` value is exactly what the filter drops.
- (c) Release checklist, for the supervisor: A00 §19.2 lives outside this issue's paths (`src_C/`,
  `docs/delivery/r18-issues/`), and `src_C` has no release-checklist doc. Please insert this step before §19.2 step 4
  ("Deploy core"): **"Set source-watch-secret and notifier-secret (RUNBOOK §7 post-apply secret step: a random value of
  at least 32 characters each) before deploying core."** If core is deployed first, it now fails closed: the routes
  answer 403 `Missing INTERNAL_SECRET_*` and deploy.sh warns. It no longer verifies against the public placeholder.

### backend-design-9
Status: fixed

- `Vpc/Automation/Notifications.cs:188` — `ResendAsync` also sends rows that are `queued` with 0 attempts and older
  than `NeverSentAfterMinutes` (10, `:42`). Such a row was never handed to SQS: `SendAsync` increments attempts before
  the send. Resending it cannot produce a second email. A `queued` row with attempts is still never resent (R18B K6).
- `Notifications.cs:98-119` — the email is sent right after its insert. The `automation.exception` webhook now runs
  after the send (in a `finally`, so a send that throws still emits it). This keeps the never-sent window as short as
  possible.
- Tests: `AutomationRound2Tests.Tick_NeverSentQueuedNotification_IsSentExactlyOnce` (the crash between the steps is
  simulated by a seeded queued/0-attempt row: sent once, not again, and a fresh row is left alone),
  `Tick_SummaryDedupedOntoANeverSentRow_IsStillEmailed` (the dedupe path returns the row, and the tick still gets the
  email out), `Enqueue_Exception_SendsTheEmailBeforeTheWebhook`.

### automation-17
Status: fixed (same root cause and change as backend-design-9)

- `Notifications.cs:188` (the resend of never-sent rows) and `:98-119` (send before the webhook).
- Tests: the three tests listed under backend-design-9.

### backend-design-10
Status: fixed

- K4 signal: `AutomationFailures.Record()` is now called in these catch blocks, and in no schema_not_ready branch:
  - `DraftDecisions.OnSubmittedAsync` (`Vpc/Automation/DraftDecisions.cs:91`);
  - `EnqueueQaAsync` (`:403`);
  - `OnHumanDecisionAsync` (`:522`);
  - `Notifications.EnqueueAsync` (`Notifications.cs:129`);
  - `Notifications.RaiseExceptionAsync` (`:165`).

  Inside a tick, `Record()` attributes each failure to the running step in `failedSteps`.
- Missing decisions: `DraftDecisions.SweepMissingAsync` (`:148`) runs as the new tick step `decision_sweep`
  (`AutomationTick.cs:169`), before the QA steps and finalisation. It picks up pending `ai_drafts` that match all of
  these:
  - `agent.runId` names an `automation_runs` row;
  - the draft was submitted by that run's owner;
  - it is older than `MissingDecisionGraceMinutes` (5);
  - it has no decision.

  The sweep decides each such draft through the same prechecks (`DecideAsync`, `:100`, shared with `OnSubmittedAsync`;
  `PrecheckAsync` now takes the submitter's sub instead of the whole `AuthContext`). A run that is no longer `running`
  therefore routes the draft to a human with `RUN_NOT_RUNNING`, so a late decision is never automatic.
- Stuck `qa_pending`: `AutomationTick.TimeOutQaAsync` (`:300-341`) moves a `qa_pending` decision to `human` /
  `ENQUEUE_FAILED` when all of these hold:
  - its reason is not `AI_QA_DAILY_CAP`;
  - it has not been updated for `QaTimeoutMinutes × QaPendingTimeoutFactor` (2) minutes.

  The move adds its event, the live ledger row and a count in `qaTimedOut`, and the run can then finalise.
- Tests: `AutomationRound2Tests.SwallowedFailures_EachEmitAutomationStepFailures` (and the schema_not_ready branch
  stays silent), `Tick_DraftWhoseSubmitHookWasLost_GetsItsDecisionFromTheSweep`,
  `Tick_QaPendingThatNeverEnqueues_RoutesHumanAfterTheTimeout` (it also asserts `qa_retry` in `failedSteps`).

### automation-18
Status: fixed

- Same K4 call sites as backend-design-10, plus `RunnerRoutes.AfterCompleteAsync` (`Vpc/Automation/RunnerRoutes.cs:417`).
  Its drafts without a decision are repaired by the sweep described under backend-design-10, so they appear in the
  summary and backlog counts again.
- Tests: `AutomationRound2Tests.SwallowedFailures_EachEmitAutomationStepFailures` (covers `AfterCompleteAsync` too),
  `Tick_DraftWhoseSubmitHookWasLost_GetsItsDecisionFromTheSweep`.

### backend-design-14
Status: fixed

- `Vpc/Automation/AutoPublisher.cs:451-475` (`ReconcileAsync`) handles two cases the same way:
  - A `publishing` row whose job has been PENDING/PROCESSING and untouched for more than `StuckJobMinutes`: the tick
    fails that one job with the reaper's statement and error text (`StuckJobError = "orphaned: no worker pickup"`,
    `:29`), guarded so that a job that moved meanwhile is left alone.
  - A row whose job row is missing.

  Both then take the existing FAILED branch: `human` / `PUBLISH_FAILED`, a `publish_failed` exception email (dedupe
  per job), the live ledger row, and `AutomationFailures.Record()`. The warn-only branch is gone. The doc comment no
  longer claims that "the existing reaper handles stuck jobs".
- Tests: `AutomationRound2Tests.Tick_StuckPublishingJob_RoutesHumanAfterStuckMinutes` (PROCESSING and PENDING 61
  minutes old are routed; a job 55 minutes old is left alone), `Tick_PublishingRowWithoutItsJobRow_RoutesHuman`.

### automation-11
Status: fixed (same change as backend-design-14)

- `AutoPublisher.cs:451-475`: fail after `StuckJobMinutes`, and handle the missing-job-row case; then
  `Record()`; the doc comment is corrected.
- Tests: `Tick_StuckPublishingJob_RoutesHumanAfterStuckMinutes`, `Tick_PublishingRowWithoutItsJobRow_RoutesHuman`
  (the two tests the finding asked for).

### backend-design-12
Status: fixed

Coverage is now decided by membership, not by timestamps.

- `Vpc/Authoring/Publish.cs:428-446` — every job row (console and automation) records `card_ids`: the ids of the deck's
  live cards, read in the insert statement itself. The Worker reads the deck after that insert commits, so every card
  in the set was committed before the build read and is in the build (or was deleted first). If the code runs before
  migration 035, a console publish falls back to the old insert, so human publishing is never blocked by the migration.
- `AutoPublisher.cs:564-566` (`PublishedAsync`) — a card is uncovered when it is a live automation-accepted card that
  is not in the job's `card_ids`, or when it is deferred. Only a job from before 035 (`card_ids` null) still uses the
  old timestamp rule.
- `AutoPublisher.cs:258,290-298` (check 6/8) — the pending change set also contains every live automation-accepted card
  that the live build's job did not record. Check 8 therefore no longer reports `published` for a card that the live
  build is missing.
- Tests:
  - `AutomationRound2Tests.Tick_CardAcceptedWhileTheBuildRan_IsPublishedByTheNextJob`. A card's `updated_at` is
    predated before the job, which simulates an accept transaction that started before the job insert and committed
    after the Worker read. The reconcile opens its own row and a second job publishes it.
  - `Evaluate_AcceptedCardMissingFromTheLiveBuild_IsPublishedNotAssumedShipped`.
  - `ConsolePublish_RecordsCardIdsButNoDeckSettings`.

### backend-design-11
Status: fixed

- `AutoPublisher.cs:341,170` — check 9 passes the `decks.updated_at` that check 5 read (in the same repeatable-read
  snapshot) to `Publish.StartPublishAsync` as `expectedDeckUpdatedAt`.
- `Publish.cs:335-339` — if the deck's `updated_at` is no longer that value, the publish is refused `AI_QA_STALE`.
  Otherwise the value is stored on the job (`deck_updated_at`).
- `Worker/Services/PublishJobProcessor.cs:82-89,177-200` — `DeckSettingsChangedAsync` runs after the deck is read. A
  job that carries `deck_updated_at` fails as `AI_QA_STALE: deck settings changed …` (with the `AiQaStale` gauge) when
  the deck's `updated_at` changed since. The existing stale path then returns the row to `waiting`, and check 5 routes
  it to a human with `DECK_HAS_HUMAN_CHANGES`. A console job has no `deck_updated_at` and is unaffected. Before 035
  the check returns false.
- Tests:
  - `AutomationRound2Tests.Tick_DeckSettingsEditedBeforeTheBuild_FailsStaleThenRoutesHuman`. This is the end-to-end
    test the finding asked for. The real Worker processor refuses the build and nothing is uploaded; the next tick
    ends the row at `human` / `DECK_HAS_HUMAN_CHANGES` / "deck settings changed".
  - `StartPublish_DeckSettingsChangedSinceTheCheck_IsRefusedStale`.
  - `ConsolePublish_RecordsCardIdsButNoDeckSettings`.

## Contract

- **L2 (placeholder secrets fail closed)** — implemented as specified:
  - A strict-route secret, or its `_PREVIOUS` companion, counts as missing when it starts with `PLACEHOLDER-` or is
    shorter than 32 characters (`Auth.IsProvisionedSecret`).
  - `drop_placeholder_secrets` in `merge-env.sh`, applied by `deploy.sh`, drops such internal-secret leaves with a
    key-only warning.
  - Both sides are tested (C# unit tests; merge-env.test.sh (q)/(r)).
  - The filter applies to the internal-secret leaves, the rows of `SSM_TO_ENV_INTERNAL`. `pg-password`,
    `migrate-secret`, `internal-shared-secret`, the RevenueCat and salt leaves are left alone: their values have
    different length rules, and dropping them would break the core-vpc deploy.
- **L1, L3, L4, L5, L6** — not touched by this issue. They belong to other issues and waves (C02+ / services / frontend
  / tools).
- R18B K4 is extended rather than changed. "Every swallowed automation failure" now includes the draft-decision hooks,
  the notification enqueue/raise paths, the runner's after-complete hook, a stuck or missing publish job, and a
  never-enqueuing `qa_pending` decision. The tick response keeps its A00 §12.6 shape (no new `actions` key). The new
  step is visible only as `decision_sweep` in `failedSteps` when it fails.
- R18B K6 is refined. A `queued` row with at least one attempt is still never resent. A `queued` row with 0 attempts
  older than 10 minutes was never sent, and the tick sends it once.
