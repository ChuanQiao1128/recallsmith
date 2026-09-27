# R18 J05 — outbound-webhook alarms on the existing alerts topic.

resource "aws_cloudwatch_metric_alarm" "webhook_dlq_nonempty" {
  alarm_name          = "developercards-${var.env}-webhook-dlq-nonempty"
  alarm_description   = "The webhook dead-letter queue holds at least one message."
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateNumberOfMessagesVisible"
  statistic           = "Maximum"
  dimensions          = { QueueName = var.webhook_dlq_name }
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = 1
  period              = 60
  evaluation_periods  = 1
  datapoints_to_alarm = 1
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
}

resource "aws_cloudwatch_metric_alarm" "webhook_dispatcher_errors" {
  alarm_name          = "developercards-${var.env}-webhook-dispatcher-errors"
  alarm_description   = "The webhook dispatcher function reported at least one error in a five-minute period."
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  statistic           = "Sum"
  dimensions          = { FunctionName = var.webhook_dispatcher_function_name }
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = 1
  period              = 300
  evaluation_periods  = 1
  datapoints_to_alarm = 1
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
}

# R18 J15 — AI QA alarms on the existing alerts topic.

resource "aws_cloudwatch_metric_alarm" "ai_qa_dlq_nonempty" {
  alarm_name          = "developercards-${var.env}-ai-qa-dlq-nonempty"
  alarm_description   = "The AI QA dead-letter queue holds at least one message."
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateNumberOfMessagesVisible"
  statistic           = "Maximum"
  dimensions          = { QueueName = var.ai_qa_dlq_name }
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = 1
  period              = 60
  evaluation_periods  = 1
  datapoints_to_alarm = 1
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
}

resource "aws_cloudwatch_metric_alarm" "ai_qa_errors" {
  alarm_name          = "developercards-${var.env}-ai-qa-errors"
  alarm_description   = "The AI QA function reported at least one error in a five-minute period."
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  statistic           = "Sum"
  dimensions          = { FunctionName = var.ai_qa_function_name }
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = 1
  period              = 300
  evaluation_periods  = 1
  datapoints_to_alarm = 1
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
}

# R18 X08 — alarms on the failure metrics the handlers emit and then swallow (acked message,
# handled batch-item failure, best-effort write). Lambda Errors never sees these, so each one
# needs its own alarm. Dimensions are copied from the emitters and must stay equal to them:
#   core-vpc / worker  RouteMetrics.EmitGauge(name, value)  -> no dimensions
#   webhook-dispatcher emf.emit                             -> Service (+ Outcome)
#   ai-qa              emf.emit                             -> Service (+ ErrorCode | Provider)
# Thresholds and periods: infra/README.md §6 (2026-09-27 X08); runbook: infra/RUNBOOK.md §7.

locals {
  # AiQaErrors codes that retrying cannot fix: every chunk of every run fails until the owner acts.
  ai_qa_fatal_error_codes = toset(["PROVIDER_AUTH", "PROVIDER_ACCESS_DENIED", "CONFIG"])
}

resource "aws_cloudwatch_metric_alarm" "webhook_delivery_failed" {
  alarm_name          = "developercards-${var.env}-webhook-delivery-failed"
  alarm_description   = "A webhook receiver answered a permanent (non-retryable) error, e.g. 401 after a secret mismatch, 404 or 410. The message was acked, so it never reaches the DLQ."
  namespace           = var.metrics_namespace
  metric_name         = "WebhookDeliveryAttempts"
  statistic           = "Sum"
  dimensions          = { Service = "webhook-dispatcher", Outcome = "failed" }
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = 1
  period              = 300
  evaluation_periods  = 1
  datapoints_to_alarm = 1
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
}

resource "aws_cloudwatch_metric_alarm" "webhook_delivery_dead" {
  alarm_name          = "developercards-${var.env}-webhook-delivery-dead"
  alarm_description   = "A webhook delivery gave up after its last retryable attempt (Outcome=dead)."
  namespace           = var.metrics_namespace
  metric_name         = "WebhookDeliveryAttempts"
  statistic           = "Sum"
  dimensions          = { Service = "webhook-dispatcher", Outcome = "dead" }
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = 1
  period              = 300
  evaluation_periods  = 1
  datapoints_to_alarm = 1
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
}

resource "aws_cloudwatch_metric_alarm" "webhook_report_failures" {
  alarm_name          = "developercards-${var.env}-webhook-report-failures"
  alarm_description   = "The webhook dispatcher could not report a delivery attempt to core-vpc, so the delivery row is stale."
  namespace           = var.metrics_namespace
  metric_name         = "WebhookReportFailures"
  statistic           = "Sum"
  dimensions          = { Service = "webhook-dispatcher" }
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = 1
  period              = 900
  evaluation_periods  = 1
  datapoints_to_alarm = 1
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
}

resource "aws_cloudwatch_metric_alarm" "webhook_enqueue_failures" {
  alarm_name          = "developercards-${var.env}-webhook-enqueue-failures"
  alarm_description   = "core-vpc or the worker could not send a webhook event to SQS; the event is lost for every subscription."
  namespace           = var.metrics_namespace
  metric_name         = "WebhookEnqueueFailures"
  statistic           = "Sum"
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = 1
  period              = 300
  evaluation_periods  = 1
  datapoints_to_alarm = 1
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
}

resource "aws_cloudwatch_metric_alarm" "ledger_write_failures" {
  alarm_name          = "developercards-${var.env}-ledger-write-failures"
  alarm_description   = "A best-effort automation ledger write was dropped by core-vpc or the worker."
  namespace           = var.metrics_namespace
  metric_name         = "LedgerWriteFailures"
  statistic           = "Sum"
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = 1
  period              = 300
  evaluation_periods  = 1
  datapoints_to_alarm = 1
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
}

resource "aws_cloudwatch_metric_alarm" "ai_qa_enqueue_failures" {
  alarm_name          = "developercards-${var.env}-ai-qa-enqueue-failures"
  alarm_description   = "core-vpc could not send an AI QA run's chunks to SQS."
  namespace           = var.metrics_namespace
  metric_name         = "AiQaEnqueueFailures"
  statistic           = "Sum"
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = 1
  period              = 300
  evaluation_periods  = 1
  datapoints_to_alarm = 1
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
}

resource "aws_cloudwatch_metric_alarm" "ai_qa_fatal_errors" {
  for_each            = local.ai_qa_fatal_error_codes
  alarm_name          = "developercards-${var.env}-ai-qa-error-${lower(replace(each.key, "_", "-"))}"
  alarm_description   = "The AI QA function failed a chunk with ${each.key}; retrying cannot fix it, so every run fails until the provider access or configuration is corrected."
  namespace           = var.metrics_namespace
  metric_name         = "AiQaErrors"
  statistic           = "Sum"
  dimensions          = { Service = "ai-qa", ErrorCode = each.key }
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = 1
  period              = 300
  evaluation_periods  = 1
  datapoints_to_alarm = 1
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
}

resource "aws_cloudwatch_metric_alarm" "ai_qa_refusals" {
  alarm_name          = "developercards-${var.env}-ai-qa-refusals"
  alarm_description   = "The AI QA model refused to review at least three cards within an hour."
  namespace           = var.metrics_namespace
  metric_name         = "AiQaRefusals"
  statistic           = "Sum"
  dimensions          = { Service = "ai-qa" }
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = 3
  period              = 3600
  evaluation_periods  = 1
  datapoints_to_alarm = 1
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
}

# Spend past the daily cap. The AWS budget cannot see the Anthropic-API provider, and core-vpc
# only checks the cap before a run starts, so one large run can still overshoot it.
resource "aws_cloudwatch_metric_alarm" "ai_qa_daily_cost" {
  alarm_name          = "developercards-${var.env}-ai-qa-daily-cost"
  alarm_description   = "AI QA estimated model spend over one day exceeded the daily cap (AI_QA_DAILY_USD_CAP)."
  comparison_operator = "GreaterThanThreshold"
  threshold           = var.ai_qa_daily_cost_cap_micro_usd
  evaluation_periods  = 1
  datapoints_to_alarm = 1
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]

  metric_query {
    id          = "total"
    expression  = "SUM(METRICS())"
    label       = "AiQaEstimatedCostMicroUsd (all providers)"
    return_data = true
  }

  dynamic "metric_query" {
    for_each = ["bedrock", "anthropic"]
    content {
      id = "cost_${metric_query.value}"
      metric {
        namespace   = var.metrics_namespace
        metric_name = "AiQaEstimatedCostMicroUsd"
        dimensions  = { Service = "ai-qa", Provider = metric_query.value }
        stat        = "Sum"
        period      = 86400
      }
    }
  }
}

resource "aws_cloudwatch_metric_alarm" "webhook_queue_oldest_age" {
  alarm_name          = "developercards-${var.env}-webhook-queue-oldest-age"
  alarm_description   = "The oldest message on the webhook events queue is older than one hour (the retry schedule spans about 26 minutes)."
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateAgeOfOldestMessage"
  statistic           = "Maximum"
  dimensions          = { QueueName = var.webhook_queue_name }
  comparison_operator = "GreaterThanThreshold"
  threshold           = 3600
  period              = 300
  evaluation_periods  = 1
  datapoints_to_alarm = 1
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
}

resource "aws_cloudwatch_metric_alarm" "ai_qa_queue_oldest_age" {
  alarm_name          = "developercards-${var.env}-ai-qa-queue-oldest-age"
  alarm_description   = "The oldest message on the AI QA jobs queue is older than two hours (two receives of the 3600 s visibility)."
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateAgeOfOldestMessage"
  statistic           = "Maximum"
  dimensions          = { QueueName = var.ai_qa_queue_name }
  comparison_operator = "GreaterThanThreshold"
  threshold           = 7200
  period              = 300
  evaluation_periods  = 1
  datapoints_to_alarm = 1
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
}
