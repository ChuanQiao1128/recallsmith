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
  ]
}

resource "aws_cloudwatch_dashboard" "prod" {
  dashboard_name = "developercards-${var.env}"
  dashboard_body = jsonencode({ widgets = local.dashboard_widgets })
}
