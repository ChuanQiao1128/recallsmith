-- =========================
-- 044_revenuecat_deletions.sql
-- R25X F04 (contract R25-00 §4, revised): the queue of RevenueCat customer records still to delete after an account
-- deletion. core-vpc has no egress, so it never calls RevenueCat: DELETE /api/v1/user/me inserts the caller's sub here
-- in the same transaction as the deletion, and the notifier (outside the VPC) reads the pending rows through
-- GET /api/v1/internal/revenuecat-deletions, calls RevenueCat and reports each status back.
--   * sub: the Cognito sub (= RevenueCat app_user_id); the row is removed once RevenueCat answers 2xx or 404.
--   * attempts / last_status / last_attempt_at: failed calls; a row is pending while attempts < 10.
--   * requested_at: the deletion time; the tick's revenuecat_deletions_retention step deletes rows older than 30 days,
--     so a sub never outlives the account by more than that.
-- Additive only, no extension needed. Deploy order: code, then migrate; until this file runs the account deletion
-- skips the insert and the internal routes answer 503.
-- Idempotent; Migrate.ApplyOne wraps this file in one transaction.
-- =========================

create table if not exists revenuecat_deletions (
  sub text primary key,
  requested_at timestamptz not null default now(),
  attempts int not null default 0,
  last_status int null,
  last_attempt_at timestamptz null
);

create index if not exists idx_revenuecat_deletions_requested_at on revenuecat_deletions (requested_at);
