-- =========================
-- 043_anon_funnel_events.sql
-- R24 A01 (contract R24-00 §3.1-§3.2): the anonymous install funnel that POST /api/v1/public/events writes and
-- GET /api/v1/admin/analytics/funnel reads. No identifiers at all: no user, device or install id, no IP, no free text.
-- A row is one funnel step of one install, kept as cohort counts (cohort_day = the install's local first-open date).
--   * event: one of the nine steps of §3.1 (check constraint).
--   * cohort_day / event_day: local dates the app sent; deck_slug only for goal/starter/first-pack steps (else null).
--   * platform / app_version: batch fields; received_at: server time, the clock of the 400-day retention delete the
--     anon_funnel_retention automation step runs (R24X F05) and of the ingest's 24-hour row cap.
-- Additive only, no extension needed. Deploy order: code, then migrate; until this file runs the ingest answers
-- 503 NOT_READY for every well-formed batch (an empty or all-invalid one included), the admin read 503 NOT_READY and
-- the retention delete skips.
-- Idempotent; Migrate.ApplyOne wraps this file in one transaction.
-- =========================

create table if not exists anon_funnel_events (
  id bigserial primary key,
  event text not null check (event in (
    'first_open', 'goal_chosen', 'starter_started', 'starter_completed', 'first_pack_opened',
    'returned_day_1', 'returned_day_7', 'signup_started', 'signup_completed')),
  cohort_day date not null,
  event_day date not null,
  deck_slug text null,
  platform text not null,
  app_version text not null,
  received_at timestamptz not null default now()
);

create index if not exists idx_anon_funnel_events_cohort_event on anon_funnel_events (cohort_day, event);
create index if not exists idx_anon_funnel_events_received_at on anon_funnel_events (received_at);
