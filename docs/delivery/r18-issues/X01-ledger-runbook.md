# Automation Ledger and webhook sweep: operator runbook (R18 X01)

All calls go to core-vpc with a super_admin JWT. None of them runs on a schedule.

## Backfill history into the ledger

1. Apply migrations first (`POST /api/v1/admin/db/migrate`). Migration 028 records `live_since`, the moment
   live recording began. The backfill counts only cards created before it.
2. Dry run: `POST /api/v1/admin/automation/backfill` with body `{}` (the default is a dry run). Read
   `inserted`/`skipped` per automation. Nothing is written.
3. Apply: the same call with `{"dryRun": false}`. It writes `source = 'backfill'` rows plus an
   `automation.backfill` audit row. A re-run inserts nothing new (dedupe keys).
4. Check the headline split: `GET /api/v1/admin/automation/ledger` returns `totals.bySource.live` and
   `totals.bySource.backfill`, and `totals.byBaselineSource.measured` and `totals.byBaselineSource.default`.
   Present the backfill figure as inferred history: SUCCESS publishes, and bursts of 5 or more cards in one
   deck-minute, excluding accepted AI drafts.

What the backfill never counts: publishes that already have a live `publish:<jobId>` row; cards created
after `live_since` (the live ledger records those imports itself); cards that are accepted AI drafts
(those are `ai_draft_review` rows).

## Re-send stranded webhook deliveries

`POST /api/v1/admin/webhooks/deliveries/sweep`, optional body `{"limit": 1..100}` (default 100).

- It re-sends deliveries that never reached SQS: `enqueue_failed`, or `queued` with 0 attempts and no
  recorded hand-off (`enqueued_at` is null, migration 032), untouched for 10 minutes, on a live
  subscription. A delivery SQS accepted but whose report never arrived is not re-sent (R18 Y01). Each keeps
  its `delivery_id` and `eventId`, so receivers dedupe as usual.
- The response is `{swept, resent, enqueueFailures, deliveryIds}`. Each call is audited as
  `webhook.deliveries.sweep`.
- It is safe to repeat. A swept row is not picked up again for 10 minutes. If `enqueueFailures > 0`, the
  queue is still unreachable (see the `WebhookEnqueueFailures` metric): fix that, wait 10 minutes and sweep
  again.
- A worker crash between marking a publish SUCCESS and sending `deck.published` no longer loses the
  event (R18 Y01): the delivery rows are written in the SUCCESS transaction (an outbox). The redelivered
  job message sends them, and if it never comes, this sweep re-sends them.

## Alarm metrics (namespace `DeveloperCards`)

`LedgerWriteFailures`, `WebhookEnqueueFailures` and `AiQaEnqueueFailures` should stay at 0.
`QaGateRefusals` is informational.
