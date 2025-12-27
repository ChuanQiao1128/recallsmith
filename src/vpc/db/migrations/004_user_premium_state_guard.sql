-- 004_user_premium_state_guard.sql
-- Purpose:
-- 1) add last_event_ts_ms to protect against out-of-order webhooks
-- 2) normalize premium_env and add constraint
-- 3) add indexes for fast checks

-- 1) column
alter table user_premium_state
  add column if not exists last_event_ts_ms bigint;

-- 2) backfill for existing rows
update user_premium_state
set last_event_ts_ms =
  coalesce(
    last_event_ts_ms,
    (extract(epoch from coalesce(last_event_at, updated_at)) * 1000)::bigint
  )
where last_event_ts_ms is null;

-- 3) enforce default / not null (safe after backfill)
alter table user_premium_state alter column last_event_ts_ms set default 0;
update user_premium_state set last_event_ts_ms = 0 where last_event_ts_ms is null;
alter table user_premium_state alter column last_event_ts_ms set not null;

-- 4) normalize premium_env (defensive)
update user_premium_state
set premium_env = lower(trim(premium_env))
where premium_env is not null and premium_env <> lower(trim(premium_env));

update user_premium_state
set premium_env = 'none'
where premium_env is null or premium_env = '';

-- 5) add check constraint for premium_env (no "if not exists" in postgres)
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'chk_user_premium_state_premium_env'
  ) then
    alter table user_premium_state
      add constraint chk_user_premium_state_premium_env
      check (premium_env in ('none','sandbox','production'));
  end if;
end $$;

-- 6) indexes
create index if not exists idx_user_premium_state_last_event_ts_ms
  on user_premium_state(last_event_ts_ms desc);

create index if not exists idx_user_premium_state_premium_env
  on user_premium_state(premium_env);

create index if not exists idx_user_premium_state_premium_active
  on user_premium_state(premium_active);

create index if not exists idx_user_premium_state_expires_at_ms
  on user_premium_state(expires_at_ms);