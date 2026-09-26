resource "aws_sns_topic" "alerts" {
  name = "developercards-alerts"
}

resource "aws_sns_topic_subscription" "alerts_email" {
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

resource "aws_sns_topic_policy" "alerts" {
  arn = aws_sns_topic.alerts.arn
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "AccountOwner"
        Effect    = "Allow"
        Principal = { AWS = "arn:aws:iam::${var.account_id}:root" }
        Action    = ["SNS:Publish", "SNS:Subscribe", "SNS:GetTopicAttributes", "SNS:SetTopicAttributes", "SNS:ListSubscriptionsByTopic", "SNS:DeleteTopic", "SNS:RemovePermission", "SNS:AddPermission"]
        Resource  = aws_sns_topic.alerts.arn
      },
      {
        Sid    = "AwsServicesPublish"
        Effect = "Allow"
        Principal = {
          Service = [
            "cloudwatch.amazonaws.com",
            "budgets.amazonaws.com",
            "lambda.amazonaws.com",
            "events.rds.amazonaws.com",
            "scheduler.amazonaws.com",
          ]
        }
        Action    = "SNS:Publish"
        Resource  = aws_sns_topic.alerts.arn
        Condition = { StringEquals = { "aws:SourceAccount" = var.account_id } }
      },
    ]
  })
}

resource "aws_db_event_subscription" "developercards" {
  name             = "developercards-${var.env}-rds-events"
  sns_topic        = aws_sns_topic.alerts.arn
  source_type      = "db-instance"
  source_ids       = [var.db_identifier]
  event_categories = ["availability", "backup", "deletion", "failover", "failure", "low storage", "maintenance", "recovery"]
  depends_on       = [aws_sns_topic_policy.alerts]
}
