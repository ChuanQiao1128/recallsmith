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

output "publish_dlq_arn" {
  value = aws_sqs_queue.publish_jobs_dlq.arn
}

output "publish_dlq_name" {
  value = aws_sqs_queue.publish_jobs_dlq.name
}

output "webhook_queue_arn" {
  value = aws_sqs_queue.webhook_events.arn
}

output "webhook_queue_url" {
  value = aws_sqs_queue.webhook_events.url
}

output "webhook_dlq_name" {
  value = aws_sqs_queue.webhook_events_dlq.name
}

output "webhook_dispatcher_function_name" {
  value = aws_lambda_function.webhook_dispatcher.function_name
}
