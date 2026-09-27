-- =========================
-- 030_ai_review_queue.sql
-- AI draft review queue (R18 J11): drafts posted by the local authoring agent wait here for an editor to
-- accept or reject them; ai_review_events is the append-only decision log. Additive: nothing existing
-- changes, so code running before this migration is unaffected. Deploy order: migrate, then code.
-- Every statement is idempotent; Migrate.ApplyOne wraps this file in one transaction.
-- Deviation from contract §3.5: "similar" is a reserved word in PostgreSQL, so the column is quoted.
-- =========================

create table if not exists ai_drafts (
  id bigserial primary key,
  deck_id bigint not null references decks(id) on delete restrict,
  batch_id uuid not null,
  client_draft_key text not null,
  stable_uid text not null,
  status text not null default 'pending',
  card jsonb not null,
  "similar" jsonb not null default '[]'::jsonb,
  agent jsonb null,
  submitted_by_sub text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  decided_at timestamptz null,
  decided_by_sub text null,
  accepted_card_id bigint null references cards(id) on delete set null,
  constraint uq_ai_drafts_client_key unique (deck_id, client_draft_key),
  constraint ck_ai_drafts_status check (status in ('pending','accepted','rejected')),
  constraint ck_ai_drafts_key check (char_length(client_draft_key) between 1 and 128)
);
create index if not exists idx_ai_drafts_deck_status on ai_drafts(deck_id, status, id desc);
create index if not exists idx_ai_drafts_batch on ai_drafts(batch_id);

create table if not exists ai_review_events (
  id bigserial primary key,
  draft_id bigint not null references ai_drafts(id) on delete restrict,
  action text not null,
  actor_sub text null,
  reason text null,
  note text null,
  before_card jsonb null,
  after_card jsonb null,
  review_ms int null,
  created_at timestamptz not null default now(),
  constraint ck_ai_review_events_action check (action in ('submitted','accepted','edited_accepted','rejected')),
  constraint ck_ai_review_events_reason check (reason is null or reason in
    ('incorrect','ambiguous','duplicate','unsupported_source','off_topic','low_value','other')),
  constraint ck_ai_review_events_note check (note is null or char_length(note) <= 500),
  constraint ck_ai_review_events_ms check (review_ms is null or review_ms >= 0)
);
create index if not exists idx_ai_review_events_draft on ai_review_events(draft_id, id);

create or replace function ai_review_events_append_only() returns trigger
language plpgsql as $$
begin
  raise exception 'ai_review_events is append-only';
end
$$;
drop trigger if exists trg_ai_review_events_no_update on ai_review_events;
create trigger trg_ai_review_events_no_update before update or delete on ai_review_events
  for each row execute function ai_review_events_append_only();
drop trigger if exists trg_ai_review_events_no_truncate on ai_review_events;
create trigger trg_ai_review_events_no_truncate before truncate on ai_review_events
  for each statement execute function ai_review_events_append_only();
