variable "account_id" {
  type    = string
  default = "622994489535"
}

variable "region" {
  type    = string
  default = "ap-southeast-2"
}

variable "vpc_id" {
  type    = string
  default = "vpc-04af44dd8f5f48717"
}

variable "subnet_ids" {
  type    = list(string)
  default = ["subnet-0cc7a99faf631cee2", "subnet-0dd0ac42e1bb9648a", "subnet-0a365ac32e28958ed"]
}

variable "core_vpc_security_group_ids" {
  type    = list(string)
  default = ["sg-00ad6c62d292a475e", "sg-04af3c6fa45f10113"]
}

variable "worker_security_group_ids" {
  type    = list(string)
  default = ["sg-00ad6c62d292a475e", "sg-04af3c6fa45f10113", "sg-0d2541aec08b1a215", "sg-0fbc6607e6473cbd3"]
}

variable "rds_security_group_ids" {
  type    = list(string)
  default = ["sg-0d2541aec08b1a215", "sg-0fbc6607e6473cbd3"]
}

variable "console_pool_id" {
  type    = string
  default = "ap-southeast-2_4Vf8uCXKt"
}

variable "mobile_pool_id" {
  type    = string
  default = "ap-southeast-2_04hd6iisb"
}

variable "cors_allowed_origins" {
  type    = list(string)
  default = ["http://localhost:5173", "https://d12pfy1rhi3ekm.cloudfront.net"]
}

variable "snowflake_external_id" {
  type      = string
  sensitive = true
  default   = null
}

variable "alert_email" {
  type      = string
  sensitive = true
}
