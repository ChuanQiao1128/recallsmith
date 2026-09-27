output "budget_name" {
  value = aws_budgets_budget.monthly.name
}

output "alerts_topic_arn" { value = aws_sns_topic.alerts.arn }
output "api_access_log_group_arn" { value = aws_cloudwatch_log_group.api_access.arn }
output "api_access_log_group_name" { value = aws_cloudwatch_log_group.api_access.name }

# R18C: the alerts topic for the SES event destination, available only once the topic policy that lets
# the automation configuration set publish (SesEventPublish) is in place.
output "ses_events_topic_arn" {
  value      = aws_sns_topic.alerts.arn
  depends_on = [aws_sns_topic_policy.alerts]
}
