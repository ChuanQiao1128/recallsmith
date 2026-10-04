locals {
  # E00 §2.4.4, one line, key order kept: $context.* are API Gateway variables, not Terraform interpolation.
  api_access_log_format = chomp(<<-EOT
    {"requestId":"$context.requestId","ip":"$context.identity.sourceIp","requestTime":"$context.requestTime","method":"$context.httpMethod","routeKey":"$context.routeKey","path":"$context.path","status":"$context.status","protocol":"$context.protocol","responseLength":"$context.responseLength","integrationLatency":"$context.integrationLatency","responseLatency":"$context.responseLatency","integrationError":"$context.integrationErrorMessage","authorizerError":"$context.authorizer.error","userAgent":"$context.identity.userAgent"}
  EOT
  )

  # Route map (relocated here from main.tf so the route keys live beside the
  # route/authorizer/throttle they drive). Each route resolves an integration
  # through local.integration_ids and an authorizer through local.authorizer_ids.
  # auth: "console" | "agent" | "mobile" | "none".
  # R18 Y04 (ai-agent-6): "console" admits only the SPA client. "agent" admits the SPA client and the
  # agent app clients (console-dev, the local MCP server) and is attached ONLY to the exact route keys
  # the MCP server calls (tools/mcp-server/src/api.ts, server.ts). Every other route rejects an agent
  # token at the gateway. core-vpc's AgentClientPolicy stays as defence in depth; keep the two lists equal.
  # R27 EDGE (2026-10-04): edge-public is retired and its three routes (ANY /api/v1/ai/{proxy+},
  # ANY /api/v1/billing/{proxy+}, ANY /api/v1/admin/cognito/{proxy+}) and their OPTIONS routes are gone.
  # Those paths now fall to ANY /{proxy+} and ANY /api/v1/admin/{proxy+} (console JWT, core-vpc), which
  # answers 404; OPTIONS falls to OPTIONS /{proxy+} and OPTIONS /api/v1/admin/{proxy+}, core-vpc as before.
  routes = {
    default         = { route_key = "$default", integration = "core_vpc", auth = "console" }
    proxy           = { route_key = "ANY /{proxy+}", integration = "core_vpc", auth = "console" }
    authoring       = { route_key = "ANY /api/v1/authoring/{proxy+}", integration = "core_vpc", auth = "console" }
    admin           = { route_key = "ANY /api/v1/admin/{proxy+}", integration = "core_vpc", auth = "console" }
    publish_jobs    = { route_key = "GET /api/v1/authoring/publish/jobs", integration = "core_vpc", auth = "console" }
    sync            = { route_key = "ANY /api/v1/sync/{proxy+}", integration = "core_vpc", auth = "mobile" }
    draw_state      = { route_key = "ANY /api/v1/draw-state/{proxy+}", integration = "core_vpc", auth = "mobile" }
    user            = { route_key = "ANY /api/v1/user/{proxy+}", integration = "core_vpc", auth = "mobile" }
    premium         = { route_key = "ANY /api/v1/premium/{proxy+}", integration = "core_vpc", auth = "mobile" }
    me              = { route_key = "GET /api/v1/me", integration = "core_vpc", auth = "mobile" }
    entitlements    = { route_key = "GET /api/v1/entitlements", integration = "core_vpc", auth = "mobile" }
    premium_url     = { route_key = "GET /api/v1/content/premium-url", integration = "core_vpc", auth = "mobile" }
    premium_url_dev = { route_key = "GET /api/v1/content/premium-url-dev", integration = "core_vpc", auth = "mobile" }
    health          = { route_key = "GET /health", integration = "core_vpc", auth = "none" }
    rc_production   = { route_key = "POST /webhooks/revenuecat/production", integration = "core_vpc", auth = "none" }
    rc_development  = { route_key = "POST /webhooks/revenuecat/development", integration = "core_vpc", auth = "none" }
    # 2026-09-26 (E09 follow-up): browser CORS preflights carry no token. A JWT route such as
    # ANY /api/v1/authoring/{proxy+} matched them (longest greedy path wins over the method) and
    # answered 401, so the console could not call the API. One unauthenticated OPTIONS route per
    # console prefix; core-vpc answers OPTIONS with 200 and API Gateway adds the CORS headers.
    options_root      = { route_key = "OPTIONS /{proxy+}", integration = "core_vpc", auth = "none" }
    options_authoring = { route_key = "OPTIONS /api/v1/authoring/{proxy+}", integration = "core_vpc", auth = "none" }
    options_admin     = { route_key = "OPTIONS /api/v1/admin/{proxy+}", integration = "core_vpc", auth = "none" }
    # R18 J05: server-to-server HMAC route (no JWT, no OPTIONS); the narrow key wins over proxy.
    # R18 X08: exact keys, never {proxy+}. A greedy key let /api/internal/webhooks/x/<any path>
    # reach core-vpc without the JWT, where suffix routing picked the handler; with exact keys
    # every other /api/internal/* path falls to ANY /{proxy+} and keeps the console JWT.
    internal_webhooks = { route_key = "POST /api/internal/webhooks/deliveries/report", integration = "core_vpc", auth = "none" }
    # R18 J15: HMAC callback from the ai-qa Lambda (no JWT, no OPTIONS). Exact key (X08).
    internal_ai_qa = { route_key = "POST /api/internal/ai-qa/results", integration = "core_vpc", auth = "none" }

    # R18 Y04 (ai-agent-6): the MCP server's three calls. Exact keys win over the greedy console routes
    # (ANY /api/v1/admin/{proxy+}, ANY /api/v1/authoring/{proxy+}), so only these reach core-vpc with an
    # agent token; a query string (GET /api/v1/admin/decks?q=...) does not affect route matching.
    agent_admin_decks   = { route_key = "GET /api/v1/admin/decks", integration = "core_vpc", auth = "agent" }
    agent_cards_similar = { route_key = "POST /api/v1/authoring/cards/similar", integration = "core_vpc", auth = "agent" }
    agent_drafts_submit = { route_key = "POST /api/v1/authoring/drafts", integration = "core_vpc", auth = "agent" }

    # R18A A10: HMAC callbacks from the source-watcher and notifier Lambdas (no JWT, no OPTIONS). Exact keys (X08).
    internal_source_watch_targets     = { route_key = "POST /api/internal/source-watch/targets", integration = "core_vpc", auth = "none" }
    internal_source_watch_report      = { route_key = "POST /api/internal/source-watch/report", integration = "core_vpc", auth = "none" }
    internal_automation_tick          = { route_key = "POST /api/internal/automation/tick", integration = "core_vpc", auth = "none" }
    internal_automation_notifications = { route_key = "POST /api/internal/automation/notifications/report", integration = "core_vpc", auth = "none" }

    # R18A A10: the author runner's three calls (tools/author-runner/src) with an agent token; exact keys, as the MCP server's above.
    agent_runner_heartbeat = { route_key = "POST /api/v1/authoring/automation/runner/heartbeat", integration = "core_vpc", auth = "agent" }
    agent_runner_claim     = { route_key = "POST /api/v1/authoring/automation/runner/claim", integration = "core_vpc", auth = "agent" }
    agent_runner_complete  = { route_key = "POST /api/v1/authoring/automation/runner/complete", integration = "core_vpc", auth = "agent" }

    # R25X F05 (contract R25-00 §4 as moved out of the VPC by F04): the notifier's signed calls for the RevenueCat
    # customer deletions (no JWT, no OPTIONS). Exact keys (X08); a query string (?limit=50) does not affect matching.
    internal_revenuecat_deletions        = { route_key = "GET /api/v1/internal/revenuecat-deletions", integration = "core_vpc", auth = "none" }
    internal_revenuecat_deletions_report = { route_key = "POST /api/v1/internal/revenuecat-deletions/report", integration = "core_vpc", auth = "none" }

    # R24 P01: anonymous install funnel events from the app (no JWT, no OPTIONS). Exact key (X08); tight throttle below.
    public_events = { route_key = "POST /api/v1/public/events", integration = "core_vpc", auth = "none" }

    # R28 ANONREPORT (user-perspective review U2): a card report from a learner who is not signed in (no JWT, no
    # OPTIONS). Exact key (X08); tighter throttle below; core-vpc adds a body cap, a budget and a daily cap.
    public_card_reports = { route_key = "POST /api/v1/public/card-reports", integration = "core_vpc", auth = "none" }
  }

  integration_ids = {
    core_vpc = aws_apigatewayv2_integration.core_vpc.id
  }

  authorizer_ids = {
    console = aws_apigatewayv2_authorizer.console.id
    agent   = aws_apigatewayv2_authorizer.agent.id
    mobile  = aws_apigatewayv2_authorizer.mobile.id
  }

  # Lower per-route throttles layered over each stage's validated default (Changes 4). Each key is its own token bucket,
  # shared by every caller of that route on that stage (the HTTP API has no per-client limit).
  # R29 HARDEN (enterprise audit SPC-02): every unauthenticated route and the expensive routes have their own entry, so
  # no single route can spend core-vpc (reserved concurrency 40) at the stage default of 200 rps. Sized from the
  # 30 days to 2026-10-04 (AWS/ApiGateway Count per route, read-only; infra/RUNBOOK.md §16) with at least 100x
  # headroom over the busiest minute seen on each: GET /health 5 a minute (the synthetic check), the console's
  # preflights and calls at most 11, the app's user routes 3, the agent's 5.
  route_throttles = {
    "GET /health"                                        = { burst = 20, rate = 10 }
    "OPTIONS /{proxy+}"                                  = { burst = 40, rate = 20 }
    "OPTIONS /api/v1/authoring/{proxy+}"                 = { burst = 40, rate = 20 }
    "OPTIONS /api/v1/admin/{proxy+}"                     = { burst = 40, rate = 20 }
    "ANY /api/v1/authoring/{proxy+}"                     = { burst = 40, rate = 20 }
    "ANY /api/v1/admin/{proxy+}"                         = { burst = 40, rate = 20 }
    "ANY /api/v1/user/{proxy+}"                          = { burst = 40, rate = 20 }
    "POST /api/v1/authoring/cards/similar"               = { burst = 20, rate = 10 }
    "POST /api/v1/authoring/drafts"                      = { burst = 20, rate = 10 }
    "ANY /api/v1/sync/{proxy+}"                          = { burst = 40, rate = 20 }
    "ANY /api/v1/draw-state/{proxy+}"                    = { burst = 40, rate = 20 }
    "POST /webhooks/revenuecat/production"               = { burst = 20, rate = 10 }
    "POST /webhooks/revenuecat/development"              = { burst = 10, rate = 5 }
    "POST /api/internal/webhooks/deliveries/report"      = { burst = 20, rate = 10 }
    "POST /api/internal/ai-qa/results"                   = { burst = 20, rate = 10 }
    "POST /api/internal/source-watch/targets"            = { burst = 20, rate = 10 }
    "POST /api/internal/source-watch/report"             = { burst = 20, rate = 10 }
    "POST /api/internal/automation/tick"                 = { burst = 20, rate = 10 }
    "POST /api/internal/automation/notifications/report" = { burst = 20, rate = 10 }
    "POST /api/v1/authoring/automation/runner/heartbeat" = { burst = 10, rate = 5 }
    "POST /api/v1/authoring/automation/runner/claim"     = { burst = 10, rate = 5 }
    "POST /api/v1/authoring/automation/runner/complete"  = { burst = 10, rate = 5 }
    "POST /api/v1/public/events"                         = { burst = 10, rate = 5 }
    "POST /api/v1/public/card-reports"                   = { burst = 5, rate = 2 }
    "GET /api/v1/internal/revenuecat-deletions"          = { burst = 20, rate = 10 }
    "POST /api/v1/internal/revenuecat-deletions/report"  = { burst = 20, rate = 10 }
  }

  # R24X F06 (p-tests-1): route guard. `terraform validate` evaluates this local, so a broken rule fails the
  # offline gate (fmt + validate) with the messages below; plan-allow files compare addresses and actions only.
  # Rules: every route_throttles key is a route in local.routes (an orphan key fails the stage update); every
  # auth = "none" route except the OPTIONS preflights is an exact key (X08); the R24 public events route is
  # exactly contract §3.3 (exact key, NONE on core_vpc, burst 10 / rate 5 on both stages via route_throttles).
  # R28 ANONREPORT: every /api/v1/public/ route has a per-route throttle, and the anonymous card report route is
  # exactly POST /api/v1/public/card-reports, NONE on core_vpc, burst 5 / rate 2.
  # R29 HARDEN (SPC-02): every auth = "none" route (OPTIONS preflights and GET /health included) has a per-route
  # throttle, and no throttle is below 1 (API Gateway reads 0 as "refuse everything": the 2026-09-23 incident).
  route_guard_public_events       = lookup(local.routes, "public_events", { route_key = "", integration = "", auth = "" })
  route_guard_public_card_reports = lookup(local.routes, "public_card_reports", { route_key = "", integration = "", auth = "" })
  route_guard_errors = concat(
    [for k in keys(local.route_throttles) : "route_throttles key \"${k}\" has no route in local.routes" if !contains([for r in values(local.routes) : r.route_key], k)],
    [for name, r in local.routes : "auth = \"none\" route ${name} (\"${r.route_key}\") is not an exact key" if r.auth == "none" && !startswith(r.route_key, "OPTIONS ") && length(regexall("^(GET|POST|PUT|DELETE|PATCH) /[A-Za-z0-9/_-]+$", r.route_key)) == 0],
    local.route_guard_public_events.route_key == "POST /api/v1/public/events" ? [] : ["routes.public_events.route_key must be \"POST /api/v1/public/events\""],
    local.route_guard_public_events.integration == "core_vpc" ? [] : ["routes.public_events.integration must be \"core_vpc\""],
    local.route_guard_public_events.auth == "none" ? [] : ["routes.public_events.auth must be \"none\""],
    lookup(local.route_throttles, "POST /api/v1/public/events", { burst = 0, rate = 0 }) == { burst = 10, rate = 5 } ? [] : ["route_throttles[\"POST /api/v1/public/events\"] must be { burst = 10, rate = 5 }"],
    [for name, r in local.routes : "public route ${name} (\"${r.route_key}\") has no route_throttles entry" if length(regexall("^[A-Z]+ /api/v1/public/", r.route_key)) > 0 && !contains(keys(local.route_throttles), r.route_key)],
    local.route_guard_public_card_reports.route_key == "POST /api/v1/public/card-reports" ? [] : ["routes.public_card_reports.route_key must be \"POST /api/v1/public/card-reports\""],
    local.route_guard_public_card_reports.integration == "core_vpc" ? [] : ["routes.public_card_reports.integration must be \"core_vpc\""],
    local.route_guard_public_card_reports.auth == "none" ? [] : ["routes.public_card_reports.auth must be \"none\""],
    lookup(local.route_throttles, "POST /api/v1/public/card-reports", { burst = 0, rate = 0 }) == { burst = 5, rate = 2 } ? [] : ["route_throttles[\"POST /api/v1/public/card-reports\"] must be { burst = 5, rate = 2 }"],
    [for name, r in local.routes : "auth = \"none\" route ${name} (\"${r.route_key}\") has no route_throttles entry" if r.auth == "none" && !contains(keys(local.route_throttles), r.route_key)],
    [for k, t in local.route_throttles : "route_throttles[\"${k}\"] must have burst >= 1 and rate >= 1" if t.burst < 1 || t.rate < 1],
  )
  # tobool() of the joined messages fails validate and prints them; an empty list evaluates to true.
  route_guard_ok = length(local.route_guard_errors) == 0 ? true : tobool("ROUTE GUARD: ${join("; ", local.route_guard_errors)}")
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

# R18 Y04 (ai-agent-6): same pool/issuer as "console", plus the agent app clients. Only the routes with
# auth = "agent" use it.
resource "aws_apigatewayv2_authorizer" "agent" {
  api_id                           = aws_apigatewayv2_api.http.id
  authorizer_result_ttl_in_seconds = 0
  authorizer_type                  = "JWT"
  identity_sources                 = ["$request.header.Authorization"]
  name                             = "cognito-jwt-agent"
  jwt_configuration {
    audience = concat([var.console_client_id], var.agent_client_ids)
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
