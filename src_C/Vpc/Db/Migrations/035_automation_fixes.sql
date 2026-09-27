-- =========================
-- 035_automation_fixes.sql
-- R18C C01 (automation fix round 2), two nullable columns on deck_publishes:
--   * card_ids (backend-design-12): the ids of the deck's live cards when the job row was inserted. Every card a
--     publish job builds was committed before the Worker read the deck, so a card in this set is in the build (or was
--     deleted before it). Auto-publish decides build coverage from this set instead of comparing cards.updated_at
--     (a transaction's start time) with the job's created_at.
--   * deck_updated_at (backend-design-11): the decks.updated_at an automation publish checked (A00 §6.2 check 5).
--     The Worker refuses such a job as AI_QA_STALE when the deck's settings changed since, so a human settings edit
--     is never built and published under the automation actor.
-- Additive: code running before this migration never reads or writes the new columns; a row inserted by such code
-- leaves both null, which every reader treats as "not recorded" (the pre-035 behaviour).
-- Deploy order: migrate, then code.
-- Every statement is idempotent; Migrate.ApplyOne wraps this file in one transaction.
-- =========================

alter table deck_publishes add column if not exists card_ids bigint[] null;
alter table deck_publishes add column if not exists deck_updated_at timestamptz null;
