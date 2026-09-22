variable "env" {
  type = string
}

variable "db_identifier" {
  type = string
}

variable "db_subnet_group_name" {
  type = string
}

variable "content_bucket_name" {
  type = string
}

variable "premium_bucket_name" {
  type = string
}

variable "vpc_id" {
  type = string
}

variable "subnet_ids" {
  type = list(string)
}

variable "lambda_security_group_ids" {
  type = list(string)
}

variable "rds_security_group_ids" {
  type = list(string)
}

variable "rds_monitoring_role_arn" {
  type = string
}

variable "tags" {
  type    = map(string)
  default = {}
}
