# H06 — notes (infra-slo-dashboard-runbook)

## Plan (mode b, read-only, 2026-09-29)

`Plan: 10 to add, 1 to change, 2 to destroy.` — `check-plan.py --allow docs/delivery/r18-issues/H06.plan-allow.json`
⇒ `PLAN OK 13`, `SUMMARY imports=0 no-op=282 create=10 update=1 delete=2 replace=0 outputs=0`. No H05 entry
appeared, so H05 was applied at the branch point.

## get-metric-data replay

REPLAY_PLACEHOLDER

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
