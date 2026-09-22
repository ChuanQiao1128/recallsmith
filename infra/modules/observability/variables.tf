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
