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

output "ai_qa_queue_arn" {
  value = aws_sqs_queue.ai_qa_jobs.arn
}

output "ai_qa_queue_url" {
  value = aws_sqs_queue.ai_qa_jobs.url
}

output "ai_qa_dlq_name" {
  value = aws_sqs_queue.ai_qa_jobs_dlq.name
}

output "ai_qa_function_name" {
  value = aws_lambda_function.ai_qa.function_name
}

output "webhook_queue_name" {
  value = aws_sqs_queue.webhook_events.name
}

output "ai_qa_queue_name" {
  value = aws_sqs_queue.ai_qa_jobs.name
}

output "notify_queue_arn" {
  value = aws_sqs_queue.notify.arn
}

output "notify_queue_url" {
  value = aws_sqs_queue.notify.url
}

output "notify_queue_name" {
  value = aws_sqs_queue.notify.name
}

output "notify_dlq_name" {
  value = aws_sqs_queue.notify_dlq.name
}

output "notifier_function_name" {
  value = aws_lambda_function.notifier.function_name
}

output "source_watcher_function_name" {
  value = aws_lambda_function.source_watcher.function_name
}

output "synthetic_check_function_name" {
  value = aws_lambda_function.synthetic_check.function_name
}
