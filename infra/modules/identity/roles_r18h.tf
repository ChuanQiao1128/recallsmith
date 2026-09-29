# R18H H05 — X-Ray write grants and the synthetic check's roles (H00 §3.6, §5.4). Documents are built from var.* strings only so change.after.policy is known in the plan.

locals {
  synthetic_check_log_arn   = "arn:aws:logs:${var.region}:${var.account_id}:log-group:/aws/lambda/${var.synthetic_check_function_name}:*"
  synthetic_check_alias_arn = "arn:aws:lambda:${var.region}:${var.account_id}:function:${var.synthetic_check_function_name}:prod"
  xray_write_roles = {
    core_vpc           = aws_iam_role.core_vpc.name
    worker             = aws_iam_role.worker.name
    webhook_dispatcher = aws_iam_role.webhook_dispatcher.name
    ai_qa              = aws_iam_role.ai_qa.name
    notifier           = aws_iam_role.notifier.name
    source_watcher     = aws_iam_role.source_watcher.name
    synthetic_check    = aws_iam_role.synthetic_check.name
  }
}

# PutTraceSegments and PutTelemetryRecords have no resource-level scoping, hence Resource "*".
resource "aws_iam_role_policy" "xray_write" {
  for_each = local.xray_write_roles
  name     = "developercards-xray-write"
  role     = each.value
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid      = "XRayWrite"
      Effect   = "Allow"
      Action   = ["xray:PutTraceSegments", "xray:PutTelemetryRecords"]
      Resource = "*"
    }]
  })
}

resource "aws_iam_role" "synthetic_check" {
  name = "developercards-synthetic-check-role"
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

# role = .name, not .id: the id of a role created in the same apply is unknown at plan time.
resource "aws_iam_role_policy" "synthetic_check" {
  name = "developercards-synthetic-check-scoped"
  role = aws_iam_role.synthetic_check.name
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid      = "Logs"
      Effect   = "Allow"
      Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
      Resource = [local.synthetic_check_log_arn]
    }]
  })
}

# A separate policy on the automation scheduler role; developercards-automation-scheduler-invoke stays unchanged (H00 §10.11).
resource "aws_iam_role_policy" "synthetic_scheduler" {
  name = "developercards-synthetic-scheduler-invoke"
  role = aws_iam_role.automation_scheduler.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid      = "InvokeSyntheticCheck"
      Effect   = "Allow"
      Action   = ["lambda:InvokeFunction"]
      Resource = [local.synthetic_check_alias_arn]
    }]
  })
}
