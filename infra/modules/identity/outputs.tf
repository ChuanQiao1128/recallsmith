output "core_vpc_role_arn" {
  value = aws_iam_role.core_vpc.arn
}

output "core_vpc_role_name" {
  value = aws_iam_role.core_vpc.name
}

output "edge_public_role_arn" {
  value = aws_iam_role.edge_public.arn
}

output "snowflake_role_arn" {
  value = var.snowflake_external_id == null ? null : aws_iam_role.snowflake.arn
}

output "rds_monitoring_role_arn" {
  value = aws_iam_role.rds_monitoring.arn
}

output "console_pool_endpoint" {
  value = "cognito-idp.${var.region}.amazonaws.com/${var.console_pool_id}"
}

output "console_client_id" {
  value = var.manage_cognito ? aws_cognito_user_pool_client.spa[0].id : null
}

output "console_dev_client_id" {
  value = var.manage_cognito ? aws_cognito_user_pool_client.console_dev[0].id : null
}

output "mobile_pool_endpoint" {
  value = "cognito-idp.${var.region}.amazonaws.com/${var.mobile_pool_id}"
}

output "mobile_client_id" {
  value = var.manage_cognito ? aws_cognito_user_pool_client.mobile[0].id : null
}

output "worker_role_arn" {
  value      = aws_iam_role.worker.arn
  depends_on = [aws_iam_role_policy.worker] # the function update must follow the policy (Context #5)
}

output "worker_role_name" {
  value = aws_iam_role.worker.name
}

output "secret_parameter_path" {
  description = "SSM path prefix deploy.sh reads with get-parameters-by-path."
  value       = "/developercards/${var.env}"
}

output "secret_parameter_arns" {
  description = "Leaf name → parameter ARN, for the CD role policy (E11)."
  value       = { for k, p in aws_ssm_parameter.secret : k => p.arn }
}
