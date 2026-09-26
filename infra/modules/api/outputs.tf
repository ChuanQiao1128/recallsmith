output "api_id" {
  value = aws_apigatewayv2_api.http.id
}

output "api_execution_arn" {
  value = aws_apigatewayv2_api.http.execution_arn
}

output "api_endpoint" {
  value = aws_apigatewayv2_api.http.api_endpoint
}

output "stage_names" {
  value = [aws_apigatewayv2_stage.default.name, aws_apigatewayv2_stage.dev.name]
}

output "core_vpc_function_arn" {
  value = aws_lambda_function.core_vpc.arn
}

output "core_vpc_alias_arn" {
  value = aws_lambda_alias.core_vpc_prod.arn
}

output "core_vpc_log_group_name" {
  value = aws_cloudwatch_log_group.core_vpc.name
}

output "edge_public_function_arn" {
  value = aws_lambda_function.edge_public.arn
}
