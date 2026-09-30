# R20 V12: the AI QA dashboard row and the per-provider p95 latency alarms. Offline only: the aws
# provider is mocked, so this never reaches AWS. Run from the module directory:
#   terraform -chdir=infra/modules/observability init -backend=false -input=false
#   terraform -chdir=infra/modules/observability test

mock_provider "aws" {}

variables {
  env                              = "prod"
  account_id                       = "000000000000"
  budget_name                      = "test-budget"
  budget_limit                     = "60"
  alert_email                      = "alerts@example.com"
  region                           = "ap-southeast-2"
  api_id                           = "testapi"
  api_name                         = "developercards-api"
  core_vpc_function_name           = "core-vpc"
  worker_function_name             = "worker-lambda"
  publish_queue_name               = "publish"
  publish_dlq_name                 = "publish-dlq"
  db_identifier                    = "developercards"
  webhook_queue_name               = "webhook"
  webhook_dlq_name                 = "webhook-dlq"
  webhook_dispatcher_function_name = "webhook-dispatcher"
  ai_qa_queue_name                 = "ai-qa"
  ai_qa_dlq_name                   = "ai-qa-dlq"
  ai_qa_function_name              = "ai-qa"
  notify_queue_name                = "notify"
  notify_dlq_name                  = "notify-dlq"
  notifier_function_name           = "notifier"
  source_watcher_function_name     = "source-watcher"
}

run "ai_qa_latency_p95_alarm_per_provider" {
  command = plan

  assert {
    condition     = toset(keys(aws_cloudwatch_metric_alarm.ai_qa_latency_p95)) == toset(["bedrock", "anthropic", "bedrock-converse", "openai-mantle"])
    error_message = "expected one p95 latency alarm per ai-qa provider"
  }

  assert {
    condition = alltrue([for p, a in aws_cloudwatch_metric_alarm.ai_qa_latency_p95 : (
      a.alarm_name == "developercards-prod-ai-qa-latency-p95-${p}" &&
      a.namespace == "DeveloperCards" &&
      a.metric_name == "AiQaLatency" &&
      a.extended_statistic == "p95" &&
      a.statistic == null &&
      a.dimensions == tomap({ Service = "ai-qa", Provider = p }) &&
      a.comparison_operator == "GreaterThanThreshold" &&
      a.threshold == 120000 &&
      a.period == 3600 &&
      a.evaluation_periods == 1 &&
      a.datapoints_to_alarm == 1 &&
      a.treat_missing_data == "notBreaching"
    )])
    error_message = "a p95 latency alarm has the wrong metric, statistic, dimensions, threshold or period"
  }

  assert {
    condition = alltrue([for a in aws_cloudwatch_metric_alarm.ai_qa_latency_p95 : (
      a.alarm_actions == toset([aws_sns_topic.alerts.arn]) && a.ok_actions == toset([aws_sns_topic.alerts.arn])
    )])
    error_message = "every p95 latency alarm must notify the alerts topic on ALARM and OK"
  }
}

run "ai_qa_dashboard_row" {
  command = plan

  assert {
    condition = length([for w in jsondecode(aws_cloudwatch_dashboard.prod.dashboard_body).widgets : w
    if w.type == "text" && w.y == 54 && w.x == 0 && w.width == 24 && strcontains(w.properties.markdown, "AI QA")]) == 1
    error_message = "expected one \"AI QA\" text header at y=54"
  }

  assert {
    condition = toset([for w in jsondecode(aws_cloudwatch_dashboard.prod.dashboard_body).widgets : w.properties.title if w.type == "metric" && w.y >= 56]) == toset([
      "AI QA cards reviewed by Provider",
      "AI QA tokens by Provider (input / output / cache read)",
      "AI QA estimated cost per day (USD)",
      "AI QA latency p50 / p95 by Provider",
      "AI QA errors by ErrorCode",
      "AI QA findings by Severity",
      "AI QA refusals",
    ])
    error_message = "the AI QA row is missing a widget"
  }

  assert {
    # No widget in the new row starts above y=56 or overlaps another widget of the row.
    condition = alltrue(flatten([
      for i, a in [for w in jsondecode(aws_cloudwatch_dashboard.prod.dashboard_body).widgets : w if w.y >= 54] : [
        for j, b in [for w in jsondecode(aws_cloudwatch_dashboard.prod.dashboard_body).widgets : w if w.y >= 54] :
        i == j || a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y
      ]
    ]))
    error_message = "two AI QA widgets overlap"
  }

  assert {
    condition = alltrue([for p in ["bedrock", "anthropic", "bedrock-converse", "openai-mantle"] : alltrue([for s in ["p50", "p95"] :
      length([for w in jsondecode(aws_cloudwatch_dashboard.prod.dashboard_body).widgets : w
        if w.type == "metric" && try(w.properties.title, "") == "AI QA latency p50 / p95 by Provider" &&
      contains([for m in w.properties.metrics : jsonencode(m)], jsonencode(["DeveloperCards", "AiQaLatency", "Service", "ai-qa", "Provider", p, { stat = s, id = "lat_${s}_${replace(p, "-", "_")}" }]))]) == 1
    ])])
    error_message = "the latency widget must show AiQaLatency p50 and p95 for every provider"
  }

  assert {
    condition = length([for w in jsondecode(aws_cloudwatch_dashboard.prod.dashboard_body).widgets : w
      if w.type == "metric" && try(w.properties.title, "") == "AI QA estimated cost per day (USD)" &&
      alltrue([for m in w.properties.metrics : try(m[length(m) - 1].period, 0) == 86400 && try(m[length(m) - 1].stat, "") == "Sum" if try(m[1], "") == "AiQaEstimatedCostMicroUsd"]) &&
      length([for m in w.properties.metrics : m if try(m[1], "") == "AiQaEstimatedCostMicroUsd"]) == 4 &&
    length([for m in w.properties.metrics : m if strcontains(try(m[0].expression, ""), "/ 1000000")]) >= 1]) == 1
    error_message = "the cost widget must sum AiQaEstimatedCostMicroUsd per day for every provider and convert it to USD"
  }
}
