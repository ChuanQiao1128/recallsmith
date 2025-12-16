-- =========================
-- 003_progress_phase3.sql
-- - store next review time (from mobile progressAfter.nextReviewAt)
-- - store lastSeenRevision / deckVersion for future "card updated" UX
-- =========================

-- 1) events: add next_review_at + last_seen_revision + deck_version
alter table user_progress_events
  add column if not exists next_review_at timestamptz;

alter table user_progress_events
  add column if not exists last_seen_revision int;

alter table user_progress_events
  add column if not exists deck_version text;

-- 2) aggregate: add last_seen_revision (due_at already exists and can be used as nextReviewAt)
alter table user_progress
  add column if not exists last_seen_revision int;

-- 3) Optional: backfill due_at for old rows (safe)
--    If due_at is null but last_reviewed_at exists, set due_at = last_reviewed_at.
--    This matches your mobile fallback behavior (nextReviewAt = lastReviewedAt).
update user_progress
set due_at = last_reviewed_at
where due_at is null and last_reviewed_at is not null;