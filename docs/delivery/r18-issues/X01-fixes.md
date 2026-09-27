# X01 — Server hardening: fixes per finding

Issue #353, wave r18x-s. Branch `delivery/r18xs/X01-353`. Every path is relative to the repo root.
All tests are in `src_C/Tests/RecallSmith.Lambda.IntegrationTests/` and run against a real Postgres
(Testcontainers). `dotnet test src_C/RecallSmith.Lambda.sln`: 1573 passed, 0 failed.

Migrations 026–031 have not been applied anywhere yet, so migration 028 is edited in place (additive and
idempotent: `create table if not exists`, `insert … on conflict do nothing`). No migration 032 was added.

Contract changes (they differ from `R18-00-contracts.md`, and a finding requires each one):

| Contract item | Was | Now | Finding |
|---|---|---|---|
| §7 ai_qa_review dedupe key | `qa:<runId>:<chunk>` | `qa:<runId>:<chunk>:<hash of the transitions>` | backend-design-1 |
| §9.3 webhook_notification dedupe key | `webhook:<deliveryId>` | `webhook:<eventId>:<subscriptionId>` | automation-10 |
| §9.3 draft reject ledger row | only for the 4 defect reasons, `defects_caught = 1` | every reject, `units 0`, `actual_minutes = reviewMs/60000`, `defects_caught = 0`, `details {reason, defect}` | automation-4 |
| §9.4 GET /ledger | per-row clamp; totals/automations/series | per-(automation, source) clamp; adds `totals.bySource`, `totals.byBaselineSource`, top-level `agentDrafts` (additive) | automation-4, automation-11 |
| §9.5 backfill import heuristic | every deck-minute with ≥ 5 cards | only cards created before `live_since`, never an accepted AI draft | backend-design-2, automation-3 |
| §6 delivery status | a `retry` for an inactive subscription stays `retrying`; only `delivered` is sticky | written as `failed` / `subscription inactive`; `delivered`, `failed` and `dead` are sticky; stale attempts are ignored | backend-design-3, -8, automation-9 |
| §2 routes | — | new super_admin `POST /api/v1/admin/webhooks/deliveries/sweep` | automation-1 |
| internal route dispatch | `EndsWith` suffix match | exact path match | cloud-security-resilience-2 |

## Metric contract (namespace `DeveloperCards`)

core-vpc and worker gauges go through `RouteMetrics.EmitGauge(name, value)`. They are dimensionless, like
the existing `WebhookEnqueueFailures`. Each emission has value 1 per event (the webhook one carries the
failure count of the call):

| Metric | Emitted at | Meaning |
|---|---|---|
| `LedgerWriteFailures` | `src_C/Shared/RecallSmith.Lambda.Db/AutomationLedger.cs:50,55` | a best-effort ledger write was dropped (schema not ready, FK/check violation, DB error) |
| `AiQaEnqueueFailures` | `src_C/Vpc/Qa/QaRuns.cs:200` | a QA run whose SQS send failed (the run is also marked `failed`/`ENQUEUE_FAILED`) |
| `QaGateRefusals` | `src_C/Vpc/Qa/QaGate.cs:134,142` | a publish refused by the AI QA gate (informational; the code `AI_QA_REQUIRED`/`AI_QA_BLOCKED` is on the log line) |
| `WebhookEnqueueFailures` (existing) | `WebhookEvents.cs` enqueue, redeliver and sweep | delivery rows left `enqueue_failed` |

webhook-dispatcher (`services/webhook-dispatcher`, not changed here): `WebhookDeliveryAttempts` with
dimension `Outcome` already uses four distinct values (handler.py:173-177, emf.py:51):
`delivered`; `retry` (retryable failure, another attempt follows); `failed` (permanent, non-retryable
failure such as a 4xx or a blocked URL); `dead` (give-up after the last attempt, `MAX_ATTEMPTS`). So a
permanent failure (`Outcome=failed`) and a give-up (`Outcome=dead`) can be told apart. Report-call
failures stay in `WebhookReportFailures`. ai-qa keeps `AiQaErrors` and `AiQaRefusals`.

The CloudWatch alarms on `WebhookEnqueueFailures` and `LedgerWriteFailures` > 0 are infra (X08).

---

### backend-design-1

Status: fixed

- `src_C/Vpc/Internal/AiQaResults.cs:170-175` records every `cardId → newStatus` transition the report
  applied. `:290-300` records the ledger event only when there is at least one transition, keyed by
  `LedgerDedupeKey` (`:313`): `qa:<runId>:<chunk>:<first 16 hex of SHA-256 over the sorted cardId:status pairs>`.
  An exact replay changes nothing, so it records nothing. A chunk retried after `PROVIDER_RATE_LIMITED`,
  `PROVIDER_ERROR` or `PROVIDER_TIMEOUT` reports different transitions, so it gets its own row. A card
  becomes `done` at most once per run (`done` is never downgraded), so no unit can be counted twice.
- Tests: `AiQaResultsTests.Results_RetriedChunk_RecordsNewlyDoneUnits` (2 done + 1 retryable error, then all 3
  done, then an exact replay: 2 rows, total units 3; the same with the third card left `queued`).
  `Results_RecordsLedgerEventOncePerChunk` and `Results_UnknownCardId_IsIgnored` now look up the key by the
  `qa:<runId>:0:%` prefix, because the key format changed. Their assertions are otherwise unchanged.

### backend-design-2

Status: fixed

- `src_C/Vpc/Db/Migrations/028_automation_ledger.sql:54-62` adds `automation_ledger_meta` and writes
  `live_since = now()` once, when 028 is applied. Live ledger recording starts at that moment.
- `src_C/Vpc/Ledger/LedgerRoutes.cs:529-551`: `ImportCandidates` counts only cards with
  `created_at < live_since`. If the meta row is missing, the cutoff is the first live event, and if there
  is none, `infinity`. It also skips every card that is an accepted AI draft
  (`ai_drafts.accepted_card_id`, used only when migration 030 is present, `:582-584`). A live import of 5 or
  more cards, or a burst of draft accepts, can no longer be counted a second time. This holds for the
  first run after deploy and for every later re-run.
- Test: `LedgerBackfillTests.Backfill_SkipsLiveImportsAndAcceptedDrafts` (a live import of 6 cards with its
  live `bulk_import` row, plus 5 accepted drafts in one historical minute; backfill with `dryRun=false`
  inserts 0 rows for that deck). This test fails on the old code. The existing backfill tests still pass.

### backend-design-3

Status: fixed

- `src_C/Vpc/Internal/WebhookDeliveryReport.cs:93-127`: the single UPDATE now writes status `failed` and
  `last_error = 'subscription inactive'` (`SubscriptionInactiveError`, `:21`) when a `retry` is reported
  for a deleted or inactive subscription. The same statement returns `stop=true`, and the dispatcher then
  acks, so no row is left `retrying` for good. `dead`/`failed`/`delivered` outcomes for such a
  subscription are stored as reported.
- Test: `WebhookDeliveryReportTests.Report_InactiveSubscription_ReturnsStop` now also asserts that the row
  and the response are `failed`, with the `subscription inactive` error, for both the inactive and the
  deleted case.

### backend-design-8

Status: fixed

- `src_C/Vpc/Internal/WebhookDeliveryReport.cs:106-120`: `delivered`, `failed` and `dead` are terminal.
  A report with `attempt < attempts` is stale. In both cases the row keeps its `status`,
  `last_status_code`, `last_error` and `delivered_at`, and only `attempts = greatest(...)` may grow.
- Tests: `WebhookDeliveryReportTests.Report_TerminalStates_AreSticky_AndStaleAttemptsIgnored` (dead at attempt 5,
  then retry at 4 and a duplicate retry at 5; failed at 3, then retry/dead/delivered at 2; a stale retry on a
  `retrying` row keeps the newer code and error). `Report_Retry_UpdatesAttemptsStatusAndError` used to
  send `failed` after `dead` on the same row and expect `failed`. The finding makes that expectation wrong,
  so the `failed` outcome is now checked on a fresh delivery.

### backend-design-10

Status: fixed

- `LedgerWriteFailures` in both catch blocks of `AutomationLedger.RecordAsync`
  (`src_C/Shared/RecallSmith.Lambda.Db/AutomationLedger.cs:50,55`). `AiQaEnqueueFailures` at the QA send
  failure (`src_C/Vpc/Qa/QaRuns.cs:200`). `QaGateRefusals` at both gate refusals
  (`src_C/Vpc/Qa/QaGate.cs:134,142`). The names follow the wave's metric contract, not the audit's
  suggested `AutomationLedgerWriteFailures`/`PublishRefused`, so the X08 alarms and these emitters agree.
- The alarms themselves (on `WebhookEnqueueFailures` and `LedgerWriteFailures` > 0) are infra, owned by X08.
  `enqueue_failed` rows now also have a sweeper (automation-1).
- Tests: `AutomationLedgerTests.Record_DroppedWrite_EmitsLedgerWriteFailures` (FK failure and pre-028 schema
  each emit 1, a good write emits 0), `AiQaRunsTests.StartRun_SendFailure_EmitsAiQaEnqueueFailures`,
  `AiQaPublishGateTests.Gate_Refusal_EmitsQaGateRefusals`. Each test parses the EMF line from stdout.

### backend-design-4

Status: fixed

- `src_C/Shared/RecallSmith.Lambda.Db/WebhookEvents.cs:40-78`: the side-effect SQS client uses
  `BoundedSqsConfig()` (`Timeout = 3 s`, `MaxErrorRetry = 1`). Every `EnqueueAsync`, `RedeliverAsync` and
  sweep call gets one linked deadline of `SendDeadline = 5 s` (`:214, :285, :365`). `TrySendAsync`
  enforces it with `WaitAsync(ct)` (`:405-406`), so even a send that ignores its token stops at the
  deadline. The remaining rows fail immediately and are marked `enqueue_failed` with
  `enqueue deadline exceeded (5000 ms)`, and the sweep can then pick them up. `QaRuns` builds its SQS client
  from the same bounded config (`src_C/Vpc/Qa/QaRuns.cs:53`).
- Tests: `WebhookSweepTests.Enqueue_HangingSend_ReturnsWithinTheDeadline` (a 30 s send against 3 subscriptions
  and a 300 ms deadline returns in well under 5 s, with `EnqueueFailures == 3`, and all rows
  `enqueue_failed`), `WebhookSweepTests.SqsClientConfig_IsBounded`.

### automation-1

Status: partially fixed

- New super_admin route `POST /api/v1/admin/webhooks/deliveries/sweep`
  (`src_C/Vpc/Integrations/WebhookDeliveries.cs:168-241`, dispatched at `src_C/Vpc/VpcFunction.cs:249`,
  labelled in `src_C/Shared/RecallSmith.Lambda.Common/RouteMetrics.cs:161`). Body `{ "limit": 1..100 }`
  (optional, default 100). It claims up to `limit` stranded deliveries, oldest first:
  `enqueue_failed`, or `queued` with `attempts = 0`, untouched for 10 minutes, on a live subscription
  (`WebhookEvents.ClaimStrandedAsync`, `WebhookEvents.cs:320`). The claim uses
  `for update … skip locked`, so concurrent sweeps never claim the same row. Each claimed row goes back to
  `queued` with a fresh `updated_at`, and an `admin_audit` row (`webhook.deliveries.sweep`) is written in
  the same transaction. After commit, each row is re-sent with the same `delivery_id` and `eventId`
  (`ResendClaimedAsync`, `:353`), so receivers dedupe as before. A failed send marks the row
  `enqueue_failed` again. The route is idempotent: a swept row is fresh, and a second sweep within
  10 minutes finds nothing. It answers `503 WEBHOOKS_NOT_CONFIGURED` without a queue URL.
- Not fixed, by design of this release: a process crash between `CompleteJobAsync` and
  `AfterPublishSucceededAsync` in the worker (`PublishJobProcessor.cs:85-86`) still loses `deck.published`
  and the `publish_pipeline` row for that job, because no delivery row exists yet. Closing that gap needs
  an outbox written in the job's own transaction. The contract keeps the enqueue a best-effort side effect
  (§8, §6), and the verifier marks the outbox as a later-release item. A scheduler for the sweep is out of
  scope (contract: "R18 adds no scheduler action"). Operators run the sweep from the runbook. Showing
  Redeliver for old `queued` rows is a console change (frontend wave). The server already redelivers any
  row, and the sweep now covers old `queued` rows.
- Tests: `WebhookSweepTests.Sweep_ResendsOnlyStrandedDeliveries_WithTheSameIds`,
  `Sweep_IsBoundedAndMarksFailedSendsAgain`, `Sweep_RequiresSuperAdmin_ValidLimit_AndAQueue`.
  `RouteMetricsTests.RouteTable_AndTheDispatchers_NameTheSameRoutes` covers the route registration.

### automation-3

Status: fixed

- The same change as backend-design-2: the `live_since` cutoff (`028_automation_ledger.sql:54-62`, recorded when
  migration 028 is applied) and the accepted-draft exclusion in `ImportCandidates`
  (`src_C/Vpc/Ledger/LedgerRoutes.cs:529-551`).
- Test: `LedgerBackfillTests.Backfill_SkipsLiveImportsAndAcceptedDrafts` (a live import of 6 cards, then a
  backfill with `dryRun=false`, inserts 0 `bulk_import` rows for that minute; accepted drafts are not a
  burst).

### automation-4

Status: partially fixed

- Every reject now records `ai_draft_review` with units 0, `actual_minutes = reviewMs / 60000`,
  dedupe key `draft-reject:<id>` and `details {reason, defect}`
  (`src_C/Vpc/Review/Drafts.cs:629-637`). The row carries `defects_caught = 0`, because a draft the agent
  got wrong is not a defect caught before publish. `totals.defectsCaught` and the series now count only
  QA fixes and gate refusals.
- Minutes saved are clamped per (automation, source) group, not per row: `greatest(0, Σ units × baseline −
  Σ actual_minutes)` over success/partial rows (`src_C/Vpc/Ledger/LedgerRoutes.cs:86-154`, both the
  per-automation query and the series). Review time on rejects now reduces the savings of the accepts.
  Backfill rows carry no actual minutes, so live review cost does not offset inferred history.
- New `agentDrafts` block on GET /ledger (`AgentDraftQualityAsync`, `LedgerRoutes.cs:257`), from
  `ai_review_events` in the period: `decided`, `accepted`, `editedAccepted`, `rejected`, `defectRejects`,
  `acceptanceRate`, `editedAcceptRate`, `defectRate` (the agent's defect rate), and `avgReviewMinutes`.
- Partial: the console still prints the old definition of "Defects caught before publish", and it has no
  tile for `agentDrafts` yet (`frontend/src/lib/ledgerView.ts:142-144`). That is frontend, which this
  issue's scope does not allow. The server numbers are already correct, so the existing tile stops
  counting agent rejects without a frontend change.
- Tests: `DraftsTests.Reject_DefectReason_RecordsReviewCostNotDefect` and
  `DraftsTests.Reject_NonDefectReason_RecordsReviewCostWithoutDefect` replace the old
  `Reject_DefectReason_RecordsLedgerDefect` / `Reject_NonDefectReason_RecordsNoLedgerDefect`. The finding
  makes their old expectations wrong (defect 1 for defect reasons, no row otherwise).
  `AutomationLedgerTests.Ledger_ReviewCostOffsetsSavingsPerAutomation_AndSplitsBySource` (accept 1 unit with
  2 min, reject with 3 min: saved 7, where the per-row clamp gave 10) and
  `AutomationLedgerTests.Ledger_ReportsAgentDraftQuality`. `Ledger_ComputesTotalsAndMinutesSaved` has two
  shape assertions (the response key lists) that now include the new additive keys.

### automation-9

Status: fixed

- The same statement as backend-design-8 (`src_C/Vpc/Internal/WebhookDeliveryReport.cs:106-120`): a
  report whose `attempt` is lower than the recorded `attempts` changes no status, code or error, and
  neither does any report on a terminal row.
- Test: `WebhookDeliveryReportTests.Report_TerminalStates_AreSticky_AndStaleAttemptsIgnored` (`failed` at
  attempt 3, then `retry` at attempt 2: the row stays `failed` with its code and error).

### automation-10

Status: fixed

- `src_C/Vpc/Internal/WebhookDeliveryReport.cs:133-142`: the `webhook_notification` dedupe key is now
  `webhook:<eventId>:<subscriptionId>`, read from the same `returning` clause (`d.event_id`,
  `d.subscription_id`). An event notified to a destination counts once, however many times it is
  redelivered. `ref` stays the delivery id that succeeded first.
- Tests: `AutomationLedgerTests.WebhookRedelivered_CountsOneNotificationPerEventAndSubscription`.
  `AutomationLedgerTests.WebhookDelivered_RecordsNotificationOnce` now looks up the new key; its assertions
  are otherwise unchanged.

### automation-11

Status: partially fixed

- GET /api/v1/admin/automation/ledger now returns `totals.bySource.{live,backfill}` (`runs`, `units`,
  `minutesSaved`, `hoursSaved`) and `totals.byBaselineSource.{measured,default}.minutesSaved`
  (`src_C/Vpc/Ledger/LedgerRoutes.cs:199-210`). A reader can see how much of the headline is inferred
  history versus measured live data, and how much rests on default baselines.
- Runbook: `docs/delivery/r18-issues/X01-ledger-runbook.md` (backfill dry run, then apply, then the sweep).
- Partial: the super_admin "Backfill history" panel and the split tiles on LedgerPage are frontend, which
  this issue's allowed paths do not include. The API they need is in place.
- Test: `AutomationLedgerTests.Ledger_ReviewCostOffsetsSavingsPerAutomation_AndSplitsBySource` (live 10 min,
  backfill 15 min, total 25; measured + default = total).

### cloud-security-resilience-2

Status: partially fixed

- `src_C/Vpc/VpcFunction.cs:393-411`: the four HMAC-signed internal routes (`/api/internal/entitlements/apply`,
  `/api/internal/subscriptions/upsert`, `/api/internal/webhooks/deliveries/report`,
  `/api/internal/ai-qa/results`) match by exact path through `RouteMatcher.Match` (same segment count,
  ordinal), never by `EndsWith`. `/api/internal/webhooks/x/api/internal/ai-qa/results` and similar paths
  now answer 404. They also moved to the exact-match (template) table in
  `src_C/Shared/RecallSmith.Lambda.Common/RouteMetrics.cs:203-208`, so the metric label agrees with the
  router (`unmatched` for those paths).
- Partial, owned elsewhere: X08 narrows the gateway route keys from `{proxy+}` to the two exact paths
  (infra). A per-caller secret or a signature over method and path would touch the dispatcher and ai-qa
  signers (`services/`) and the shared secret wiring, which other waves own. With exact routing, a request
  signed with the shared secret can reach only the route its path names.
- Test: `WebhookDeliveryReportTests.InternalRoutes_MatchExactPathsOnly` (6 suffix and extension paths → 404
  with the `unmatched` label, and no row changed; the exact path still routes).
