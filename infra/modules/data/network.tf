data "aws_vpc" "main" {
  id = var.vpc_id
}

data "aws_subnet" "this" {
  for_each = toset(var.subnet_ids)
  id       = each.value
}

data "aws_security_group" "lambda" {
  for_each = toset(var.lambda_security_group_ids)
  id       = each.value
}

data "aws_security_group" "rds" {
  for_each = toset(var.rds_security_group_ids)
  id       = each.value
}

data "aws_kms_alias" "rds" {
  name = "alias/aws/rds"
}
