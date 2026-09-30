locals {
  # Q1 (R18I I03): a budget reads 100 % until its 28-day window holds this many events, so one bad event is at most
  # 10 % of the budget (N = 10 / budget); the widget shows the event count beside it.
  slo_budget_min_events = {
    api     = 2000
    sync    = 200
    publish = 200
  }
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
          ["AWS/ApiGateway", "Count", "ApiId", var.api_id, "Stage", var.api_stage_name, "Resource", "/health", "Method", "GET", { stat = "Sum", id = "hc", visible = false }],
          ["AWS/ApiGateway", "5xx", "ApiId", var.api_id, "Stage", var.api_stage_name, "Resource", "/health", "Method", "GET", { stat = "Sum", id = "h5xx", visible = false }],
          ["AWS/ApiGateway", "4xx", "ApiId", var.api_id, "Stage", var.api_stage_name, "Resource", "/api/v1/me", "Method", "GET", { stat = "Sum", id = "m4xx", visible = false }],
          [{ expression = local.slo_api_user_total, label = "requests in window, synthetic check excluded (budget counts from ${local.slo_budget_min_events.api})", id = "user_total" }],
          [{ expression = local.slo_api_user_bad, id = "user_bad", visible = false }],
          [{ expression = "IF(user_total >= ${local.slo_budget_min_events.api}, 100 * (1 - (user_bad / user_total) / 0.005), 100)", label = "API availability budget remaining % (synthetic check excluded)", id = "budget" }],
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
            [{ expression = local.slo_sync_total, label = "sync requests in window (budget counts from ${local.slo_budget_min_events.sync})", id = "total" }],
            [{ expression = local.slo_sync_bad, id = "bad", visible = false }],
            [{ expression = "IF(total >= ${local.slo_budget_min_events.sync}, 100 * (1 - (bad / total) / 0.05), 100)", label = "Sync latency budget remaining %", id = "budget" }],
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
          [{ expression = "good + bad", label = "publish jobs in window (budget counts from ${local.slo_budget_min_events.publish})", id = "total" }],
          [{ expression = "IF(total >= ${local.slo_budget_min_events.publish}, 100 * (1 - (bad / total) / 0.05), 100)", label = "Publish success budget remaining %", id = "budget" }],
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
          [{ expression = "IF(total >= 16 AND bad >= 2, (bad / total) / 0.005, 0)", label = "burn rate (1 h)", id = "burn" }],
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
    {
      type   = "metric"
      x      = 0
      y      = 48
      width  = 12
      height = 6
      properties = {
        region  = var.region
        view    = "timeSeries"
        stacked = false
        period  = 300
        title   = "API 5xx by route (top 10)"
        metrics = [
          [{ expression = "SORT(SEARCH('{AWS/ApiGateway,ApiId,Method,Resource,Stage} MetricName=\"5xx\" ApiId=\"${var.api_id}\" Stage=\"${var.api_stage_name}\"', 'Sum', 300), SUM, DESC, 10)", label = "5xx by route", id = "top5xx" }],
        ]
      }
    },
    {
      type   = "text"
      x      = 0
      y      = 54
      width  = 24
      height = 2
      properties = {
        markdown = "## AI QA (R20 V12) — ai-qa EMF, namespace ${var.metrics_namespace}, Service = ai-qa; usage metrics only when the model was called; p95 latency alarm per provider at 120 s"
      }
    },
    {
      type   = "metric"
      x      = 0
      y      = 56
      width  = 12
      height = 6
      properties = {
        region  = var.region
        view    = "timeSeries"
        stacked = false
        period  = 300
        title   = "AI QA cards reviewed by Provider"
        metrics = [
          [{ expression = "SEARCH('{${var.metrics_namespace},Provider,Service} Service=\"ai-qa\" MetricName=\"AiQaCardsReviewed\"', 'Sum', 300)", id = "cards" }],
        ]
      }
    },
    {
      type   = "metric"
      x      = 12
      y      = 56
      width  = 12
      height = 6
      properties = {
        region  = var.region
        view    = "timeSeries"
        stacked = false
        period  = 300
        title   = "AI QA tokens by Provider (input / output / cache read)"
        metrics = [
          [{ expression = "SEARCH('{${var.metrics_namespace},Provider,Service} Service=\"ai-qa\" MetricName=\"AiQaInputTokens\"', 'Sum', 300)", label = "input", id = "tok_in" }],
          [{ expression = "SEARCH('{${var.metrics_namespace},Provider,Service} Service=\"ai-qa\" MetricName=\"AiQaOutputTokens\"', 'Sum', 300)", label = "output", id = "tok_out" }],
          [{ expression = "SEARCH('{${var.metrics_namespace},Provider,Service} Service=\"ai-qa\" MetricName=\"AiQaCacheReadTokens\"', 'Sum', 300)", label = "cache read", id = "tok_cache" }],
        ]
      }
    },
    {
      # AiQaEstimatedCostMicroUsd is micro-USD; the expressions divide by 1 000 000. Same providers as the
      # ai_qa_daily_cost alarm (alarms_r18.tf), whose threshold is the daily cap.
      type   = "metric"
      x      = 0
      y      = 62
      width  = 12
      height = 6
      properties = {
        region  = var.region
        view    = "timeSeries"
        stacked = false
        period  = 86400
        title   = "AI QA estimated cost per day (USD)"
        metrics = concat(
          [for p in local.ai_qa_providers :
            [var.metrics_namespace, "AiQaEstimatedCostMicroUsd", "Service", "ai-qa", "Provider", p, { id = "cost_${replace(p, "-", "_")}", visible = false, stat = "Sum", period = 86400 }]
          ],
          [for p in local.ai_qa_providers :
            [{ expression = "FILL(cost_${replace(p, "-", "_")}, 0) / 1000000", label = "${p} USD", id = "usd_${replace(p, "-", "_")}" }]
          ],
          [[{ expression = "(${join(" + ", [for p in local.ai_qa_providers : "FILL(cost_${replace(p, "-", "_")}, 0)"])}) / 1000000", label = "total USD (daily cap: ${var.ai_qa_daily_cost_cap_micro_usd / 1000000})", id = "usd_total" }]],
        )
      }
    },
    {
      type   = "metric"
      x      = 12
      y      = 62
      width  = 12
      height = 6
      properties = {
        region  = var.region
        view    = "timeSeries"
        stacked = false
        period  = 300
        title   = "AI QA latency p50 / p95 by Provider"
        metrics = concat(
          [for p in local.ai_qa_providers : [var.metrics_namespace, "AiQaLatency", "Service", "ai-qa", "Provider", p, { stat = "p50", id = "lat_p50_${replace(p, "-", "_")}" }]],
          [for p in local.ai_qa_providers : [var.metrics_namespace, "AiQaLatency", "Service", "ai-qa", "Provider", p, { stat = "p95", id = "lat_p95_${replace(p, "-", "_")}" }]],
        )
        annotations = { horizontal = [{ label = "p95 alarm", value = 120000 }] }
      }
    },
    {
      type   = "metric"
      x      = 0
      y      = 68
      width  = 12
      height = 6
      properties = {
        region  = var.region
        view    = "timeSeries"
        stacked = false
        period  = 300
        title   = "AI QA errors by ErrorCode"
        metrics = [
          [{ expression = "SEARCH('{${var.metrics_namespace},ErrorCode,Service} Service=\"ai-qa\" MetricName=\"AiQaErrors\"', 'Sum', 300)", id = "errors" }],
        ]
      }
    },
    {
      type   = "metric"
      x      = 12
      y      = 68
      width  = 12
      height = 6
      properties = {
        region  = var.region
        view    = "timeSeries"
        stacked = false
        period  = 300
        title   = "AI QA findings by Severity"
        metrics = [
          for s in ["blocker", "major", "minor"] :
          [var.metrics_namespace, "AiQaFindings", "Service", "ai-qa", "Severity", s, { stat = "Sum", id = "findings_${s}" }]
        ]
      }
    },
    {
      type   = "metric"
      x      = 0
      y      = 74
      width  = 12
      height = 6
      properties = {
        region  = var.region
        view    = "timeSeries"
        stacked = false
        period  = 3600
        title   = "AI QA refusals"
        metrics = [
          [var.metrics_namespace, "AiQaRefusals", "Service", "ai-qa", { stat = "Sum", id = "refusals" }],
        ]
        annotations = { horizontal = [{ label = "alarm (3 / h)", value = 3 }] }
      }
    },
  ]
}

resource "aws_cloudwatch_dashboard" "prod" {
  dashboard_name = "developercards-${var.env}"
  dashboard_body = jsonencode({ widgets = local.dashboard_widgets })
}
