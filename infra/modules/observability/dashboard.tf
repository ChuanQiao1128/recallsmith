locals {
  dashboard_widgets = [
    {
      type   = "metric"
      x      = 0
      y      = 0
      width  = 12
      height = 6
      properties = {
        region  = var.region
        view    = "timeSeries"
        stacked = false
        period  = 300
        title   = "API Count / 4xx / 5xx"
        metrics = [
          ["AWS/ApiGateway", "Count", "ApiId", var.api_id, "Stage", var.api_stage_name, { stat = "Sum" }],
          ["AWS/ApiGateway", "4xx", "ApiId", var.api_id, "Stage", var.api_stage_name, { stat = "Sum" }],
          ["AWS/ApiGateway", "5xx", "ApiId", var.api_id, "Stage", var.api_stage_name, { stat = "Sum" }],
        ]
      }
    },
    {
      type   = "metric"
      x      = 12
      y      = 0
      width  = 12
      height = 6
      properties = {
        region  = var.region
        view    = "timeSeries"
        stacked = false
        period  = 300
        title   = "API Latency p50 / p95"
        metrics = [
          ["AWS/ApiGateway", "Latency", "ApiId", var.api_id, "Stage", var.api_stage_name, { stat = "p50" }],
          ["AWS/ApiGateway", "Latency", "ApiId", var.api_id, "Stage", var.api_stage_name, { stat = "p95" }],
        ]
      }
    },
    {
      type   = "metric"
      x      = 0
      y      = 6
      width  = 12
      height = 6
      properties = {
        region  = var.region
        view    = "timeSeries"
        stacked = false
        period  = 300
        title   = "core-vpc Invocations / Errors / Throttles"
        metrics = [
          ["AWS/Lambda", "Invocations", "FunctionName", var.core_vpc_function_name, { stat = "Sum" }],
          ["AWS/Lambda", "Errors", "FunctionName", var.core_vpc_function_name, { stat = "Sum" }],
          ["AWS/Lambda", "Throttles", "FunctionName", var.core_vpc_function_name, { stat = "Sum" }],
        ]
      }
    },
    {
      type   = "metric"
      x      = 12
      y      = 6
      width  = 12
      height = 6
      properties = {
        region  = var.region
        view    = "timeSeries"
        stacked = false
        period  = 300
        title   = "core-vpc Duration p50 / p95 / max"
        metrics = [
          ["AWS/Lambda", "Duration", "FunctionName", var.core_vpc_function_name, { stat = "p50" }],
          ["AWS/Lambda", "Duration", "FunctionName", var.core_vpc_function_name, { stat = "p95" }],
          ["AWS/Lambda", "Duration", "FunctionName", var.core_vpc_function_name, { stat = "Maximum" }],
        ]
      }
    },
    {
      type   = "metric"
      x      = 0
      y      = 12
      width  = 12
      height = 6
      properties = {
        region  = var.region
        view    = "timeSeries"
        stacked = false
        period  = 300
        title   = "worker Invocations / Errors / Duration"
        metrics = [
          ["AWS/Lambda", "Invocations", "FunctionName", var.worker_function_name, { stat = "Sum" }],
          ["AWS/Lambda", "Errors", "FunctionName", var.worker_function_name, { stat = "Sum" }],
          ["AWS/Lambda", "Duration", "FunctionName", var.worker_function_name, { stat = "p95" }],
        ]
      }
    },
    {
      type   = "metric"
      x      = 12
      y      = 12
      width  = 12
      height = 6
      properties = {
        region  = var.region
        view    = "timeSeries"
        stacked = false
        period  = 300
        title   = "SQS oldest age / DLQ visible"
        metrics = [
          ["AWS/SQS", "ApproximateAgeOfOldestMessage", "QueueName", var.publish_queue_name, { stat = "Maximum" }],
          ["AWS/SQS", "ApproximateNumberOfMessagesVisible", "QueueName", var.publish_dlq_name, { stat = "Maximum" }],
        ]
      }
    },
    {
      type   = "metric"
      x      = 0
      y      = 18
      width  = 12
      height = 6
      properties = {
        region  = var.region
        view    = "timeSeries"
        stacked = false
        period  = 300
        title   = "RDS CPU / Connections"
        metrics = [
          ["AWS/RDS", "CPUUtilization", "DBInstanceIdentifier", var.db_identifier, { stat = "Average" }],
          ["AWS/RDS", "DatabaseConnections", "DBInstanceIdentifier", var.db_identifier, { stat = "Maximum" }],
        ]
      }
    },
    {
      type   = "metric"
      x      = 12
      y      = 18
      width  = 12
      height = 6
      properties = {
        region  = var.region
        view    = "timeSeries"
        stacked = false
        period  = 300
        title   = "RDS FreeStorageSpace / FreeableMemory"
        metrics = [
          ["AWS/RDS", "FreeStorageSpace", "DBInstanceIdentifier", var.db_identifier, { stat = "Minimum" }],
          ["AWS/RDS", "FreeableMemory", "DBInstanceIdentifier", var.db_identifier, { stat = "Minimum" }],
        ]
      }
    },
    {
      type   = "metric"
      x      = 0
      y      = 24
      width  = 12
      height = 6
      properties = {
        region  = var.region
        view    = "timeSeries"
        stacked = false
        period  = 3600
        title   = "OutboxPending"
        metrics = [
          [var.metrics_namespace, "OutboxPending", { stat = "Maximum" }],
        ]
      }
    },
    {
      type   = "metric"
      x      = 12
      y      = 24
      width  = 12
      height = 6
      properties = {
        region  = var.region
        view    = "timeSeries"
        stacked = false
        period  = 300
        title   = "Latency p95 by Route (top 10)"
        metrics = [
          [{ expression = "SORT(SEARCH('{${var.metrics_namespace},Method,Route,Service} MetricName=\"Latency\"', 'p95', 300), MAX, DESC, 10)", label = "p95 by route", id = "top" }],
        ]
      }
    },
    {
      type   = "text"
      x      = 0
      y      = 30
      width  = 24
      height = 2
      properties = {
        markdown = "## SLOs (R18H) — rolling 28 days: API availability 99.5 %, sync latency 95 % ≤ 2 s, publish success 95 %; fast burn ≥ 14.4, slow burn ≥ 6"
      }
    },
    {
      type   = "metric"
      x      = 0
      y      = 32
      width  = 8
      height = 4
      properties = {
        region               = var.region
        view                 = "singleValue"
        stacked              = false
        period               = 3600
        setPeriodToTimeRange = true
        start                = "-PT672H"
        end                  = "P0D"
        title                = "API availability error budget remaining %"
        metrics = [
          ["AWS/ApiGateway", "5xx", "ApiId", var.api_id, "Stage", var.api_stage_name, { stat = "Sum", id = "e5xx", visible = false }],
          ["AWS/ApiGateway", "Count", "ApiId", var.api_id, "Stage", var.api_stage_name, { stat = "Sum", id = "total", visible = false }],
          [{ expression = "FILL(e5xx, 0)", id = "bad", visible = false }],
          [{ expression = "100 * (1 - (bad / total) / 0.005)", label = "API availability budget remaining %", id = "budget" }],
        ]
      }
    },
    {
      type   = "metric"
      x      = 8
      y      = 32
      width  = 8
      height = 4
      properties = {
        region               = var.region
        view                 = "singleValue"
        stacked              = false
        period               = 3600
        setPeriodToTimeRange = true
        start                = "-PT672H"
        end                  = "P0D"
        title                = "Sync latency error budget remaining %"
        metrics = concat(
          [for q in local.slo_sync_metrics : [var.metrics_namespace, "Latency", "Service", "core-vpc", "Route", q.route, "Method", q.method, { stat = q.stat, id = q.id, visible = false }]],
          [
            [{ expression = local.slo_sync_total, id = "total", visible = false }],
            [{ expression = local.slo_sync_bad, id = "bad", visible = false }],
            [{ expression = "100 * (1 - (bad / total) / 0.05)", label = "Sync latency budget remaining %", id = "budget" }],
          ],
        )
      }
    },
    {
      type   = "metric"
      x      = 16
      y      = 32
      width  = 8
      height = 4
      properties = {
        region               = var.region
        view                 = "singleValue"
        stacked              = false
        period               = 3600
        setPeriodToTimeRange = true
        start                = "-PT672H"
        end                  = "P0D"
        title                = "Publish success error budget remaining %"
        metrics = [
          [var.metrics_namespace, "PublishJobsSucceeded", { stat = "Sum", id = "succeeded", visible = false }],
          [var.metrics_namespace, "PublishJobsFailed", { stat = "Sum", id = "failed", visible = false }],
          [{ expression = "FILL(succeeded, 0)", id = "good", visible = false }],
          [{ expression = "FILL(failed, 0)", id = "bad", visible = false }],
          [{ expression = "good + bad", id = "total", visible = false }],
          [{ expression = "100 * (1 - (bad / total) / 0.05)", label = "Publish success budget remaining %", id = "budget" }],
        ]
      }
    },
    {
      type   = "metric"
      x      = 0
      y      = 36
      width  = 8
      height = 6
      properties = {
        region      = var.region
        view        = "timeSeries"
        stacked     = false
        period      = 3600
        title       = "API availability burn rate (1 h)"
        annotations = { horizontal = [{ value = 14.4, label = "fast" }, { value = 6, label = "slow" }] }
        metrics = [
          ["AWS/ApiGateway", "5xx", "ApiId", var.api_id, "Stage", var.api_stage_name, { stat = "Sum", id = "e5xx", visible = false }],
          ["AWS/ApiGateway", "Count", "ApiId", var.api_id, "Stage", var.api_stage_name, { stat = "Sum", id = "total", visible = false }],
          [{ expression = "FILL(e5xx, 0)", id = "bad", visible = false }],
          [{ expression = "IF(total >= 10 AND bad >= 2, (bad / total) / 0.005, 0)", label = "burn rate (1 h)", id = "burn" }],
        ]
      }
    },
    {
      type   = "metric"
      x      = 8
      y      = 36
      width  = 8
      height = 6
      properties = {
        region      = var.region
        view        = "timeSeries"
        stacked     = false
        period      = 3600
        title       = "Sync latency burn rate (1 h)"
        annotations = { horizontal = [{ value = 14.4, label = "fast" }, { value = 6, label = "slow" }] }
        metrics = concat(
          [for q in local.slo_sync_metrics : [var.metrics_namespace, "Latency", "Service", "core-vpc", "Route", q.route, "Method", q.method, { stat = q.stat, id = q.id, visible = false }]],
          [
            [{ expression = local.slo_sync_total, id = "total", visible = false }],
            [{ expression = local.slo_sync_bad, id = "bad", visible = false }],
            [{ expression = "IF(total >= 6, (bad / total) / 0.05, 0)", label = "burn rate (1 h)", id = "burn" }],
          ],
        )
      }
    },
    {
      type   = "metric"
      x      = 16
      y      = 36
      width  = 8
      height = 6
      properties = {
        region      = var.region
        view        = "timeSeries"
        stacked     = false
        period      = 3600
        title       = "Publish success burn rate (1 h)"
        annotations = { horizontal = [{ value = 14.4, label = "fast" }, { value = 6, label = "slow" }] }
        metrics = [
          [var.metrics_namespace, "PublishJobsSucceeded", { stat = "Sum", id = "succeeded", visible = false }],
          [var.metrics_namespace, "PublishJobsFailed", { stat = "Sum", id = "failed", visible = false }],
          [{ expression = "FILL(succeeded, 0)", id = "good", visible = false }],
          [{ expression = "FILL(failed, 0)", id = "bad", visible = false }],
          [{ expression = local.slo_publish_burn, label = "burn rate (1 h)", id = "burn" }],
        ]
      }
    },
    {
      type   = "metric"
      x      = 0
      y      = 42
      width  = 12
      height = 6
      properties = {
        region  = var.region
        view    = "timeSeries"
        stacked = false
        period  = 900
        title   = "Synthetic check success"
        metrics = [
          [var.metrics_namespace, "SyntheticCheckSuccess", "Service", "synthetic-check", { stat = "Minimum", id = "success" }],
        ]
      }
    },
    {
      type   = "metric"
      x      = 12
      y      = 42
      width  = 12
      height = 6
      properties = {
        region  = var.region
        view    = "timeSeries"
        stacked = false
        period  = 900
        title   = "Synthetic check latency"
        metrics = [
          [var.metrics_namespace, "SyntheticCheckLatency", "Service", "synthetic-check", { stat = "p50", id = "latp50" }],
          [var.metrics_namespace, "SyntheticCheckLatency", "Service", "synthetic-check", { stat = "Maximum", id = "latmax" }],
        ]
      }
    },
  ]
}

resource "aws_cloudwatch_dashboard" "prod" {
  dashboard_name = "developercards-${var.env}"
  dashboard_body = jsonencode({ widgets = local.dashboard_widgets })
}
