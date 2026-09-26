terraform {
  required_providers {
    aws = {
      source                = "hashicorp/aws"
      configuration_aliases = [aws.use1]
    }
  }
}

locals {
  content_origin_id = "core-vpc.s3.ap-southeast-2.amazonaws.com-mj5ly8krcla"
  console_origin_id = "console-s3"
}
