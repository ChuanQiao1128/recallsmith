# Placeholders only. The real values are written by the supervisor with put-parameter after
# apply and are ignored by state; deploy.sh copies them into the Lambda function's env vars at
# deploy time (E00 §2.6.3). No Lambda role reads SSM (E00 §6 #8): there is no runtime fetch and
# no VPC endpoint.
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
