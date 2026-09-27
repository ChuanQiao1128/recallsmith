# R18 J05 — outbound webhooks: events queue + DLQ, the Python dispatcher function, its alias and SQS trigger.

resource "aws_sqs_queue" "webhook_events_dlq" {
  name                      = var.webhook_dlq_name
  message_retention_seconds = 1209600
  sqs_managed_sse_enabled   = true
}

resource "aws_sqs_queue" "webhook_events" {
  name                       = var.webhook_queue_name
  max_message_size           = 262144
  message_retention_seconds  = 345600
  sqs_managed_sse_enabled    = true
  visibility_timeout_seconds = 180
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.webhook_events_dlq.arn
    maxReceiveCount     = 5
  })
}

resource "aws_sqs_queue_redrive_allow_policy" "webhook_events_dlq" {
  queue_url = aws_sqs_queue.webhook_events_dlq.id
  redrive_allow_policy = jsonencode({
    redrivePermission = "byQueue"
    sourceQueueArns   = [aws_sqs_queue.webhook_events.arn]
  })
}

resource "aws_cloudwatch_log_group" "webhook_dispatcher" {
  name              = "/aws/lambda/${var.webhook_dispatcher_function_name}"
  retention_in_days = 30
}

# Outside the VPC on purpose: it reaches api.developercards.app and subscriber URLs over the internet (R18-00 §14 #2).
resource "aws_lambda_function" "webhook_dispatcher" {
  architectures                  = ["arm64"]
  filename                       = "${path.module}/../../bootstrap/placeholder.zip"
  function_name                  = var.webhook_dispatcher_function_name
  handler                        = "webhook_dispatcher.handler.lambda_handler"
  memory_size                    = 256
  reserved_concurrent_executions = 2
  role                           = var.webhook_dispatcher_role_arn
  runtime                        = "python3.12"
  timeout                        = 30
  environment {
    variables = var.webhook_dispatcher_environment
  }
  logging_config {
    log_format = "Text"
    log_group  = aws_cloudwatch_log_group.webhook_dispatcher.name
  }
  lifecycle {
    ignore_changes = [filename, source_code_hash, s3_bucket, s3_key, s3_object_version, publish, environment, description]
  }
}

resource "aws_lambda_alias" "webhook_dispatcher_prod" {
  name             = "prod"
  function_name    = aws_lambda_function.webhook_dispatcher.function_name
  function_version = "$LATEST"
  lifecycle {
    ignore_changes = [function_version, description]
  }
}

resource "aws_lambda_event_source_mapping" "webhook_dispatcher_sqs" {
  batch_size                         = 1
  enabled                            = true
  event_source_arn                   = aws_sqs_queue.webhook_events.arn
  function_name                      = aws_lambda_alias.webhook_dispatcher_prod.arn
  function_response_types            = ["ReportBatchItemFailures"]
  maximum_batching_window_in_seconds = 0
  scaling_config {
    maximum_concurrency = 2
  }
  lifecycle {
    # R18 Y04 (cloud-security-resilience-14): the emergency stop is `update-event-source-mapping
    # --no-enabled` (infra/RUNBOOK.md §7). Ignoring `enabled` keeps a later plan from quietly
    # re-enabling a stopped consumer; re-enabling is the same CLI call with --enabled.
    ignore_changes = [metrics_config, enabled]
  }
}
