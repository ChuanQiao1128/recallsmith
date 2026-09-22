resource "aws_cloudwatch_metric_alarm" "api_5xx" {
  alarm_name          = "developercards-${var.env}-api-5xx"
  alarm_description   = "API Gateway 5xx responses exceed one percent of requests over fifteen minutes."
  comparison_operator = "GreaterThanThreshold"
  threshold           = 0.01
  evaluation_periods  = 3
  datapoints_to_alarm = 2
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]

  metric_query {
    id          = "e5xx"
    return_data = false
    metric {
      namespace   = "AWS/ApiGateway"
      metric_name = "5xx"
      stat        = "Sum"
      period      = 300
      dimensions = {
        ApiId = var.api_id
        Stage = var.api_stage_name
      }
    }
  }

  metric_query {
    id          = "count"
    return_data = false
    metric {
      namespace   = "AWS/ApiGateway"
      metric_name = "Count"
      stat        = "Sum"
      period      = 300
      dimensions = {
        ApiId = var.api_id
        Stage = var.api_stage_name
      }
    }
  }

  metric_query {
    id          = "rate"
    expression  = "IF(count > 20, e5xx/count, 0)"
    label       = "5xx rate"
    return_data = true
  }
}

resource "aws_cloudwatch_metric_alarm" "core_vpc_errors" {
  alarm_name          = "developercards-${var.env}-core-vpc-errors"
  alarm_description   = "The core-vpc function reported at least one error in a five-minute period."
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  statistic           = "Sum"
  dimensions          = { FunctionName = var.core_vpc_function_name }
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = 1
  period              = 300
  evaluation_periods  = 1
  datapoints_to_alarm = 1
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
}

resource "aws_cloudwatch_metric_alarm" "worker_errors" {
  alarm_name          = "developercards-${var.env}-worker-errors"
  alarm_description   = "The worker-lambda function reported at least one error in a five-minute period."
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  statistic           = "Sum"
  dimensions          = { FunctionName = var.worker_function_name }
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = 1
  period              = 300
  evaluation_periods  = 1
  datapoints_to_alarm = 1
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
}

resource "aws_cloudwatch_metric_alarm" "core_vpc_throttles" {
  alarm_name          = "developercards-${var.env}-core-vpc-throttles"
  alarm_description   = "The core-vpc function was throttled at least once in a five-minute period."
  namespace           = "AWS/Lambda"
  metric_name         = "Throttles"
  statistic           = "Sum"
  dimensions          = { FunctionName = var.core_vpc_function_name }
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = 1
  period              = 300
  evaluation_periods  = 1
  datapoints_to_alarm = 1
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
}

resource "aws_cloudwatch_metric_alarm" "worker_throttles" {
  alarm_name          = "developercards-${var.env}-worker-throttles"
  alarm_description   = "The worker-lambda function was throttled at least once in a five-minute period."
  namespace           = "AWS/Lambda"
  metric_name         = "Throttles"
  statistic           = "Sum"
  dimensions          = { FunctionName = var.worker_function_name }
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = 1
  period              = 300
  evaluation_periods  = 1
  datapoints_to_alarm = 1
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
}

resource "aws_cloudwatch_metric_alarm" "core_vpc_duration_p95" {
  alarm_name          = "developercards-${var.env}-core-vpc-duration-p95"
  alarm_description   = "The core-vpc function p95 duration stayed above three seconds for fifteen minutes."
  namespace           = "AWS/Lambda"
  metric_name         = "Duration"
  extended_statistic  = "p95"
  dimensions          = { FunctionName = var.core_vpc_function_name }
  comparison_operator = "GreaterThanThreshold"
  threshold           = 3000
  period              = 300
  evaluation_periods  = 3
  datapoints_to_alarm = 3
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
}

resource "aws_cloudwatch_metric_alarm" "sqs_oldest_age" {
  alarm_name          = "developercards-${var.env}-sqs-oldest-age"
  alarm_description   = "The oldest message on the publish queue is older than fifteen minutes."
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateAgeOfOldestMessage"
  statistic           = "Maximum"
  dimensions          = { QueueName = var.publish_queue_name }
  comparison_operator = "GreaterThanThreshold"
  threshold           = 900
  period              = 300
  evaluation_periods  = 1
  datapoints_to_alarm = 1
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
}

resource "aws_cloudwatch_metric_alarm" "dlq_nonempty" {
  alarm_name          = "developercards-${var.env}-dlq-nonempty"
  alarm_description   = "The publish dead-letter queue holds at least one message."
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateNumberOfMessagesVisible"
  statistic           = "Maximum"
  dimensions          = { QueueName = var.publish_dlq_name }
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = 1
  period              = 60
  evaluation_periods  = 1
  datapoints_to_alarm = 1
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
}

resource "aws_cloudwatch_metric_alarm" "rds_cpu" {
  alarm_name          = "developercards-${var.env}-rds-cpu"
  alarm_description   = "The database CPU stayed above eighty percent for fifteen minutes."
  namespace           = "AWS/RDS"
  metric_name         = "CPUUtilization"
  statistic           = "Average"
  dimensions          = { DBInstanceIdentifier = var.db_identifier }
  comparison_operator = "GreaterThanThreshold"
  threshold           = 80
  period              = 300
  evaluation_periods  = 3
  datapoints_to_alarm = 3
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
}

resource "aws_cloudwatch_metric_alarm" "rds_free_storage" {
  alarm_name          = "developercards-${var.env}-rds-free-storage"
  alarm_description   = "The database has less than two gigabytes of free storage."
  namespace           = "AWS/RDS"
  metric_name         = "FreeStorageSpace"
  statistic           = "Minimum"
  dimensions          = { DBInstanceIdentifier = var.db_identifier }
  comparison_operator = "LessThanThreshold"
  threshold           = 2147483648
  period              = 300
  evaluation_periods  = 1
  datapoints_to_alarm = 1
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
}

resource "aws_cloudwatch_metric_alarm" "rds_connections" {
  alarm_name          = "developercards-${var.env}-rds-connections"
  alarm_description   = "The database has more than sixty open connections."
  namespace           = "AWS/RDS"
  metric_name         = "DatabaseConnections"
  statistic           = "Maximum"
  dimensions          = { DBInstanceIdentifier = var.db_identifier }
  comparison_operator = "GreaterThanThreshold"
  threshold           = 60
  period              = 300
  evaluation_periods  = 1
  datapoints_to_alarm = 1
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
}

resource "aws_cloudwatch_metric_alarm" "outbox_backlog" {
  alarm_name          = "developercards-${var.env}-outbox-backlog"
  alarm_description   = "The analytics outbox backlog is at or above fifty thousand pending rows."
  namespace           = var.metrics_namespace
  metric_name         = "OutboxPending"
  statistic           = "Maximum"
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = 50000
  period              = 3600
  evaluation_periods  = 1
  datapoints_to_alarm = 1
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
}
