terraform {
  required_providers {
    aws = {
      source = "hashicorp/aws"
    }
  }
}

locals {
  log_group_name = "/aws/lambda/${var.function_name}"
}
