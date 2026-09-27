-- =========================
-- 034_automation.sql
-- R18A A01, human-on-exception automation (contract A00 §7). Adds:
--   * automation_runners (local runner heartbeats), source_watch_targets / source_watch_events /
--     source_watch_feed_items (watched pages and feeds), authoring_queue_items (the runner's queue),
--     automation_runs (one per claimed queue item), automation_eval_gates (the reviewer precision gate);
--   * automation_draft_decisions + automation_draft_findings + the append-only automation_decision_events log;
--   * automation_publishes (auto-publish attempts) and automation_notifications (the email log);
--   * the auto_accept, auto_publish and source_watch ledger baselines ('default' placeholders);
--   * the two seeded feed targets (inactive when their deck does not exist).
-- Additive except one declared exception: part 10 replaces ck_webhook_subscriptions_events by a strictly weaker
-- CHECK (every row valid before is valid after; code running before 034 never writes the new event names).
-- Deploy order: migrate, then code.
-- Every statement is idempotent; Migrate.ApplyOne wraps this file in one transaction.
-- =========================

-- 1. runners (one row per local runner; heartbeat state)
create table if not exists automation_runners (
  runner_id text primary key,
  owner_sub text not null,
  host text null,
  runner_version text null,
  claude_version text null,
  state text not null default 'idle',
  login_expires_at timestamptz null,
  last_heartbeat_at timestamptz not null default now(),
  last_run_id uuid null,
  last_run_at timestamptz null,
  last_run_outcome text null,
  last_error text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ck_automation_runners_id check (runner_id ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  constraint ck_automation_runners_state check (state in ('idle','running','error','login_expired')),
  constraint ck_automation_runners_outcome check (last_run_outcome is null or last_run_outcome in ('done','nothing_new','failed')),
  constraint ck_automation_runners_text check (
    (host is null or char_length(host) <= 64) and (runner_version is null or char_length(runner_version) <= 40)
    and (claude_version is null or char_length(claude_version) <= 80) and (last_error is null or char_length(last_error) <= 500))
);

-- 2. watched sources
create table if not exists source_watch_targets (
  id bigserial primary key,
  kind text not null,
  url text not null,
  feed_format text null,
  deck_id bigint null references decks(id) on delete set null,
  item_title_pattern text null,
  active boolean not null default true,
  check_interval_minutes int not null,
  content_sha256 text null,
  normalizer text null,
  etag text null,
  last_modified text null,
  leased_until timestamptz null,
  last_checked_at timestamptz null,
  last_changed_at timestamptz null,
  last_status text null,
  last_http_status int null,
  consecutive_failures int not null default 0,
  created_by text not null default 'system',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_source_watch_targets_url unique (url),
  constraint ck_source_watch_targets_kind check (kind in ('feed','page')),
  constraint ck_source_watch_targets_format check (
    (kind = 'feed') = (feed_format is not null) and (feed_format is null or feed_format in ('rss','atom','html-headings'))),
  constraint ck_source_watch_targets_url check (url like 'https://%' and char_length(url) <= 2048),
  constraint ck_source_watch_targets_interval check (check_interval_minutes between 60 and 43200),
  constraint ck_source_watch_targets_status check (last_status is null or last_status in
    ('baseline','unchanged','changed','not_modified','failed','gone','unsupported','robots_disallowed')),
  constraint ck_source_watch_targets_pattern check (item_title_pattern is null or char_length(item_title_pattern) <= 1000)
);
create index if not exists idx_source_watch_targets_due on source_watch_targets(last_checked_at nulls first, id) where active;

create table if not exists source_watch_events (
  id bigserial primary key,
  target_id bigint not null references source_watch_targets(id) on delete cascade,
  watch_run_id uuid not null,
  kind text not null,
  old_sha256 text null,
  new_sha256 text null,
  details jsonb null,
  recheck_state text not null default 'not_needed',
  recheck_run_ids uuid[] not null default '{}',
  notification_id uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ck_source_watch_events_kind check (kind in ('baseline','changed','gone','failing','recovered','feed_items','unsupported')),
  constraint ck_source_watch_events_recheck check (recheck_state in ('not_needed','waiting','started','done','unavailable'))
);
create index if not exists idx_source_watch_events_target on source_watch_events(target_id, id desc);
create index if not exists idx_source_watch_events_recheck on source_watch_events(recheck_state) where recheck_state in ('waiting','started');

-- 3. authoring queue (the runner pulls it)
create table if not exists authoring_queue_items (
  id bigserial primary key,
  kind text not null,
  url text not null,
  deck_id bigint null references decks(id) on delete set null,
  title text null,
  section_hint text null,
  note text null,
  dedupe_key text not null,
  status text not null default 'queued',
  attempts int not null default 0,
  not_before timestamptz not null default now(),
  claimed_by_runner text null,
  claimed_at timestamptz null,
  lease_expires_at timestamptz null,
  last_run_id uuid null,
  last_error text null,
  source_target_id bigint null references source_watch_targets(id) on delete set null,
  source_event_id bigint null references source_watch_events(id) on delete set null,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz null,
  constraint uq_authoring_queue_items_dedupe unique (dedupe_key),
  constraint ck_authoring_queue_items_kind check (kind in ('feed_item','source_changed','manual')),
  constraint ck_authoring_queue_items_status check (status in ('queued','claimed','done','failed','skipped')),
  constraint ck_authoring_queue_items_url check (url like 'https://%' and char_length(url) <= 2048),
  constraint ck_authoring_queue_items_text check ((title is null or char_length(title) <= 300)
    and (section_hint is null or char_length(section_hint) <= 300) and (note is null or char_length(note) <= 500)
    and (last_error is null or char_length(last_error) <= 500)),
  constraint ck_authoring_queue_items_claim check ((status = 'claimed') = (lease_expires_at is not null))
);
create index if not exists idx_authoring_queue_items_due on authoring_queue_items(not_before, id) where status = 'queued';
create index if not exists idx_authoring_queue_items_status on authoring_queue_items(status, id desc);

create table if not exists source_watch_feed_items (
  target_id bigint not null references source_watch_targets(id) on delete cascade,
  item_key text not null,                 -- lowercase hex SHA-256 of the item url
  url text not null,
  title text null,
  published_at timestamptz null,
  matched boolean not null,
  queue_item_id bigint null references authoring_queue_items(id) on delete set null,
  first_seen_at timestamptz not null default now(),
  primary key (target_id, item_key)
);

-- 4. automation runs (one per claimed queue item)
create table if not exists automation_runs (
  run_id uuid primary key,
  queue_item_id bigint not null references authoring_queue_items(id) on delete restrict,
  runner_id text not null,
  owner_sub text not null,
  deck_id bigint null references decks(id) on delete set null,
  status text not null default 'running',
  outcome text null,
  started_at timestamptz not null default now(),
  completed_at timestamptz null,
  finalized_at timestamptz null,
  summary_notification_id uuid null,
  exit_code int null,
  duration_ms int null,
  num_turns int null,
  error text null,
  summary text null,
  updated_at timestamptz not null default now(),
  constraint ck_automation_runs_status check (status in ('running','completed','failed','abandoned')),
  constraint ck_automation_runs_outcome check (outcome is null or outcome in ('done','nothing_new','failed')),
  constraint ck_automation_runs_text check ((error is null or char_length(error) <= 500) and (summary is null or char_length(summary) <= 2000))
);
create index if not exists idx_automation_runs_started on automation_runs(started_at desc);
create index if not exists idx_automation_runs_open on automation_runs(started_at) where finalized_at is null;

-- 5. eval gates (§15)
create table if not exists automation_eval_gates (
  id bigserial primary key,
  reviewer_provider text not null,
  reviewer_model text not null,
  prompt_version text not null,
  passed boolean not null,
  metrics jsonb not null,
  report_sha256 text not null,
  report jsonb not null,
  created_by_sub text not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz null,
  revoked_by_sub text null,
  constraint ck_automation_eval_gates_sha check (report_sha256 ~ '^[0-9a-f]{64}$')
);

-- 6. per-draft decisions
create table if not exists automation_draft_decisions (
  draft_id bigint primary key references ai_drafts(id) on delete restrict,
  run_id uuid not null references automation_runs(run_id) on delete restrict,
  deck_id bigint not null references decks(id) on delete restrict,
  mode text not null,
  state text not null,
  reason text null,
  reason_detail text null,
  qa_job_id uuid null,
  qa_content_sha256 text null,
  qa_attempts int not null default 0,
  qa_enqueued_at timestamptz null,
  qa_status text null,
  qa_error_code text null,
  qa_provider text null,
  qa_model text null,
  qa_prompt_version text null,
  qa_request_id text null,
  blocker_count int not null default 0,
  major_count int not null default 0,
  minor_count int not null default 0,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  estimated_cost_usd numeric(12,6) not null default 0,
  gate_id bigint null references automation_eval_gates(id) on delete set null,
  accepted_card_id bigint null references cards(id) on delete set null,
  accepted_content_sha256 text null,
  human_action text null,
  human_reason text null,
  human_decided_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  decided_at timestamptz null,
  constraint ck_automation_decisions_mode check (mode in ('dry_run','live')),
  constraint ck_automation_decisions_state check (state in ('qa_pending','qa_queued','would_accept','auto_accepted','human','superseded')),
  constraint ck_automation_decisions_reason check (reason is null or reason in ('RUN_NOT_RUNNING','DECK_MISMATCH','DECK_NOT_ALLOWED',
    'EXISTING_CARD','LIKELY_DUPLICATE','UNGROUNDED','SOURCE_HOST_NOT_ALLOWED','QA_UNAVAILABLE','AI_QA_DAILY_CAP','ENQUEUE_RETRY',
    'ENQUEUE_FAILED','QA_TIMEOUT','QA_ERROR','QA_HASH_MISMATCH','QA_FLAGGED','REVIEWER_NOT_GATED','MODE_OFF','DECK_DELETED','DECIDED_BY_HUMAN')),
  constraint ck_automation_decisions_qa_status check (qa_status is null or qa_status in ('done','error','refused','skipped')),
  constraint ck_automation_decisions_human check (human_action is null or human_action in ('accepted','edited_accepted','rejected')),
  constraint ck_automation_decisions_accepted check ((state = 'auto_accepted') = (accepted_content_sha256 is not null)),
  constraint ck_automation_decisions_detail check (reason_detail is null or char_length(reason_detail) <= 300)
);
create unique index if not exists uq_automation_decisions_qa_job on automation_draft_decisions(qa_job_id) where qa_job_id is not null;
create index if not exists idx_automation_decisions_run on automation_draft_decisions(run_id);
create index if not exists idx_automation_decisions_state on automation_draft_decisions(state, updated_at);
create index if not exists idx_automation_decisions_deck on automation_draft_decisions(deck_id, created_at desc);
create index if not exists idx_automation_decisions_card on automation_draft_decisions(accepted_card_id) where accepted_card_id is not null;
create index if not exists idx_automation_decisions_created on automation_draft_decisions(created_at);

-- Draft-QA spend, one row per QA attempt (job, request id; request_key is '' when the report has none), dated by when
-- the report arrived. The shared daily cap sums spent_at of today, so a report after QA_TIMEOUT or after a released
-- send still counts, on the day it was spent (R18B backend-design-4). The decision's cost columns are the running total.
create table if not exists automation_qa_spend (
  qa_job_id uuid not null,
  request_key text not null,
  draft_id bigint not null references automation_draft_decisions(draft_id) on delete cascade,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  estimated_cost_usd numeric(12,6) not null default 0,
  spent_at timestamptz not null default now(),
  primary key (qa_job_id, request_key),
  constraint ck_automation_qa_spend_request_key check (char_length(request_key) <= 200)
);
create index if not exists idx_automation_qa_spend_spent on automation_qa_spend(spent_at);

create table if not exists automation_draft_findings (
  id bigserial primary key,
  draft_id bigint not null references automation_draft_decisions(draft_id) on delete cascade,
  qa_job_id uuid not null,
  severity text not null,
  category text not null,
  message text not null,
  suggested_fix text null,
  created_at timestamptz not null default now(),
  constraint ck_automation_draft_findings_severity check (severity in ('blocker','major','minor')),
  constraint ck_automation_draft_findings_category check (category in ('incorrect_answer','multiple_correct','answer_leak',
    'ambiguous_stem','outdated_fact','qualifier_mismatch','source_unsupported','weak_distractor','other')),
  constraint ck_automation_draft_findings_message check (char_length(message) between 1 and 1000),
  constraint ck_automation_draft_findings_fix check (suggested_fix is null or char_length(suggested_fix) <= 2000)
);
create index if not exists idx_automation_draft_findings_draft on automation_draft_findings(draft_id, id);

create table if not exists automation_decision_events (
  id bigserial primary key,
  draft_id bigint not null references automation_draft_decisions(draft_id) on delete restrict,
  from_state text null,
  to_state text not null,
  reason text null,
  actor text not null,                    -- 'automation' | 'human:<sub>'
  mode text not null,                     -- effective mode when the event was written: 'off' | 'dry_run' | 'live'
  details jsonb null,
  created_at timestamptz not null default now()
);
create index if not exists idx_automation_decision_events_draft on automation_decision_events(draft_id, id);
create or replace function automation_decision_events_append_only() returns trigger language plpgsql as $$
begin
  raise exception 'automation_decision_events is append-only';
end
$$;
drop trigger if exists trg_automation_decision_events_no_update on automation_decision_events;
create trigger trg_automation_decision_events_no_update before update or delete on automation_decision_events
  for each row execute function automation_decision_events_append_only();
drop trigger if exists trg_automation_decision_events_no_truncate on automation_decision_events;
create trigger trg_automation_decision_events_no_truncate before truncate on automation_decision_events
  for each statement execute function automation_decision_events_append_only();

-- 7. auto-publish attempts. card_ids are the cards the row's build covers: they are appended only while the row is
-- 'waiting'. A run that finalises while the deck's row is already 'publishing' records its cards in deferred_card_ids;
-- the reconcile moves them (and any card the build missed) to a new 'waiting' row once the job ends.
create table if not exists automation_publishes (
  id bigserial primary key,
  deck_id bigint not null references decks(id) on delete restrict,
  run_id uuid null references automation_runs(run_id) on delete set null,
  mode text not null,
  state text not null,
  reason text null,
  reason_detail text null,
  card_ids bigint[] not null default '{}',
  deferred_card_ids bigint[] not null default '{}',
  snapshot_sha256 text null,
  job_id text null,
  build_id text null,
  attempts int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz null,
  constraint ck_automation_publishes_mode check (mode in ('dry_run','live')),
  constraint ck_automation_publishes_state check (state in ('waiting','publishing','published','would_publish','human')),
  constraint ck_automation_publishes_reason check (reason is null or reason in ('DECK_DELETED','AUTO_PUBLISH_DISABLED',
    'DECK_NEVER_PUBLISHED','PUBLISH_IN_PROGRESS','PUBLISH_WAIT_TIMEOUT','DECK_HAS_HUMAN_CHANGES','MCQ_PUBLISH_GATE','AI_QA_REQUIRED',
    'AI_QA_BLOCKED','AI_QA_STALE','CONFIG_ERROR','SERVER_NOT_READY_AI_QA','PUBLISH_FAILED')),
  constraint ck_automation_publishes_detail check (reason_detail is null or char_length(reason_detail) <= 300)
);
create unique index if not exists uq_automation_publishes_open on automation_publishes(deck_id) where state in ('waiting','publishing');
create index if not exists idx_automation_publishes_deck on automation_publishes(deck_id, created_at desc);
create index if not exists idx_automation_publishes_run on automation_publishes(run_id);

-- 8. email log
create table if not exists automation_notifications (
  id bigserial primary key,
  notification_id uuid not null,
  kind text not null,
  subkind text null,
  dedupe_key text null,
  subject text not null,
  body_text text not null,
  mode text not null,
  status text not null default 'queued',
  attempts int not null default 0,
  ses_message_id text null,
  error_code text null,
  error text null,
  run_id uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz null,
  constraint uq_automation_notifications_id unique (notification_id),
  constraint uq_automation_notifications_dedupe unique (dedupe_key),
  constraint ck_automation_notifications_kind check (kind in ('exception','batch_summary','weekly_digest','source_changed','test')),
  constraint ck_automation_notifications_mode check (mode in ('off','dry_run','live')),
  constraint ck_automation_notifications_status check (status in ('queued','sent','failed','enqueue_failed')),
  constraint ck_automation_notifications_text check (char_length(subject) between 1 and 200 and char_length(body_text) <= 100000
    and (error is null or char_length(error) <= 500))
);
create index if not exists idx_automation_notifications_created on automation_notifications(created_at desc);
create index if not exists idx_automation_notifications_retry on automation_notifications(created_at) where status in ('queued','enqueue_failed');

-- 9. ledger baselines (R18-00 §3.3 table; 'default' placeholders to be measured and replaced)
insert into automation_baselines(automation, unit, baseline_minutes_per_unit, note) values
  ('auto_accept',  'auto-accepted card',   3.00, 'human review of one agent draft avoided; replace with the measured median review time'),
  ('auto_publish', 'auto-published build', 5.00, 'human publish check and click per build'),
  ('source_watch', 'page check',           0.50, 'opening one cited page or feed and comparing it by eye')
on conflict (automation) do nothing;

-- 10. widen the subscribable webhook events (declared exception, see above)
alter table webhook_subscriptions drop constraint if exists ck_webhook_subscriptions_events;
alter table webhook_subscriptions add constraint ck_webhook_subscriptions_events check (
  cardinality(events) between 1 and 8
  and events <@ array['deck.published','import.failed','card.flagged','review.queued',
                      'draft.auto_accepted','automation.batch_completed','automation.exception','source.changed']::text[]);

-- 11. seed the two watched feeds (deck resolved by slug; inactive when the deck does not exist)
insert into source_watch_targets (kind, url, feed_format, deck_id, item_title_pattern, active, check_interval_minutes, created_by)
select 'feed', 'https://aws.amazon.com/about-aws/whats-new/recent/feed/', 'rss', d.id,
  '\m(S3|EC2|EBS|EFS|FSx|RDS|Aurora|DynamoDB|ElastiCache|CloudFront|Route 53|VPC|Transit Gateway|Direct Connect|PrivateLink|Global Accelerator|Elastic Load Balancing|Load Balancer|Auto Scaling|Lambda|Fargate|ECS|EKS|SQS|SNS|Kinesis|EventBridge|Step Functions|API Gateway|Cognito|IAM|KMS|Secrets Manager|Shield|WAF|GuardDuty|Macie|Organizations|Control Tower|CloudTrail|CloudWatch|Config|Backup|Storage Gateway|DataSync|Snow|Redshift|Athena|Glue|EMR|Lake Formation|Savings Plans|Spot)\M',
  d.id is not null, 120, 'migration:034'
from (select (select id from decks where slug = 'aws-saa-c03' and is_deleted = 0 order by id limit 1) as id) d
on conflict (url) do nothing;

insert into source_watch_targets (kind, url, feed_format, deck_id, item_title_pattern, active, check_interval_minutes, created_by)
select 'feed', 'https://platform.claude.com/docs/en/release-notes/overview', 'html-headings', d.id, null,
  d.id is not null, 360, 'migration:034'
from (select (select id from decks where slug = 'claude-ccdv-f' and is_deleted = 0 order by id limit 1) as id) d
on conflict (url) do nothing;
