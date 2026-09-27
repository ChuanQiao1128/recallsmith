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
