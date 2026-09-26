variable "env" {
  type = string
}

variable "account_id" {
  type = string
}

variable "region" {
  type = string
}

variable "core_vpc_role_name" {
  type = string
}

variable "edge_public_role_name" {
  type = string
}

variable "manage_cognito" {
  type = bool
}

variable "console_pool_id" {
  type = string
}

variable "mobile_pool_id" {
  type = string
}

variable "snowflake_external_id" {
  type      = string
  sensitive = true
  default   = null
}

variable "tags" {
  type    = map(string)
  default = {}
}

variable "worker_role_name" {
  type = string
} # prod "developercards-worker-lambda-role"

variable "content_bucket_name" {
  type = string
} # prod "core-vpc"

variable "premium_bucket_name" {
  type = string
} # prod "core-vpc-premium"

variable "publish_queue_name" {
  type = string
} # prod "recallsmith-publish-jobs"

variable "core_vpc_function_name" {
  type = string
} # prod "core-vpc"

variable "worker_function_name" {
  type = string
} # prod "worker-lambda"
