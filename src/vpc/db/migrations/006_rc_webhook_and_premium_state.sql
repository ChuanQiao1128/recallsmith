-- 005_rc_webhook_and_premium_state.sql
-- Purpose:
-- 1) Ensure rc_webhook_events exists (idempotent)
-- 2) Ensure user_premium_state exists + columns for out-of-order guard (last_event_ts_ms)
-- 3) Normalize premium_env and add constraints + indexes

-- =========================
-- 0) rc_webhook_events
-- =========================
create table if not exists rc_webhook_events (
  event_id           text primary key,
  mode               text not null,
  environment        text,
  event_type         text,
  app_user_id        text,
  product_id         text,
  event_timestamp_ms bigint,
  expiration_at_ms   bigint,
  raw                jsonb not null,
  received_at        timestamptz not null default now()
);

-- In case table existed with missing cols
alter table rc_webhook_events add column if not exists mode               text;
alter table rc_webhook_events add column if not exists environment        text;
alter table rc_webhook_events add column if not exists event_type         text;
alter table rc_webhook_events add column if not exists app_user_id        text;
alter table rc_webhook_events add column if not exists product_id         text;
alter table rc_webhook_events add column if not exists event_timestamp_ms bigint;
alter table rc_webhook_events add column if not exists expiration_at_ms   bigint;
alter table rc_webhook_events add column if not exists received_at        timestamptz;

-- Make sure received_at has default + not null
update rc_webhook_events set received_at = now() where received_at is null;
alter table rc_webhook_events alter column received_at set default now();
alter table rc_webhook_events alter column received_at set not null;

-- If raw exists but is not jsonb, try to convert
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name   = 'rc_webhook_events'
      and column_name  = 'raw'
      and data_type   <> 'jsonb'
  ) then
    alter table rc_webhook_events
      alter column raw type jsonb
      using raw::jsonb;
  end if;
end $$;

-- Ensure raw is not null (defensive)
update rc_webhook_events set raw = '{}'::jsonb where raw is null;
alter table rc_webhook_events alter column raw set not null;

-- Indexes for debugging / lookup
create index if not exists idx_rc_webhook_events_received_at
  on rc_webhook_events(received_at desc);

create index if not exists idx_rc_webhook_events_app_user_id
  on rc_webhook_events(app_user_id);

create index if not exists idx_rc_webhook_events_event_timestamp_ms
  on rc_webhook_events(event_timestamp_ms desc);

create index if not exists idx_rc_webhook_events_product_id
  on rc_webhook_events(product_id);

create index if not exists idx_rc_webhook_events_event_type
  on rc_webhook_events(event_type);


-- =========================
-- 1) user_premium_state
-- =========================
create table if not exists user_premium_state (
  app_user_id        text primary key,

  premium_active     boolean not null default false,
  premium_env        text    not null default 'none', -- none|sandbox|production

  product_id         text,
  entitlement_id     text,

  expires_at_ms      bigint,

  updated_at         timestamptz not null default now(),

  last_event_id      text,
  last_event_type    text,
  last_event_at      timestamptz,

  -- ✅ out-of-order guard (we will use this in Step 2 webhook code)
  last_event_ts_ms   bigint not null default 0
);

-- Ensure columns exist if table pre-existed
alter table user_premium_state add column if not exists premium_active   boolean;
alter table user_premium_state add column if not exists premium_env      text;
alter table user_premium_state add column if not exists product_id       text;
alter table user_premium_state add column if not exists entitlement_id   text;
alter table user_premium_state add column if not exists expires_at_ms    bigint;
alter table user_premium_state add column if not exists updated_at       timestamptz;
alter table user_premium_state add column if not exists last_event_id    text;
alter table user_premium_state add column if not exists last_event_type  text;
alter table user_premium_state add column if not exists last_event_at    timestamptz;
alter table user_premium_state add column if not exists last_event_ts_ms bigint;

-- Backfill + enforce defaults/not-null safely
update user_premium_state set premium_active = false where premium_active is null;
alter table user_premium_state alter column premium_active set default false;
alter table user_premium_state alter column premium_active set not null;

update user_premium_state set updated_at = now() where updated_at is null;
alter table user_premium_state alter column updated_at set default now();
alter table user_premium_state alter column updated_at set not null;

-- Normalize premium_env
update user_premium_state
set premium_env = lower(trim(premium_env))
where premium_env is not null
  and premium_env <> lower(trim(premium_env));

update user_premium_state
set premium_env = 'none'
where premium_env is null or premium_env = '';

alter table user_premium_state alter column premium_env set default 'none';
alter table user_premium_state alter column premium_env set not null;

-- Backfill last_event_ts_ms:
-- if last_event_ts_ms is missing/0/null, derive from last_event_at or updated_at
update user_premium_state
set last_event_ts_ms =
  coalesce(
    nullif(last_event_ts_ms, 0),
    (extract(epoch from coalesce(last_event_at, updated_at)) * 1000)::bigint,
    0
  )
where last_event_ts_ms is null or last_event_ts_ms = 0;

alter table user_premium_state alter column last_event_ts_ms set default 0;
alter table user_premium_state alter column last_event_ts_ms set not null;

-- Add check constraint for premium_env (Postgres has no "if not exists" here)
do $$
begin
  if not exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where c.conname = 'chk_user_premium_state_premium_env'
      and n.nspname = 'public'
      and t.relname = 'user_premium_state'
  ) then
    alter table user_premium_state
      add constraint chk_user_premium_state_premium_env
      check (premium_env in ('none','sandbox','production'));
  end if;
end $$;

-- Indexes for fast entitlement checks / debugging
create index if not exists idx_user_premium_state_premium_active
  on user_premium_state(premium_active);

create index if not exists idx_user_premium_state_premium_env
  on user_premium_state(premium_env);

create index if not exists idx_user_premium_state_expires_at_ms
  on user_premium_state(expires_at_ms);

create index if not exists idx_user_premium_state_last_event_ts_ms
  on user_premium_state(last_event_ts_ms desc);