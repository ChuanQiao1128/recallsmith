-- =========================
-- 026_cards_source.sql
-- Optional citation on a card: { "url": string, "quote": string | null }. NULL = no source (every
-- card that exists before this migration stays NULL; no backfill). The shape is validated at the API
-- boundary (Helpers.NormalizeSource), so there is no CHECK here and no index. Additive: code running
-- before this migration is unaffected, and the Worker falls back on 42703. Deploy order: migrate, then code.
-- One idempotent statement; Migrate.ApplyOne wraps this file in one transaction.
-- =========================
alter table cards add column if not exists source jsonb null;
