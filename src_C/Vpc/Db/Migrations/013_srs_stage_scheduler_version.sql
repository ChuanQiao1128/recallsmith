-- =========================
-- 013_srs_stage_scheduler_version.sql
-- Persist the scheduler's stage (interval bucket) instead of re-deriving it.
-- =========================

-- WHY this exists: the client has always sent the whole CardProgress inside
-- progressAfter, stage included, and the ingest simply never read that field.
-- A device that only received due_at had to guess the stage back out of the
-- interval, and that decode is many-to-one (hard/again both land on buckets
-- they did not come from), so a second device could silently reschedule a card
-- onto a different ladder rung than the one the user earned.

-- NAMING: the column is srs_stage, NOT review_stage. user_progress_events
-- already has a text review_stage from 009 ('first_review' / 'repeat_review',
-- an analytics label the client fills in), and reusing that name here would
-- give one word two types and two meanings, with the numeric ladder position
-- quietly written into the analytics label on the next careless join.

-- All columns are nullable, so this migration needs no backfill: null means
-- "written before the server stored stage", and the client keeps its
-- interval-based inference for exactly those rows.
alter table user_progress add column if not exists srs_stage smallint null;

-- The scheduler that produced srs_stage/due_at. Stored, never interpreted:
-- the server does not schedule, so this is a provenance breadcrumb for the day
-- the ladder changes shape and old rows need to be told apart from new ones.
alter table user_progress add column if not exists last_scheduler_version text null;

alter table user_progress_events add column if not exists scheduler_version text null;
