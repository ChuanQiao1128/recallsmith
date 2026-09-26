resource "aws_cloudwatch_log_group" "api_access" {
  name              = "/aws/apigateway/${var.api_name}"
  retention_in_days = 30
}
