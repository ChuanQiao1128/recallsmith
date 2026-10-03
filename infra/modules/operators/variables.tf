variable "account_id" {
  type = string
}

variable "region" {
  type = string
}

# The IAM users allowed to assume the operator roles. Today: the one static-key user every deploy host,
# Claude session and launchd agent signs in as. After the cutover (infra/scripts/operator-cutover.sh) that
# user holds only devcards-operator-base, so the key alone reaches read-only and deploy, never admin.
variable "operator_user_arns" {
  type = list(string)
}


variable "admin_session_seconds" {
  type = number
  # One hour (review of PR #736): the CLI caches the role session in ~/.aws/cli/cache, readable by every process
  # running as the same macOS user, agents included. A short session keeps that window small.
  default = 3600
}

# Functions the deployer may update, publish and re-alias (src_C/deploy.sh, services/deploy-python-lambda.sh).
# The newsapp functions are deliberately absent; so was edge-public until it was retired (R27 EDGE, 2026-10-04).
variable "deploy_function_names" {
  type = list(string)
}

# Static-site buckets the deployer syncs (frontend/deploy.sh, site/deploy.sh) and their distributions.
variable "deploy_bucket_names" {
  type = list(string)
}

variable "deploy_distribution_ids" {
  type = list(string)
}

variable "ssm_root_path" {
  type    = string
  default = "/developercards"
}

variable "rds_instance_id" {
  type = string
}

variable "github_repository" {
  type    = string
  default = "ChuanQiao1128/recallsmith"
}

variable "github_environment" {
  type    = string
  default = "production"
}
