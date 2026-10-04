# R18H H06 — SLOs (H00 §4)
# Rolling 28-day window; burn rate = (bad / total) / (1 − target); fast burn >= 14.4 (2 % of the budget in 1 h),
# slow burn >= 6 (≈ 5 % in 6 h). The 1-hour and 5-minute child alarms carry no actions; their composite pages.
# R18I I03: slow burn is a composite too, 6 h AND 30 min (SRE workbook short window), so it clears within about
# 30 minutes of recovery instead of 6 hours; its actions are suppressed while the SLO's fast burn is in ALARM, so
# one incident sends one page. Availability slow burn is users, not probes (Q2): the synthetic check's own requests
# are subtracted with the API Gateway detailed route metrics (gateway.tf detailed_metrics_enabled).

locals {
  slo_api_metrics = {
    e5xx  = "5xx"
    total = "Count"
  }
  # Q2: GET /health (hc, h5xx) is the probe's liveness call; the token-less GET /api/v1/me gets its 401 from the JWT
  # authorizer, so that route's 4xx (m4xx) are the probe's requests (and a user's expired token, which is no 5xx either).
  # R28 MONITOR: the probe's token-less GET /api/v1/sync/progress is a 4xx of ANY /api/v1/sync/{proxy+} (s4xx), left
  # out the same way. services/synthetic-check/tests/test_infra_contract.py keeps these routes equal to the probe's.
  slo_api_user_metrics = {
    e5xx  = { metric = "5xx", route = {} }
    total = { metric = "Count", route = {} }
    hc    = { metric = "Count", route = { Resource = "/health", Method = "GET" } }
    h5xx  = { metric = "5xx", route = { Resource = "/health", Method = "GET" } }
    m4xx  = { metric = "4xx", route = { Resource = "/api/v1/me", Method = "GET" } }
    s4xx  = { metric = "4xx", route = { Resource = "/api/v1/sync/{proxy+}", Method = "ANY" } }
  }
  slo_api_user_total = "total - FILL(hc, 0) - FILL(m4xx, 0) - FILL(s4xx, 0)"
  slo_api_user_bad   = "FILL(e5xx, 0) - FILL(h5xx, 0)"

  # The synthetic check's API requests per hour (4 runs x GET /health, /api/v1/me, /api/v1/sync/progress); the
  # 1-hour fast-burn guard is twice this, so the probes alone never meet it and are at most half of the hour.
  slo_probe_api_requests_per_hour = 12

  # The three sync routes the app calls (RouteMetrics EMF Latency, Service = core-vpc): n<i> = SampleCount, p<i> = percent <= 2000 ms.
  slo_sync_routes = [
    { route = "/api/v1/sync/push", method = "POST" },
    { route = "/api/v1/sync/progress", method = "GET" },
    { route = "/api/v1/draw-state/sync", method = "POST" },
  ]
  slo_sync_metrics = flatten([
    for i, r in local.slo_sync_routes : [
      { id = "n${i + 1}", stat = "SampleCount", route = r.route, method = r.method },
      { id = "p${i + 1}", stat = "PR(:2000)", route = r.route, method = r.method },
    ]
  ])
  slo_sync_total = "FILL(n1, 0) + FILL(n2, 0) + FILL(n3, 0)"
  slo_sync_bad   = "FILL(n1, 0) * (100 - FILL(p1, 100)) / 100 + FILL(n2, 0) * (100 - FILL(p2, 100)) / 100 + FILL(n3, 0) * (100 - FILL(p3, 100)) / 100"
  slo_publish_metrics = {
    succeeded = "PublishJobsSucceeded"
    failed    = "PublishJobsFailed"
  }
  slo_publish_burn = "IF(bad >= 2, (bad / (good + bad)) / 0.05, 0)"
  # The 30-minute short window only confirms the burn is still going on; the 6-hour window carries the volume guard.
  slo_publish_burn_short = "IF(bad >= 1, (bad / (good + bad)) / 0.05, 0)"

  # Q1: dormant wording (replayed read-only on 2026-09-29 over the data since 2026-09-21).
  slo_sync_dormant    = "dormant at 2026-09 traffic: needs >= 6 sync requests in 1 h (fast) / >= 12 in 6 h (slow), and 14 arrived in total (at most 6 in an hour, 10 in 6 h), so latency regressions show only on the dashboard and SyntheticCheckLatency"
  slo_publish_dormant = "dormant at 2026-09 traffic: needs >= 2 failed publish jobs in the window, and no publish job ran"
  # Suppress a slow-burn page while the same SLO's fast burn is paging, and for 30 minutes after it clears.
  slo_suppressor_extension_s = 1800
  slo_suppressor_wait_s      = 300
}

# ── api-availability: 99.5 % of app API requests without a 5xx ──────────────

resource "aws_cloudwatch_metric_alarm" "slo_api_availability_burn_1h" {
  alarm_name          = "developercards-${var.env}-slo-api-availability-burn-1h"
  alarm_description   = "SLO api-availability: 99.5 % of app API requests without a 5xx over a rolling 28 days; 1-hour burn rate >= 14.4 (fast-burn child, no actions; guard >= ${2 * local.slo_probe_api_requests_per_hour} requests, twice the synthetic check's ${local.slo_probe_api_requests_per_hour} per hour, and >= 2 5xx)."
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = 14.4
  evaluation_periods  = 1
  datapoints_to_alarm = 1
  treat_missing_data  = "notBreaching"
  alarm_actions       = []
  ok_actions          = []

  dynamic "metric_query" {
    for_each = local.slo_api_metrics
    content {
      id          = metric_query.key
      return_data = false
      metric {
        namespace   = "AWS/ApiGateway"
        metric_name = metric_query.value
        stat        = "Sum"
        period      = 3600
        dimensions  = { ApiId = var.api_id, Stage = var.api_stage_name }
      }
    }
  }

  metric_query {
    id          = "bad"
    expression  = "FILL(e5xx, 0)"
    return_data = false
  }

  metric_query {
    id          = "burn"
    expression  = "IF(total >= ${2 * local.slo_probe_api_requests_per_hour} AND bad >= 2, (bad / total) / 0.005, 0)"
    label       = "api-availability burn rate (1 h)"
    return_data = true
  }
}

resource "aws_cloudwatch_metric_alarm" "slo_api_availability_burn_5m" {
  alarm_name          = "developercards-${var.env}-slo-api-availability-burn-5m"
  alarm_description   = "SLO api-availability: 99.5 % of app API requests without a 5xx over a rolling 28 days; 5-minute burn rate >= 14.4 (fast-burn child, no actions)."
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = 14.4
  evaluation_periods  = 1
  datapoints_to_alarm = 1
  treat_missing_data  = "notBreaching"
  alarm_actions       = []
  ok_actions          = []

  dynamic "metric_query" {
    for_each = local.slo_api_metrics
    content {
      id          = metric_query.key
      return_data = false
      metric {
        namespace   = "AWS/ApiGateway"
        metric_name = metric_query.value
        stat        = "Sum"
        period      = 300
        dimensions  = { ApiId = var.api_id, Stage = var.api_stage_name }
      }
    }
  }

  metric_query {
    id          = "bad"
    expression  = "FILL(e5xx, 0)"
    return_data = false
  }

  metric_query {
    id          = "burn"
    expression  = "IF(total >= 1 AND bad >= 1, (bad / total) / 0.005, 0)"
    label       = "api-availability burn rate (5 min)"
    return_data = true
  }
}

resource "aws_cloudwatch_composite_alarm" "slo_api_availability_fast_burn" {
  alarm_name        = "developercards-${var.env}-slo-api-availability-fast-burn"
  alarm_description = "SLO api-availability: 99.5 % of app API requests without a 5xx over a rolling 28 days; fast burn when both the 1-hour and the 5-minute burn rate are >= 14.4."
  alarm_rule        = "ALARM(\"${aws_cloudwatch_metric_alarm.slo_api_availability_burn_1h.alarm_name}\") AND ALARM(\"${aws_cloudwatch_metric_alarm.slo_api_availability_burn_5m.alarm_name}\")"
  alarm_actions     = [aws_sns_topic.alerts.arn]
  ok_actions        = [aws_sns_topic.alerts.arn]
}

moved {
  from = aws_cloudwatch_metric_alarm.slo_api_availability_slow_burn
  to   = aws_cloudwatch_metric_alarm.slo_api_availability_burn_6h
}

resource "aws_cloudwatch_metric_alarm" "slo_api_availability_burn_6h" {
  alarm_name          = "developercards-${var.env}-slo-api-availability-burn-6h"
  alarm_description   = "SLO api-availability: 99.5 % of app API requests (synthetic check excluded) without a 5xx over a rolling 28 days; 6-hour burn rate >= 6 (slow-burn child, no actions; guard >= 30 requests and >= 3 5xx, both without the synthetic check)."
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = 6
  evaluation_periods  = 1
  datapoints_to_alarm = 1
  treat_missing_data  = "notBreaching"
  alarm_actions       = []
  ok_actions          = []

  dynamic "metric_query" {
    for_each = local.slo_api_user_metrics
    content {
      id          = metric_query.key
      return_data = false
      metric {
        namespace   = "AWS/ApiGateway"
        metric_name = metric_query.value.metric
        stat        = "Sum"
        period      = 21600
        dimensions  = merge({ ApiId = var.api_id, Stage = var.api_stage_name }, metric_query.value.route)
      }
    }
  }

  metric_query {
    id          = "user_total"
    expression  = local.slo_api_user_total
    return_data = false
  }

  metric_query {
    id          = "user_bad"
    expression  = local.slo_api_user_bad
    return_data = false
  }

  metric_query {
    id          = "burn"
    expression  = "IF(user_total >= 30 AND user_bad >= 3, (user_bad / user_total) / 0.005, 0)"
    label       = "api-availability burn rate (6 h, synthetic check excluded)"
    return_data = true
  }
}

resource "aws_cloudwatch_metric_alarm" "slo_api_availability_burn_30m" {
  alarm_name          = "developercards-${var.env}-slo-api-availability-burn-30m"
  alarm_description   = "SLO api-availability: 99.5 % of app API requests (synthetic check excluded) without a 5xx over a rolling 28 days; 30-minute burn rate >= 6 (slow-burn short-window child, no actions)."
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = 6
  evaluation_periods  = 1
  datapoints_to_alarm = 1
  treat_missing_data  = "notBreaching"
  alarm_actions       = []
  ok_actions          = []

  dynamic "metric_query" {
    for_each = local.slo_api_user_metrics
    content {
      id          = metric_query.key
      return_data = false
      metric {
        namespace   = "AWS/ApiGateway"
        metric_name = metric_query.value.metric
        stat        = "Sum"
        period      = 1800
        dimensions  = merge({ ApiId = var.api_id, Stage = var.api_stage_name }, metric_query.value.route)
      }
    }
  }

  metric_query {
    id          = "user_total"
    expression  = local.slo_api_user_total
    return_data = false
  }

  metric_query {
    id          = "user_bad"
    expression  = local.slo_api_user_bad
    return_data = false
  }

  metric_query {
    id          = "burn"
    expression  = "IF(user_total >= 1 AND user_bad >= 1, (user_bad / user_total) / 0.005, 0)"
    label       = "api-availability burn rate (30 min, synthetic check excluded)"
    return_data = true
  }
}

resource "aws_cloudwatch_composite_alarm" "slo_api_availability_slow_burn" {
  alarm_name        = "developercards-${var.env}-slo-api-availability-slow-burn"
  alarm_description = "SLO api-availability: 99.5 % of app API requests (synthetic check excluded) without a 5xx over a rolling 28 days; slow burn when both the 6-hour and the 30-minute burn rate are >= 6 (silent while the fast burn pages)."
  alarm_rule        = "ALARM(\"${aws_cloudwatch_metric_alarm.slo_api_availability_burn_6h.alarm_name}\") AND ALARM(\"${aws_cloudwatch_metric_alarm.slo_api_availability_burn_30m.alarm_name}\")"
  alarm_actions     = [aws_sns_topic.alerts.arn]
  ok_actions        = [aws_sns_topic.alerts.arn]

  actions_suppressor {
    alarm            = aws_cloudwatch_composite_alarm.slo_api_availability_fast_burn.alarm_name
    extension_period = local.slo_suppressor_extension_s
    wait_period      = local.slo_suppressor_wait_s
  }
}

# ── sync-latency: 95 % of app sync requests served in <= 2000 ms ────────────
# The SLI is core-vpc handler latency (RouteMetrics times the dispatch), so it excludes Lambda init / cold start.

resource "aws_cloudwatch_metric_alarm" "slo_sync_latency_burn_1h" {
  alarm_name          = "developercards-${var.env}-slo-sync-latency-burn-1h"
  alarm_description   = "SLO sync-latency: 95 % of app sync requests served in <= 2000 ms (handler latency) over a rolling 28 days; 1-hour burn rate >= 14.4 (fast-burn child, no actions); ${local.slo_sync_dormant}."
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = 14.4
  evaluation_periods  = 1
  datapoints_to_alarm = 1
  treat_missing_data  = "notBreaching"
  alarm_actions       = []
  ok_actions          = []

  dynamic "metric_query" {
    for_each = local.slo_sync_metrics
    content {
      id          = metric_query.value.id
      return_data = false
      metric {
        namespace   = var.metrics_namespace
        metric_name = "Latency"
        stat        = metric_query.value.stat
        period      = 3600
        dimensions  = { Service = "core-vpc", Route = metric_query.value.route, Method = metric_query.value.method }
      }
    }
  }

  metric_query {
    id          = "total"
    expression  = local.slo_sync_total
    return_data = false
  }

  metric_query {
    id          = "bad"
    expression  = local.slo_sync_bad
    return_data = false
  }

  metric_query {
    id          = "burn"
    expression  = "IF(total >= 6, (bad / total) / 0.05, 0)"
    label       = "sync-latency burn rate (1 h)"
    return_data = true
  }
}

resource "aws_cloudwatch_metric_alarm" "slo_sync_latency_burn_5m" {
  alarm_name          = "developercards-${var.env}-slo-sync-latency-burn-5m"
  alarm_description   = "SLO sync-latency: 95 % of app sync requests served in <= 2000 ms (handler latency) over a rolling 28 days; 5-minute burn rate >= 14.4 (fast-burn child, no actions)."
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = 14.4
  evaluation_periods  = 1
  datapoints_to_alarm = 1
  treat_missing_data  = "notBreaching"
  alarm_actions       = []
  ok_actions          = []

  dynamic "metric_query" {
    for_each = local.slo_sync_metrics
    content {
      id          = metric_query.value.id
      return_data = false
      metric {
        namespace   = var.metrics_namespace
        metric_name = "Latency"
        stat        = metric_query.value.stat
        period      = 300
        dimensions  = { Service = "core-vpc", Route = metric_query.value.route, Method = metric_query.value.method }
      }
    }
  }

  metric_query {
    id          = "total"
    expression  = local.slo_sync_total
    return_data = false
  }

  metric_query {
    id          = "bad"
    expression  = local.slo_sync_bad
    return_data = false
  }

  metric_query {
    id          = "burn"
    expression  = "IF(total >= 1, (bad / total) / 0.05, 0)"
    label       = "sync-latency burn rate (5 min)"
    return_data = true
  }
}

resource "aws_cloudwatch_composite_alarm" "slo_sync_latency_fast_burn" {
  alarm_name        = "developercards-${var.env}-slo-sync-latency-fast-burn"
  alarm_description = "SLO sync-latency: 95 % of app sync requests served in <= 2000 ms (handler latency) over a rolling 28 days; fast burn when both the 1-hour and the 5-minute burn rate are >= 14.4; ${local.slo_sync_dormant}."
  alarm_rule        = "ALARM(\"${aws_cloudwatch_metric_alarm.slo_sync_latency_burn_1h.alarm_name}\") AND ALARM(\"${aws_cloudwatch_metric_alarm.slo_sync_latency_burn_5m.alarm_name}\")"
  alarm_actions     = [aws_sns_topic.alerts.arn]
  ok_actions        = [aws_sns_topic.alerts.arn]
}

moved {
  from = aws_cloudwatch_metric_alarm.slo_sync_latency_slow_burn
  to   = aws_cloudwatch_metric_alarm.slo_sync_latency_burn_6h
}

resource "aws_cloudwatch_metric_alarm" "slo_sync_latency_burn_6h" {
  alarm_name          = "developercards-${var.env}-slo-sync-latency-burn-6h"
  alarm_description   = "SLO sync-latency: 95 % of app sync requests served in <= 2000 ms (handler latency) over a rolling 28 days; 6-hour burn rate >= 6 (slow-burn child, no actions); ${local.slo_sync_dormant}."
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = 6
  evaluation_periods  = 1
  datapoints_to_alarm = 1
  treat_missing_data  = "notBreaching"
  alarm_actions       = []
  ok_actions          = []

  dynamic "metric_query" {
    for_each = local.slo_sync_metrics
    content {
      id          = metric_query.value.id
      return_data = false
      metric {
        namespace   = var.metrics_namespace
        metric_name = "Latency"
        stat        = metric_query.value.stat
        period      = 21600
        dimensions  = { Service = "core-vpc", Route = metric_query.value.route, Method = metric_query.value.method }
      }
    }
  }

  metric_query {
    id          = "total"
    expression  = local.slo_sync_total
    return_data = false
  }

  metric_query {
    id          = "bad"
    expression  = local.slo_sync_bad
    return_data = false
  }

  metric_query {
    id          = "burn"
    expression  = "IF(total >= 12, (bad / total) / 0.05, 0)"
    label       = "sync-latency burn rate (6 h)"
    return_data = true
  }
}

resource "aws_cloudwatch_metric_alarm" "slo_sync_latency_burn_30m" {
  alarm_name          = "developercards-${var.env}-slo-sync-latency-burn-30m"
  alarm_description   = "SLO sync-latency: 95 % of app sync requests served in <= 2000 ms (handler latency) over a rolling 28 days; 30-minute burn rate >= 6 (slow-burn short-window child, no actions)."
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = 6
  evaluation_periods  = 1
  datapoints_to_alarm = 1
  treat_missing_data  = "notBreaching"
  alarm_actions       = []
  ok_actions          = []

  dynamic "metric_query" {
    for_each = local.slo_sync_metrics
    content {
      id          = metric_query.value.id
      return_data = false
      metric {
        namespace   = var.metrics_namespace
        metric_name = "Latency"
        stat        = metric_query.value.stat
        period      = 1800
        dimensions  = { Service = "core-vpc", Route = metric_query.value.route, Method = metric_query.value.method }
      }
    }
  }

  metric_query {
    id          = "total"
    expression  = local.slo_sync_total
    return_data = false
  }

  metric_query {
    id          = "bad"
    expression  = local.slo_sync_bad
    return_data = false
  }

  metric_query {
    id          = "burn"
    expression  = "IF(total >= 1, (bad / total) / 0.05, 0)"
    label       = "sync-latency burn rate (30 min)"
    return_data = true
  }
}

resource "aws_cloudwatch_composite_alarm" "slo_sync_latency_slow_burn" {
  alarm_name        = "developercards-${var.env}-slo-sync-latency-slow-burn"
  alarm_description = "SLO sync-latency: 95 % of app sync requests served in <= 2000 ms (handler latency) over a rolling 28 days; slow burn when both the 6-hour and the 30-minute burn rate are >= 6 (silent while the fast burn pages); ${local.slo_sync_dormant}."
  alarm_rule        = "ALARM(\"${aws_cloudwatch_metric_alarm.slo_sync_latency_burn_6h.alarm_name}\") AND ALARM(\"${aws_cloudwatch_metric_alarm.slo_sync_latency_burn_30m.alarm_name}\")"
  alarm_actions     = [aws_sns_topic.alerts.arn]
  ok_actions        = [aws_sns_topic.alerts.arn]

  actions_suppressor {
    alarm            = aws_cloudwatch_composite_alarm.slo_sync_latency_fast_burn.alarm_name
    extension_period = local.slo_suppressor_extension_s
    wait_period      = local.slo_suppressor_wait_s
  }
}

# ── publish-success: 95 % of publish jobs succeed (H02 gauges; sparse, so no 5-minute window) ──

resource "aws_cloudwatch_metric_alarm" "slo_publish_success_fast_burn" {
  alarm_name          = "developercards-${var.env}-slo-publish-success-fast-burn"
  alarm_description   = "SLO publish-success: 95 % of publish jobs succeed over a rolling 28 days; 1-hour burn rate >= 14.4 (fast burn); ${local.slo_publish_dormant}."
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = 14.4
  evaluation_periods  = 1
  datapoints_to_alarm = 1
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]

  dynamic "metric_query" {
    for_each = local.slo_publish_metrics
    content {
      id          = metric_query.key
      return_data = false
      metric {
        namespace   = var.metrics_namespace
        metric_name = metric_query.value
        stat        = "Sum"
        period      = 3600
      }
    }
  }

  metric_query {
    id          = "good"
    expression  = "FILL(succeeded, 0)"
    return_data = false
  }

  metric_query {
    id          = "bad"
    expression  = "FILL(failed, 0)"
    return_data = false
  }

  metric_query {
    id          = "burn"
    expression  = local.slo_publish_burn
    label       = "publish-success burn rate (1 h)"
    return_data = true
  }
}

moved {
  from = aws_cloudwatch_metric_alarm.slo_publish_success_slow_burn
  to   = aws_cloudwatch_metric_alarm.slo_publish_success_burn_6h
}

resource "aws_cloudwatch_metric_alarm" "slo_publish_success_burn_6h" {
  alarm_name          = "developercards-${var.env}-slo-publish-success-burn-6h"
  alarm_description   = "SLO publish-success: 95 % of publish jobs succeed over a rolling 28 days; 6-hour burn rate >= 6 (slow-burn child, no actions); ${local.slo_publish_dormant}."
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = 6
  evaluation_periods  = 1
  datapoints_to_alarm = 1
  treat_missing_data  = "notBreaching"
  alarm_actions       = []
  ok_actions          = []

  dynamic "metric_query" {
    for_each = local.slo_publish_metrics
    content {
      id          = metric_query.key
      return_data = false
      metric {
        namespace   = var.metrics_namespace
        metric_name = metric_query.value
        stat        = "Sum"
        period      = 21600
      }
    }
  }

  metric_query {
    id          = "good"
    expression  = "FILL(succeeded, 0)"
    return_data = false
  }

  metric_query {
    id          = "bad"
    expression  = "FILL(failed, 0)"
    return_data = false
  }

  metric_query {
    id          = "burn"
    expression  = local.slo_publish_burn
    label       = "publish-success burn rate (6 h)"
    return_data = true
  }
}

resource "aws_cloudwatch_metric_alarm" "slo_publish_success_burn_30m" {
  alarm_name          = "developercards-${var.env}-slo-publish-success-burn-30m"
  alarm_description   = "SLO publish-success: 95 % of publish jobs succeed over a rolling 28 days; 30-minute burn rate >= 6 (slow-burn short-window child, no actions)."
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = 6
  evaluation_periods  = 1
  datapoints_to_alarm = 1
  treat_missing_data  = "notBreaching"
  alarm_actions       = []
  ok_actions          = []

  dynamic "metric_query" {
    for_each = local.slo_publish_metrics
    content {
      id          = metric_query.key
      return_data = false
      metric {
        namespace   = var.metrics_namespace
        metric_name = metric_query.value
        stat        = "Sum"
        period      = 1800
      }
    }
  }

  metric_query {
    id          = "good"
    expression  = "FILL(succeeded, 0)"
    return_data = false
  }

  metric_query {
    id          = "bad"
    expression  = "FILL(failed, 0)"
    return_data = false
  }

  metric_query {
    id          = "burn"
    expression  = local.slo_publish_burn_short
    label       = "publish-success burn rate (30 min)"
    return_data = true
  }
}

resource "aws_cloudwatch_composite_alarm" "slo_publish_success_slow_burn" {
  alarm_name        = "developercards-${var.env}-slo-publish-success-slow-burn"
  alarm_description = "SLO publish-success: 95 % of publish jobs succeed over a rolling 28 days; slow burn when both the 6-hour and the 30-minute burn rate are >= 6 (silent while the fast burn pages); ${local.slo_publish_dormant}."
  alarm_rule        = "ALARM(\"${aws_cloudwatch_metric_alarm.slo_publish_success_burn_6h.alarm_name}\") AND ALARM(\"${aws_cloudwatch_metric_alarm.slo_publish_success_burn_30m.alarm_name}\")"
  alarm_actions     = [aws_sns_topic.alerts.arn]
  ok_actions        = [aws_sns_topic.alerts.arn]

  actions_suppressor {
    alarm            = aws_cloudwatch_metric_alarm.slo_publish_success_fast_burn.alarm_name
    extension_period = local.slo_suppressor_extension_s
    wait_period      = local.slo_suppressor_wait_s
  }
}
