# RecallSmith Content Intelligence on Snowflake

This folder contains the Snowflake warehouse side of the Content Intelligence MVP.

## Flow

Mobile review events are written to PostgreSQL and `analytics_event_outbox` in the same transaction. The VPC Lambda publisher drains pending outbox rows into S3 JSONL files. Snowpipe loads those files into `raw.review_events_json`, then Snowflake staging and marts model card quality.

## Publisher endpoint

After deploying the VPC Lambda build, publish pending outbox rows:

```bash
curl -sS -X POST "${MIGRATE_HDR[@]}" \
  -H "Content-Type: application/json" \
  -d '{}' \
  "${API_BASE}/api/v1/admin/analytics/outbox/publish?limit=1000" | jq .
```

Environment variables:

- `ANALYTICS_S3_BUCKET`: preferred analytics bucket.
- `ANALYTICS_S3_PREFIX`: optional prefix, default `analytics/raw/review_events`.
- `CONTENT_BUCKET`: fallback bucket if `ANALYTICS_S3_BUCKET` is not set.

Expected S3 layout:

```text
s3://<bucket>/<prefix>/event_type=card_reviewed/dt=YYYY-MM-DD/batch-*.jsonl
```

## Snowflake setup

Run `001_content_intelligence_setup.sql` after replacing placeholders:

- `<WAREHOUSE_NAME>`
- `<DATABASE_NAME>`
- `<ANALYTICS_BUCKET>`
- `<ANALYTICS_PREFIX>`
- `<STORAGE_INTEGRATION_NAME>`

There is no runner or CI step for this file: the owner applies it by hand, and it must be
**re-run after every edit**. Every view and dynamic table is `create or replace`, so re-running
the whole file is idempotent. The 2026-09 edit added `card_format`, `answer_mode`,
`client_features`, and `update_id` to `staging.stg_review_events` and projected them through
`staging.card_observations`. `answer_mode` is `'mcq'` only when `card_format = 'mcq'` **and** the
event's `client_features` array contains `'mcq'`; otherwise it is `'qa'` (a Wave C client sends no
`client_features`, so everything reads `'qa'`). The quality mart's user and difficulty baselines now
group by `answer_mode`, MCQ rows carry `content_quality_status = 'MCQ · Not Assessed'`,
`mart_card_revision_impact` reads `answer_mode = 'qa'` rows only, and `mart_deck_health_daily` gains
an `mcq_not_assessed_count` column.

The script creates:

- `raw.review_events_json`
- `staging.stg_review_events`
- `staging.card_observations`
- `marts.mart_card_quality_daily`
- `marts.mart_card_revision_impact`
- `marts.mart_deck_health_daily`

For production, configure S3 event notifications to the Snowpipe notification channel returned by `show pipes like 'REVIEW_EVENTS_PIPE' in schema raw;`.

