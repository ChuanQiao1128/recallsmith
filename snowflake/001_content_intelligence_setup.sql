-- RecallSmith Content Intelligence Snowflake setup.
--
-- Replace placeholders before running:
--   <WAREHOUSE_NAME>
--   <DATABASE_NAME>
--   <ANALYTICS_BUCKET>
--   <ANALYTICS_PREFIX>
--   <STORAGE_INTEGRATION_NAME>
--
-- Expected S3 layout from the Lambda outbox publisher:
--   s3://<ANALYTICS_BUCKET>/<ANALYTICS_PREFIX>/event_type=card_reviewed/dt=YYYY-MM-DD/*.jsonl

create database if not exists <DATABASE_NAME>;
use database <DATABASE_NAME>;

create schema if not exists raw;
create schema if not exists staging;
create schema if not exists marts;

create file format if not exists raw.jsonl_format
  type = json
  strip_outer_array = false;

create stage if not exists raw.review_events_stage
  url = 's3://<ANALYTICS_BUCKET>/<ANALYTICS_PREFIX>/event_type=card_reviewed/'
  storage_integration = <STORAGE_INTEGRATION_NAME>
  file_format = raw.jsonl_format;

create table if not exists raw.review_events_json (
  src variant not null,
  source_file string,
  source_row_number number,
  loaded_at timestamp_ltz not null default current_timestamp()
);

create pipe if not exists raw.review_events_pipe
  auto_ingest = true
as
copy into raw.review_events_json (
  src,
  source_file,
  source_row_number
)
from (
  select
    $1,
    metadata$filename,
    metadata$file_row_number
  from @raw.review_events_stage
)
file_format = (format_name = raw.jsonl_format)
on_error = 'continue';

create or replace view staging.stg_review_events as
select
  coalesce(src:payload:event_id::string, src:event_id::string) as event_id,
  coalesce(src:payload:schema_version::number, src:schema_version::number, 1) as schema_version,
  coalesce(src:payload:event_type::string, src:event_type::string, 'card_reviewed') as event_type,
  coalesce(src:payload:user_id_hash::string, src:user_id_hash::string) as user_id_hash,
  coalesce(src:payload:session_id::string, src:session_id::string) as session_id,
  coalesce(src:payload:deck_slug::string, src:deck_slug::string) as deck_slug,
  coalesce(src:payload:card_stable_uid::string, src:card_stable_uid::string) as card_stable_uid,
  coalesce(src:payload:card_revision::number, src:card_revision::number, 1) as card_revision,
  coalesce(src:payload:stated_difficulty::number, src:stated_difficulty::number, 2) as stated_difficulty,
  lower(coalesce(src:payload:rating::string, src:rating::string)) as rating,
  case lower(coalesce(src:payload:rating::string, src:rating::string))
    when 'again' then 4.0
    when 'hard' then 3.0
    when 'good' then 1.0
    when 'easy' then 0.0
    else null
  end as response_score,
  coalesce(src:payload:review_stage::string, src:review_stage::string) as review_stage,
  coalesce(src:payload:review_count_for_card::number, src:review_count_for_card::number) as review_count_for_card,
  coalesce(src:payload:dwell_time_ms::number, src:dwell_time_ms::number) as dwell_time_ms,
  coalesce(src:payload:client_event_ts::timestamp_ltz, src:client_event_ts::timestamp_ltz) as client_event_ts,
  coalesce(src:payload:server_received_ts::timestamp_ltz, src:server_received_ts::timestamp_ltz) as server_received_ts,
  coalesce(src:payload:platform::string, src:platform::string) as platform,
  coalesce(src:payload:app_version::string, src:app_version::string) as app_version,
  coalesce(src:payload:offline_queue_delay_ms::number, src:offline_queue_delay_ms::number) as offline_queue_delay_ms,
  src:outbox_id::number as outbox_id,
  src:aggregate_id::string as aggregate_id,
  src:published_at::timestamp_ltz as published_at,
  source_file,
  source_row_number,
  loaded_at
from raw.review_events_json
qualify row_number() over (
  partition by coalesce(src:payload:event_id::string, src:event_id::string)
  order by loaded_at desc, source_file desc, source_row_number desc
) = 1;

create or replace view staging.card_observations as
select
  date_trunc('day', coalesce(client_event_ts, server_received_ts, loaded_at))::date as event_date,
  event_id,
  user_id_hash,
  session_id,
  deck_slug,
  card_stable_uid,
  card_revision,
  stated_difficulty,
  rating,
  response_score,
  review_stage,
  review_count_for_card,
  dwell_time_ms,
  platform,
  app_version
from staging.stg_review_events
where event_type = 'card_reviewed'
  and event_id is not null
  and deck_slug is not null
  and card_stable_uid is not null
  and rating in ('again', 'hard', 'good', 'easy')
  and response_score is not null;

create or replace dynamic table marts.mart_card_quality_daily
  target_lag = '12 hours'
  warehouse = <WAREHOUSE_NAME>
as
with user_card_ordered as (
  select
    *,
    row_number() over (
      partition by user_id_hash, deck_slug, card_stable_uid, card_revision
      order by event_date, event_id
    ) as user_card_review_number
  from staging.card_observations
),
user_baseline as (
  select
    user_id_hash,
    count(*) as user_review_count,
    avg(response_score) as user_avg_response_score
  from user_card_ordered
  group by user_id_hash
),
expected_by_difficulty as (
  select
    event_date,
    deck_slug,
    stated_difficulty,
    avg(response_score) as expected_difficulty,
    nullif(stddev_samp(response_score), 0) as expected_stddev,
    median(dwell_time_ms) as expected_dwell_time_ms,
    nullif(stddev_samp(dwell_time_ms), 0) as expected_dwell_stddev
  from user_card_ordered
  where dwell_time_ms is null or dwell_time_ms > 0
  group by event_date, deck_slug, stated_difficulty
),
card_stats as (
  select
    e.event_date,
    e.deck_slug,
    e.card_stable_uid,
    e.card_revision,
    e.stated_difficulty,
    count(*) as review_count,
    count(distinct e.user_id_hash) as unique_user_count,
    count_if(e.user_card_review_number = 1) as first_review_count,
    avg(e.response_score) as observed_difficulty_raw,
    avg(iff(e.rating = 'easy', 1, 0)) as easy_rate,
    avg(iff(e.rating = 'good', 1, 0)) as good_rate,
    avg(iff(e.rating = 'hard', 1, 0)) as hard_rate,
    avg(iff(e.rating = 'again', 1, 0)) as again_rate,
    avg(iff(e.rating in ('again', 'hard'), 1, 0)) as struggle_rate,
    avg(iff(e.rating = 'again', 1, 0)) as failure_rate,
    avg(iff(e.user_card_review_number = 1 and e.rating = 'easy', 1,
      iff(e.user_card_review_number = 1, 0, null))) as first_review_easy_rate,
    avg(iff(e.user_card_review_number > 1 and e.rating = 'again', 1,
      iff(e.user_card_review_number > 1, 0, null))) as repeat_failure_rate,
    median(iff(e.dwell_time_ms > 0, e.dwell_time_ms, null)) as median_dwell_time_ms,
    avg(iff(ub.user_review_count >= 10 and ub.user_avg_response_score <= 1.4 and e.rating = 'again', 1,
      iff(ub.user_review_count >= 10 and ub.user_avg_response_score <= 1.4, 0, null))) as high_level_user_failure_rate,
    avg(iff(e.rating in ('good', 'easy'), e.user_card_review_number, null)) as review_count_to_mastery
  from user_card_ordered e
  left join user_baseline ub on ub.user_id_hash = e.user_id_hash
  group by e.event_date, e.deck_slug, e.card_stable_uid, e.card_revision, e.stated_difficulty
),
scored as (
  select
    cs.*,
    b.expected_difficulty,
    b.expected_stddev,
    b.expected_dwell_time_ms,
    (cs.observed_difficulty_raw - b.expected_difficulty) as difficulty_gap,
    (cs.observed_difficulty_raw - b.expected_difficulty) / nullif(b.expected_stddev, 0) as difficulty_gap_z,
    (cs.median_dwell_time_ms - b.expected_dwell_time_ms) / nullif(b.expected_dwell_stddev, 0) as dwell_time_gap_z
  from card_stats cs
  left join expected_by_difficulty b
    on b.event_date = cs.event_date
   and b.deck_slug = cs.deck_slug
   and b.stated_difficulty = cs.stated_difficulty
)
select
  *,
  case
    when review_count < 30 then 'Needs More Data'
    when coalesce(difficulty_gap_z, difficulty_gap, 0) > 1.5 and stated_difficulty < 3 then 'Difficulty Understated'
    when coalesce(difficulty_gap_z, difficulty_gap, 0) < -1.5 then 'Difficulty Overstated'
    else 'Correctly Calibrated'
  end as difficulty_calibration_status,
  case
    when review_count < 30 then 'Needs More Data'
    when coalesce(difficulty_gap_z, 0) > 1.0
      and coalesce(dwell_time_gap_z, 0) > 1.0
      and coalesce(repeat_failure_rate, failure_rate, 0) >= 0.20
      and coalesce(high_level_user_failure_rate, 0) >= 0.15
      then 'Possibly Unclear'
    when stated_difficulty = 3
      and coalesce(struggle_rate, 0) >= 0.35
      and coalesce(failure_rate, 0) < 0.22
      and coalesce(repeat_failure_rate, 0) < 0.22
      then 'Productive Challenge'
    when coalesce(difficulty_gap_z, 0) < -1.0
      and coalesce(first_review_easy_rate, easy_rate, 0) >= 0.45
      then 'Too Shallow'
    else 'Healthy'
  end as content_quality_status,
  case
    when review_count < 30 then 'Low'
    when review_count < 100 then 'Medium'
    else 'High'
  end as confidence_level,
  round((
    (
      (least(abs(coalesce(difficulty_gap_z, 0)), 3) * 20)
      + (coalesce(failure_rate, 0) * 40)
      + (coalesce(repeat_failure_rate, 0) * 30)
      + (greatest(coalesce(dwell_time_gap_z, 0), 0) * 10)
    )
    * ln(greatest(unique_user_count, 1) + 1)
    * case
      when review_count >= 100 then 1.0
      when review_count >= 30 then 0.7
      else 0.35
    end
  ), 2) as fix_priority_score
from scored;

create or replace dynamic table marts.mart_card_revision_impact
  target_lag = '12 hours'
  warehouse = <WAREHOUSE_NAME>
as
with revision_rollup as (
  select
    deck_slug,
    card_stable_uid,
    card_revision,
    stated_difficulty,
    sum(review_count) as review_count,
    avg(observed_difficulty_raw) as observed_difficulty,
    avg(again_rate + hard_rate) as struggle_rate,
    avg(again_rate) as failure_rate,
    avg(median_dwell_time_ms) as median_dwell_time_ms
  from marts.mart_card_quality_daily
  group by deck_slug, card_stable_uid, card_revision, stated_difficulty
),
paired as (
  select
    *,
    lag(card_revision) over (partition by deck_slug, card_stable_uid order by card_revision) as previous_revision,
    lag(stated_difficulty) over (partition by deck_slug, card_stable_uid order by card_revision) as previous_stated_difficulty,
    lag(struggle_rate) over (partition by deck_slug, card_stable_uid order by card_revision) as previous_struggle_rate,
    lag(failure_rate) over (partition by deck_slug, card_stable_uid order by card_revision) as previous_failure_rate,
    lag(median_dwell_time_ms) over (partition by deck_slug, card_stable_uid order by card_revision) as previous_median_dwell_time_ms
  from revision_rollup
)
select
  deck_slug,
  card_stable_uid,
  previous_revision,
  card_revision as current_revision,
  previous_stated_difficulty,
  stated_difficulty as current_stated_difficulty,
  review_count,
  previous_struggle_rate,
  struggle_rate as current_struggle_rate,
  previous_failure_rate,
  failure_rate as current_failure_rate,
  previous_median_dwell_time_ms,
  median_dwell_time_ms as current_median_dwell_time_ms,
  previous_struggle_rate - struggle_rate as revision_improvement_delta,
  case
    when previous_revision is null then 'Insufficient data'
    when review_count < 30 then 'Insufficient data'
    when previous_stated_difficulty != stated_difficulty then 'Difficulty relabeled'
    when previous_struggle_rate - struggle_rate >= 0.10 then 'Improved'
    when previous_struggle_rate - struggle_rate <= -0.10 then 'Regressed'
    else 'No clear change'
  end as revision_impact_status
from paired
where previous_revision is not null;

create or replace dynamic table marts.mart_deck_health_daily
  target_lag = '12 hours'
  warehouse = <WAREHOUSE_NAME>
as
select
  event_date,
  deck_slug,
  count(*) as card_count,
  count_if(content_quality_status = 'Possibly Unclear') as possibly_unclear_count,
  count_if(content_quality_status = 'Too Shallow') as too_shallow_count,
  count_if(content_quality_status = 'Productive Challenge') as productive_challenge_count,
  count_if(content_quality_status = 'Healthy') as healthy_count,
  count_if(difficulty_calibration_status = 'Difficulty Understated') as difficulty_understated_count,
  count_if(difficulty_calibration_status = 'Difficulty Overstated') as difficulty_overstated_count,
  avg(fix_priority_score) as avg_fix_priority_score,
  max(fix_priority_score) as max_fix_priority_score
from marts.mart_card_quality_daily
group by event_date, deck_slug;

