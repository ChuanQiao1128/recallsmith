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
-- Idempotent (drop ... if exists); Migrate.ApplyOne wraps this file in one transaction.
-- =========================

-- DROP TABLE takes an exclusive lock: fail fast instead of queueing behind an open transaction (safe to retry;
-- SET LOCAL is scoped to the migration's transaction).
set local lock_timeout = '5s';

drop table if exists analytics_event_outbox;
drop table if exists content_intelligence_card_snapshot;
drop table if exists content_intelligence_import_runs;
