-- migrations/20251224_01_revenuecat.sql

create table if not exists rc_webhook_events (
  event_id text primary key,                 -- ✅ idempotency key (RevenueCat event.id)
  received_at timestamptz not null default now(),

  event_type text not null,
  environment text null,                     -- SANDBOX / PRODUCTION
  app_id text null,

  app_user_id text null,
  original_app_user_id text null,
  aliases jsonb null,

  product_id text null,
  entitlement_ids jsonb null,

  purchase_date_ms bigint null,
  expiration_at_ms bigint null,
  event_timestamp_ms bigint null,

  raw jsonb not null
);

create index if not exists idx_rc_events_app_user_id on rc_webhook_events(app_user_id);
create index if not exists idx_rc_events_env on rc_webhook_events(environment);

create table if not exists user_premium_state (
  user_sub text primary key,                 -- Cognito sub == RC app_user_id (recommended)
  rc_app_user_id text not null,
  entitlement_id text not null,

  premium_active boolean not null default false,
  premium_env text not null default 'none',   -- production/sandbox/none

  active_prod boolean not null default false,
  prod_expires_at timestamptz null,

  active_sandbox boolean not null default false,
  sandbox_expires_at timestamptz null,

  product_id text null,
  store text null,
  is_sandbox boolean null,
  management_url text null,

  last_event_id text null,
  last_event_type text null,

  last_rc_request_at timestamptz null,
  last_updated_at timestamptz not null default now(),

  rc_raw jsonb null
);

create index if not exists idx_user_premium_active on user_premium_state(premium_active);