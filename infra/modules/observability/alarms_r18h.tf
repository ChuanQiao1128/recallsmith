# R18H H05 — synthetic check alarm (H00 §5.4). Created with actions disabled because the schedule starts DISABLED; the supervisor enables its actions after two good runs (H00 §8.2 step 6) and Terraform ignores actions_enabled from then on.

resource "aws_cloudwatch_metric_alarm" "synthetic_check_failing" {
  alarm_name          = "developercards-${var.env}-synthetic-check-failing"
  alarm_description   = "The synthetic check failed, or did not run, in two consecutive 15-minute periods (SyntheticCheckSuccess maximum below 1)."
  namespace           = var.metrics_namespace
  metric_name         = "SyntheticCheckSuccess"
  statistic           = "Maximum"
  dimensions          = { Service = "synthetic-check" }
  comparison_operator = "LessThanThreshold"
  threshold           = 1
  period              = 900
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
