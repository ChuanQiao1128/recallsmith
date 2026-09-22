resource "aws_apigatewayv2_api" "http" {
  name                         = var.api_name
  protocol_type                = "HTTP"
  route_selection_expression   = "$request.method $request.path"
  api_key_selection_expression = "$request.header.x-api-key"
  disable_execute_api_endpoint = false
  ip_address_type              = "ipv4"
  cors_configuration {
    allow_credentials = false
    allow_headers     = ["accept", "authorization", "content-type", "x-internal-signature", "x-internal-timestamp", "x-migrate-secret"]
    allow_methods     = ["DELETE", "GET", "OPTIONS", "POST", "PUT"]
    allow_origins     = var.cors_allowed_origins
    expose_headers    = []
    max_age           = 600
  }
}

resource "aws_apigatewayv2_integration" "core_vpc" {
  api_id                 = aws_apigatewayv2_api.http.id
  connection_type        = "INTERNET"
  integration_method     = "POST"
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_alias.core_vpc_prod.arn
  payload_format_version = "2.0"
  timeout_milliseconds   = 30000
}

resource "aws_apigatewayv2_integration" "core_vpc_dup" {
  for_each               = toset(["a9dzpce", "q8lfdrr"])
  api_id                 = aws_apigatewayv2_api.http.id
  connection_type        = "INTERNET"
  integration_method     = "POST"
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_alias.core_vpc_prod.arn
  payload_format_version = "2.0"
  timeout_milliseconds   = 30000
}

resource "aws_apigatewayv2_integration" "edge_public" {
  api_id                 = aws_apigatewayv2_api.http.id
  connection_type        = "INTERNET"
  integration_method     = "POST"
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.edge_public.arn
  payload_format_version = "2.0"
  timeout_milliseconds   = 30000
}

resource "aws_apigatewayv2_route" "this" {
  for_each           = local.routes
  api_id             = aws_apigatewayv2_api.http.id
  route_key          = each.value.route_key
  target             = "integrations/${local.integration_ids[each.value.integration]}"
  authorization_type = "NONE"
}

resource "aws_apigatewayv2_authorizer" "console" {
  api_id                           = aws_apigatewayv2_api.http.id
  authorizer_result_ttl_in_seconds = 0
  authorizer_type                  = "JWT"
  identity_sources                 = ["$request.header.Authorization"]
  name                             = "cognito-jwt"
  jwt_configuration {
    audience = [var.console_client_id]
    issuer   = "https://${var.console_pool_endpoint}"
  }
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.http.id
  auto_deploy = true
  name        = "$default"
  default_route_settings {
    data_trace_enabled       = false
    detailed_metrics_enabled = false
    throttling_burst_limit   = 0
    throttling_rate_limit    = 0
  }
}

resource "aws_apigatewayv2_stage" "dev" {
  api_id      = aws_apigatewayv2_api.http.id
  auto_deploy = true
  name        = "dev"
  default_route_settings {
    data_trace_enabled       = false
    detailed_metrics_enabled = false
    throttling_burst_limit   = 0
    throttling_rate_limit    = 0
  }
}
