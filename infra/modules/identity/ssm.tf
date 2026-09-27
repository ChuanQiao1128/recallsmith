# Placeholders only. The real values are written by the supervisor with put-parameter after
# apply and are ignored by state; deploy.sh copies them into the Lambda function's env vars at
# deploy time (E00 §2.6.3). core-vpc and worker-lambda read no SSM at runtime (E00 §6 #8). The R18
# Python Lambdas outside the VPC each read exactly two parameters at cold start — their own leaf and
# internal-shared-secret (R18-00 §14 #7); merge-env.sh keeps those leaves out of deploy.sh (SSM_NOT_ENV).
resource "aws_ssm_parameter" "secret" {
  for_each = toset(var.secret_parameter_names)

  name        = "/developercards/${var.env}/${each.key}"
  description = "developercards ${var.env} secret ${each.key} (value managed outside Terraform)"
  type        = "SecureString"
  tier        = "Standard"
  value       = "PLACEHOLDER-set-by-supervisor"

  lifecycle {
    ignore_changes = [value]
  }
}
