# R26 P03: the analytics outbox is retired, so the dashboard carries no OutboxPending widget and no
# widget overlaps the row it left. Offline only (mocked aws provider). Run from the module directory:
#   terraform -chdir=infra/modules/observability init -backend=false -input=false
#   terraform -chdir=infra/modules/observability test
# The removed outbox_backlog alarm is checked by infra/scripts/tests/test_r26_snowflake_retired.py
# (a test cannot name a resource that no longer exists).

mock_provider "aws" {}

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

run "no_outbox_widget" {
  command = plan

  assert {
    condition = length([for w in jsondecode(aws_cloudwatch_dashboard.prod.dashboard_body).widgets : w
    if strcontains(jsonencode(w), "OutboxPending")]) == 0
    error_message = "the dashboard still shows the retired OutboxPending metric"
  }

  assert {
    condition = length([for w in jsondecode(aws_cloudwatch_dashboard.prod.dashboard_body).widgets : w
    if w.y == 24 && w.x == 0 && w.width == 24 && w.properties.title == "Latency p95 by Route (top 10)"]) == 1
    error_message = "the p95-by-route widget should span the row the OutboxPending widget left"
  }
}
