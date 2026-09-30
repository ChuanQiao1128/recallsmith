-- =========================
-- 039_source_watch_impact.sql
-- R20 V07 (contract R20-00 §6): the change impact of the source watch.
--   * source_watch_feed_items gains possibly_affected_cards jsonb: the top 5 live cards a new release-notes item
--     possibly affects, by built-in PostgreSQL full-text search (no extension), as
--     [{cardId, deckId, deckSlug, stableUid, question, rank}]. null = not analysed (baseline items, items that do not
--     match the target's title pattern, and every row written before this migration).
--   * The affected cards of a changed/gone page live in source_watch_events.details (jsonb already), so no column there.
-- Additive only. Deploy order: code, then migrate; until this file runs the report skips the analysis with a log line,
-- the watch route answers recentFeedItems [] and the digest counts zero.
-- Idempotent; Migrate.ApplyOne wraps this file in one transaction.
-- =========================

alter table source_watch_feed_items add column if not exists possibly_affected_cards jsonb null;
