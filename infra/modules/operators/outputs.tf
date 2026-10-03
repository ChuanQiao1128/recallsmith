output "agent_readonly_role_arn" {
  value = aws_iam_role.agent_readonly.arn
}

output "deployer_role_arn" {
  value = aws_iam_role.deployer.arn
}

output "admin_mfa_role_arn" {
  value = aws_iam_role.admin_mfa.arn
}

output "operator_base_policy_arn" {
  value = aws_iam_policy.operator_base.arn
}

output "gha_prod_role_arn" {
  value = aws_iam_role.gha_prod.arn
}
