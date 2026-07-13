-- 010_content_intelligence_snapshot.sql
-- Stores Snowflake-exported content intelligence snapshots for application-side reads.

create table if not exists content_intelligence_card_snapshot (
  window_days integer not null,
  deck_slug text not null,
  card_stable_uid text not null,
  card_revision integer not null,
  stated_difficulty integer not null,
  review_count integer not null default 0,
  unique_user_count integer not null default 0,
  observed_difficulty_raw numeric null,
  expected_difficulty numeric null,
  difficulty_gap numeric null,
  difficulty_gap_z numeric null,
  easy_rate numeric null,
  good_rate numeric null,
  hard_rate numeric null,
  again_rate numeric null,
  struggle_rate numeric null,
  failure_rate numeric null,
  repeat_failure_rate numeric null,
  median_dwell_time_ms numeric null,
  expected_dwell_time_ms numeric null,
  dwell_time_ratio numeric null,
  high_level_user_failure_rate numeric null,
  post_card_dropout_rate numeric null,
  review_count_to_mastery numeric null,
  difficulty_calibration_status text not null,
  content_quality_status text not null,
  confidence_level text not null,
  fix_priority_score numeric not null default 0,
  window_start_at timestamptz not null,
  window_end_at timestamptz not null,
  source_generated_at timestamptz not null,
  imported_at timestamptz not null default now(),
  primary key (
    window_days,
    deck_slug,
    card_stable_uid,
    card_revision
  ),
  constraint content_intelligence_snapshot_window_days_check
    check (window_days in (30, 90)),
  constraint content_intelligence_snapshot_difficulty_check
    check (stated_difficulty in (1, 2, 3))
);

create index if not exists idx_ci_card_snapshot_deck_priority
  on content_intelligence_card_snapshot (
    window_days,
    deck_slug,
    fix_priority_score desc
  );

create index if not exists idx_ci_card_snapshot_status
  on content_intelligence_card_snapshot (
    window_days,
    difficulty_calibration_status,
    content_quality_status,
    confidence_level
  );

create index if not exists idx_ci_card_snapshot_source_generated
  on content_intelligence_card_snapshot (
    source_generated_at desc
  );

create table if not exists content_intelligence_import_runs (
  id bigserial primary key,
  s3_bucket text not null,
  s3_key text not null,
  s3_etag text null,
  status text not null,
  row_count integer not null default 0,
  started_at timestamptz not null default now(),
  completed_at timestamptz null,
  error_message text null,
  constraint content_intelligence_import_runs_status_check
    check (status in ('RUNNING', 'SUCCEEDED', 'FAILED'))
);

create index if not exists idx_ci_import_runs_started
  on content_intelligence_import_runs (started_at desc);
