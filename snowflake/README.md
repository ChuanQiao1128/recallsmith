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

The script creates:

- `raw.review_events_json`
- `staging.stg_review_events`
- `staging.card_observations`
- `marts.mart_card_quality_daily`
- `marts.mart_card_revision_impact`
- `marts.mart_deck_health_daily`

For production, configure S3 event notifications to the Snowpipe notification channel returned by `show pipes like 'REVIEW_EVENTS_PIPE' in schema raw;`.

