locals {
  # The budget subscriber and SNS endpoint are given the plain alert address; the root
  # variable stays sensitive (never printed). Passing the value unmarked keeps the adopted
  # budget's notification blocks a no-op on import instead of a spurious sensitivity re-mark.
  alert_email = var.alert_email
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

module "identity" {
  source = "../../modules/identity"

  env                   = "prod"
  account_id            = var.account_id
  region                = var.region
  core_vpc_role_name    = "core-vpc-role-joizyiwt"
  edge_public_role_name = "edge-public-role-zezx326f"
  manage_cognito        = true
  console_pool_id       = var.console_pool_id
  mobile_pool_id        = var.mobile_pool_id
  snowflake_external_id = var.snowflake_external_id

  worker_role_name       = "developercards-worker-lambda-role"
  content_bucket_name    = "core-vpc"
  premium_bucket_name    = "core-vpc-premium"
  publish_queue_name     = "recallsmith-publish-jobs"
  core_vpc_function_name = "core-vpc"
  worker_function_name   = "worker-lambda"

  secret_parameter_names = ["pg-password", "migrate-secret", "internal-shared-secret", "rc-webhook-auth-production", "rc-webhook-auth-development"]
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
}

module "api" {
  source = "../../modules/api"

  env                       = "prod"
  api_name                  = "developercards-api"
  core_vpc_function_name    = "core-vpc"
  core_vpc_alias_name       = "prod"
  core_vpc_role_arn         = module.identity.core_vpc_role_arn
  edge_public_function_name = "edge-public"
  edge_public_role_arn      = module.identity.edge_public_role_arn
  subnet_ids                = module.data.subnet_ids
  security_group_ids        = var.core_vpc_security_group_ids
  console_pool_endpoint     = module.identity.console_pool_endpoint
  console_client_id         = module.identity.console_client_id
  cors_allowed_origins      = var.cors_allowed_origins

  access_log_destination_arn = module.observability.api_access_log_group_arn
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
}
