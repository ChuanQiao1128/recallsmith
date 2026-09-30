-- =========================
-- 040_usage_analytics.sql
-- R20 V08 (contract R20-00 §7): the daily usage rollups the automation tick step analytics_daily writes.
--   * analytics_daily gains wau, new_users, cards_learned, d1_retention, d7_retention (a share 0..1, null until the
--     cohort matured or when the day has no new users) and computed_at (when the step last recomputed the row).
--   * analytics_deck_daily gains new_learners (learners whose first ever review in the deck fell on that day).
-- Every day is a UTC date. The definitions live in docs/delivery/r20-issues/V08-notes.md.
-- Additive only, no extension needed. Deploy order: code, then migrate; until this file runs the tick step skips with a
-- log line and GET /api/v1/admin/analytics/usage answers 503 NOT_READY.
-- Idempotent; Migrate.ApplyOne wraps this file in one transaction.
-- =========================

alter table analytics_daily add column if not exists wau int null;
alter table analytics_daily add column if not exists new_users int null;
alter table analytics_daily add column if not exists cards_learned int null;
alter table analytics_daily add column if not exists d1_retention numeric(5,4) null;
alter table analytics_daily add column if not exists d7_retention numeric(5,4) null;
alter table analytics_daily add column if not exists computed_at timestamptz null;

alter table analytics_deck_daily add column if not exists new_learners int null;
