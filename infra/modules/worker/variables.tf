variable "env" {
  type = string
}

variable "queue_name" {
  type = string
}

variable "function_name" {
  type = string
}

variable "alias_name" {
  type = string
}

variable "role_arn" {
  type = string
}

variable "subnet_ids" {
  type = list(string)
}

variable "security_group_ids" {
  type = list(string)
}

variable "tags" {
  type    = map(string)
  default = {}
}

variable "webhook_queue_name" {
  type = string
}

variable "webhook_dlq_name" {
  type = string
}

variable "webhook_dispatcher_function_name" {
  type = string
}

variable "webhook_dispatcher_role_arn" {
  type = string
}

variable "webhook_dispatcher_environment" {
  type = map(string)
}

variable "ai_qa_queue_name" {
  type = string
}

variable "ai_qa_dlq_name" {
  type = string
}

variable "ai_qa_function_name" {
  type = string
}

variable "ai_qa_role_arn" {
  type = string
}

variable "ai_qa_environment" {
  type = map(string)
}

variable "notify_queue_name" {
  type = string
}

variable "notify_dlq_name" {
  type = string
}

variable "notifier_function_name" {
  type = string
}

variable "notifier_role_arn" {
  type = string
}

variable "notifier_environment" {
  type = map(string)
}

variable "source_watcher_function_name" {
  type = string
}

variable "source_watcher_role_arn" {
  type = string
}

variable "source_watcher_environment" {
  type = map(string)
}

variable "automation_scheduler_role_arn" {
  type = string
}
