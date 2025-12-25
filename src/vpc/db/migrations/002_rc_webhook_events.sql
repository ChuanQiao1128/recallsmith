create table if not exists rc_webhook_events (
  event_id text primary key,                  -- RevenueCat event.id（幂等键）
  received_at timestamptz not null default now(),

  mode text not null,                         -- development / production
  environment text null,                      -- SANDBOX / PRODUCTION
  event_type text null,                       -- TEST / INITIAL_PURCHASE / RENEWAL / etc

  app_user_id text null,
  product_id text null,

  event_timestamp_ms bigint null,
  expiration_at_ms bigint null,

  raw jsonb not null
);

create index if not exists idx_rc_events_user on rc_webhook_events(app_user_id);
create index if not exists idx_rc_events_type on rc_webhook_events(event_type);