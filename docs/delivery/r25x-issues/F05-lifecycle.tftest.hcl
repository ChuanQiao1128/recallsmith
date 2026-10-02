# R25X F05 (p-tests-2): offline plan-mode test of the core-vpc bucket lifecycle (infra/modules/data/buckets.tf).
# The aws provider is mocked, so this never reaches AWS. F05-retention-test.sh copies this file into a temp copy of
# infra/modules/data/tests/ and runs `terraform test` there (the brief's scope allows no new file under infra/).

mock_provider "aws" {
  # rds.tf validates the KMS key as an ARN; the mock's random string is not one.
  mock_data "aws_kms_alias" {
    defaults = {
      target_key_arn = "arn:aws:kms:ap-southeast-2:000000000000:key/00000000-0000-0000-0000-000000000000"
    }
  }
}

variables {
  env                       = "prod"
  db_identifier             = "developercards"
  db_subnet_group_name      = "test-subnets"
  content_bucket_name       = "core-vpc"
  premium_bucket_name       = "premium"
  vpc_id                    = "vpc-00000000"
  subnet_ids                = ["subnet-00000000"]
  lambda_security_group_ids = ["sg-00000000"]
  rds_security_group_ids    = ["sg-00000001"]
  rds_monitoring_role_arn   = "arn:aws:iam::000000000000:role/rds-monitoring"
}

run "content_bucket_lifecycle_rules" {
  command = plan

  assert {
    condition     = [for r in aws_s3_bucket_lifecycle_configuration.content.rule : r.id] == ["noncurrent-90d", "analytics-raw-400d"]
    error_message = "content lifecycle must hold exactly the rules noncurrent-90d and analytics-raw-400d, in that order"
  }

  # noncurrent-90d: empty filter (an unset filter prefix is unknown at plan time, so the script checks the block text), noncurrent 90 days, multipart abort 7 days, no current-version expiration.
  assert {
    condition = alltrue([for r in aws_s3_bucket_lifecycle_configuration.content.rule : (
      r.status == "Enabled" &&
      length(r.filter) == 1 && length(r.filter[0].and) == 0 && length(r.filter[0].tag) == 0 &&
      length(r.noncurrent_version_expiration) == 1 && r.noncurrent_version_expiration[0].noncurrent_days == 90 &&
      length(r.abort_incomplete_multipart_upload) == 1 && r.abort_incomplete_multipart_upload[0].days_after_initiation == 7 &&
      length(r.expiration) == 0 && length(r.transition) == 0 && length(r.noncurrent_version_transition) == 0
    ) if r.id == "noncurrent-90d"])
    error_message = "noncurrent-90d changed: want empty filter, noncurrent 90 days, abort multipart 7 days, nothing else"
  }

  # analytics-raw-400d: prefix analytics/raw/ only, current versions 400 days, noncurrent 30 days, nothing else.
  assert {
    condition = alltrue([for r in aws_s3_bucket_lifecycle_configuration.content.rule : (
      r.status == "Enabled" &&
      length(r.filter) == 1 && r.filter[0].prefix == "analytics/raw/" && length(r.filter[0].and) == 0 && length(r.filter[0].tag) == 0 &&
      length(r.expiration) == 1 && r.expiration[0].days == 400 && r.expiration[0].date == null &&
      length(r.noncurrent_version_expiration) == 1 && r.noncurrent_version_expiration[0].noncurrent_days == 30 &&
      length(r.abort_incomplete_multipart_upload) == 0 && length(r.transition) == 0 && length(r.noncurrent_version_transition) == 0
    ) if r.id == "analytics-raw-400d"])
    error_message = "analytics-raw-400d changed: want prefix analytics/raw/, expiration 400 days, noncurrent 30 days, nothing else"
  }

  # The premium bucket keeps its single rule.
  assert {
    condition = [for r in aws_s3_bucket_lifecycle_configuration.premium.rule : [
      r.id, r.status, length(r.filter[0].and), length(r.filter[0].tag), r.noncurrent_version_expiration[0].noncurrent_days,
      r.abort_incomplete_multipart_upload[0].days_after_initiation, length(r.expiration)
    ]] == [["noncurrent-90d", "Enabled", 0, 0, 90, 7, 0]]
    error_message = "premium lifecycle must stay the single noncurrent-90d rule"
  }
}
