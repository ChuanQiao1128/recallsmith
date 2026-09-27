-- =========================
-- 027_webhooks.sql
-- Outbound webhooks (R18 J03): webhook_subscriptions (soft-deleted, never hard-deleted) and
-- webhook_deliveries (one row per event x subscription; body is the exact ASCII JSON that is POSTed).
-- Additive: nothing existing changes, so code running before this migration is unaffected (the
-- enqueue helper logs and skips on 42P01). Deploy order: migrate, then code.
-- Every statement is idempotent; Migrate.ApplyOne wraps this file in one transaction.
-- =========================

create table if not exists webhook_subscriptions (
  id bigserial primary key,
  name text not null,
  url text not null,
  events text[] not null,
  is_active boolean not null default true,
  created_by_sub text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null,
  constraint ck_webhook_subscriptions_name check (char_length(name) between 1 and 80),
  constraint ck_webhook_subscriptions_url check (url like 'https://%' and char_length(url) <= 2048),
  constraint ck_webhook_subscriptions_events check (
    cardinality(events) between 1 and 4
    and events <@ array['deck.published','import.failed','card.flagged','review.queued']::text[])
);
create index if not exists idx_webhook_subscriptions_live on webhook_subscriptions(id) where deleted_at is null and is_active;

create table if not exists webhook_deliveries (
  delivery_id uuid primary key,
  event_id uuid not null,
  event text not null,
  subscription_id bigint not null references webhook_subscriptions(id) on delete restrict,
  status text not null default 'queued',
  attempts int not null default 0,
  last_status_code int null,
  last_error text null,
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  delivered_at timestamptz null,
  constraint ck_webhook_deliveries_status check (status in ('queued','delivered','retrying','failed','dead','enqueue_failed')),
  constraint ck_webhook_deliveries_attempts check (attempts >= 0),
  constraint ck_webhook_deliveries_error check (last_error is null or char_length(last_error) <= 500)
);
create index if not exists idx_webhook_deliveries_sub_created on webhook_deliveries(subscription_id, created_at desc);
create index if not exists idx_webhook_deliveries_status_created on webhook_deliveries(status, created_at desc);
create index if not exists idx_webhook_deliveries_event on webhook_deliveries(event_id);
