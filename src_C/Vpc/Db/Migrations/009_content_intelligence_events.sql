-- 009_content_intelligence_events.sql
-- Adds review-event analytics snapshots plus an outbox for downstream Snowflake ingestion.

alter table user_progress_events add column if not exists schema_version int not null default 1;
alter table user_progress_events add column if not exists event_type text not null default 'card_reviewed';
alter table user_progress_events add column if not exists session_id text null;
alter table user_progress_events add column if not exists client_platform text null;
alter table user_progress_events add column if not exists client_event_time timestamptz null;
alter table user_progress_events add column if not exists server_received_at timestamptz not null default now();
alter table user_progress_events add column if not exists offline_queue_delay_ms bigint null;
alter table user_progress_events add column if not exists dwell_time_ms bigint null;
alter table user_progress_events add column if not exists review_stage text null;
alter table user_progress_events add column if not exists review_count_for_card int null;
alter table user_progress_events add column if not exists card_revision int null;
alter table user_progress_events add column if not exists stated_difficulty int null;

update user_progress_events
set client_event_time = event_time
where client_event_time is null;

create index if not exists idx_events_deck_card_time
  on user_progress_events(deck_slug, stable_uid, event_time desc);

create index if not exists idx_events_session
  on user_progress_events(session_id)
  where session_id is not null;

create index if not exists idx_events_card_revision
  on user_progress_events(deck_slug, stable_uid, card_revision)
  where card_revision is not null;

create table if not exists analytics_event_outbox (
  id bigserial primary key,
  event_id uuid not null unique,
  event_type text not null,
  aggregate_type text not null,
  aggregate_id text not null,
  payload jsonb not null,
  status text not null default 'pending',
  attempts int not null default 0,
  available_at timestamptz not null default now(),
  sent_at timestamptz null,
  last_error text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_analytics_outbox_pending
  on analytics_event_outbox(status, available_at, id)
  where status = 'pending';

create index if not exists idx_analytics_outbox_event_type
  on analytics_event_outbox(event_type, created_at desc);
