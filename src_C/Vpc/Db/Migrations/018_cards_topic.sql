-- =========================
-- 018_cards_topic.sql
-- Optional single-valued topic label on cards (Wave C, C05)
-- =========================

-- One statement, runs inside Migrate.ApplyOne's transaction (Migrate.cs:73-94).
-- No index and no CHECK: topic is a grouping label for the console and the
-- mobile Library; the 80-character bound is enforced by the API
-- (Helpers.NormalizeTopic), and legacy cards stay NULL ("untagged").
alter table cards add column if not exists topic text null;
