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
