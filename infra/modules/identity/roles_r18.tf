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
      # X08: "-previous" is read only during a signing-secret rotation (X03); the owner creates and
      # deletes that parameter by hand, Terraform never manages it. A missing parameter is not an error.
      {
        Sid      = "SsmRead"
        Effect   = "Allow"
        Action   = ["ssm:GetParameter"]
        Resource = ["${local.ssm_param_prefix}/webhook-signing-secret", "${local.ssm_param_prefix}/webhook-signing-secret-previous", "${local.ssm_param_prefix}/webhook-report-secret", "${local.ssm_param_prefix}/webhook-report-secret-previous"]
      },
      # Z03: per-subscription signing secrets "-sub-<id>" and their rotation leaves "-sub-<id>-previous",
      # read only with WEBHOOK_SUBSCRIPTION_SECRETS on. The owner creates them by hand; Terraform never manages them.
      {
        Sid      = "SsmReadSubscriptionSecrets"
        Effect   = "Allow"
        Action   = ["ssm:GetParameter"]
        Resource = ["${local.ssm_param_prefix}/webhook-signing-secret-sub-*"]
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

# R18 J15 — AI QA role: Bedrock Mantle inference, two SSM names, its queue and log group (§10.4, §14 #4/#7).
# R18 Y04 (cloud-security-resilience-13): ai-qa calls anthropic.AnthropicBedrockMantle, which SigV4-signs
# for service `bedrock-mantle` and authorizes only bedrock-mantle:CreateInference. The InvokeModel grants
# (and their bedrock:InferenceProfileArn condition) were never exercised, so they are gone. Per the Service
# Authorization Reference for bedrock-mantle (list_bedrock-mantle.html), CreateInference takes one resource
# type, project (arn:...:bedrock-mantle:<region>:<account>:project/<id>), and the condition keys
# aws:ResourceTag/*, bedrock-mantle:Model and bedrock-mantle:ServiceTier. The client sends no OpenAI-Project
# header, so every call lands in the account's `default` project; the grant names that project only and
# pins bedrock-mantle:Model to the one model ai-qa is configured with (AI_MODEL).

locals {
  ai_qa_queue_arn        = "arn:aws:sqs:${var.region}:${var.account_id}:${var.ai_qa_queue_name}"
  ai_qa_log_arn          = "arn:aws:logs:${var.region}:${var.account_id}:log-group:/aws/lambda/${var.ai_qa_function_name}:*"
  bedrock_mantle_project = "arn:aws:bedrock-mantle:${var.region}:${var.account_id}:project/${var.bedrock_mantle_project_id}"

  # R18 Q02: Converse (bedrock:InvokeModel) through the owner-approved inference profiles only. Each profile id
  # names its foundation model once the global./au./apac. routing prefix is dropped; the model grant covers the
  # region-less and the regional model ARN (both listed by get-inference-profile) and holds only when the call
  # arrives through one of these profiles (bedrock:InferenceProfileArn).
  ai_qa_converse_profile_arns = [for id in var.ai_qa_converse_profile_ids : "arn:aws:bedrock:${var.region}:${var.account_id}:inference-profile/${id}"]
  ai_qa_converse_model_ids    = [for id in var.ai_qa_converse_profile_ids : replace(id, "/^(global|au|apac)\\./", "")]
  ai_qa_converse_model_arns = flatten([for m in local.ai_qa_converse_model_ids : [
    "arn:aws:bedrock:::foundation-model/${m}",
    "arn:aws:bedrock:${var.region}::foundation-model/${m}",
  ]])
  ai_qa_converse_statements = [for st in [
    {
      Sid      = "BedrockConverseProfiles"
      Effect   = "Allow"
      Action   = ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"]
      Resource = local.ai_qa_converse_profile_arns
    },
    {
      Sid       = "BedrockConverseModels"
      Effect    = "Allow"
      Action    = ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"]
      Resource  = local.ai_qa_converse_model_arns
      Condition = { StringEquals = { "bedrock:InferenceProfileArn" = local.ai_qa_converse_profile_arns } }
    },
  ] : st if length(var.ai_qa_converse_profile_ids) > 0]
}

resource "aws_iam_role" "ai_qa" {
  name = "developercards-ai-qa-role"
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

# Mantle inference on one project, for one model id. A different AI_MODEL (or a request routed to another
# project) is denied by IAM until this policy changes with it. Q02 adds the Converse statements above, only
# when ai_qa_converse_profile_ids is non-empty; no aws-marketplace:* here (a first-use subscription is an owner action).
resource "aws_iam_role_policy" "ai_qa" {
  name = "developercards-ai-qa-scoped"
  role = aws_iam_role.ai_qa.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = concat([
      {
        Sid      = "SqsConsume"
        Effect   = "Allow"
        Action   = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes", "sqs:ChangeMessageVisibility"]
        Resource = [local.ai_qa_queue_arn]
      },
      {
        Sid      = "Logs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = [local.ai_qa_log_arn]
      },
      {
        Sid      = "SsmRead"
        Effect   = "Allow"
        Action   = ["ssm:GetParameter"]
        Resource = ["${local.ssm_param_prefix}/anthropic-api-key", "${local.ssm_param_prefix}/ai-qa-results-secret", "${local.ssm_param_prefix}/ai-qa-results-secret-previous"]
      },
      {
        Sid       = "BedrockMantleInference"
        Effect    = "Allow"
        Action    = ["bedrock-mantle:CreateInference"]
        Resource  = [local.bedrock_mantle_project]
        Condition = { StringEquals = { "bedrock-mantle:Model" = var.bedrock_mantle_model_id } }
      },
    ], local.ai_qa_converse_statements)
  })
}

# Only core-vpc enqueues QA jobs; the worker gets nothing.
resource "aws_iam_role_policy" "core_vpc_ai_qa_send" {
  name = "developercards-core-vpc-ai-qa-send"
  role = aws_iam_role.core_vpc.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid      = "SqsSendAiQa"
      Effect   = "Allow"
      Action   = ["sqs:SendMessage", "sqs:GetQueueAttributes"]
      Resource = [local.ai_qa_queue_arn]
    }]
  })
}
