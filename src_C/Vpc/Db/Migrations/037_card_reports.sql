-- =========================
-- 037_card_reports.sql
-- R20 V05 (contract R20-00 §4): learners report a problem with a card; console admins triage the reports.
--   * card_reports: one row per report. note and resolution_note are untrusted learner/admin text, capped at 500
--     characters, stored as is and never logged. deck_slug and stable_uid are kept so a report outlives its card.
--   * a partial unique index keeps at most one open report per (user_sub, stable_uid).
--   * ck_webhook_subscriptions_events gains card.reported (the 034 part 10 precedent: a strictly weaker CHECK, every
--     row valid before is valid after; code running before this migration never writes the new event name).
-- Additive except that declared exception. Deploy order: code, then migrate; until this file runs the card report
-- routes answer 503 NOT_READY and the status/digest counts read zero.
-- Every statement is idempotent; Migrate.ApplyOne wraps this file in one transaction.
-- =========================

create table if not exists card_reports (
  id bigserial primary key,
  user_sub text not null,
  deck_id bigint null,
  deck_slug text not null,
  card_id bigint null,
  stable_uid text not null,
  reason text not null,
  note text null,
  status text not null default 'open',
  resolution text null,
  resolution_note text null,
  client_version text null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz null,
  resolved_by_sub text null,
  constraint ck_card_reports_reason check (reason in ('wrong_answer','outdated','unclear','typo','other')),
  constraint ck_card_reports_status check (status in ('open','resolved')),
  constraint ck_card_reports_resolution check (resolution is null or resolution in ('fixed','wont_fix','duplicate','invalid')),
  constraint ck_card_reports_note check (note is null or char_length(note) <= 500),
  constraint ck_card_reports_resolution_note check (resolution_note is null or char_length(resolution_note) <= 500),
  constraint ck_card_reports_deck_slug check (char_length(deck_slug) between 1 and 128),
  constraint ck_card_reports_stable_uid check (char_length(stable_uid) between 1 and 128),
  constraint ck_card_reports_client_version check (client_version is null or char_length(client_version) <= 64),
  constraint ck_card_reports_resolved check ((status = 'open') = (resolution is null))
);

create unique index if not exists uq_card_reports_open on card_reports (user_sub, stable_uid) where status = 'open';
create index if not exists idx_card_reports_status_created on card_reports (status, created_at desc);
create index if not exists idx_card_reports_user_created on card_reports (user_sub, created_at desc);

-- widen the subscribable webhook events (declared exception, see above)
alter table webhook_subscriptions drop constraint if exists ck_webhook_subscriptions_events;
alter table webhook_subscriptions add constraint ck_webhook_subscriptions_events check (
  cardinality(events) between 1 and 9
  and events <@ array['deck.published','import.failed','card.flagged','review.queued',
                      'draft.auto_accepted','automation.batch_completed','automation.exception','source.changed',
                      'card.reported']::text[]);
