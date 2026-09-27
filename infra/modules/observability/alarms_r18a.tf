# R18A A10 — automation alarms on the existing alerts topic (A00 §17.2).

resource "aws_cloudwatch_metric_alarm" "notify_dlq_nonempty" {
  alarm_name          = "developercards-${var.env}-notify-dlq-nonempty"
  alarm_description   = "The notify dead-letter queue holds at least one message."
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateNumberOfMessagesVisible"
  statistic           = "Maximum"
  dimensions          = { QueueName = var.notify_dlq_name }
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = 1
  period              = 60
  evaluation_periods  = 1
  datapoints_to_alarm = 1
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
}

resource "aws_cloudwatch_metric_alarm" "notifier_errors" {
  alarm_name          = "developercards-${var.env}-notifier-errors"
  alarm_description   = "The notifier function reported at least one error in a five-minute period."
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  statistic           = "Sum"
  dimensions          = { FunctionName = var.notifier_function_name }
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = 1
  period              = 300
  evaluation_periods  = 1
  datapoints_to_alarm = 1
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
}

resource "aws_cloudwatch_metric_alarm" "source_watcher_errors" {
  alarm_name          = "developercards-${var.env}-source-watcher-errors"
  alarm_description   = "The source-watcher function reported at least one error in an hour."
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  statistic           = "Sum"
  dimensions          = { FunctionName = var.source_watcher_function_name }
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = 1
  period              = 3600
  evaluation_periods  = 1
  datapoints_to_alarm = 1
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
}

# The tick runs in every automation mode, so two silent hours mean the scheduler or its role broke. Created with
# actions disabled because the schedules start DISABLED; the supervisor enables its actions together with the
# schedules (infra/RUNBOOK.md §7), and Terraform ignores actions_enabled from then on.
resource "aws_cloudwatch_metric_alarm" "automation_tick_missing" {
  alarm_name          = "developercards-${var.env}-automation-tick-missing"
  alarm_description   = "The notifier was not invoked for two consecutive hours (the 15-minute automation tick stopped)."
  namespace           = "AWS/Lambda"
  metric_name         = "Invocations"
  statistic           = "Sum"
  dimensions          = { FunctionName = var.notifier_function_name }
  comparison_operator = "LessThanThreshold"
  threshold           = 1
  period              = 3600
  evaluation_periods  = 2
  datapoints_to_alarm = 2
  treat_missing_data  = "breaching"
  actions_enabled     = false
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
  lifecycle {
    ignore_changes = [actions_enabled]
  }
}

resource "aws_cloudwatch_metric_alarm" "notification_failures" {
  alarm_name          = "developercards-${var.env}-notification-failures"
  alarm_description   = "The notifier failed to deliver at least one notification in an hour."
  namespace           = var.metrics_namespace
  metric_name         = "NotificationFailures"
  statistic           = "Sum"
  dimensions          = { Service = "notifier" }
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = 1
  period              = 3600
  evaluation_periods  = 1
  datapoints_to_alarm = 1
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
}

resource "aws_cloudwatch_metric_alarm" "automation_notify_enqueue_failures" {
  alarm_name          = "developercards-${var.env}-automation-notify-enqueue-failures"
  alarm_description   = "core-vpc failed to enqueue at least one automation email on the notify queue in a five-minute period."
  namespace           = var.metrics_namespace
  metric_name         = "AutomationNotifyEnqueueFailures"
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
