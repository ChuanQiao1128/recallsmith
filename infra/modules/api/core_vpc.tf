resource "aws_cloudwatch_log_group" "core_vpc" {
  name              = "/aws/lambda/${var.core_vpc_function_name}"
  retention_in_days = 90
}

resource "aws_lambda_function" "core_vpc" {
  architectures                  = ["arm64"]
  filename                       = "${path.module}/../../bootstrap/placeholder.zip"
  function_name                  = var.core_vpc_function_name
  handler                        = "RecallSmith.Lambda::RecallSmith.Lambda.VpcFunction::Handler"
  memory_size                    = 128
  reserved_concurrent_executions = 40
  role                           = var.core_vpc_role_arn
  runtime                        = "dotnet8"
  timeout                        = 90
  ephemeral_storage {
    size = 512
  }
  logging_config {
    log_format = "Text"
    log_group  = "/aws/lambda/${var.core_vpc_function_name}"
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

resource "aws_lambda_alias" "core_vpc_prod" {
  name             = var.core_vpc_alias_name
  function_name    = aws_lambda_function.core_vpc.function_name
  function_version = "48"
  lifecycle {
    ignore_changes = [function_version, description]
  }
}

resource "aws_lambda_permission" "core_vpc" {
  for_each      = local.core_vpc_permissions
  statement_id  = each.key
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.core_vpc.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = each.value
}
