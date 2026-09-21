-- =========================
-- 019_cards_mcq.sql
-- Optional MCQ overlay on a card. NULL = plain Q/A card (the only kind that
-- exists before this migration). The blob's shape is validated at the API
-- boundary (McqValidation.Canonicalize) and again by the publish gate, so
-- there is no CHECK here and no index. One statement; runs inside
-- Migrate.ApplyOne's transaction like every other migration.
-- =========================
alter table cards add column if not exists mcq jsonb null;
