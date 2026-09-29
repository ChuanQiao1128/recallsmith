# R18H H05 — the synthetic check (H00 §5.4): code-less function (placeholder zip; the Python deploy script owns code and env), prod alias, no async retry, a 15-minute schedule created DISABLED.

resource "aws_cloudwatch_log_group" "synthetic_check" {
  name              = "/aws/lambda/${var.synthetic_check_function_name}"
  retention_in_days = 30
}

# Outside the VPC on purpose: it probes the public API, CDN and console endpoints.
resource "aws_lambda_function" "synthetic_check" {
  architectures                  = ["arm64"]
  filename                       = "${path.module}/../../bootstrap/placeholder.zip"
  function_name                  = var.synthetic_check_function_name
  handler                        = "synthetic_check.handler.lambda_handler"
  memory_size                    = 256
  reserved_concurrent_executions = 1
  role                           = var.synthetic_check_role_arn
  runtime                        = "python3.12"
  timeout                        = 60
  environment {
    variables = var.synthetic_check_environment
  }
  logging_config {
    log_format = "Text"
    log_group  = aws_cloudwatch_log_group.synthetic_check.name
  }
  tracing_config {
    mode = "Active"
  }
  lifecycle {
    ignore_changes = [filename, source_code_hash, s3_bucket, s3_key, s3_object_version, publish, environment, description]
  }
}

resource "aws_lambda_alias" "synthetic_check_prod" {
  name             = "prod"
  function_name    = aws_lambda_function.synthetic_check.function_name
  function_version = "$LATEST"
  lifecycle {
    ignore_changes = [function_version, description]
  }
}

# A failed run is covered by the next one 15 minutes later; the alarm counts misses.
resource "aws_lambda_function_event_invoke_config" "synthetic_check_prod" {
  function_name                = aws_lambda_function.synthetic_check.function_name
  qualifier                    = aws_lambda_alias.synthetic_check_prod.name
  maximum_retry_attempts       = 0
  maximum_event_age_in_seconds = 900
}

resource "aws_scheduler_schedule" "synthetic_check" {
  name                = "developercards-synthetic-check"
  schedule_expression = "rate(15 minutes)"
  state               = "DISABLED"
  flexible_time_window {
    mode = "OFF"
  }
  target {
    arn      = aws_lambda_alias.synthetic_check_prod.arn
    role_arn = var.automation_scheduler_role_arn
    input    = jsonencode({ job = "synthetic-check" })
    retry_policy {
      maximum_retry_attempts = 0
    }
  }
  lifecycle {
    ignore_changes = [state]
  }
}
