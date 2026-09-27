# R18 J15 — AI QA: jobs queue + DLQ, the Python ai-qa function (outside the VPC), its alias and SQS trigger.

resource "aws_sqs_queue" "ai_qa_jobs_dlq" {
  name                      = var.ai_qa_dlq_name
  message_retention_seconds = 1209600
  sqs_managed_sse_enabled   = true
}

# Visibility 6 x the 600 s timeout; redrive 2 = one retry for a transient provider failure (R18-00 §7.5).
resource "aws_sqs_queue" "ai_qa_jobs" {
  name                       = var.ai_qa_queue_name
  max_message_size           = 262144
  message_retention_seconds  = 345600
  sqs_managed_sse_enabled    = true
  visibility_timeout_seconds = 3600
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.ai_qa_jobs_dlq.arn
    maxReceiveCount     = 2
  })
}

resource "aws_sqs_queue_redrive_allow_policy" "ai_qa_jobs_dlq" {
  queue_url = aws_sqs_queue.ai_qa_jobs_dlq.id
  redrive_allow_policy = jsonencode({
    redrivePermission = "byQueue"
    sourceQueueArns   = [aws_sqs_queue.ai_qa_jobs.arn]
  })
}

resource "aws_cloudwatch_log_group" "ai_qa" {
  name              = "/aws/lambda/${var.ai_qa_function_name}"
  retention_in_days = 30
}

# Outside the VPC on purpose: core-vpc has no egress, and this function reaches Bedrock and api.developercards.app (R18-00 §14 #2).
resource "aws_lambda_function" "ai_qa" {
  architectures                  = ["arm64"]
  filename                       = "${path.module}/../../bootstrap/placeholder.zip"
  function_name                  = var.ai_qa_function_name
  handler                        = "ai_qa.handler.lambda_handler"
  memory_size                    = 512
  reserved_concurrent_executions = 2
  role                           = var.ai_qa_role_arn
  runtime                        = "python3.12"
  timeout                        = 600
  environment {
    variables = var.ai_qa_environment
  }
  logging_config {
    log_format = "Text"
    log_group  = aws_cloudwatch_log_group.ai_qa.name
  }
  lifecycle {
    ignore_changes = [filename, source_code_hash, s3_bucket, s3_key, s3_object_version, publish, environment, description]
  }
}

resource "aws_lambda_alias" "ai_qa_prod" {
  name             = "prod"
  function_name    = aws_lambda_function.ai_qa.function_name
  function_version = "$LATEST"
  lifecycle {
    ignore_changes = [function_version, description]
  }
}

resource "aws_lambda_event_source_mapping" "ai_qa_sqs" {
  batch_size                         = 1
  enabled                            = true
  event_source_arn                   = aws_sqs_queue.ai_qa_jobs.arn
  function_name                      = aws_lambda_alias.ai_qa_prod.arn
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
