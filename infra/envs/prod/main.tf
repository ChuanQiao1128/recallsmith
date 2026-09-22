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
}

module "worker" {
  source = "../../modules/worker"

  env                = "prod"
  queue_name         = "recallsmith-publish-jobs"
  function_name      = "worker-lambda"
  alias_name         = "prod"
  role_arn           = module.identity.core_vpc_role_arn
  subnet_ids         = module.data.subnet_ids
  security_group_ids = var.worker_security_group_ids
}

module "observability" {
  source = "../../modules/observability"

  env          = "prod"
  account_id   = var.account_id
  budget_name  = "My Monthly Cost Budget"
  budget_limit = "60"
}
