terraform {
  required_providers {
    aws = {
      source = "hashicorp/aws"
    }
  }
}

locals {
  buckets = {
    content = var.content_bucket_name
    premium = var.premium_bucket_name
  }
}
