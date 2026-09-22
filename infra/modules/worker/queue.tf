resource "aws_sqs_queue" "publish_jobs" {
  name                       = var.queue_name
  max_message_size           = 1048576
  message_retention_seconds  = 345600
  sqs_managed_sse_enabled    = true
  visibility_timeout_seconds = 300
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
