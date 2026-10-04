# R28 MONITOR (user-perspective review 2026-10-04, G4) — what users are refused, on the existing alerts topic.
#
# The HTTP API publishes only Count, 4xx, 5xx, Latency, IntegrationLatency and DataProcessed to AWS/ApiGateway:
# no throttle metric (a throttled request is one more 4xx) and no way to leave a caller out. So these alarms read
# the API access log (gateway.tf api_access_log_format: JSON with status, routeKey and userAgent) through metric
# filters, which can:
#   - leave out the synthetic check by its User-Agent (services/synthetic-check CHECK_USER_AGENT
#     "DeveloperCards-Synthetic/1.0 (+https://developercards.app)"): its token-less GET /api/v1/me and
#     GET /api/v1/sync/progress are 8 of the API's 4xx every hour by design (96 a day against about 6 real ones);
#   - leave out the unmatched routes ANY /{proxy+} and $default: the console calls only /api/v1/admin/* and
#     /api/v1/authoring/*, the app only exact routes, so these see scanners and retired paths (99 of their 106
#     requests in the 14 days to 2026-10-04 were 4xx);
#   - count 429 whoever was refused, the probe included (a throttled probe is the 2026-09-23 incident).
# Both stages write to this one log group and the line carries no stage; dev saw 1 request in that week.
# services/synthetic-check/tests/test_infra_contract.py keeps the User-Agent here equal to the probe's.
#
# core-vpc's own bearer check (src_C/Shared/RecallSmith.Lambda.Common/Auth.cs): a token the JWT authorizer did not
# already verify (routes with no authorizer, direct invokes) that fails verification, or a verified admin-group
# token that fails the console binding, writes one structured warn line
# {"ts":…,"level":"warn","tag":"auth","reason":<code>,"traceId","method","path"} (never a token or a claim). A
# token that is not JWT-shaped (webhook secrets) is an info line and is not counted. Lambda's Text format prefixes
# the JSON with "<time>\t<request id>\t<level>\t"; a JSON filter still matches it (checked with
# test-metric-filter on 2026-10-04).
#
# Runbook: infra/RUNBOOK.md §7 "User-facing refusals (R28 MONITOR)".

locals {
  synthetic_user_agent_prefix = "DeveloperCards-Synthetic/"
  api_user_filter             = "($.userAgent != \"${local.synthetic_user_agent_prefix}*\") && ($.routeKey != \"ANY /{proxy+}\") && ($.routeKey != \"$default\")"
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

# Most of the app's and console's requests refused in one hour. Guards: >= 10 requests and >= 5 4xx in the hour
# (the probe and the unmatched routes left out), so one client's retries in a quiet hour never page. Replayed
# read-only over 2026-09-20..10-04 with the route metrics as a stand-in: 58 of 336 hours met the request guard and
# the alarm would have fired in 2 (2026-09-26 07:00 and 08:00 UTC, 11/11 and 18/25: the console's CORS preflights
# answered 401). Missing data is no traffic, not an outage (the synthetic check covers that).
resource "aws_cloudwatch_metric_alarm" "api_4xx_rate" {
  alarm_name          = "developercards-${var.env}-api-4xx-rate"
  alarm_description   = "At least half of the app and console API requests got a 4xx in one hour (>= 10 requests and >= 5 4xx; the synthetic check and the unmatched routes ANY /{proxy+} and $default left out): an authorizer, CORS or client release that refuses users. Runbook: infra/RUNBOOK.md §7."
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
      period      = 3600
    }
  }

  metric_query {
    id          = "e4xx"
    return_data = false
    metric {
      namespace   = var.metrics_namespace
      metric_name = aws_cloudwatch_log_metric_filter.api_user_4xx.metric_transformation[0].name
      stat        = "Sum"
      period      = 3600
    }
  }

  metric_query {
    id          = "rate"
    expression  = "IF(FILL(req, 0) >= 10 AND FILL(e4xx, 0) >= 5, 100 * FILL(e4xx, 0) / FILL(req, 0), 0)"
    label       = "API 4xx rate % (synthetic check and unmatched routes excluded)"
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
# forged, foreign-pool or expired tokens, or core-vpc unable to fetch a pool's JWKS (reason jwks_unavailable).
resource "aws_cloudwatch_metric_alarm" "core_vpc_auth_rejects" {
  alarm_name          = "developercards-${var.env}-core-vpc-auth-rejects"
  alarm_description   = "core-vpc rejected at least 10 bearer tokens in 15 minutes (warn lines tag=auth: failed verification or a failed console binding). Runbook: infra/RUNBOOK.md §7."
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
