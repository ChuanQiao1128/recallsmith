-- =========================
-- 031_ai_qa.sql
-- Pre-publish AI QA (R18 J13): one ai_qa_runs row per QA pass over a deck, one ai_qa_items row per card
-- reviewed at a content hash, and the findings the ai-qa Lambda reports back. Additive: nothing existing
-- changes, so code running before this migration is unaffected. Deploy order: migrate, then code.
-- Every statement is idempotent; Migrate.ApplyOne wraps this file in one transaction.
-- =========================

create table if not exists ai_qa_runs (
  id uuid primary key,
  deck_id bigint not null references decks(id) on delete restrict,
  scope text not null,
  status text not null default 'queued',
  provider text null,
  model text null,
  prompt_version text null,
  requested_by_sub text not null,
  card_count int not null,
  chunk_count int not null,
  cards_done int not null default 0,
  error_count int not null default 0,
  blocker_count int not null default 0,
  major_count int not null default 0,
  minor_count int not null default 0,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  cache_read_tokens bigint not null default 0,
  estimated_cost_usd numeric(12,6) not null default 0,
  error_code text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz null,
  constraint ck_ai_qa_runs_scope check (scope in ('changed','all','cards')),
  constraint ck_ai_qa_runs_status check (status in ('queued','running','done','failed'))
);
create unique index if not exists uq_ai_qa_runs_active on ai_qa_runs(deck_id) where status in ('queued','running');
create index if not exists idx_ai_qa_runs_deck_created on ai_qa_runs(deck_id, created_at desc);

create table if not exists ai_qa_items (
  run_id uuid not null references ai_qa_runs(id) on delete cascade,
  card_id bigint not null references cards(id) on delete cascade,
  stable_uid text not null,
  content_sha256 text not null,
  status text not null default 'queued',
  error_code text null,
  latency_ms int null,
  input_tokens int null,
  output_tokens int null,
  cache_read_tokens int null,
  estimated_cost_usd numeric(12,6) null,
  request_id text null,
  updated_at timestamptz not null default now(),
  primary key (run_id, card_id),
  constraint ck_ai_qa_items_status check (status in ('queued','done','error','refused','skipped'))
);
create index if not exists idx_ai_qa_items_card_hash on ai_qa_items(card_id, content_sha256, status);

create table if not exists ai_qa_findings (
  id bigserial primary key,
  run_id uuid not null references ai_qa_runs(id) on delete cascade,
  card_id bigint not null references cards(id) on delete cascade,
  content_sha256 text not null,
  severity text not null,
  category text not null,
  message text not null,
  suggested_fix text null,
  resolution text not null default 'open',
  resolved_by_sub text null,
  resolved_at timestamptz null,
  resolution_note text null,
  created_at timestamptz not null default now(),
  constraint ck_ai_qa_findings_severity check (severity in ('blocker','major','minor')),
  constraint ck_ai_qa_findings_category check (category in ('incorrect_answer','multiple_correct','answer_leak',
    'ambiguous_stem','outdated_fact','qualifier_mismatch','source_unsupported','weak_distractor','other')),
  constraint ck_ai_qa_findings_resolution check (resolution in ('open','fixed','dismissed')),
  constraint ck_ai_qa_findings_message check (char_length(message) between 1 and 1000),
  constraint ck_ai_qa_findings_fix check (suggested_fix is null or char_length(suggested_fix) <= 2000)
);
create index if not exists idx_ai_qa_findings_card_hash on ai_qa_findings(card_id, content_sha256);
create index if not exists idx_ai_qa_findings_run on ai_qa_findings(run_id);
