locals {
  # E00 §2.4.4, one line, key order kept: $context.* are API Gateway variables, not Terraform interpolation.
  api_access_log_format = chomp(<<-EOT
    {"requestId":"$context.requestId","ip":"$context.identity.sourceIp","requestTime":"$context.requestTime","method":"$context.httpMethod","routeKey":"$context.routeKey","path":"$context.path","status":"$context.status","protocol":"$context.protocol","responseLength":"$context.responseLength","integrationLatency":"$context.integrationLatency","responseLatency":"$context.responseLatency","integrationError":"$context.integrationErrorMessage","authorizerError":"$context.authorizer.error","userAgent":"$context.identity.userAgent"}
  EOT
  )

  # Route map (relocated here from main.tf so the route keys live beside the
  # route/authorizer/throttle they drive). Each route resolves an integration
  # through local.integration_ids and an authorizer through local.authorizer_ids.
  # auth: "console" | "mobile" | "none".
  routes = {
    default            = { route_key = "$default", integration = "core_vpc", auth = "console" }
    proxy              = { route_key = "ANY /{proxy+}", integration = "core_vpc", auth = "console" }
    authoring          = { route_key = "ANY /api/v1/authoring/{proxy+}", integration = "core_vpc", auth = "console" }
    admin              = { route_key = "ANY /api/v1/admin/{proxy+}", integration = "core_vpc", auth = "console" }
    publish_jobs       = { route_key = "GET /api/v1/authoring/publish/jobs", integration = "core_vpc", auth = "console" }
    edge_ai            = { route_key = "ANY /api/v1/ai/{proxy+}", integration = "edge_public", auth = "console" }
    edge_billing       = { route_key = "ANY /api/v1/billing/{proxy+}", integration = "edge_public", auth = "console" }
    edge_admin_cognito = { route_key = "ANY /api/v1/admin/cognito/{proxy+}", integration = "edge_public", auth = "console" }
    sync               = { route_key = "ANY /api/v1/sync/{proxy+}", integration = "core_vpc", auth = "mobile" }
    draw_state         = { route_key = "ANY /api/v1/draw-state/{proxy+}", integration = "core_vpc", auth = "mobile" }
    user               = { route_key = "ANY /api/v1/user/{proxy+}", integration = "core_vpc", auth = "mobile" }
    premium            = { route_key = "ANY /api/v1/premium/{proxy+}", integration = "core_vpc", auth = "mobile" }
    me                 = { route_key = "GET /api/v1/me", integration = "core_vpc", auth = "mobile" }
    entitlements       = { route_key = "GET /api/v1/entitlements", integration = "core_vpc", auth = "mobile" }
    premium_url        = { route_key = "GET /api/v1/content/premium-url", integration = "core_vpc", auth = "mobile" }
    premium_url_dev    = { route_key = "GET /api/v1/content/premium-url-dev", integration = "core_vpc", auth = "mobile" }
    health             = { route_key = "GET /health", integration = "core_vpc", auth = "none" }
    rc_production      = { route_key = "POST /webhooks/revenuecat/production", integration = "core_vpc", auth = "none" }
    rc_development     = { route_key = "POST /webhooks/revenuecat/development", integration = "core_vpc", auth = "none" }
  }

  integration_ids = {
    core_vpc    = aws_apigatewayv2_integration.core_vpc.id
    edge_public = aws_apigatewayv2_integration.edge_public.id
  }

  authorizer_ids = {
    console = aws_apigatewayv2_authorizer.console.id
    mobile  = aws_apigatewayv2_authorizer.mobile.id
  }

  # Lower per-route throttles layered over each stage's validated default (Changes 4).
  route_throttles = {
    "ANY /api/v1/sync/{proxy+}"             = { burst = 40, rate = 20 }
    "ANY /api/v1/draw-state/{proxy+}"       = { burst = 40, rate = 20 }
    "POST /webhooks/revenuecat/production"  = { burst = 20, rate = 10 }
    "POST /webhooks/revenuecat/development" = { burst = 10, rate = 5 }
  }
}

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
  for_each  = local.routes
  api_id    = aws_apigatewayv2_api.http.id
  route_key = each.value.route_key
  target    = "integrations/${local.integration_ids[each.value.integration]}"

  authorization_type = each.value.auth == "none" ? "NONE" : "JWT"
  authorizer_id      = each.value.auth == "none" ? null : local.authorizer_ids[each.value.auth]
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

resource "aws_apigatewayv2_authorizer" "mobile" {
  api_id           = aws_apigatewayv2_api.http.id
  name             = "cognito-jwt-mobile"
  authorizer_type  = "JWT"
  identity_sources = ["$request.header.Authorization"]

  jwt_configuration {
    issuer   = "https://${var.mobile_pool_endpoint}"
    audience = [var.mobile_client_id]
  }
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.http.id
  auto_deploy = true
  name        = "$default"
  access_log_settings {
    destination_arn = var.access_log_destination_arn
    format          = local.api_access_log_format
  }
  default_route_settings {
    data_trace_enabled       = false
    detailed_metrics_enabled = true
    # 2026-09-23 incident: E04 wrote 0/0 here. API Gateway treats 0 as "throttle everything" — every
    # request answered 429 for ~14 minutes after the E05 apply (the same stage update carried it).
    # Real limits now; E08 may raise them per route but must never write 0.
    throttling_burst_limit = var.throttling_burst_limit
    throttling_rate_limit  = var.throttling_rate_limit
  }
  dynamic "route_settings" {
    for_each = local.route_throttles
    content {
      route_key              = route_settings.key
      throttling_burst_limit = route_settings.value.burst
      throttling_rate_limit  = route_settings.value.rate
    }
  }
  depends_on = [aws_apigatewayv2_route.this]
}

resource "aws_apigatewayv2_stage" "dev" {
  api_id      = aws_apigatewayv2_api.http.id
  auto_deploy = true
  name        = "dev"
  access_log_settings {
    destination_arn = var.access_log_destination_arn
    format          = local.api_access_log_format
  }
  default_route_settings {
    data_trace_enabled       = false
    detailed_metrics_enabled = true
    # 2026-09-23 incident: E04 wrote 0/0 here. API Gateway treats 0 as "throttle everything" — every
    # request answered 429 for ~14 minutes after the E05 apply (the same stage update carried it).
    # Real limits now; E08 may raise them per route but must never write 0.
    throttling_burst_limit = var.dev_throttling_burst_limit
    throttling_rate_limit  = var.dev_throttling_rate_limit
  }
  dynamic "route_settings" {
    for_each = local.route_throttles
    content {
      route_key              = route_settings.key
      throttling_burst_limit = route_settings.value.burst
      throttling_rate_limit  = route_settings.value.rate
    }
  }
  depends_on = [aws_apigatewayv2_route.this]
}

# Custom hostname for the HTTP API: api.<domain> -> $default (no mapping key; the
# execute-api endpoint stays enabled for 1.5.0 clients, E00 §0). The alias records are
# created only when the root passes zone_id (prod); the staging root writes its own.
locals {
  api_hostname = var.api_hostname != "" ? var.api_hostname : "api.${var.domain}"
}

resource "aws_apigatewayv2_domain_name" "api" {
  domain_name = local.api_hostname

  domain_name_configuration {
    certificate_arn = var.api_cert_arn
    endpoint_type   = "REGIONAL"
    security_policy = "TLS_1_2"
  }
}

resource "aws_apigatewayv2_api_mapping" "api" {
  api_id      = aws_apigatewayv2_api.http.id
  domain_name = aws_apigatewayv2_domain_name.api.id
  stage       = aws_apigatewayv2_stage.default.id
}

resource "aws_route53_record" "api" {
  for_each = var.zone_id == "" ? toset([]) : toset(["A", "AAAA"])
  zone_id  = var.zone_id
  name     = local.api_hostname
  type     = each.key

  alias {
    name                   = aws_apigatewayv2_domain_name.api.domain_name_configuration[0].target_domain_name
    zone_id                = aws_apigatewayv2_domain_name.api.domain_name_configuration[0].hosted_zone_id
    evaluate_target_health = false
  }
}
