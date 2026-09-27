-- =========================
-- 032_webhook_deliveries_enqueued_at.sql
-- Webhook hand-off marker (R18 Y01, backend-design-13 / automation-1): webhook_deliveries.enqueued_at is
-- set when SQS accepts the delivery's message. The stranded-delivery sweep re-sends only 'queued' rows
-- without it, so a delivery the dispatcher POSTed but could not report (or that still waits in a
-- backed-up queue) is never sent twice. The publish outbox stages 'queued' rows in the job-completion
-- transaction and sends them after commit; the partial index serves both lookups.
-- Additive: code running before this migration never reads the column. Deploy order: migrate, then code.
-- Every statement is idempotent; Migrate.ApplyOne wraps this file in one transaction.
-- =========================

alter table webhook_deliveries add column if not exists enqueued_at timestamptz null;

-- Rows the dispatcher has already reported on were handed off; record that (their created_at is the
-- closest known time). 'queued' rows with no attempt keep null: whether they reached SQS is unknown, and
-- the sweep keeps its pre-032 behaviour for them.
update webhook_deliveries
set enqueued_at = created_at
where enqueued_at is null
  and (status in ('delivered','retrying','failed','dead') or attempts > 0);

create index if not exists idx_webhook_deliveries_not_enqueued
  on webhook_deliveries(event_id)
  where status = 'queued' and enqueued_at is null;
