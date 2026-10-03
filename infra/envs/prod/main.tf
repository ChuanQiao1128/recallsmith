locals {
  # The budget subscriber and SNS endpoint are given the plain alert address; the root
  # variable stays sensitive (never printed). Passing the value unmarked keeps the adopted
  # budget's notification blocks a no-op on import instead of a spurious sensitivity re-mark.
  alert_email = var.alert_email

  # R18 Y04: one model id feeds both the ai-qa IAM condition (bedrock-mantle:Model) and the function's
  # create-time AI_MODEL, so the two cannot drift apart in Terraform.
  ai_qa_model_id = "anthropic.claude-opus-5"

  # R18 Q02: inference profiles the owner approved for ai-qa's Converse provider (identity grants
  # bedrock:InvokeModel on each profile and, through it only, on its foundation model). One line per model.
  ai_qa_converse_profile_ids = ["global.openai.gpt-5.5"]

  # R18C L1: the automation reviewer's transport (services/ai-qa provider openai-mantle). Must equal
  # AI_QA_AUTOMATION_MODEL / AI_QA_AUTOMATION_REGION in services/ai-qa/env/prod.env.json; the Converse grant
  # above stays as the bedrock-converse fallback.
  ai_qa_openai_mantle_model_id = "openai.gpt-5.5"
  ai_qa_openai_mantle_region   = "us-east-1"
}

# E03's DLQ exists in the account but is not in imports.tf (E00 §6 #20). module.worker's
# publish_jobs.redrive_policy references its ARN, so in an empty-state plan the DLQ is a create
# with an unknown ARN and publish_jobs reads as a spurious redrive_policy update. Adopting the
# DLQ here (import blocks are configuration, allowed in any .tf per E00 §0) resolves its ARN so
# publish_jobs is a no-op. Against the real backend the DLQ is already in state, so this import
# block is inert (Terraform skips import for a resource already tracked).
import {
  to = module.worker.aws_sqs_queue.publish_jobs_dlq
  id = "https://sqs.ap-southeast-2.amazonaws.com/622994489535/developercards-publish-jobs-dlq"
}

# E04's API access-log group exists in the account but is not in imports.tf (E00 §6 #20).
# module.api's two stages set access_log_settings.destination_arn to its ARN, so in an
# empty-state plan the log group is a create with an unknown ARN and both stages read as a
# spurious access_log_settings update. Adopting it here (same technique as the DLQ above,
# E04 commit 5e5d524) resolves its ARN so the stages are a no-op. Against the real backend it
# is already in state, so this import block is inert (Terraform skips import when tracked).
import {
  to = module.observability.aws_cloudwatch_log_group.api_access
  id = "/aws/apigateway/developercards-api"
}

# E09: the registrar created this zone on 2026-09-22 (Route 53 Domains). Adopt it; never recreate it.
import {
  to = module.edge.aws_route53_zone.main[0]
  id = "Z0284954BSN00C8BF94Q"
}

module "identity" {
  source = "../../modules/identity"

  env                = "prod"
  account_id         = var.account_id
  region             = var.region
  core_vpc_role_name = "core-vpc-role-joizyiwt"
  manage_cognito     = true
  console_pool_id    = var.console_pool_id
  mobile_pool_id     = var.mobile_pool_id

  worker_role_name       = "developercards-worker-lambda-role"
  content_bucket_name    = "core-vpc"
  premium_bucket_name    = "core-vpc-premium"
  publish_queue_name     = "recallsmith-publish-jobs"
  core_vpc_function_name = "core-vpc"
  worker_function_name   = "worker-lambda"

  webhook_queue_name               = "developercards-webhook-events"
  webhook_dispatcher_function_name = "developercards-webhook-dispatcher"

  ai_qa_queue_name        = "developercards-ai-qa-jobs"
  ai_qa_function_name     = "developercards-ai-qa"
  bedrock_mantle_model_id = local.ai_qa_model_id

  ai_qa_converse_profile_ids = local.ai_qa_converse_profile_ids

  ai_qa_openai_mantle_model_id = local.ai_qa_openai_mantle_model_id
  ai_qa_openai_mantle_region   = local.ai_qa_openai_mantle_region

  notify_queue_name            = "developercards-notify"
  notifier_function_name       = "developercards-notifier"
  source_watcher_function_name = "developercards-source-watcher"

  secret_parameter_names = ["pg-password", "migrate-secret", "internal-shared-secret", "rc-webhook-auth-production", "rc-webhook-auth-development", "webhook-signing-secret", "anthropic-api-key", "webhook-report-secret", "ai-qa-results-secret", "source-watch-secret", "notifier-secret"]

  console_hostname = "console.${var.domain}"

  # R18A A11: the automation email recipient (sensitive; never printed).
  notify_recipient_email = local.alert_email

  # R18H H05: the synthetic check (H00 §5.4).
  synthetic_check_function_name = "developercards-synthetic-check"
}

module "data" {
  source = "../../modules/data"

  env                       = "prod"
  db_identifier             = "developercards"
  db_subnet_group_name      = "default-vpc-04af44dd8f5f48717"
  content_bucket_name       = "core-vpc"
  premium_bucket_name       = "core-vpc-premium"
  vpc_id                    = var.vpc_id
  subnet_ids                = var.subnet_ids
  lambda_security_group_ids = var.worker_security_group_ids
  rds_security_group_ids    = var.rds_security_group_ids
  rds_monitoring_role_arn   = module.identity.rds_monitoring_role_arn
}

module "edge" {
  source = "../../modules/edge"
  providers = {
    aws      = aws
    aws.use1 = aws.use1
  }

  env                                 = "prod"
  content_bucket_name                 = "core-vpc"
  content_bucket_arn                  = module.data.content_bucket_arn
  content_bucket_regional_domain_name = module.data.content_bucket_regional_domain_name
  console_bucket_name                 = "recallsmith-console-622994489535"
  core_vpc_role_arn                   = module.identity.core_vpc_role_arn

  domain           = var.domain
  manage_domain    = true
  site_bucket_name = "developercards-site-622994489535"

  # R18A A11: the SES recipient identity (sensitive; never printed).
  notify_recipient_email = local.alert_email

  # R18C: delivery problems of the automation emails go to the alerts topic.
  automation_events_topic_arn = module.observability.ses_events_topic_arn
}

module "api" {
  source = "../../modules/api"

  env                    = "prod"
  api_name               = "developercards-api"
  core_vpc_function_name = "core-vpc"
  core_vpc_alias_name    = "prod"
  core_vpc_role_arn      = module.identity.core_vpc_role_arn
  subnet_ids             = module.data.subnet_ids
  security_group_ids     = var.core_vpc_security_group_ids
  console_pool_endpoint  = module.identity.console_pool_endpoint
  console_client_id      = module.identity.console_client_id
  agent_client_ids       = [module.identity.console_dev_client_id]
  mobile_pool_endpoint   = module.identity.mobile_pool_endpoint
  mobile_client_id       = module.identity.mobile_client_id
  cors_allowed_origins   = concat(var.cors_allowed_origins, ["https://console.${var.domain}"])

  access_log_destination_arn = module.observability.api_access_log_group_arn

  domain       = var.domain
  api_cert_arn = module.edge.api_cert_arn
  zone_id      = module.edge.zone_id
}

module "worker" {
  source = "../../modules/worker"

  env                = "prod"
  queue_name         = "recallsmith-publish-jobs"
  function_name      = "worker-lambda"
  alias_name         = "prod"
  role_arn           = module.identity.worker_role_arn
  subnet_ids         = module.data.subnet_ids
  security_group_ids = var.worker_security_group_ids

  webhook_queue_name               = "developercards-webhook-events"
  webhook_dlq_name                 = "developercards-webhook-events-dlq"
  webhook_dispatcher_function_name = "developercards-webhook-dispatcher"
  webhook_dispatcher_role_arn      = module.identity.webhook_dispatcher_role_arn
  # Create-time only; SSM parameter names, not values (R18-00 §6.5.1). The deploy script owns it afterwards.
  webhook_dispatcher_environment = {
    SIGNING_SECRET_SSM_NAME      = "/developercards/prod/webhook-signing-secret"
    INTERNAL_SECRET_SSM_NAME     = "/developercards/prod/internal-shared-secret"
    CORE_API_BASE                = "https://api.developercards.app"
    METRICS_NAMESPACE            = "DeveloperCards"
    WEBHOOK_HTTP_TIMEOUT_SECONDS = "10"
    LOG_LEVEL                    = "info"
  }

  ai_qa_queue_name    = "developercards-ai-qa-jobs"
  ai_qa_dlq_name      = "developercards-ai-qa-jobs-dlq"
  ai_qa_function_name = "developercards-ai-qa"
  ai_qa_role_arn      = module.identity.ai_qa_role_arn
  # Create-time only; equals services/ai-qa/env/prod.env.json (R18-00 §7.5). Kill switch off; the deploy script owns it afterwards.
  ai_qa_environment = {
    AI_PROVIDER                = "bedrock"
    AI_MODEL                   = local.ai_qa_model_id
    AI_BEDROCK_REGION          = "ap-southeast-2"
    AI_EFFORT                  = "high"
    AI_STRUCTURED_OUTPUTS      = "auto"
    AI_QA_ENABLED              = "0"
    ANTHROPIC_API_KEY_SSM_NAME = "/developercards/prod/anthropic-api-key"
    INTERNAL_SECRET_SSM_NAME   = "/developercards/prod/internal-shared-secret"
    CORE_API_BASE              = "https://api.developercards.app"
    METRICS_NAMESPACE          = "DeveloperCards"
    AI_PRICE_INPUT_PER_MTOK    = "5"
    AI_PRICE_OUTPUT_PER_MTOK   = "25"
    LOG_LEVEL                  = "info"
  }

  notify_queue_name             = "developercards-notify"
  notify_dlq_name               = "developercards-notify-dlq"
  notifier_function_name        = "developercards-notifier"
  notifier_role_arn             = module.identity.notifier_role_arn
  source_watcher_function_name  = "developercards-source-watcher"
  source_watcher_role_arn       = module.identity.source_watcher_role_arn
  automation_scheduler_role_arn = module.identity.automation_scheduler_role_arn
  # Create-time only; equals services/notifier/env/prod.env.json (A09). SSM parameter names, not values; the deploy script owns it afterwards.
  notifier_environment = {
    NOTIFY_FROM               = "DeveloperCards Automation <automation@developercards.app>"
    NOTIFY_RECIPIENT_SSM_NAME = "/developercards/prod/notify-recipient"
    INTERNAL_SECRET_SSM_NAME  = "/developercards/prod/notifier-secret"
    CORE_API_BASE             = "https://api.developercards.app"
    SES_REGION                = "ap-southeast-2"
    SES_CONFIGURATION_SET     = "developercards-automation"
    METRICS_NAMESPACE         = "DeveloperCards"
    LOG_LEVEL                 = "info"
  }
  # Create-time only; equals services/source-watcher/env/prod.env.json (A08). The deploy script owns it afterwards.
  source_watcher_environment = {
    INTERNAL_SECRET_SSM_NAME    = "/developercards/prod/source-watch-secret"
    CORE_API_BASE               = "https://api.developercards.app"
    WATCH_MAX_TARGETS           = "60"
    WATCH_TIME_BUDGET_SECONDS   = "240"
    WATCH_HTTP_TIMEOUT_SECONDS  = "10"
    WATCH_MAX_BYTES             = "5242880"
    WATCH_HOST_INTERVAL_SECONDS = "1"
    WATCH_USER_AGENT            = "DeveloperCards-SourceWatch/1.0 (+https://developercards.app)"
    METRICS_NAMESPACE           = "DeveloperCards"
    LOG_LEVEL                   = "info"
  }

  # R18H H05: the synthetic check (H00 §5.4). Create-time only; equals services/synthetic-check/env/prod.env.json (H04).
  synthetic_check_function_name = "developercards-synthetic-check"
  synthetic_check_role_arn      = module.identity.synthetic_check_role_arn
  synthetic_check_environment = {
    API_BASE              = "https://api.developercards.app"
    CDN_BASE              = "https://cdn.developercards.app"
    CONSOLE_BASE          = "https://console.developercards.app"
    CHECK_TIMEOUT_SECONDS = "10"
    CHECK_USER_AGENT      = "DeveloperCards-Synthetic/1.0 (+https://developercards.app)"
    METRICS_NAMESPACE     = "DeveloperCards"
    LOG_LEVEL             = "info"
  }
}

module "observability" {
  source = "../../modules/observability"

  env          = "prod"
  account_id   = var.account_id
  budget_name  = "My Monthly Cost Budget"
  budget_limit = "60"

  alert_email            = nonsensitive(local.alert_email)
  region                 = var.region
  api_id                 = module.api.api_id
  api_name               = "developercards-api"
  api_stage_name         = "$default"
  core_vpc_function_name = "core-vpc"
  worker_function_name   = "worker-lambda"
  publish_queue_name     = "recallsmith-publish-jobs"
  publish_dlq_name       = module.worker.publish_dlq_name
  db_identifier          = "developercards"

  webhook_queue_name               = module.worker.webhook_queue_name
  webhook_dlq_name                 = module.worker.webhook_dlq_name
  webhook_dispatcher_function_name = module.worker.webhook_dispatcher_function_name

  ai_qa_queue_name    = module.worker.ai_qa_queue_name
  ai_qa_dlq_name      = module.worker.ai_qa_dlq_name
  ai_qa_function_name = module.worker.ai_qa_function_name

  notify_queue_name            = module.worker.notify_queue_name
  notify_dlq_name              = module.worker.notify_dlq_name
  notifier_function_name       = module.worker.notifier_function_name
  source_watcher_function_name = module.worker.source_watcher_function_name
}

# Enterprise audit 2026-10-03 SEC-01: operator roles that replace the shared static admin key
# (read-only for agents, scoped deployer, MFA admin, the CD and Terraform pipeline roles). RUNBOOK §10 has the
# profiles and the cutover, §12 the CD role, §15 the Terraform pipeline role.
module "operators" {
  source = "../../modules/operators"

  account_id         = var.account_id
  region             = var.region
  operator_user_arns = ["arn:aws:iam::${var.account_id}:user/devcards-admin"]

  deploy_function_names = [
    "core-vpc",
    "worker-lambda",
    "developercards-ai-qa",
    "developercards-notifier",
    "developercards-source-watcher",
    "developercards-synthetic-check",
    "developercards-webhook-dispatcher",
  ]
  deploy_bucket_names     = ["recallsmith-console-622994489535", "developercards-site-622994489535"]
  deploy_distribution_ids = ["E85FKUMZZWQWX", "EML9BSZ8EXMQ1"]
  rds_instance_id         = "developercards"

  # Kept out of reach of the pipeline role developercards-gha-infra (RUNBOOK §15).
  audit_bucket_name = "developercards-cloudtrail-${var.account_id}"
  state_bucket_name = "recallsmith-tfstate-${var.account_id}"
}
