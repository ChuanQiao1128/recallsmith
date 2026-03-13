create table if not exists user_premium_state (
  app_user_id text primary key,               -- RevenueCat app_user_id（你这里通常是 Cognito sub）
  premium_active boolean not null default false,
  premium_env text not null default 'none',    -- production / sandbox / none

  product_id text null,
  entitlement_id text null,

  expires_at_ms bigint null,
  updated_at timestamptz not null default now(),

  -- 便于排错：最近一次事件
  last_event_id text null,
  last_event_type text null,
  last_event_at timestamptz null
);

create index if not exists idx_user_premium_active on user_premium_state(premium_active);

