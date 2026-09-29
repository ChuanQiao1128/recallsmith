# R18H H06 — SLOs (H00 §4)
# Rolling 28-day window; burn rate = (bad / total) / (1 − target); fast burn >= 14.4 (2 % of the budget in 1 h),
# slow burn >= 6 (≈ 5 % in 6 h). The 1-hour and 5-minute child alarms carry no actions; their composite pages.

locals {
  slo_api_metrics = {
    e5xx  = "5xx"
    total = "Count"
  }
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
}

# ── api-availability: 99.5 % of app API requests without a 5xx ──────────────

resource "aws_cloudwatch_metric_alarm" "slo_api_availability_burn_1h" {
  alarm_name          = "developercards-${var.env}-slo-api-availability-burn-1h"
  alarm_description   = "SLO api-availability: 99.5 % of app API requests without a 5xx over a rolling 28 days; 1-hour burn rate >= 14.4 (fast-burn child, no actions)."
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
    expression  = "IF(total >= 10 AND bad >= 2, (bad / total) / 0.005, 0)"
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

resource "aws_cloudwatch_metric_alarm" "slo_api_availability_slow_burn" {
  alarm_name          = "developercards-${var.env}-slo-api-availability-slow-burn"
  alarm_description   = "SLO api-availability: 99.5 % of app API requests without a 5xx over a rolling 28 days; 6-hour burn rate >= 6 (slow burn)."
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = 6
  evaluation_periods  = 1
  datapoints_to_alarm = 1
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]

  dynamic "metric_query" {
    for_each = local.slo_api_metrics
    content {
      id          = metric_query.key
      return_data = false
      metric {
        namespace   = "AWS/ApiGateway"
        metric_name = metric_query.value
        stat        = "Sum"
        period      = 21600
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
    expression  = "IF(total >= 30 AND bad >= 3, (bad / total) / 0.005, 0)"
    label       = "api-availability burn rate (6 h)"
    return_data = true
  }
}

# ── sync-latency: 95 % of app sync requests served in <= 2000 ms ────────────

resource "aws_cloudwatch_metric_alarm" "slo_sync_latency_burn_1h" {
  alarm_name          = "developercards-${var.env}-slo-sync-latency-burn-1h"
  alarm_description   = "SLO sync-latency: 95 % of app sync requests served in <= 2000 ms over a rolling 28 days; 1-hour burn rate >= 14.4 (fast-burn child, no actions)."
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
  alarm_description   = "SLO sync-latency: 95 % of app sync requests served in <= 2000 ms over a rolling 28 days; 5-minute burn rate >= 14.4 (fast-burn child, no actions)."
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
  alarm_description = "SLO sync-latency: 95 % of app sync requests served in <= 2000 ms over a rolling 28 days; fast burn when both the 1-hour and the 5-minute burn rate are >= 14.4."
  alarm_rule        = "ALARM(\"${aws_cloudwatch_metric_alarm.slo_sync_latency_burn_1h.alarm_name}\") AND ALARM(\"${aws_cloudwatch_metric_alarm.slo_sync_latency_burn_5m.alarm_name}\")"
  alarm_actions     = [aws_sns_topic.alerts.arn]
  ok_actions        = [aws_sns_topic.alerts.arn]
}

resource "aws_cloudwatch_metric_alarm" "slo_sync_latency_slow_burn" {
  alarm_name          = "developercards-${var.env}-slo-sync-latency-slow-burn"
  alarm_description   = "SLO sync-latency: 95 % of app sync requests served in <= 2000 ms over a rolling 28 days; 6-hour burn rate >= 6 (slow burn)."
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = 6
  evaluation_periods  = 1
  datapoints_to_alarm = 1
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]

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

# ── publish-success: 95 % of publish jobs succeed (H02 gauges; sparse, so no 5-minute window) ──

resource "aws_cloudwatch_metric_alarm" "slo_publish_success_fast_burn" {
  alarm_name          = "developercards-${var.env}-slo-publish-success-fast-burn"
  alarm_description   = "SLO publish-success: 95 % of publish jobs succeed over a rolling 28 days; 1-hour burn rate >= 14.4 (fast burn)."
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

resource "aws_cloudwatch_metric_alarm" "slo_publish_success_slow_burn" {
  alarm_name          = "developercards-${var.env}-slo-publish-success-slow-burn"
  alarm_description   = "SLO publish-success: 95 % of publish jobs succeed over a rolling 28 days; 6-hour burn rate >= 6 (slow burn)."
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = 6
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
