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

# R18C (cloud-security-resilience-11): the notify queue carries every exception email. A consumer that stops
# (the email mapping left disabled after RUNBOOK §7 step 2, or a mapping that no longer invokes) raises no
# error, no DLQ entry and no tick-missing alarm, and core does not re-send a queued message (K6), so it would
# expire after the 4-day retention unseen. Same shape as webhook/ai-qa-queue-oldest-age. A healthy message is
# gone within seconds; one that keeps failing reaches the DLQ after 5 receives x 180 s, well under 1800 s.
resource "aws_cloudwatch_metric_alarm" "notify_queue_oldest_age" {
  alarm_name          = "developercards-${var.env}-notify-queue-oldest-age"
  alarm_description   = "The oldest message on the notify queue is at least 30 minutes old: the email consumer is not draining it (check the notify event source mapping is Enabled)."
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateAgeOfOldestMessage"
  statistic           = "Maximum"
  dimensions          = { QueueName = var.notify_queue_name }
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = 1800
  period              = 300
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

# The tick runs in every automation mode, so two silent hours mean the scheduler or its role broke. R18B K5: it
# watches the notifier's own heartbeat AutomationTicks (one per tick invocation, whatever core answers; emitted
# with Service = notifier only), not the function's Invocations, which SQS email deliveries also count. Created
# with actions disabled because the schedules start DISABLED; the supervisor enables its actions together with the
# schedules (infra/RUNBOOK.md §7), and Terraform ignores actions_enabled from then on.
resource "aws_cloudwatch_metric_alarm" "automation_tick_missing" {
  alarm_name          = "developercards-${var.env}-automation-tick-missing"
  alarm_description   = "The notifier emitted no AutomationTicks heartbeat for two consecutive hours (the 15-minute automation tick stopped)."
  namespace           = var.metrics_namespace
  metric_name         = "AutomationTicks"
  statistic           = "Sum"
  dimensions          = { Service = "notifier" }
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

# R18B K4: core-vpc emits the dimensionless gauge AutomationStepFailures (same convention as
# AutomationNotifyEnqueueFailures) from every swallowed automation failure: tick steps, run finalisation, publish
# evaluation/reconcile and draft-QA after-commit hooks. The tick still answers 200, so this is the only signal.
resource "aws_cloudwatch_metric_alarm" "automation_step_failures" {
  alarm_name          = "developercards-${var.env}-automation-step-failures"
  alarm_description   = "core-vpc swallowed at least one automation step failure (tick step, finalisation, publish evaluation/reconcile or draft-QA hook) in an hour."
  namespace           = var.metrics_namespace
  metric_name         = "AutomationStepFailures"
  statistic           = "Sum"
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = 1
  period              = 3600
  evaluation_periods  = 1
  datapoints_to_alarm = 1
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
}
