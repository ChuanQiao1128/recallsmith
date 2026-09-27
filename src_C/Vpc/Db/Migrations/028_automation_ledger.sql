-- =========================
-- 028_automation_ledger.sql
-- Automation Ledger (R18 J08): automation_baselines (minutes a human would spend per unit; the six
-- seeded rows are 'default' placeholders to be measured and replaced) and automation_events (one row
-- per automation run, idempotent on dedupe_key). Minutes saved are derived at query time from the
-- current baselines and never stored. Additive: nothing existing changes, so code running before this
-- migration is unaffected (the ledger helper logs and skips on 42P01). Deploy order: migrate, then code.
-- Every statement is idempotent; Migrate.ApplyOne wraps this file in one transaction.
-- =========================

create table if not exists automation_baselines (
  automation text primary key,
  unit text not null,
  baseline_minutes_per_unit numeric(8,2) not null,
  baseline_source text not null default 'default',
  note text null,
  updated_by_sub text null,
  updated_at timestamptz not null default now(),
  constraint ck_automation_baselines_minutes check (baseline_minutes_per_unit >= 0),
  constraint ck_automation_baselines_source check (baseline_source in ('default','measured'))
);

insert into automation_baselines(automation, unit, baseline_minutes_per_unit, note) values
  ('publish_pipeline',     'publish',         20.00, 'manual build, upload and manifest edit per publish'),
  ('bulk_import',          'card',             1.50, 'manual console entry per card'),
  ('ai_draft_review',      'accepted card',   12.00, 'hand-authoring one cited card'),
  ('ai_qa_review',         'reviewed card',    3.00, 'manual second-reader QA per card'),
  ('webhook_notification', 'delivered event',  1.00, 'manual status message per event'),
  ('publish_gate',         'blocked publish',  0.00, 'defect-only automation')
on conflict (automation) do nothing;

create table if not exists automation_events (
  id bigserial primary key,
  automation text not null references automation_baselines(automation),
  occurred_at timestamptz not null default now(),
  units int not null default 0,
  outcome text not null,
  actual_minutes numeric(10,2) null,
  defects_caught int not null default 0,
  deck_id bigint null references decks(id) on delete set null,
  ref text null,
  source text not null default 'live',
  dedupe_key text null,
  details jsonb null,
  constraint ck_automation_events_units check (units >= 0),
  constraint ck_automation_events_defects check (defects_caught >= 0),
  constraint ck_automation_events_outcome check (outcome in ('success','partial','failure')),
  constraint ck_automation_events_source check (source in ('live','backfill')),
  constraint uq_automation_events_dedupe unique (dedupe_key)
);
create index if not exists idx_automation_events_auto_time on automation_events(automation, occurred_at desc);
create index if not exists idx_automation_events_time on automation_events(occurred_at desc);
