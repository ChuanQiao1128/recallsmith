# H06 — notes (infra-slo-dashboard-runbook)

## Plan (mode b, read-only, 2026-09-29)

`Plan: 10 to add, 1 to change, 2 to destroy.` — `check-plan.py --allow docs/delivery/r18-issues/H06.plan-allow.json`
⇒ `PLAN OK 13`, `SUMMARY imports=0 no-op=282 create=10 update=1 delete=2 replace=0 outputs=0`. No H05 entry
appeared, so H05 was applied at the branch point.

## get-metric-data replay

Every planned metric alarm's `metric_query` list and every new dashboard metric widget's `metrics`, through
`aws cloudwatch get-metric-data` over the last 24 h with each query's own period (2026-09-29, read-only):

| Query set | Period | Returned ids | StatusCode |
|---|---|---|---|
| slo_api_availability_burn_1h | 3600 | burn | Complete |
| slo_api_availability_burn_5m | 300 | burn | Complete |
| slo_api_availability_slow_burn | 21600 | burn | Complete |
| slo_sync_latency_burn_1h | 3600 | burn | Complete |
| slo_sync_latency_burn_5m | 300 | burn | Complete |
| slo_sync_latency_slow_burn | 21600 | burn | Complete |
| slo_publish_success_fast_burn | 3600 | burn | Complete |
| slo_publish_success_slow_burn | 21600 | burn | Complete |
| widget 2 API availability error budget remaining % | 3600 | budget | Complete |
| widget 3 Sync latency error budget remaining % | 3600 | budget | Complete |
| widget 4 Publish success error budget remaining % | 3600 | budget | Complete |
| widget 5 API availability burn rate (1 h) | 3600 | burn | Complete |
| widget 6 Sync latency burn rate (1 h) | 3600 | burn | Complete |
| widget 7 Publish success burn rate (1 h) | 3600 | burn | Complete |
| widget 8 Synthetic check success | 900 | success | Complete |
| widget 9 Synthetic check latency | 900 | latmax, latp50 | Complete |

No call failed validation.

## Nine widgets, not ten

H00 §6.2 says "ten new widget titles" while its §4.5 table lists nine widgets (one text widget + eight titled
metric widgets). This change follows §4.5 and the brief: nine widgets, the dashboard goes from 10 to 19.

## Alarm count after apply

38 metric alarms before R18H (AWS facts, H00 header) + 1 synthetic (H05) − 2 deleted (`api-5xx`,
`core-vpc-duration-p95`) + 8 SLO metric alarms = **45 metric alarms + 2 composite alarms** (H00 §4.4).

## Implementation choices

- `dynamic "metric_query"` builds the metric queries (the `ai_qa_daily_cost` precedent); the sync pairs come
  from `local.slo_sync_metrics` (flattened from the three route/method pairs), which the two sync dashboard
  widgets reuse so the alarm and the widget can never disagree on a route.
- Child alarms have `alarm_actions = []` and `ok_actions = []` literally; every other alarm and the two
  composites use the alerts topic on alarm and OK.

## Follow-ups

- review the sync-latency target after 28 days at 512 MB (due 2026-10-27)
- the publish alarms stay INSUFFICIENT_DATA until H02 ships
