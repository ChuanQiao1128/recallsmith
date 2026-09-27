# R18 — execution roles and send grants for the Python Lambdas (contract §10). Documents are built from var.* strings only so change.after.policy is known in the plan and can be simulated.

locals {
  webhook_queue_arn          = "arn:aws:sqs:${var.region}:${var.account_id}:${var.webhook_queue_name}"
  webhook_dispatcher_log_arn = "arn:aws:logs:${var.region}:${var.account_id}:log-group:/aws/lambda/${var.webhook_dispatcher_function_name}:*"
  ssm_param_prefix           = "arn:aws:ssm:${var.region}:${var.account_id}:parameter/developercards/${var.env}"
}

resource "aws_iam_role" "webhook_dispatcher" {
  name = "developercards-webhook-dispatcher-role"
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

# No KMS statement: the AWS-managed aws/ssm key policy already allows decrypt through SSM for account principals.
resource "aws_iam_role_policy" "webhook_dispatcher" {
  name = "developercards-webhook-dispatcher-scoped"
  role = aws_iam_role.webhook_dispatcher.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "SqsConsume"
        Effect   = "Allow"
        Action   = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes", "sqs:ChangeMessageVisibility"]
        Resource = [local.webhook_queue_arn]
      },
      {
        Sid      = "Logs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = [local.webhook_dispatcher_log_arn]
      },
      {
        Sid      = "SsmRead"
        Effect   = "Allow"
        Action   = ["ssm:GetParameter"]
        Resource = ["${local.ssm_param_prefix}/webhook-signing-secret", "${local.ssm_param_prefix}/internal-shared-secret"]
      },
    ]
  })
}

resource "aws_iam_role_policy" "core_vpc_webhooks_send" {
  name = "developercards-core-vpc-webhooks-send"
  role = aws_iam_role.core_vpc.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid      = "SqsSendWebhooks"
      Effect   = "Allow"
      Action   = ["sqs:SendMessage", "sqs:GetQueueAttributes"]
      Resource = [local.webhook_queue_arn]
    }]
  })
}

resource "aws_iam_role_policy" "worker_webhooks_send" {
  name = "developercards-worker-webhooks-send"
  role = aws_iam_role.worker.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid      = "SqsSendWebhooks"
      Effect   = "Allow"
      Action   = ["sqs:SendMessage", "sqs:GetQueueAttributes"]
      Resource = [local.webhook_queue_arn]
    }]
  })
}
