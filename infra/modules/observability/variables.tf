variable "env" {
  type = string
}

variable "account_id" {
  type = string
}

variable "budget_name" {
  type = string
}

variable "budget_limit" {
  type = string
}

variable "tags" {
  type    = map(string)
  default = {}
}

variable "alert_email" {
  # Not marked sensitive at the module boundary on purpose: the budget subscriber is an
  # adopted, non-sensitive attribute, and re-marking it sensitive would show a spurious
  # notification diff on every import/plan. The root variable stays sensitive (never printed).
  type = string
}

variable "region" { type = string }

variable "api_id" { type = string }

variable "api_name" { type = string }

variable "api_stage_name" {
  type    = string
  default = "$default"
}

variable "core_vpc_function_name" { type = string }

variable "worker_function_name" { type = string }

variable "publish_queue_name" { type = string }

variable "publish_dlq_name" { type = string }

variable "db_identifier" { type = string }

variable "metrics_namespace" {
  type    = string
  default = "DeveloperCards"
}

variable "webhook_dlq_name" { type = string }

variable "webhook_dispatcher_function_name" { type = string }

variable "ai_qa_dlq_name" { type = string }

variable "ai_qa_function_name" { type = string }

variable "webhook_queue_name" { type = string }

variable "ai_qa_queue_name" { type = string }

# AI_QA_DAILY_USD_CAP (10 USD, contract §7.2) in the unit AiQaEstimatedCostMicroUsd is emitted in.
variable "ai_qa_daily_cost_cap_micro_usd" {
  type    = number
  default = 10000000
}

variable "notify_dlq_name" { type = string }

variable "notifier_function_name" { type = string }

variable "source_watcher_function_name" { type = string }
