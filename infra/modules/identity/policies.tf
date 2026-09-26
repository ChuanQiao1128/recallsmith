# E05 — per-function execution roles with scoped inline policies (E00 §2.5, §3.2).
# Every document is built from var.* strings only (never from a resource or data
# attribute) so `change.after.policy` is fully known in the plan JSON and can be
# fed to `aws iam simulate-custom-policy` before anything is applied.

locals {
  content_bucket_arn = "arn:aws:s3:::${var.content_bucket_name}"
  premium_bucket_arn = "arn:aws:s3:::${var.premium_bucket_name}"
  publish_queue_arn  = "arn:aws:sqs:${var.region}:${var.account_id}:${var.publish_queue_name}"
  core_vpc_log_arn   = "arn:aws:logs:${var.region}:${var.account_id}:log-group:/aws/lambda/${var.core_vpc_function_name}:*"
  worker_log_arn     = "arn:aws:logs:${var.region}:${var.account_id}:log-group:/aws/lambda/${var.worker_function_name}:*"
  # The six EC2 actions of the AWS-managed AWSLambdaVPCAccessExecutionRole (v3) — the only Resource "*".
  eni_actions = [
    "ec2:CreateNetworkInterface",
    "ec2:DescribeNetworkInterfaces",
    "ec2:DescribeSubnets",
    "ec2:DeleteNetworkInterface",
    "ec2:AssignPrivateIpAddresses",
    "ec2:UnassignPrivateIpAddresses",
  ]
}

resource "aws_iam_role" "worker" {
  name = var.worker_role_name
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "LambdaAssume"
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "core_vpc" {
  name = "developercards-core-vpc-scoped"
  role = aws_iam_role.core_vpc.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "S3Content"
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject"]
        Resource = ["${local.content_bucket_arn}/content/*", "${local.content_bucket_arn}/analytics/*"]
      },
      {
        Sid      = "S3Premium"
        Effect   = "Allow"
        Action   = ["s3:GetObject"]
        Resource = ["${local.premium_bucket_arn}/*"]
      },
      {
        Sid      = "S3Head"
        Effect   = "Allow"
        Action   = ["s3:ListBucket"]
        Resource = [local.content_bucket_arn, local.premium_bucket_arn]
      },
      {
        Sid      = "SqsSend"
        Effect   = "Allow"
        Action   = ["sqs:SendMessage", "sqs:GetQueueAttributes"]
        Resource = [local.publish_queue_arn]
      },
      {
        Sid      = "Logs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = [local.core_vpc_log_arn]
      },
      {
        Sid      = "Eni"
        Effect   = "Allow"
        Action   = local.eni_actions
        Resource = "*"
      },
    ]
  })
}

resource "aws_iam_role_policy" "worker" {
  name = "developercards-worker-lambda-scoped"
  role = aws_iam_role.worker.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "S3Builds"
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject"]
        Resource = ["${local.content_bucket_arn}/content/*", "${local.premium_bucket_arn}/*"]
      },
      {
        Sid      = "S3Head"
        Effect   = "Allow"
        Action   = ["s3:ListBucket"]
        Resource = [local.content_bucket_arn, local.premium_bucket_arn]
      },
      {
        Sid      = "SqsConsume"
        Effect   = "Allow"
        Action   = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes", "sqs:ChangeMessageVisibility"]
        Resource = [local.publish_queue_arn]
      },
      {
        Sid      = "Logs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = [local.worker_log_arn]
      },
      {
        Sid      = "Eni"
        Effect   = "Allow"
        Action   = local.eni_actions
        Resource = "*"
      },
    ]
  })
}
