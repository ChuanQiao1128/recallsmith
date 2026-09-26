resource "aws_sqs_queue" "publish_jobs_dlq" {
  name                      = "developercards-publish-jobs-dlq"
  message_retention_seconds = 1209600
  sqs_managed_sse_enabled   = true
}

resource "aws_sqs_queue" "publish_jobs" {
  name                       = var.queue_name
  max_message_size           = 1048576
  message_retention_seconds  = 345600
  sqs_managed_sse_enabled    = true
  visibility_timeout_seconds = 3700
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.publish_jobs_dlq.arn
    maxReceiveCount     = 3
  })
  policy = jsonencode({
    Id = "__default_policy_ID"
    Statement = [{
      Action = "SQS:*"
      Effect = "Allow"
      Principal = {
        AWS = "arn:aws:iam::622994489535:root"
      }
      Resource = "arn:aws:sqs:ap-southeast-2:622994489535:recallsmith-publish-jobs"
      Sid      = "__owner_statement"
    }]
    Version = "2012-10-17"
  })
}

resource "aws_sqs_queue_redrive_allow_policy" "publish_jobs_dlq" {
  queue_url = aws_sqs_queue.publish_jobs_dlq.id
  redrive_allow_policy = jsonencode({
    redrivePermission = "byQueue"
    sourceQueueArns   = [aws_sqs_queue.publish_jobs.arn]
  })
}
