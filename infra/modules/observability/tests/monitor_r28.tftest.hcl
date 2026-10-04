# R28 MONITOR: the user-facing refusal alarms (alarms_r28.tf) and the SLO's synthetic-check subtraction. Offline only:
# the aws provider is mocked, so this never reaches AWS. Run from the module directory:
#   terraform -chdir=infra/modules/observability init -backend=false -input=false
#   terraform -chdir=infra/modules/observability test

mock_provider "aws" {}

# The topic ARN is only known after apply; pin it so the alarm actions can be compared at plan time.
override_resource {
  target          = aws_sns_topic.alerts
  override_during = plan
  values = {
    arn = "arn:aws:sns:ap-southeast-2:000000000000:developercards-alerts"
  }
}

# The access log group's name is a plain string; keep the mock from inventing one.
override_resource {
  target          = aws_cloudwatch_log_group.api_access
  override_during = plan
  values = {
    name = "/aws/apigateway/developercards-api"
  }
}

variables {
  env                              = "prod"
  account_id                       = "000000000000"
  budget_name                      = "test-budget"
  budget_limit                     = "60"
  alert_email                      = "alerts@example.com"
  region                           = "ap-southeast-2"
  api_id                           = "testapi"
  api_name                         = "developercards-api"
  core_vpc_function_name           = "core-vpc"
  worker_function_name             = "worker-lambda"
  publish_queue_name               = "publish"
  publish_dlq_name                 = "publish-dlq"
  db_identifier                    = "developercards"
  webhook_queue_name               = "webhook"
  webhook_dlq_name                 = "webhook-dlq"
  webhook_dispatcher_function_name = "webhook-dispatcher"
  ai_qa_queue_name                 = "ai-qa"
  ai_qa_dlq_name                   = "ai-qa-dlq"
  ai_qa_function_name              = "ai-qa"
  notify_queue_name                = "notify"
  notify_dlq_name                  = "notify-dlq"
  notifier_function_name           = "notifier"
  source_watcher_function_name     = "source-watcher"
}

run "access_log_metric_filters" {
  command = plan

  assert {
    condition = (
      aws_cloudwatch_log_metric_filter.api_user_requests.log_group_name == "/aws/apigateway/developercards-api" &&
      aws_cloudwatch_log_metric_filter.api_user_4xx.log_group_name == "/aws/apigateway/developercards-api" &&
      aws_cloudwatch_log_metric_filter.api_429.log_group_name == "/aws/apigateway/developercards-api"
    )
    error_message = "the three API filters must read the API access log group"
  }

  assert {
    condition     = aws_cloudwatch_log_metric_filter.api_user_requests.pattern == "{ ($.userAgent != \"DeveloperCards-Synthetic/*\") && ($.routeKey != \"ANY /{proxy+}\") && ($.routeKey != \"$default\") }"
    error_message = "ApiUserRequests must leave out the synthetic check (by User-Agent) and the unmatched routes"
  }

  assert {
    condition     = aws_cloudwatch_log_metric_filter.api_user_4xx.pattern == "{ ($.status = \"4*\") && ($.userAgent != \"DeveloperCards-Synthetic/*\") && ($.routeKey != \"ANY /{proxy+}\") && ($.routeKey != \"$default\") }"
    error_message = "ApiUser4xx must be the 4xx of exactly the requests ApiUserRequests counts"
  }

  assert {
    condition     = aws_cloudwatch_log_metric_filter.api_429.pattern == "{ $.status = \"429\" }"
    error_message = "Api429Responses counts every 429, the probe's included"
  }

  assert {
    condition = alltrue([for f in [
      aws_cloudwatch_log_metric_filter.api_user_requests,
      aws_cloudwatch_log_metric_filter.api_user_4xx,
      aws_cloudwatch_log_metric_filter.api_429,
      aws_cloudwatch_log_metric_filter.core_vpc_auth_rejects,
      ] : (
      f.metric_transformation[0].namespace == "DeveloperCards" &&
      f.metric_transformation[0].value == "1" &&
      f.metric_transformation[0].default_value == null &&
      f.metric_transformation[0].dimensions == null
    )])
    error_message = "every R28 filter emits 1 per match in DeveloperCards, with no dimension and no default value"
  }
}

run "core_vpc_auth_rejects" {
  command = plan

  assert {
    condition     = aws_cloudwatch_log_metric_filter.core_vpc_auth_rejects.log_group_name == "/aws/lambda/core-vpc"
    error_message = "without core_vpc_log_group_name the filter reads /aws/lambda/<core_vpc_function_name>"
  }

  assert {
    condition     = aws_cloudwatch_log_metric_filter.core_vpc_auth_rejects.pattern == "{ ($.tag = \"auth\") && ($.level = \"warn\") }"
    error_message = "the filter counts Auth.cs's warn lines only (the malformed-bearer info line is not a reject)"
  }

  assert {
    condition = (
      aws_cloudwatch_metric_alarm.core_vpc_auth_rejects.alarm_name == "developercards-prod-core-vpc-auth-rejects" &&
      aws_cloudwatch_metric_alarm.core_vpc_auth_rejects.metric_name == "CoreVpcAuthRejects" &&
      aws_cloudwatch_metric_alarm.core_vpc_auth_rejects.statistic == "Sum" &&
      aws_cloudwatch_metric_alarm.core_vpc_auth_rejects.threshold == 10 &&
      aws_cloudwatch_metric_alarm.core_vpc_auth_rejects.period == 900 &&
      aws_cloudwatch_metric_alarm.core_vpc_auth_rejects.treat_missing_data == "notBreaching"
    )
    error_message = "core-vpc-auth-rejects: >= 10 in 15 minutes, missing data not breaching"
  }
}

run "core_vpc_log_group_from_the_api_module" {
  command = plan

  variables {
    core_vpc_log_group_name = "/aws/lambda/core-vpc-from-api"
  }

  assert {
    condition     = aws_cloudwatch_log_metric_filter.core_vpc_auth_rejects.log_group_name == "/aws/lambda/core-vpc-from-api"
    error_message = "the filter reads the log group the root passes"
  }
}

run "refusal_alarms" {
  command = plan

  assert {
    condition = alltrue([for a in [
      aws_cloudwatch_metric_alarm.api_4xx_rate,
      aws_cloudwatch_metric_alarm.api_429,
      aws_cloudwatch_metric_alarm.core_vpc_auth_rejects,
      ] : (
      a.alarm_actions == toset(["arn:aws:sns:ap-southeast-2:000000000000:developercards-alerts"]) &&
      a.ok_actions == toset(["arn:aws:sns:ap-southeast-2:000000000000:developercards-alerts"]) &&
      a.actions_enabled != false &&
      a.evaluation_periods == 1 &&
      a.datapoints_to_alarm == 1 &&
      a.comparison_operator == "GreaterThanOrEqualToThreshold"
    )])
    error_message = "each refusal alarm notifies the alerts topic on ALARM and OK after one breaching period"
  }

  assert {
    condition = (
      aws_cloudwatch_metric_alarm.api_4xx_rate.alarm_name == "developercards-prod-api-4xx-rate" &&
      aws_cloudwatch_metric_alarm.api_4xx_rate.threshold == 50 &&
      aws_cloudwatch_metric_alarm.api_4xx_rate.treat_missing_data == "notBreaching" &&
      length(aws_cloudwatch_metric_alarm.api_4xx_rate.metric_query) == 3
    )
    error_message = "api-4xx-rate: >= 50 % from three queries, missing data not breaching"
  }

  assert {
    condition = length([for q in aws_cloudwatch_metric_alarm.api_4xx_rate.metric_query : q
      if q.id == "rate" && q.return_data == true &&
    q.expression == "IF(FILL(req, 0) >= 10 AND FILL(e4xx, 0) >= 5, 100 * FILL(e4xx, 0) / FILL(req, 0), 0)"]) == 1
    error_message = "api-4xx-rate is a ratio of 4xx to requests with the >= 10 request and >= 5 4xx guards"
  }

  assert {
    condition = toset([for q in aws_cloudwatch_metric_alarm.api_4xx_rate.metric_query : "${q.id}:${q.metric[0].metric_name}:${q.metric[0].period}:${q.metric[0].stat}"
    if length(q.metric) > 0]) == toset(["req:ApiUserRequests:3600:Sum", "e4xx:ApiUser4xx:3600:Sum"])
    error_message = "api-4xx-rate reads the hourly sums of the two access-log metrics"
  }

  assert {
    condition = (
      aws_cloudwatch_metric_alarm.api_429.alarm_name == "developercards-prod-api-429" &&
      aws_cloudwatch_metric_alarm.api_429.metric_name == "Api429Responses" &&
      aws_cloudwatch_metric_alarm.api_429.namespace == "DeveloperCards" &&
      aws_cloudwatch_metric_alarm.api_429.statistic == "Sum" &&
      aws_cloudwatch_metric_alarm.api_429.threshold == 3 &&
      aws_cloudwatch_metric_alarm.api_429.period == 900 &&
      aws_cloudwatch_metric_alarm.api_429.treat_missing_data == "notBreaching"
    )
    error_message = "api-429: >= 3 in 15 minutes, missing data not breaching"
  }
}

run "slo_leaves_out_the_synthetic_checks_requests" {
  command = plan

  assert {
    condition = length([for q in aws_cloudwatch_metric_alarm.slo_api_availability_burn_1h.metric_query : q
    if q.id == "burn" && q.expression == "IF(total >= 24 AND bad >= 2, (bad / total) / 0.005, 0)"]) == 1
    error_message = "the 1-hour fast-burn guard is twice the probe's 12 API requests an hour"
  }

  assert {
    condition = alltrue([for a in [aws_cloudwatch_metric_alarm.slo_api_availability_burn_6h, aws_cloudwatch_metric_alarm.slo_api_availability_burn_30m] :
      length([for q in a.metric_query : q if q.id == "s4xx" && q.metric[0].metric_name == "4xx" &&
      q.metric[0].dimensions == tomap({ ApiId = "testapi", Stage = "$default", Resource = "/api/v1/sync/{proxy+}", Method = "ANY" })]) == 1 &&
      length([for q in a.metric_query : q if q.id == "user_total" && q.expression == "total - FILL(hc, 0) - FILL(m4xx, 0) - FILL(s4xx, 0)"]) == 1
    ])
    error_message = "the slow-burn children subtract the probe's sync 4xx as well as GET /health and GET /api/v1/me"
  }

  assert {
    condition = length([for w in jsondecode(aws_cloudwatch_dashboard.prod.dashboard_body).widgets : w
    if w.properties.title == "API availability error budget remaining %" && strcontains(jsonencode(w), "/api/v1/sync/{proxy+}")]) == 1
    error_message = "the availability budget widget subtracts the probe's sync 4xx too"
  }

  assert {
    condition = length([for w in jsondecode(aws_cloudwatch_dashboard.prod.dashboard_body).widgets : w
    if w.x == 12 && w.y == 48 && w.width == 12 && w.properties.title == "API 4xx rate (users) / 429 / core-vpc auth rejects"]) == 1
    error_message = "the R28 widget sits beside API 5xx by route"
  }
}
