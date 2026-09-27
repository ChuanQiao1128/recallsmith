# R18A A10 — automation roles (A00 §17.2): the notifier and source-watcher execution roles, the EventBridge
# Scheduler role that invokes their `prod` aliases, and core-vpc's send grant on the notify queue. Documents are
# built from var.* strings only so change.after.policy is known in the plan and can be simulated. No SES grant
# here (A11) and no KMS statement (the AWS-managed aws/ssm key policy already allows decrypt through SSM).

locals {
  notify_queue_arn         = "arn:aws:sqs:${var.region}:${var.account_id}:${var.notify_queue_name}"
  notifier_log_arn         = "arn:aws:logs:${var.region}:${var.account_id}:log-group:/aws/lambda/${var.notifier_function_name}:*"
  source_watcher_log_arn   = "arn:aws:logs:${var.region}:${var.account_id}:log-group:/aws/lambda/${var.source_watcher_function_name}:*"
  notifier_alias_arn       = "arn:aws:lambda:${var.region}:${var.account_id}:function:${var.notifier_function_name}:prod"
  source_watcher_alias_arn = "arn:aws:lambda:${var.region}:${var.account_id}:function:${var.source_watcher_function_name}:prod"
}

resource "aws_iam_role" "notifier" {
  name = "developercards-notifier-role"
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

# notify-recipient is created by A11; "-previous" exists only during a secret rotation and is created by hand.
resource "aws_iam_role_policy" "notifier" {
  name = "developercards-notifier-scoped"
  role = aws_iam_role.notifier.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "SqsConsume"
        Effect   = "Allow"
        Action   = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes", "sqs:ChangeMessageVisibility"]
        Resource = [local.notify_queue_arn]
      },
      {
        Sid      = "Logs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = [local.notifier_log_arn]
      },
      {
        Sid      = "SsmRead"
        Effect   = "Allow"
        Action   = ["ssm:GetParameter"]
        Resource = ["${local.ssm_param_prefix}/notifier-secret", "${local.ssm_param_prefix}/notifier-secret-previous", "${local.ssm_param_prefix}/notify-recipient"]
      },
    ]
  })
}

resource "aws_iam_role" "source_watcher" {
  name = "developercards-source-watcher-role"
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

resource "aws_iam_role_policy" "source_watcher" {
  name = "developercards-source-watcher-scoped"
  role = aws_iam_role.source_watcher.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "Logs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = [local.source_watcher_log_arn]
      },
      {
        Sid      = "SsmRead"
        Effect   = "Allow"
        Action   = ["ssm:GetParameter"]
        Resource = ["${local.ssm_param_prefix}/source-watch-secret", "${local.ssm_param_prefix}/source-watch-secret-previous"]
      },
    ]
  })
}

# aws:SourceAccount keeps another account's schedule from assuming this role (confused deputy).
resource "aws_iam_role" "automation_scheduler" {
  name = "developercards-automation-scheduler-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "SchedulerAssume"
      Effect    = "Allow"
      Principal = { Service = "scheduler.amazonaws.com" }
      Action    = "sts:AssumeRole"
      Condition = { StringEquals = { "aws:SourceAccount" = var.account_id } }
    }]
  })
}

# The `prod` aliases only; the unqualified functions and every other function stay denied.
resource "aws_iam_role_policy" "automation_scheduler" {
  name = "developercards-automation-scheduler-invoke"
  role = aws_iam_role.automation_scheduler.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid      = "InvokeAutomationLambdas"
      Effect   = "Allow"
      Action   = ["lambda:InvokeFunction"]
      Resource = [local.source_watcher_alias_arn, local.notifier_alias_arn]
    }]
  })
}

# Only core-vpc enqueues rendered emails; the worker gets nothing.
resource "aws_iam_role_policy" "core_vpc_notify_send" {
  name = "developercards-core-vpc-notify-send"
  role = aws_iam_role.core_vpc.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid      = "SqsSendNotify"
      Effect   = "Allow"
      Action   = ["sqs:SendMessage", "sqs:GetQueueAttributes"]
      Resource = [local.notify_queue_arn]
    }]
  })
}
