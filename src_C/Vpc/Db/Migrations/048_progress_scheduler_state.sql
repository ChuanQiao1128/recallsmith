-- Additive: old rows remain NULL because their memory model was never stored.
-- No invented backfill. Old clients still read their original progress fields.
alter table user_progress add column if not exists scheduler_state jsonb;
