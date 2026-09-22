resource "aws_cloudwatch_log_group" "worker" {
  name              = local.log_group_name
  retention_in_days = 30
}

resource "aws_lambda_function" "worker" {
  architectures = ["arm64"]
  filename      = "${path.module}/../../bootstrap/placeholder.zip"
  function_name = var.function_name
  handler       = "RecallSmith.Lambda.Worker::RecallSmith.Lambda.Worker.WorkerFunction::FunctionHandler"
  memory_size   = 512
  role          = var.role_arn
  runtime       = "dotnet8"
  timeout       = 615
  ephemeral_storage {
    size = 512
  }
  logging_config {
    log_format = "Text"
    log_group  = local.log_group_name
  }
  tracing_config {
    mode = "PassThrough"
  }
  vpc_config {
    ipv6_allowed_for_dual_stack = false
    security_group_ids          = var.security_group_ids
    subnet_ids                  = var.subnet_ids
  }
  lifecycle {
    ignore_changes = [filename, source_code_hash, s3_bucket, s3_key, s3_object_version, publish, environment, description]
  }
}

resource "aws_lambda_alias" "worker_prod" {
  name             = var.alias_name
  function_name    = aws_lambda_function.worker.function_name
  function_version = "4"
  lifecycle {
    ignore_changes = [function_version, description]
  }
}

resource "aws_lambda_event_source_mapping" "worker_sqs" {
  batch_size                         = 1
  enabled                            = true
  event_source_arn                   = aws_sqs_queue.publish_jobs.arn
  function_name                      = aws_lambda_function.worker.arn
  function_response_types            = []
  maximum_batching_window_in_seconds = 60
  scaling_config {
    maximum_concurrency = 2
  }
  lifecycle {
    ignore_changes = [metrics_config]
  }
}
