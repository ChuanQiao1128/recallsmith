output "queue_arn" {
  value = aws_sqs_queue.publish_jobs.arn
}

output "queue_url" {
  value = aws_sqs_queue.publish_jobs.url
}

output "function_arn" {
  value = aws_lambda_function.worker.arn
}

output "alias_arn" {
  value = aws_lambda_alias.worker_prod.arn
}

output "log_group_name" {
  value = aws_cloudwatch_log_group.worker.name
}
