# R28 MONITOR (user-perspective review 2026-10-04, G4) — what users are refused, on the existing alerts topic.
#
# The HTTP API publishes only Count, 4xx, 5xx, Latency, IntegrationLatency and DataProcessed to AWS/ApiGateway:
# no throttle metric (a throttled request is one more 4xx) and no way to leave a caller out. So these alarms read
# the API access log (gateway.tf api_access_log_format: JSON with status, routeKey and userAgent) through metric
# filters, which can:
#   - leave out the synthetic check by its User-Agent (services/synthetic-check CHECK_USER_AGENT
#     "DeveloperCards-Synthetic/1.0 (+https://developercards.app)"): its token-less GET /api/v1/me and
#     GET /api/v1/sync/progress are 8 of the API's 4xx every hour by design (192 a day against a handful of real ones);
#   - leave out every caller that is not the app or the console (local.api_non_user_routes): the unmatched routes
#     ANY /{proxy+} and $default (the console calls only /api/v1/admin/* and /api/v1/authoring/*, the app only exact
#     routes, so these see scanners and retired paths: 99 of their 106 requests in the 14 days to 2026-10-04 were
#     4xx), and the server-to-server callbacks (HMAC: /api/internal/*, /api/v1/internal/*; RevenueCat's
#     /webhooks/*; the author runner's /api/v1/authoring/automation/runner/*). The callbacks are 5-15 requests in
#     every hour since 2026-10-01 (median 12; the tick, the RevenueCat-deletion poll, the source watch and the
#     runner), against 43 app and console requests in those 79 hours: left in, they diluted the rate so much that a
#     total refusal of the app could never reach it (R28 review F1). infra/scripts/tests/test_r28_api_user_filter.py
#     keeps this list equal to gateway.tf's unauthenticated and runner routes;
#   - count 429 whoever was refused, the probe included (a throttled probe is the 2026-09-23 incident).
# Both stages write to this one log group and the line carries no stage; dev saw 1 request in the week to 2026-10-04.
# services/synthetic-check/tests/test_infra_contract.py keeps the User-Agent here equal to the probe's.
#
# core-vpc's own bearer checks write one structured warn line with "tag":"auth" for each rejected token (never a
# token or a claim): src_C/Shared/RecallSmith.Lambda.Common/Auth.cs for a token the JWT authorizer did not already
# verify (routes with no authorizer, direct invokes) that fails verification, or a verified admin-group token that
# fails the console binding ({"ts":…,"level":"warn","tag":"auth","reason":<code>,"traceId","method","path"}), and
# src_C/Vpc/AgentClientPolicy.cs for the local agent's token on a route outside its allow-list (reason
# agent_client_forbidden, 403). A token that is not JWT-shaped (webhook secrets) is an info line and is not counted.
# Lambda's Text format prefixes the JSON with "<time>\t<request id>\t<level>\t"; a JSON filter still matches it
# (checked with test-metric-filter on 2026-10-04).
#
# Runbook: infra/RUNBOOK.md §7 "User-facing refusals (R28 MONITOR)".

locals {
  synthetic_user_agent_prefix = "DeveloperCards-Synthetic/"
  # Route keys that are not the app's or the console's users; a trailing * is a prefix match (JSON filter wildcard).
  api_non_user_routes = [
    "ANY /{proxy+}",
    "$default",
    "POST /api/internal/*",
    "GET /api/v1/internal/*",
    "POST /api/v1/internal/*",
    "POST /webhooks/*",
    "POST /api/v1/authoring/automation/runner/*",
  ]
  api_user_filter = join(" && ", concat(
    ["($.userAgent != \"${local.synthetic_user_agent_prefix}*\")"],
    [for route in local.api_non_user_routes : "($.routeKey != \"${route}\")"],
  ))
}

resource "aws_cloudwatch_log_metric_filter" "api_user_requests" {
  name           = "developercards-${var.env}-api-user-requests"
  log_group_name = aws_cloudwatch_log_group.api_access.name
  pattern        = "{ ${local.api_user_filter} }"
  metric_transformation {
    name      = "ApiUserRequests"
    namespace = var.metrics_namespace
    value     = "1"
    unit      = "Count"
  }
}

resource "aws_cloudwatch_log_metric_filter" "api_user_4xx" {
  name           = "developercards-${var.env}-api-user-4xx"
  log_group_name = aws_cloudwatch_log_group.api_access.name
  pattern        = "{ ($.status = \"4*\") && ${local.api_user_filter} }"
  metric_transformation {
    name      = "ApiUser4xx"
    namespace = var.metrics_namespace
    value     = "1"
    unit      = "Count"
  }
}

resource "aws_cloudwatch_log_metric_filter" "api_429" {
  name           = "developercards-${var.env}-api-429"
  log_group_name = aws_cloudwatch_log_group.api_access.name
  pattern        = "{ $.status = \"429\" }"
  metric_transformation {
    name      = "Api429Responses"
    namespace = var.metrics_namespace
    value     = "1"
    unit      = "Count"
  }
}

resource "aws_cloudwatch_log_metric_filter" "core_vpc_auth_rejects" {
  name           = "developercards-${var.env}-core-vpc-auth-rejects"
  log_group_name = coalesce(var.core_vpc_log_group_name, "/aws/lambda/${var.core_vpc_function_name}")
  pattern        = "{ ($.tag = \"auth\") && ($.level = \"warn\") }"
  metric_transformation {
    name      = "CoreVpcAuthRejects"
    namespace = var.metrics_namespace
    value     = "1"
    unit      = "Count"
  }
}

# Most of the app's and console's requests refused within three hours. Guards: >= 5 requests and >= 5 4xx in the
# window (the probe, the unmatched routes and the server-to-server callbacks left out), so a single refused request
# never pages. User traffic is a few requests a day in bursts (43 in the 79 hours from 2026-10-01, in 7 of them), so an
# hourly window with a 10-request guard could not see a refusal of every app request (R28 review F1); three hours at
# >= 5 does, while one stray client's retries rarely reach 5. Replayed read-only over 2026-09-22 12:00 to 2026-10-04
# 07:00 UTC with the route metrics as a stand-in (the probe as GET /health and the 4xx of GET /api/v1/me), as rolling
# three-hour sums: it would have fired once, in ALARM 2026-09-26 07:00 to about 11:00 UTC (at most 25 of 35: the
# console's CORS preflights answered 401), and in no other window. Missing data is no traffic, not an outage (the
# synthetic check covers that).
resource "aws_cloudwatch_metric_alarm" "api_4xx_rate" {
  alarm_name          = "developercards-${var.env}-api-4xx-rate"
  alarm_description   = "At least half of the app and console API requests got a 4xx in three hours (>= 5 requests and >= 5 4xx; the synthetic check, the unmatched routes and the server-to-server callbacks left out): an authorizer, CORS or client release that refuses users. Runbook: infra/RUNBOOK.md §7."
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = 50
  evaluation_periods  = 1
  datapoints_to_alarm = 1
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]

  metric_query {
    id          = "req"
    return_data = false
    metric {
      namespace   = var.metrics_namespace
      metric_name = aws_cloudwatch_log_metric_filter.api_user_requests.metric_transformation[0].name
      stat        = "Sum"
      period      = 10800
    }
  }

  metric_query {
    id          = "e4xx"
    return_data = false
    metric {
      namespace   = var.metrics_namespace
      metric_name = aws_cloudwatch_log_metric_filter.api_user_4xx.metric_transformation[0].name
      stat        = "Sum"
      period      = 10800
    }
  }

  metric_query {
    id          = "rate"
    expression  = "IF(FILL(req, 0) >= 5 AND FILL(e4xx, 0) >= 5, 100 * FILL(e4xx, 0) / FILL(req, 0), 0)"
    label       = "API 4xx rate % in 3 h (app and console only)"
    return_data = true
  }
}

# Throttling (the gateway's stage or route limits) and the app-level 429s (anonymous funnel budget, report daily
# limit, AI QA daily cap) all answer 429; none of them happened in normal traffic. On 2026-09-23 every request got a
# 429 for about 14 minutes; at 2026-10 traffic that is about 4-6 requests in 15 minutes (the tick, the probe's 3 API
# calls, the hourly source watch and runner), so 3 in 15 minutes catches it within one period.
resource "aws_cloudwatch_metric_alarm" "api_429" {
  alarm_name          = "developercards-${var.env}-api-429"
  alarm_description   = "The API answered 429 at least 3 times in 15 minutes (any caller, any stage): a gateway stage or route throttle, or an app-level limit. Runbook: infra/RUNBOOK.md §7."
  namespace           = var.metrics_namespace
  metric_name         = aws_cloudwatch_log_metric_filter.api_429.metric_transformation[0].name
  statistic           = "Sum"
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = 3
  period              = 900
  evaluation_periods  = 1
  datapoints_to_alarm = 1
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
}

# No such line in the 14 days to 2026-10-04 (filter-log-events, read-only): every app and console route has a JWT
# authorizer, so core-vpc verifies a bearer itself only on routes without one. 10 in 15 minutes is a stream of
# forged, foreign-pool or expired tokens, core-vpc unable to fetch a pool's JWKS (reason jwks_unavailable), or the
# local agent calling routes its token may not (agent_client_forbidden).
resource "aws_cloudwatch_metric_alarm" "core_vpc_auth_rejects" {
  alarm_name          = "developercards-${var.env}-core-vpc-auth-rejects"
  alarm_description   = "core-vpc rejected at least 10 bearer tokens in 15 minutes (warn lines tag=auth: failed verification, a failed console binding or the agent's token off its allow-list). Runbook: infra/RUNBOOK.md §7."
  namespace           = var.metrics_namespace
  metric_name         = aws_cloudwatch_log_metric_filter.core_vpc_auth_rejects.metric_transformation[0].name
  statistic           = "Sum"
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = 10
  period              = 900
  evaluation_periods  = 1
  datapoints_to_alarm = 1
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
}

# R28 review F2: the synthetic check's remote-config probe (the document the app reads at cold start, served by
# raw.githubusercontent.com) is advisory: it is left out of SyntheticCheckSuccess, so a GitHub incident or a document
# that breaks a rule can no longer hold developercards-<env>-synthetic-check-failing in ALARM and hide a real outage
# behind it. Its own metric, SyntheticRemoteConfigSuccess (services/synthetic-check emf.ADVISORY_METRICS), pages here
# after the same two consecutive failed runs. Not an outage by itself (the app keeps its last good copy), but a
# document that breaks a rule changes what users get, and an updateUrl off the App Store is a security incident.
# Missing data is not breaching: a run that did not happen is synthetic-check-failing's (missing data breaching), and
# before the synthetic-check deploy that adds this metric there is none. Like that alarm, actions_enabled is ignored
# after create, so silencing it through a long GitHub incident (RUNBOOK §8) is not drift that blocks the next apply.
resource "aws_cloudwatch_metric_alarm" "synthetic_remote_config_failing" {
  alarm_name          = "developercards-${var.env}-synthetic-remote-config-failing"
  alarm_description   = "The synthetic check could not read the app's remote-config document, or it broke a rule, in two consecutive 15-minute runs (SyntheticRemoteConfigSuccess maximum below 1). Not an outage by itself: the app keeps its last good copy. Runbook: infra/RUNBOOK.md §8 (remote-config)."
  namespace           = var.metrics_namespace
  metric_name         = "SyntheticRemoteConfigSuccess"
  statistic           = "Maximum"
  dimensions          = { Service = "synthetic-check" }
  comparison_operator = "LessThanThreshold"
  threshold           = 1
  period              = 900
  evaluation_periods  = 2
  datapoints_to_alarm = 2
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
  lifecycle {
    ignore_changes = [actions_enabled]
  }
}
