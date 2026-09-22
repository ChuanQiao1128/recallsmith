variable "env" {
  type = string
}

variable "api_name" {
  type = string
}

variable "core_vpc_function_name" {
  type = string
}

variable "core_vpc_alias_name" {
  type = string
}

variable "core_vpc_role_arn" {
  type = string
}

variable "edge_public_function_name" {
  type = string
}

variable "edge_public_role_arn" {
  type = string
}

variable "subnet_ids" {
  type = list(string)
}

variable "security_group_ids" {
  type = list(string)
}

variable "console_pool_endpoint" {
  type = string
}

variable "console_client_id" {
  type = string
}

variable "cors_allowed_origins" {
  type = list(string)
}

variable "tags" {
  type    = map(string)
  default = {}
}

variable "access_log_destination_arn" { type = string }

variable "throttling_rate_limit" {
  description = "Steady-state request rate for the $default stage. NEVER 0 — API Gateway reads 0 as \"throttle everything\" (2026-09-23 incident)."
  type        = number
  default     = 200
  validation {
    condition     = var.throttling_rate_limit > 0
    error_message = "throttling_rate_limit must be > 0; 0 throttles every request."
  }
}

variable "throttling_burst_limit" {
  description = "Burst capacity for the $default stage. NEVER 0."
  type        = number
  default     = 400
  validation {
    condition     = var.throttling_burst_limit > 0
    error_message = "throttling_burst_limit must be > 0; 0 throttles every request."
  }
}

variable "dev_throttling_rate_limit" {
  description = "Steady-state request rate for the dev stage. NEVER 0."
  type        = number
  default     = 50
  validation {
    condition     = var.dev_throttling_rate_limit > 0
    error_message = "dev_throttling_rate_limit must be > 0; 0 throttles every request."
  }
}

variable "dev_throttling_burst_limit" {
  description = "Burst capacity for the dev stage. NEVER 0."
  type        = number
  default     = 100
  validation {
    condition     = var.dev_throttling_burst_limit > 0
    error_message = "dev_throttling_burst_limit must be > 0; 0 throttles every request."
  }
}
