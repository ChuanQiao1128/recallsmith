# Enterprise audit 2026-10-03 SEC-01 / SDLC-01: the owner, every deploy and two unattended agents shared one
# static AdministratorAccess key. These three roles split that by job, so the key itself can be cut down to
# "assume a role" (devcards-operator-base) and a leaked key no longer means a leaked account:
#
#   devcards-agent-readonly  no MFA   AWS ReadOnlyAccess minus secrets and user data (explicit denies below)
#   devcards-deployer        MFA      update/publish/re-alias the listed functions, sync two static sites,
#                                     read /developercards SSM (deploy.sh injects it), pre-migration snapshot.
#                                     Since the CD pipeline (owner choice C, 2026-10-03) this is the local
#                                     break-glass path only; normal deploys go through developercards-gha-prod.
#   developercards-gha-prod  OIDC     the same permissions plus invoking the synthetic check, for GitHub
#                                     Actions jobs in the "production" environment (owner approval) only.
#   devcards-admin-mfa       MFA      AdministratorAccess, 1-hour sessions; break-glass Terraform (this module,
#                                     state surgery, imports) and everything else that needs the owner present.
#   developercards-gha-infra OIDC     AdministratorAccess minus an explicit deny (no new credentials, no audit
#                                     tampering, no change to the roles in this file), for the GitHub Actions
#                                     job in the "infra-prod" environment (owner approval) only: routine
#                                     Terraform applies (.github/workflows/terraform.yml, RUNBOOK §15).

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
  name        = "devcards-deployer"
  description = "Break-glass local deploys (MFA): src_C/deploy.sh, services/deploy-python-lambda.sh, frontend/deploy.sh, site/deploy.sh, rds-snapshot.sh"
  # MFA since CD (review of #736, finding 2): without it any process of the owner's macOS user could ship code.
  assume_role_policy   = data.aws_iam_policy_document.trust_mfa.json
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

# ── developercards-gha-prod: GitHub Actions CD (.github/workflows/cd.yml, RUNBOOK §12) ──────────────────
# Only a job that declares `environment: production` gets a token whose sub matches, and that environment
# requires the owner's approval and allows only main. No static credential exists for CI.
resource "aws_iam_openid_connect_provider" "github" {
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
}

data "aws_iam_policy_document" "trust_github_production" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:${var.github_repository}:environment:${var.github_environment}"]
    }
  }
}

resource "aws_iam_role" "gha_prod" {
  name                 = "developercards-gha-prod"
  description          = "GitHub Actions CD, environment ${var.github_environment} of ${var.github_repository} only"
  assume_role_policy   = data.aws_iam_policy_document.trust_github_production.json
  max_session_duration = 3600
}

data "aws_iam_policy_document" "gha_prod" {
  source_policy_documents = [data.aws_iam_policy_document.deployer.json]
  statement {
    sid       = "PostDeploySmoke" # the five end-to-end probes, services/synthetic-check
    actions   = ["lambda:InvokeFunction"]
    resources = ["${local.lambda_arn}:developercards-synthetic-check:prod"]
  }
}

resource "aws_iam_role_policy" "gha_prod" {
  name   = "release-listed-functions-and-sites"
  role   = aws_iam_role.gha_prod.id
  policy = data.aws_iam_policy_document.gha_prod.json
}

# ── developercards-gha-infra: GitHub Actions Terraform (.github/workflows/terraform.yml, RUNBOOK §15) ───────
# The job "apply (infra-prod)" plans, gates the plan against the change's allow-list and applies it after the
# owner's approval in the "infra-prod" environment (required reviewer, main only). Terraform manages IAM roles,
# Lambda, API Gateway, RDS, S3, CloudFront, Cognito, SSM, CloudWatch and budgets, so the role starts from
# AdministratorAccess; the explicit deny below wins over it and keeps these out of a pipeline apply:
#   - new static or human credentials: no IAM user, access key, password, MFA device, group, OIDC or SAML
#     provider or Identity Center user can be created or changed. The deny names write actions only, so
#     Terraform can still read (refresh) the GitHub OIDC provider this module manages;
#   - hopping into another role: sts:AssumeRole is denied (Terraform here assumes nothing: no assume_role in
#     providers.tf or the backend; the job itself gets in with AssumeRoleWithWebIdentity);
#   - audit tampering: the trail cannot be stopped or narrowed, its bucket's objects and settings cannot change,
#     and the state bucket keeps its versioning, lifecycle, policy, access settings and every state version;
#   - the identities in this file: the five roles and devcards-operator-base cannot be changed, so the pipeline
#     cannot widen its own trust, drop this deny or reach the static key. Changes to module.operators therefore
#     stay break-glass (a local apply with the owner's MFA), and the workflow refuses such a plan before apply
#     (infra/scripts/tf-pipeline.py guard) so it never half-applies;
#   - account, organization and billing settings.
# What it does not stop: AdministratorAccess can still create a service role, attach a broad policy to it and run
# code with it (a Lambda function the pipeline creates and invokes). That code outlives the job. tf-pipeline.py
# preflight and guard refuse the direct routes (provisioners, aws_lambda_invocation, providers other than
# hashicorp/aws, broad grants and admin attachments in a plan); the rest is the approval and RUNBOOK §15 "What it
# does not stop". A permissions boundary on every role Terraform creates would close it on the AWS side.
locals {
  # Built from names, not resource references, so the deny names the role being created in the same plan too.
  gha_infra_protected_role_arns = [
    for name in [
      aws_iam_role.agent_readonly.name, aws_iam_role.deployer.name, aws_iam_role.admin_mfa.name,
      aws_iam_role.gha_prod.name, var.gha_infra_role_name,
    ] : "arn:aws:iam::${var.account_id}:role/${name}"
  ]
  audit_bucket_arn = "arn:aws:s3:::${var.audit_bucket_name}"
  state_bucket_arn = "arn:aws:s3:::${var.state_bucket_name}"
}

data "aws_iam_policy_document" "trust_github_infra" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
    # Exactly the infra-prod environment of this repository: no branch, pull request or other environment.
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:${var.github_repository}:environment:${var.github_infra_environment}"]
    }
  }
}

resource "aws_iam_role" "gha_infra" {
  name                 = var.gha_infra_role_name
  description          = "GitHub Actions Terraform, environment ${var.github_infra_environment} of ${var.github_repository} only"
  assume_role_policy   = data.aws_iam_policy_document.trust_github_infra.json
  max_session_duration = 3600
}

resource "aws_iam_role_policy_attachment" "gha_infra" {
  role       = aws_iam_role.gha_infra.name
  policy_arn = "arn:aws:iam::aws:policy/AdministratorAccess"
}

data "aws_iam_policy_document" "gha_infra_deny" {
  statement {
    sid    = "NoStaticOrHumanCredentials"
    effect = "Deny"
    # Write actions only, never a wildcard: "iam:*OpenIDConnectProvider*" also matched GetOpenIDConnectProvider,
    # and every plan refreshes aws_iam_openid_connect_provider.github (test_tf_pipeline.py keeps the reads out).
    actions = [
      # A user plus a policy, a group, a key or a password is a standing way in.
      "iam:CreateUser", "iam:DeleteUser", "iam:UpdateUser", "iam:TagUser", "iam:UntagUser",
      "iam:AttachUserPolicy", "iam:DetachUserPolicy", "iam:PutUserPolicy", "iam:DeleteUserPolicy",
      "iam:PutUserPermissionsBoundary", "iam:DeleteUserPermissionsBoundary",
      "iam:AddUserToGroup", "iam:RemoveUserFromGroup",
      # UpdateAccessKey: re-activating a deactivated key counts as a new one.
      "iam:CreateAccessKey", "iam:UpdateAccessKey", "iam:DeleteAccessKey",
      "iam:CreateLoginProfile", "iam:UpdateLoginProfile", "iam:DeleteLoginProfile",
      # AttachGroupPolicy / PutGroupPolicy reach every user in the group.
      "iam:CreateGroup", "iam:DeleteGroup", "iam:UpdateGroup", "iam:AttachGroupPolicy", "iam:DetachGroupPolicy",
      "iam:PutGroupPolicy", "iam:DeleteGroupPolicy",
      # A new device on the owner's user would satisfy the admin role's MFA condition.
      "iam:CreateVirtualMFADevice", "iam:DeleteVirtualMFADevice", "iam:EnableMFADevice", "iam:DeactivateMFADevice",
      "iam:ResyncMFADevice", "iam:TagMFADevice", "iam:UntagMFADevice",
      "iam:CreateServiceSpecificCredential", "iam:UpdateServiceSpecificCredential",
      "iam:ResetServiceSpecificCredential", "iam:DeleteServiceSpecificCredential",
      "iam:UploadSSHPublicKey", "iam:UpdateSSHPublicKey", "iam:DeleteSSHPublicKey",
      "iam:UploadSigningCertificate", "iam:UpdateSigningCertificate", "iam:DeleteSigningCertificate",
      # The GitHub OIDC provider is what every GitHub role trusts.
      "iam:CreateOpenIDConnectProvider", "iam:DeleteOpenIDConnectProvider",
      "iam:UpdateOpenIDConnectProviderThumbprint", "iam:AddClientIDToOpenIDConnectProvider",
      "iam:RemoveClientIDFromOpenIDConnectProvider", "iam:TagOpenIDConnectProvider",
      "iam:UntagOpenIDConnectProvider",
      "iam:CreateSAMLProvider", "iam:DeleteSAMLProvider", "iam:UpdateSAMLProvider", "iam:TagSAMLProvider",
      "iam:UntagSAMLProvider",
      "sso:*", "sso-directory:*", "identitystore:*", # IAM Identity Center users; Terraform reads none of them
    ]
    resources = ["*"]
  }
  statement {
    sid       = "NoRoleHopping" # in-job code cannot step into a role this deny does not bind
    effect    = "Deny"
    actions   = ["sts:AssumeRole"]
    resources = ["*"]
  }
  statement {
    sid    = "NoAuditTampering"
    effect = "Deny"
    actions = [
      "cloudtrail:StopLogging", "cloudtrail:DeleteTrail", "cloudtrail:UpdateTrail", "cloudtrail:PutEventSelectors",
      "cloudtrail:PutInsightSelectors",
    ]
    resources = ["*"]
  }
  statement {
    sid    = "NoAuditLogChanges" # the trail's bucket (modules/observability/retention.tf)
    effect = "Deny"
    actions = [
      "s3:DeleteBucket", "s3:PutBucketPolicy", "s3:DeleteBucketPolicy", "s3:PutLifecycleConfiguration",
      "s3:PutBucketVersioning", "s3:PutBucketAcl", "s3:PutBucketOwnershipControls", "s3:PutBucketPublicAccessBlock",
      "s3:PutEncryptionConfiguration", "s3:PutObject", "s3:PutObjectAcl", "s3:DeleteObject", "s3:DeleteObjectVersion",
    ]
    resources = [local.audit_bucket_arn, "${local.audit_bucket_arn}/*"]
  }
  statement {
    sid    = "KeepStateHistory"
    effect = "Deny"
    actions = [
      "s3:DeleteBucket", "s3:PutBucketPolicy", "s3:DeleteBucketPolicy", "s3:PutLifecycleConfiguration",
      "s3:PutBucketVersioning", "s3:PutBucketAcl", "s3:PutBucketOwnershipControls", "s3:PutBucketPublicAccessBlock",
    ]
    resources = [local.state_bucket_arn]
  }
  # PutObject and a plain DeleteObject stay allowed: the S3 backend writes the state and creates and removes its
  # lock file with them (in a versioned bucket a plain delete only adds a delete marker). No version can be removed.
  statement {
    sid    = "KeepStateVersions"
    effect = "Deny"
    actions = [
      "s3:DeleteObjectVersion", "s3:PutObjectRetention", "s3:PutObjectLegalHold", "s3:BypassGovernanceRetention",
    ]
    resources = ["${local.state_bucket_arn}/*"]
  }
  statement {
    sid    = "NoOperatorOrCiRoleChanges"
    effect = "Deny"
    actions = [
      "iam:UpdateAssumeRolePolicy", "iam:PutRolePolicy", "iam:DeleteRolePolicy", "iam:AttachRolePolicy",
      "iam:DetachRolePolicy", "iam:DeleteRole", "iam:UpdateRole", "iam:UpdateRoleDescription",
      "iam:PutRolePermissionsBoundary", "iam:DeleteRolePermissionsBoundary", "iam:TagRole", "iam:UntagRole",
    ]
    resources = local.gha_infra_protected_role_arns
  }
  statement {
    sid    = "NoOperatorBasePolicyChanges" # what the static key may do
    effect = "Deny"
    actions = [
      "iam:CreatePolicyVersion", "iam:DeletePolicyVersion", "iam:SetDefaultPolicyVersion", "iam:DeletePolicy",
      "iam:TagPolicy", "iam:UntagPolicy",
    ]
    resources = [aws_iam_policy.operator_base.arn]
  }
  statement {
    sid    = "NoAccountChanges"
    effect = "Deny"
    actions = [
      "organizations:*", "account:Put*", "account:Delete*", "account:Enable*", "account:Disable*",
      "account:Accept*", "account:Start*", "aws-portal:Modify*", "billing:Put*", "billing:Update*", "payments:*",
      "iam:CreateAccountAlias", "iam:DeleteAccountAlias", "iam:UpdateAccountPasswordPolicy",
      "iam:DeleteAccountPasswordPolicy",
    ]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "gha_infra_deny" {
  name   = "deny-credentials-audit-and-operator-changes"
  role   = aws_iam_role.gha_infra.id
  policy = data.aws_iam_policy_document.gha_infra_deny.json
}
