# Enterprise audit 2026-10-03 SEC-01 / SDLC-01: the owner, every deploy and two unattended agents shared one
# static AdministratorAccess key. These three roles split that by job, so the key itself can be cut down to
# "assume a role" (devcards-operator-base) and a leaked key no longer means a leaked account:
#
#   devcards-agent-readonly  no MFA   AWS ReadOnlyAccess minus secrets and user data (explicit denies below)
#   devcards-deployer        no MFA   update/publish/re-alias the listed functions, sync two static sites,
#                                     read /developercards SSM (deploy.sh injects it), pre-migration snapshot
#   devcards-admin-mfa       MFA      AdministratorAccess, 1-hour sessions; Terraform and break-glass. The MFA
#                                     code is the owner's approval step for production infrastructure changes.

locals {
  lambda_arn  = "arn:aws:lambda:${var.region}:${var.account_id}:function"
  fn_arns     = flatten([for n in var.deploy_function_names : ["${local.lambda_arn}:${n}", "${local.lambda_arn}:${n}:*"]])
  ssm_arn     = "arn:aws:ssm:${var.region}:${var.account_id}:parameter${var.ssm_root_path}"
  rds_db_arn  = "arn:aws:rds:${var.region}:${var.account_id}:db:${var.rds_instance_id}"
  rds_snap    = "arn:aws:rds:${var.region}:${var.account_id}:snapshot:*"
  cf_arns     = [for id in var.deploy_distribution_ids : "arn:aws:cloudfront::${var.account_id}:distribution/${id}"]
  bucket_arns = [for b in var.deploy_bucket_names : "arn:aws:s3:::${b}"]
}

data "aws_iam_policy_document" "trust_key" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "AWS"
      identifiers = var.operator_user_arns
    }
  }
}

data "aws_iam_policy_document" "trust_mfa" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "AWS"
      identifiers = var.operator_user_arns
    }
    condition {
      test     = "Bool"
      variable = "aws:MultiFactorAuthPresent"
      values   = ["true"]
    }
    condition {
      test     = "NumericLessThan"
      variable = "aws:MultiFactorAuthAge"
      values   = [tostring(var.admin_session_seconds)]
    }
  }
}

# ── devcards-agent-readonly ────────────────────────────────────────────────────────────────────────────
resource "aws_iam_role" "agent_readonly" {
  name                 = "devcards-agent-readonly"
  description          = "Claude sessions, workflow agents and launchd agents: read-only, no secrets, no user data"
  assume_role_policy   = data.aws_iam_policy_document.trust_key.json
  max_session_duration = 3600
}

resource "aws_iam_role_policy_attachment" "agent_readonly" {
  role       = aws_iam_role.agent_readonly.name
  policy_arn = "arn:aws:iam::aws:policy/ReadOnlyAccess"
}

# Explicit denies win over ReadOnlyAccess. Each group closes a path from "read" to a secret or to user data.
data "aws_iam_policy_document" "agent_readonly_deny" {
  statement {
    sid    = "NoDecryptNoSecretValues" # SecureString parameters, Secrets Manager, anything KMS-wrapped
    effect = "Deny"
    actions = [
      "kms:Decrypt", "kms:GenerateDataKey*", "kms:ReEncrypt*",
      "secretsmanager:GetSecretValue",
      "ssm:GetParameter", "ssm:GetParameters", "ssm:GetParametersByPath", "ssm:GetParameterHistory",
    ]
    resources = ["*"]
  }
  statement {
    sid    = "NoLambdaEnvironment" # deploy.sh writes decrypted SSM values into each function's environment
    effect = "Deny"
    actions = [
      "lambda:GetFunction", "lambda:GetFunctionConfiguration",
      "lambda:ListFunctions", "lambda:ListVersionsByFunction", "lambda:GetLayerVersion",
    ]
    resources = ["*"]
  }
  statement {
    sid    = "NoObjectData" # user content, Terraform state (holds secrets), CloudTrail logs
    effect = "Deny"
    actions = [
      "s3:GetObject", "s3:GetObjectVersion", "s3:GetObjectAttributes", "s3:GetObjectTorrent",
      "s3:GetObjectVersionTorrent", "s3:GetObjectVersionAttributes",
    ]
    resources = ["*"]
  }
  statement {
    sid    = "NoUserRecords" # learner identities and database contents
    effect = "Deny"
    actions = [
      "cognito-idp:ListUsers", "cognito-idp:ListUsersInGroup", "cognito-idp:AdminGetUser",
      "cognito-idp:AdminListGroupsForUser", "cognito-idp:AdminListDevices", "cognito-idp:AdminListUserAuthEvents",
      "rds:DownloadDBLogFilePortion", "rds:DownloadCompleteDBLogFile", "rds-data:*",
      "dynamodb:GetItem", "dynamodb:BatchGetItem", "dynamodb:Query", "dynamodb:Scan",
      "sqs:ReceiveMessage",
    ]
    resources = ["*"]
  }
  statement {
    sid       = "NoCodeOrCredentialDownloads"
    effect    = "Deny"
    actions   = ["ecr:GetAuthorizationToken", "ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer", "ec2:GetPasswordData"]
    resources = ["*"]
  }
  statement {
    sid    = "NoLearnerIpLogs" # the API access-log format records $context.identity.sourceIp and userAgent
    effect = "Deny"
    actions = [
      "logs:GetLogEvents", "logs:FilterLogEvents", "logs:StartQuery", "logs:StartLiveTail", "logs:Unmask",
      "logs:GetLogRecord",
    ]
    resources = [
      "arn:aws:logs:${var.region}:${var.account_id}:log-group:/aws/apigateway/*",
      "arn:aws:logs:${var.region}:${var.account_id}:log-group:/aws/apigateway/*:*",
    ]
  }
  statement {
    sid    = "NoOwnerContactData" # alert e-mail endpoint and account contact
    effect = "Deny"
    actions = [
      "sns:ListSubscriptions", "sns:ListSubscriptionsByTopic", "sns:GetSubscriptionAttributes",
      "account:GetContactInformation", "account:GetAlternateContact",
    ]
    resources = ["*"]
  }
  # Nothing below exists in the account today (review of PR #736 counted 0 of each). Denied now so a
  # resource added later does not quietly become readable by agents.
  statement {
    sid    = "NoLatentSecretOrPiiReads"
    effect = "Deny"
    actions = [
      "cognito-idp:DescribeUserPoolClient", "cognito-idp:DescribeIdentityProvider", "cognito-idp:AdminGetDevice",
      "cognito-identity:DescribeIdentity", "cognito-identity:LookupDeveloperIdentity", "cognito-sync:ListRecords",
      "ec2:DescribeInstanceAttribute", "ec2:DescribeLaunchTemplateVersions", "ec2:GetLaunchTemplateData",
      "ec2:GetConsoleOutput", "ec2:GetConsoleScreenshot", "autoscaling:DescribeLaunchConfigurations",
      "cloudformation:GetTemplate", "ecs:DescribeTaskDefinition", "batch:DescribeJobDefinitions",
      "apprunner:DescribeService", "codebuild:BatchGetProjects", "codebuild:BatchGetBuilds",
      "amplify:GetApp", "amplify:ListApps", "amplify:GetBranch", "elasticbeanstalk:DescribeConfigurationSettings",
      "appsync:ListApiKeys", "appconfig:GetConfiguration", "appconfig:GetHostedConfigurationVersion",
      "dynamodb:PartiQLSelect", "dynamodb:GetRecords", "kinesis:GetRecords",
      "states:DescribeExecution", "states:GetExecutionHistory",
      "es:ESHttpGet", "dax:GetItem", "dax:BatchGetItem", "dax:Query", "dax:Scan", "cassandra:Select",
      "s3-object-lambda:GetObject",
      "ses:ListSuppressedDestinations", "ses:GetSuppressedDestination", "ses:ListContacts", "ses:GetContact",
      "ses:GetMessageInsights",
      "sns:GetEndpointAttributes", "sns:ListEndpointsByPlatformApplication", "sns:ListPhoneNumbersOptedOut",
      "mobiletargeting:GetEndpoint", "mobiletargeting:GetUserEndpoints",
      "ssm:GetCommandInvocation", "ssm:ListCommandInvocations", "ssm:GetAutomationExecution",
      "cloudfront-keyvaluestore:GetKey", "cloudfront-keyvaluestore:ListKeys",
      "pi:GetDimensionKeyDetails", "pi:DescribeDimensionKeys", "athena:GetQueryResults",
    ]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "agent_readonly_deny" {
  name   = "deny-secrets-and-user-data"
  role   = aws_iam_role.agent_readonly.id
  policy = data.aws_iam_policy_document.agent_readonly_deny.json
}

# ── devcards-deployer ──────────────────────────────────────────────────────────────────────────────────
resource "aws_iam_role" "deployer" {
  name                 = "devcards-deployer"
  description          = "src_C/deploy.sh, services/deploy-python-lambda.sh, frontend/deploy.sh, site/deploy.sh, rds-snapshot.sh"
  assume_role_policy   = data.aws_iam_policy_document.trust_key.json
  max_session_duration = 3600
}

data "aws_iam_policy_document" "deployer" {
  statement {
    sid = "ReleaseListedFunctions" # no iam:PassRole, so the execution role cannot be swapped
    actions = [
      "lambda:GetFunction", "lambda:GetFunctionConfiguration", "lambda:UpdateFunctionCode",
      "lambda:UpdateFunctionConfiguration", "lambda:PublishVersion", "lambda:ListVersionsByFunction",
      "lambda:GetAlias", "lambda:ListAliases", "lambda:UpdateAlias",
    ]
    resources = local.fn_arns
  }
  statement {
    sid       = "ReadDeployParameters" # merge-env.sh: get-parameters-by-path --with-decryption
    actions   = ["ssm:GetParametersByPath", "ssm:GetParameter", "ssm:GetParameters"]
    resources = [local.ssm_arn, "${local.ssm_arn}/*"]
  }
  statement {
    sid       = "DecryptThroughSsmOnly"
    actions   = ["kms:Decrypt"]
    resources = ["*"]
    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["ssm.${var.region}.amazonaws.com"]
    }
  }
  statement {
    sid       = "SyncStaticSites"
    actions   = ["s3:ListBucket"]
    resources = local.bucket_arns
  }
  statement {
    sid       = "SyncStaticSiteObjects"
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
    resources = [for b in local.bucket_arns : "${b}/*"]
  }
  statement {
    sid       = "InvalidateStaticSites"
    actions   = ["cloudfront:CreateInvalidation", "cloudfront:GetInvalidation", "cloudfront:ListInvalidations"]
    resources = local.cf_arns
  }
  statement {
    sid       = "PreMigrationSnapshot" # infra/scripts/rds-snapshot.sh
    actions   = ["rds:CreateDBSnapshot"]
    resources = [local.rds_db_arn, local.rds_snap]
  }
  statement {
    sid       = "TagOwnSnapshotsOnly" # never the DB instance itself
    actions   = ["rds:AddTagsToResource"]
    resources = [local.rds_snap]
  }
  statement {
    sid       = "WatchSnapshot"
    actions   = ["rds:DescribeDBSnapshots", "rds:DescribeDBInstances"]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "deployer" {
  name   = "release-listed-functions-and-sites"
  role   = aws_iam_role.deployer.id
  policy = data.aws_iam_policy_document.deployer.json
}

# ── devcards-admin-mfa ─────────────────────────────────────────────────────────────────────────────────
resource "aws_iam_role" "admin_mfa" {
  name                 = "devcards-admin-mfa"
  description          = "Terraform and break-glass; assumable only with the owner's MFA code"
  assume_role_policy   = data.aws_iam_policy_document.trust_mfa.json
  max_session_duration = var.admin_session_seconds
}

resource "aws_iam_role_policy_attachment" "admin_mfa" {
  role       = aws_iam_role.admin_mfa.name
  policy_arn = "arn:aws:iam::aws:policy/AdministratorAccess"
}

# ── devcards-operator-base: what the static key keeps after the cutover ────────────────────────────────
# Created here, attached by infra/scripts/operator-cutover.sh (the user itself predates Terraform).
data "aws_iam_policy_document" "operator_base" {
  statement {
    sid       = "AssumeOperatorRoles"
    actions   = ["sts:AssumeRole"]
    resources = [aws_iam_role.agent_readonly.arn, aws_iam_role.deployer.arn, aws_iam_role.admin_mfa.arn]
  }
  statement {
    sid       = "SeeOwnUser"
    actions   = ["iam:GetUser", "iam:ListAccessKeys", "iam:GetAccessKeyLastUsed", "iam:ListMFADevices"]
    resources = ["arn:aws:iam::${var.account_id}:user/$${aws:username}"]
  }
}

resource "aws_iam_policy" "operator_base" {
  name        = "devcards-operator-base"
  description = "The static operator key: assume the three operator roles, nothing else"
  policy      = data.aws_iam_policy_document.operator_base.json
}
