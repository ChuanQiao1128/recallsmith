resource "aws_budgets_budget" "monthly" {
  account_id        = var.account_id
  billing_view_arn  = "arn:aws:billing::622994489535:billingview/primary"
  budget_type       = "COST"
  limit_amount      = var.budget_limit
  limit_unit        = "USD"
  metrics           = ["UnblendedCost"]
  name              = var.budget_name
  time_period_end   = "2087-06-15_00:00"
  time_period_start = "2025-12-01_00:00"
  time_unit         = "MONTHLY"
  filter_expression {
    not {
      dimensions {
        key           = "RECORD_TYPE"
        match_options = []
        values        = ["Credit", "Refund"]
      }
    }
  }
  notification {
    comparison_operator        = "GREATER_THAN"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = ["info@timeawake.co.nz"]
    threshold                  = 50
    threshold_type             = "PERCENTAGE"
  }
  notification {
    comparison_operator        = "GREATER_THAN"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = ["info@timeawake.co.nz"]
    threshold                  = 85
    threshold_type             = "PERCENTAGE"
  }
  notification {
    comparison_operator        = "GREATER_THAN"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = ["info@timeawake.co.nz"]
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
  }
}
