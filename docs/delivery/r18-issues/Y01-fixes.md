# Y01 — Server round 2: fixes per finding

Issue #369, wave r18y-s. Branch `delivery/r18ys/Y01-369`. Every path is relative to the repo root.
All C# tests are in `src_C/Tests/RecallSmith.Lambda.IntegrationTests/` and run against a real Postgres
(Testcontainers). `dotnet test src_C/RecallSmith.Lambda.sln`: 1627 passed, 0 failed.
`bash src_C/scripts/merge-env.test.sh`: `merge-env tests OK`.

Migrations 026–031 are applied in production and are not edited. The one schema change is the new
additive, idempotent migration `src_C/Vpc/Db/Migrations/032_webhook_deliveries_enqueued_at.sql`.
Deploy order stays: migrate, then code.

Contract changes (they differ from `R18-00-contracts.md` or from the round-1 ledger, and a finding
requires each one):

| Contract item | Was | Now | Finding |
|---|---|---|---|
| §6 delivery status | `delivered`, `failed`, `dead` sticky | `delivered`, `failed` sticky; `dead` sticky except against a `delivered` report (DLQ redrive) | automation-12 |
| §6 webhook_deliveries | — | new nullable `enqueued_at` (032): set when SQS accepts the message | backend-design-13 |
| §6 sweep predicate | `enqueue_failed`, or `queued` with 0 attempts | `enqueue_failed`, or `queued` with 0 attempts **and no `enqueued_at`** | backend-design-13 |
| §6.1 deck.published eventId | random per emission | deterministic per publish job (`DerivedEventId("deck.published:<jobId>")`) | automation-1 |
| §6.3 body | keys data, environment, event, eventId, occurredAt | the same five keys, then `schemaVersion: 1` | automation-7 |
| §9.4 GET /ledger | totals clamp per (automation, source), series per (period, automation, source) | both clamp per (period at the requested granularity, automation, source) | backend-design-17, automation-14 |
| §9.4 agentDrafts | — | additive `reviewNotMeasured`; `avgReviewMinutes` is over values capped at 30 min | automation-13 |
| §9.3 draft ledger rows | `actual_minutes = reviewMs/60000` (unbounded) | `reviewMs` capped at 30 min; `details.reviewTimeMeasured`, `details.rawReviewMs` (when clamped) | automation-13 |

---

### backend-design-13

Status: fixed

- New column `webhook_deliveries.enqueued_at` (`src_C/Vpc/Db/Migrations/032_webhook_deliveries_enqueued_at.sql`).
  Rows the dispatcher already reported on are backfilled with `created_at`. Pre-032 `queued` rows with 0
  attempts keep `null`, because nobody can tell whether they reached SQS, so the sweep keeps its old
  behaviour for them. A partial index `(event_id) where status = 'queued' and enqueued_at is null` serves
  the outbox lookup.
- `TrySendAsync` sets `enqueued_at = now()` once SQS accepts the message
  (`src_C/Shared/RecallSmith.Lambda.Db/WebhookEvents.cs:571`). This is best-effort: if the marker write
  fails it logs `enqueued_marker_failed`, and the send still counts as done.
- `StrandedPredicate` (`WebhookEvents.cs:452-453`) is now
  `(d.status = 'enqueue_failed' or (d.status = 'queued' and d.attempts = 0 and d.enqueued_at is null))`.
  The sweep no longer picks up a delivery that SQS accepted but whose report never arrived, or that is
  still waiting in a backed-up queue.
- Test: `WebhookSweepTests.Sweep_SkipsARowSentButNeverReported` sends a row successfully, never reports
  it and ages it 2 hours. The sweep claims only the never-sent neighbour, and that row gets its marker
  once it is re-sent. The existing `Sweep_ResendsOnlyStrandedDeliveries_WithTheSameIds` still passes: its
  seeded rows have no marker, so they are still "never reached SQS".

### backend-design-14

Status: fixed

- The failed-send writer is guarded with `... where delivery_id = $1 and status = 'queued'`
  (`WebhookEvents.cs:560`). A send that times out after SQS accepted it, or a sweep re-send racing the
  original message, can no longer move a `retrying`/`delivered`/`failed`/`dead` row back to
  `enqueue_failed`. So the sweep no longer re-sends a delivered event.
- Test: `WebhookSweepTests.FailedSend_NeverRegressesAReportedRow`. The send seam first marks the row
  delivered through the signed report route (`WebhookDeliveryReport.HandleReport`) and then throws. The row
  stays `delivered` with `delivered_at` set and no `last_error`.

### backend-design-17

Status: fixed

- `src_C/Vpc/Ledger/LedgerRoutes.cs:98,111,132`: the totals CTE now groups by the requested period too
  (`date_trunc($3, occurred_at)`, positional group `6`). So `greatest(0, Σ…)` is applied per
  (period, automation, source), which is exactly the series grain (`:137`). `totals.minutesSaved`,
  `automations[].minutesSaved`, `totals.bySource.*` and `totals.byBaselineSource.*` are all sums of the same
  clamped groups. So Σ series = totals at every granularity. The trade-off is documented in the code
  comment (`:87-93`): a net-negative period shows 0 in both the bar and the headline, and the headline can
  differ between granularities (month nets more rejects against accepts than week does). The other
  option, unclamped negative bars, would still have left Σ series ≠ totals when the whole range nets
  negative, so it did not meet the acceptance.
- Test: `AutomationLedgerTests.Ledger_SeriesAddsUpToTotals_AcrossPeriods` covers an accept of 1 × baseline
  in week 1 and a reject costing baseline + 8 min in week 2. For day, week and month, Σ series equals
  `totals.minutesSaved`, the automation's `minutesSaved` and `bySource.live.minutesSaved`. Weekly the total
  is one baseline and monthly it is 0. The existing `Ledger_ReviewCostOffsetsSavingsPerAutomation_AndSplitsBySource`
  (both rows in one month) is unchanged and passes.

### automation-14

Status: fixed

- The same change as backend-design-17 (`LedgerRoutes.cs:87-132`). The headline is the sum of the
  clamped series points at the chosen granularity, and this is documented in the code comment and in the
  contract table above.
- Test: `AutomationLedgerTests.Ledger_SeriesAddsUpToTotals_AcrossPeriods`, the finding's own example
  (accept 1 × 12 min in week 1, a 20-minute reject in week 2).

### automation-12

Status: fixed

- `src_C/Vpc/Internal/WebhookDeliveryReport.cs`: the sticky condition is one SQL fragment, `Keep`
  (`:167-171`), used for status, last_status_code, last_error and delivered_at (`:112-123`):
  `d.status in ('delivered','failed') or (d.status = 'dead' and $3 <> 'delivered') or ($2 < d.attempts and not (d.status = 'dead' and $3 = 'delivered'))`.
  A `delivered` report for a `dead` row wins at any attempt number. A message redriven from the DLQ
  restarts its receive count, and the receiver really did get it. That report sets `delivered_at` and the
  200 code, clears the error, and writes the `webhook_notification` ledger unit (deduped on
  `webhook:<eventId>:<subscriptionId>`). `dead` still holds against retry, failed and dead reports, and
  `failed` keeps its documented stickiness. `attempts` still never decreases.
- Test: `WebhookDeliveryReportTests.Report_DeadThenDelivered_AfterRedrive_IsDelivered_AndCountsOnce`
  covers dead at attempt 5, then delivered at attempt 1: the row is delivered with `delivered_at`, and
  attempts stay 5. A second delivered report at attempt 6 keeps the first `delivered_at`. There is exactly
  one ledger row. A retry or failed report at attempt 1 on another dead row keeps it dead.
  `Report_TerminalStates_AreSticky_AndStaleAttemptsIgnored` is unchanged and passes: it never sends
  `delivered` to a dead row.

### automation-1

Status: partially fixed

Server side, fixed (the crash window and the sweep ambiguity):
- Outbox. `JobRepository.CompleteJobAsync` (`src_C/Worker/Repositories/JobRepository.cs:70-139`) now
  runs in one transaction: the PROCESSING → SUCCESS update (and the live pointer), then
  `WebhookEvents.StageAsync` (`WebhookEvents.cs:278`), which inserts the `deck.published` rows as
  `queued`, one per live subscription, under a savepoint. So they commit or roll back with the SUCCESS
  transition, and a schema or DB error in staging never fails the completion. Staging is idempotent per
  (event, subscription), and it stages nothing when the job was not PROCESSING or when no queue URL is set.
- Deterministic eventId. `JobRepository.PublishedEventId(jobId)` (`:142`) =
  `WebhookEvents.DerivedEventId("deck.published:<jobId>")` (`WebhookEvents.cs:260`, a name-based RFC 9562
  version-8 UUID over SHA-256), so every emitter of one publish finds the same rows.
- Send after commit. `PublishJobProcessor.AfterPublishSucceededAsync` calls
  `WebhookEvents.SendStagedAsync` (`src_C/Worker/Services/PublishJobProcessor.cs:109`,
  `WebhookEvents.cs:338`). It sends only rows of that event that are still `queued`, have 0 attempts and
  have no `enqueued_at`, so it is safe to repeat.
- Replay. The `Job already finished` branch now re-runs `AfterPublishSucceededAsync` for a SUCCESS row
  (`PublishJobProcessor.cs:47`). A crash between completion and the side effects leaves the SQS message
  unacked, and its redelivery sends the staged rows and writes the `publish:<jobId>` ledger row, which is
  already deduped. If no redelivery comes, the staged rows are `queued` with no `enqueued_at`, and the
  sweep re-sends them after 10 minutes.
- Tests: `WebhookEventsTests.Publish_CrashAfterCompletion_ReplaySendsTheStagedEventOnce` covers
  completion without the side effects: one staged row, nothing sent, no ledger row. The replay then sends
  it once with the staged delivery id and a full `data` object, and writes the ledger row. A second replay
  sends nothing. Also `WebhookEventsTests.Publish_CompletionOfAFinishedJob_StagesNothing`,
  `WebhookEventsTests.DerivedEventId_IsStableAndVersion8`, and the existing
  `WebhookEventsTests.Publish_Success_EmitsDeckPublished`, which is unchanged and passes.

Not done here (out of this issue's allowed paths `src_C/.*` and `docs/delivery/r18-issues/.*`; the brief
forbids touching `frontend`): the WebhooksPage "Re-send stranded deliveries" button and
`isRedeliverable` for old `queued` rows (`frontend/src/lib/webhookRules.ts`). The sweep route
`POST /api/v1/admin/webhooks/deliveries/sweep` is unchanged and ready for that button. Follow-up for the
frontend wave: when calling it, treat a `queued` row as redeliverable only when it is older than 10
minutes and has no `enqueuedAt`. The admin list does not expose that field yet, so that change also needs
a list-shape addition. No stranded-queued metric was added: the sweep's response and `WebhookEnqueueFailures`
remain the signal.

Runbook update: `docs/delivery/r18-issues/X01-ledger-runbook.md` ("Re-send stranded webhook deliveries")
now says the sweep re-sends only rows that never reached SQS (no `enqueued_at`), and it replaces the
"Known limit" crash-window bullet with the outbox behaviour.

### automation-7

Status: fixed

- `WebhookEvents.BodySchemaVersion = 1` (`src_C/Shared/RecallSmith.Lambda.Db/WebhookEvents.cs:89`), and
  `RenderBody` appends `schemaVersion` as the last key (`:104`). Receivers that read the first five keys are
  unaffected. The value is inside the signed body, so the signature scheme (`v1=` HMAC over
  `<timestamp>.<body>`) does not change. The rule for receivers, documented on the constant: new keys are
  added without a bump, and a breaking change to the envelope or to the shape of `data` increments
  `schemaVersion`.
- Test: `WebhookEventsTests.RenderBody_IsAsciiWithContractKeyOrder`. Its expected key list gains
  `schemaVersion` because the finding makes the old five-key body wrong, and it asserts the value 1.
- Follow-up outside this issue's paths: the dispatcher README (`services/webhook-dispatcher/README.md`)
  and the n8n fixtures (`integrations/n8n/fixtures/*.json`) should mention and carry `"schemaVersion": 1`.
  The n8n recipe reads only named keys, so it needs no change to keep working.

### automation-13

Status: fixed

- `Drafts.ReviewMsCap = 30 * 60_000` (`src_C/Vpc/Review/Drafts.cs:667`). `ParseReviewMs` (`:674-678`)
  still accepts 0..2147483647, so no client breaks, but returns `Math.Min(ms, ReviewMsCap)`. Only the
  clamped value is stored in `ai_review_events.review_ms` and charged as the ledger's `actual_minutes`
  for both accept and reject. The raw value is kept in the ledger row's `details.rawReviewMs` when it
  was clamped. Each ledger row records `details.reviewTimeMeasured` (`:557`, `:640`, `:682-683`).
- `GET /ledger` `agentDrafts` (`src_C/Vpc/Ledger/LedgerRoutes.cs:278-307`): `avgReviewMinutes` is now
  over `least(review_ms, cap)`, which also bounds rows written before this fix, and it still skips nulls.
  The new additive `reviewNotMeasured` counts decisions sent without `reviewMs`. Those decisions are not
  measured and are charged no human cost, and the reader can now see how many there are.
- Tests: `DraftsTests.Decision_ReviewMsAboveCap_IsClampedTo30Minutes` covers an accept with 10 h, which
  records 30 min with `rawReviewMs` = 36000000, a reject with `int.MaxValue`, which records 30 min, and an
  accept without reviewMs (`reviewTimeMeasured = false`, no minutes). `AutomationLedgerTests.Ledger_ReportsAgentDraftQuality`'s
  expected key list gains `reviewNotMeasured` (additive, required by this finding), and the test asserts
  that it is 1.

### cloud-security-resilience-10

Status: fixed

- `src_C/scripts/merge-env.sh:13`:
  `SSM_NOT_ENV='["webhook-signing-secret","webhook-signing-secret-previous","anthropic-api-key"]'`. These
  are the three leaves that Python Lambdas read and that live under the path `deploy.sh` lists. A search of
  `services/` and `infra/` finds no other rotation leaf. An unknown leaf is still a hard error. So during
  a signing-secret rotation, a core-vpc or worker deploy with env injection works while
  `/developercards/prod/webhook-signing-secret-previous` exists.
- Test: `src_C/scripts/merge-env.test.sh` case (j) `test_ssm_to_env_rotation_leaf` feeds
  internal-shared-secret plus the three Python-only leaves. The only output is `INTERNAL_SHARED_SECRET`,
  with no error. Before the fix it failed with `unmapped SSM parameter: webhook-signing-secret-previous`
  (verified). Case (h) (an unmapped leaf is still an error) is unchanged.
- Runbook line (the rotation runbook lives in `services/webhook-dispatcher/README.md`, outside this
  issue's paths, so it is recorded here for that owner): "core-vpc and worker deploys are safe during a
  signing-secret rotation; `webhook-signing-secret-previous` is skipped by `ssm_to_env`."
