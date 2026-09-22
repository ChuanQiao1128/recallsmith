resource "aws_cloudwatch_log_group" "edge_public" {
  name              = "/aws/lambda/${var.edge_public_function_name}"
  retention_in_days = 30
}

resource "aws_lambda_function" "edge_public" {
  architectures = ["arm64"]
  filename      = "${path.module}/../../bootstrap/placeholder.zip"
  function_name = var.edge_public_function_name
  handler       = "src/public/handler.handler"
  memory_size   = 128
  role          = var.edge_public_role_arn
  runtime       = "nodejs24.x"
  timeout       = 15
  ephemeral_storage {
    size = 512
  }
  logging_config {
    log_format = "Text"
    log_group  = "/aws/lambda/${var.edge_public_function_name}"
  }
  tracing_config {
    mode = "PassThrough"
  }
  lifecycle {
    ignore_changes = [filename, source_code_hash, s3_bucket, s3_key, s3_object_version, publish, environment, description]
  }
}

resource "aws_lambda_permission" "edge_public" {
  for_each      = local.edge_public_permissions
  statement_id  = each.key
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.edge_public.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = each.value
}
