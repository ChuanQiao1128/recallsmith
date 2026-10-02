-- =========================
-- 045_retire_content_intelligence.sql
-- R26 S01 (contract R26-00 §1): Snowflake was retired on 2026-10-02, so the warehouse path goes with it.
--   * analytics_event_outbox (009): filled by the sync ingest for the S3 -> Snowflake export. The ingest stopped
--     writing it in the same release; it carried an unsalted user hash and a device id with no consumer left.
--   * content_intelligence_card_snapshot, content_intelligence_import_runs (010): the Snowflake snapshot imported back
--     for the console's Content Intelligence page, which is removed. Usage and per-card numbers stay in the Postgres
--     rollups (analytics_daily, 040).
-- No foreign key points at any of these tables (009 and 010 declare none, and no later migration adds one), so the
-- drops cascade nothing. Not additive by design: this permanently deletes the rows. The owner runs it after the code
-- that stops using these tables is deployed; that code tolerates the tables being absent (42P01) and present.
-- Owner only (R26X F01): Migrate stops before this file unless the call carries confirmDestructive=45, so a later
-- additive migration never applies it along the way. The owner runs it only after the supervisor has smoke-tested the
-- deployed R26 core-vpc build in prod (one signed-in sync push and one account deletion of a test account):
--   POST /api/v1/admin/db/migrate?confirmDestructive=45 through scripts/invoke-as-admin.sh.
-- Roll forward only: once this has run, no core-vpc version older than R26 may become the prod alias target. Those
-- builds still insert into analytics_event_outbox on every sync push and delete from it on account deletion, so both
-- would fail with 42P01 (500).
-- Idempotent (drop ... if exists); Migrate.ApplyOne wraps this file in one transaction.
-- destructive: true
-- =========================

-- DROP TABLE takes an exclusive lock: fail fast instead of queueing behind an open transaction (safe to retry;
-- SET LOCAL is scoped to the migration's transaction).
set local lock_timeout = '5s';

drop table if exists analytics_event_outbox;
drop table if exists content_intelligence_card_snapshot;
drop table if exists content_intelligence_import_runs;
