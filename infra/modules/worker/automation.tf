# R18A A10 — automation (A00 §17.2): the notify queue + DLQ core-vpc sends rendered emails to, the Python
# notifier (A09) and source-watcher (A08) functions outside the VPC with their aliases, the notifier's SQS
# trigger, and the three EventBridge Scheduler schedules. The schedules are created DISABLED and ignore
# `state`: the placeholder code must not run, and the supervisor enables them after the code deploy
# (infra/RUNBOOK.md §7). Scheduler invokes the aliases through its role; there is no Lambda permission.

resource "aws_sqs_queue" "notify_dlq" {
  name                      = var.notify_dlq_name
  message_retention_seconds = 1209600
  sqs_managed_sse_enabled   = true
}

# Visibility 3 x the notifier's 60 s timeout.
resource "aws_sqs_queue" "notify" {
  name                       = var.notify_queue_name
  max_message_size           = 262144
  message_retention_seconds  = 345600
  sqs_managed_sse_enabled    = true
  visibility_timeout_seconds = 180
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.notify_dlq.arn
    maxReceiveCount     = 5
  })
}

resource "aws_sqs_queue_redrive_allow_policy" "notify_dlq" {
  queue_url = aws_sqs_queue.notify_dlq.id
  redrive_allow_policy = jsonencode({
    redrivePermission = "byQueue"
    sourceQueueArns   = [aws_sqs_queue.notify.arn]
  })
}

resource "aws_cloudwatch_log_group" "notifier" {
  name              = "/aws/lambda/${var.notifier_function_name}"
  retention_in_days = 30
}

# Outside the VPC on purpose: it reaches SES and api.developercards.app.
resource "aws_lambda_function" "notifier" {
  architectures                  = ["arm64"]
  filename                       = "${path.module}/../../bootstrap/placeholder.zip"
  function_name                  = var.notifier_function_name
  handler                        = "notifier.handler.lambda_handler"
  memory_size                    = 256
  reserved_concurrent_executions = 2
  role                           = var.notifier_role_arn
  runtime                        = "python3.12"
  timeout                        = 60
  environment {
    variables = var.notifier_environment
  }
  logging_config {
    log_format = "Text"
    log_group  = aws_cloudwatch_log_group.notifier.name
  }
  lifecycle {
    ignore_changes = [filename, source_code_hash, s3_bucket, s3_key, s3_object_version, publish, environment, description]
  }
}

resource "aws_lambda_alias" "notifier_prod" {
  name             = "prod"
  function_name    = aws_lambda_function.notifier.function_name
  function_version = "$LATEST"
  lifecycle {
    ignore_changes = [function_version, description]
  }
}

resource "aws_lambda_event_source_mapping" "notifier_sqs" {
  batch_size                         = 1
  enabled                            = true
  event_source_arn                   = aws_sqs_queue.notify.arn
  function_name                      = aws_lambda_alias.notifier_prod.arn
  function_response_types            = ["ReportBatchItemFailures"]
  maximum_batching_window_in_seconds = 0
  scaling_config {
    maximum_concurrency = 2
  }
  lifecycle {
    # Y04: the emergency stop disables this mapping by hand (infra/RUNBOOK.md §7); a later plan must not re-enable it.
    ignore_changes = [metrics_config, enabled]
  }
}

resource "aws_cloudwatch_log_group" "source_watcher" {
  name              = "/aws/lambda/${var.source_watcher_function_name}"
  retention_in_days = 30
}

# Outside the VPC on purpose: it fetches public source pages and calls api.developercards.app.
resource "aws_lambda_function" "source_watcher" {
  architectures                  = ["arm64"]
  filename                       = "${path.module}/../../bootstrap/placeholder.zip"
  function_name                  = var.source_watcher_function_name
  handler                        = "source_watcher.handler.lambda_handler"
  memory_size                    = 512
  reserved_concurrent_executions = 1
  role                           = var.source_watcher_role_arn
  runtime                        = "python3.12"
  timeout                        = 300
  environment {
    variables = var.source_watcher_environment
  }
  logging_config {
    log_format = "Text"
    log_group  = aws_cloudwatch_log_group.source_watcher.name
  }
  lifecycle {
    ignore_changes = [filename, source_code_hash, s3_bucket, s3_key, s3_object_version, publish, environment, description]
  }
}

resource "aws_lambda_alias" "source_watcher_prod" {
  name             = "prod"
  function_name    = aws_lambda_function.source_watcher.function_name
  function_version = "$LATEST"
  lifecycle {
    ignore_changes = [function_version, description]
  }
}

resource "aws_scheduler_schedule" "source_watch" {
  name                = "developercards-source-watch"
  schedule_expression = "rate(1 hour)"
  state               = "DISABLED"
  flexible_time_window {
    mode = "OFF"
  }
  target {
    arn      = aws_lambda_alias.source_watcher_prod.arn
    role_arn = var.automation_scheduler_role_arn
    input    = jsonencode({ job = "source-watch" })
    retry_policy {
      maximum_retry_attempts = 0
    }
  }
  lifecycle {
    ignore_changes = [state]
  }
}

resource "aws_scheduler_schedule" "automation_tick" {
  name                = "developercards-automation-tick"
  schedule_expression = "rate(15 minutes)"
  state               = "DISABLED"
  flexible_time_window {
    mode = "OFF"
  }
  target {
    arn      = aws_lambda_alias.notifier_prod.arn
    role_arn = var.automation_scheduler_role_arn
    input    = jsonencode({ job = "tick" })
    retry_policy {
      maximum_retry_attempts = 2
    }
  }
  lifecycle {
    ignore_changes = [state]
  }
}

resource "aws_scheduler_schedule" "automation_digest" {
  name                         = "developercards-automation-digest"
  schedule_expression          = "cron(0 8 ? * MON *)"
  schedule_expression_timezone = "Pacific/Auckland"
  state                        = "DISABLED"
  flexible_time_window {
    mode = "OFF"
  }
  target {
    arn      = aws_lambda_alias.notifier_prod.arn
    role_arn = var.automation_scheduler_role_arn
    input    = jsonencode({ job = "digest" })
    retry_policy {
      maximum_retry_attempts = 2
    }
  }
  lifecycle {
    ignore_changes = [state]
  }
}
