terraform {
  required_providers {
    aws = {
      source = "hashicorp/aws"
    }
  }
}

locals {
  core_vpc_attachments = {
    sqs_exec = "arn:aws:iam::aws:policy/service-role/AWSLambdaSQSQueueExecutionRole"
    ec2_full = "arn:aws:iam::aws:policy/AmazonEC2FullAccess"
    rds_full = "arn:aws:iam::aws:policy/AmazonRDSFullAccess"
    sqs_full = "arn:aws:iam::aws:policy/AmazonSQSFullAccess"
    s3_full  = "arn:aws:iam::aws:policy/AmazonS3FullAccess"
    logs     = aws_iam_policy.core_vpc_logs.arn
    vpc      = aws_iam_policy.core_vpc_vpc.arn
  }
}

resource "aws_iam_role" "core_vpc" {
  assume_role_policy = jsonencode({
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "lambda.amazonaws.com"
      }
    }]
    Version = "2012-10-17"
  })
  force_detach_policies = false
  max_session_duration  = 3600
  name                  = var.core_vpc_role_name
  path                  = "/service-role/"
}

resource "aws_iam_policy" "core_vpc_logs" {
  name = "AWSLambdaBasicExecutionRole-033fad1a-ba7b-4152-ba28-7cf61f0c3423"
  path = "/service-role/"
  policy = jsonencode({
    Statement = [{
      Action   = "logs:CreateLogGroup"
      Effect   = "Allow"
      Resource = "arn:aws:logs:ap-southeast-2:622994489535:*"
      }, {
      Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
      Effect   = "Allow"
      Resource = ["arn:aws:logs:ap-southeast-2:622994489535:log-group:/aws/lambda/core-vpc:*"]
    }]
    Version = "2012-10-17"
  })
}

resource "aws_iam_policy" "core_vpc_vpc" {
  name = "AWSLambdaVPCAccessExecutionRole-0916ae0e-b0bc-43bf-9827-cf383da694db"
  path = "/service-role/"
  policy = jsonencode({
    Statement = [{
      Action   = ["ec2:CreateNetworkInterface", "ec2:DeleteNetworkInterface", "ec2:DescribeNetworkInterfaces"]
      Effect   = "Allow"
      Resource = "*"
    }]
    Version = "2012-10-17"
  })
}

resource "aws_iam_role_policy_attachment" "core_vpc" {
  for_each   = local.core_vpc_attachments
  role       = aws_iam_role.core_vpc.name
  policy_arn = each.value
}

resource "aws_iam_role" "edge_public" {
  assume_role_policy = jsonencode({
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "lambda.amazonaws.com"
      }
    }]
    Version = "2012-10-17"
  })
  force_detach_policies = false
  max_session_duration  = 3600
  name                  = var.edge_public_role_name
  path                  = "/service-role/"
}

resource "aws_iam_role_policy" "edge_public_cognito" {
  name = "edge-public-cognito"
  role = aws_iam_role.edge_public.name
  policy = jsonencode({
    Statement = [{
      Action   = ["cognito-idp:ListUsersInGroup", "cognito-idp:AdminCreateUser", "cognito-idp:AdminAddUserToGroup", "cognito-idp:AdminDisableUser", "cognito-idp:AdminDeleteUser"]
      Effect   = "Allow"
      Resource = "arn:aws:cognito-idp:ap-southeast-2:622994489535:userpool/ap-southeast-2_4Vf8uCXKt"
      Sid      = "CognitoUserManagement"
    }]
    Version = "2012-10-17"
  })
}

resource "aws_iam_policy" "edge_public_logs" {
  name = "AWSLambdaBasicExecutionRole-4587d025-3600-45c8-9409-a1ead0afc685"
  path = "/service-role/"
  policy = jsonencode({
    Statement = [{
      Action   = "logs:CreateLogGroup"
      Effect   = "Allow"
      Resource = "arn:aws:logs:ap-southeast-2:622994489535:*"
      }, {
      Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
      Effect   = "Allow"
      Resource = ["arn:aws:logs:ap-southeast-2:622994489535:log-group:/aws/lambda/edge-public:*"]
    }]
    Version = "2012-10-17"
  })
}

resource "aws_iam_role_policy_attachment" "edge_public_logs" {
  role       = aws_iam_role.edge_public.name
  policy_arn = aws_iam_policy.edge_public_logs.arn
}

resource "aws_iam_role" "snowflake" {
  assume_role_policy = jsonencode({
    Statement = [{
      Action = "sts:AssumeRole"
      Condition = {
        StringEquals = {
          "sts:ExternalId" = var.snowflake_external_id
        }
      }
      Effect = "Allow"
      Principal = {
        AWS = "arn:aws:iam::665557889528:user/qato1000-s"
      }
    }]
    Version = "2012-10-17"
  })
  force_detach_policies = false
  max_session_duration  = 3600
  name                  = "snowflake-recallsmith-s3-role"
  path                  = "/"

  lifecycle {
    ignore_changes = [assume_role_policy]
  }
}

resource "aws_iam_policy" "snowflake_read" {
  name = "snowflake-recallsmith-s3-read"
  path = "/"
  policy = jsonencode({
    Statement = [{
      Action = "s3:ListBucket"
      Condition = {
        StringLike = {
          "s3:prefix" = ["analytics/raw/review_events", "analytics/raw/review_events/*"]
        }
      }
      Effect   = "Allow"
      Resource = "arn:aws:s3:::core-vpc"
      Sid      = "ListAnalyticsPrefix"
      }, {
      Action   = "s3:GetObject"
      Effect   = "Allow"
      Resource = "arn:aws:s3:::core-vpc/analytics/raw/review_events/*"
      Sid      = "ReadAnalyticsObjects"
    }]
    Version = "2012-10-17"
  })
}

resource "aws_iam_role_policy_attachment" "snowflake" {
  for_each = {
    read    = aws_iam_policy.snowflake_read.arn
    s3_full = "arn:aws:iam::aws:policy/AmazonS3FullAccess"
  }
  role       = aws_iam_role.snowflake.name
  policy_arn = each.value
}

resource "aws_iam_role" "rds_monitoring" {
  assume_role_policy = jsonencode({
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "monitoring.rds.amazonaws.com"
      }
      Sid = ""
    }]
    Version = "2012-10-17"
  })
  force_detach_policies = false
  max_session_duration  = 3600
  name                  = "rds-monitoring-role"
  path                  = "/"
}

resource "aws_iam_role_policy_attachment" "rds_monitoring" {
  role       = aws_iam_role.rds_monitoring.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonRDSEnhancedMonitoringRole"
}
