-- =========================
-- 012_sync_keyset_index.sql
-- Keyset-pagination supporting indexes for sync pull and the console deck list
-- =========================

-- NOTE on CONCURRENTLY: the migration runner (Migrate.ApplyOne) executes each
-- file inside a transaction, and CREATE INDEX CONCURRENTLY cannot run inside a
-- transaction block, so plain CREATE INDEX is used here. Plain CREATE INDEX
-- takes a lock that blocks writes to the table for the duration of the build;
-- at production scale, build the index out-of-band with
-- CREATE INDEX CONCURRENTLY first and let the IF NOT EXISTS below be a no-op.

-- 1. Sync pull keyset (GET /api/v1/sync/progress with ?cursor=):
--    serves  WHERE user_sub = $1
--              AND (updated_at, deck_slug, stable_uid) > (to_timestamp(...), $2, $3)
--            ORDER BY updated_at ASC, deck_slug ASC, stable_uid ASC
--    The existing idx_progress_user_updated(user_sub, updated_at DESC) covers
--    neither tie-breaker column of the sort tuple.
CREATE INDEX IF NOT EXISTS idx_progress_user_keyset
ON user_progress(user_sub, updated_at, deck_slug, stable_uid);

-- 2. Console deck list keyset (GET /api/v1/admin/decks):
--    serves  WHERE ... (updated_at, slug) < (to_timestamp(...), $n)
--            ORDER BY updated_at DESC, slug DESC
--    Both columns are DESC so the row-comparison bound matches the index order
--    (a uniform-direction index also serves its exact reverse via a backward
--    scan, but mixed directions like (updated_at DESC, slug ASC) would not).
CREATE INDEX IF NOT EXISTS idx_decks_updated_at_slug
ON decks(updated_at DESC, slug DESC);
