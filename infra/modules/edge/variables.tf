variable "env" {
  type = string
}

variable "content_bucket_name" {
  type = string
}

variable "content_bucket_arn" {
  type = string
}

variable "content_bucket_regional_domain_name" {
  type = string
}

variable "console_bucket_name" {
  type = string
}

variable "core_vpc_role_arn" {
  type = string
}

variable "tags" {
  type    = map(string)
  default = {}
}
