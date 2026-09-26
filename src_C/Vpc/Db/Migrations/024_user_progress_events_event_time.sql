-- =========================
-- 024_user_progress_events_event_time.sql
-- All-deck Content Intelligence windows filter user_progress_events on event_time alone
-- (ContentIntelligence.BuildLiveSql); every existing index leads with user_sub or deck_slug (CBE-25).
-- Additive; plain CREATE INDEX because Migrate.ApplyOne runs each file in a transaction (see 012).
-- Deploy order: migrate, then code (the code does not depend on this index).
-- =========================
create index if not exists idx_events_event_time on user_progress_events(event_time desc);
