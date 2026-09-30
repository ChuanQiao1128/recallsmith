# R20 V12 — p95 latency per ai-qa provider. Emitter and dimensions, which must stay equal to it:
#   ai-qa  emf.emit_item (usage line, only when the model was called) -> AiQaLatency ms, Service + Provider
# Provider is always a dimension, and a percentile cannot be summed across metrics (no SUM(METRICS())
# as in ai_qa_daily_cost, and no SEARCH in an alarm), so there is one alarm per provider. With a second
# reviewer the value is primary + second (services/ai-qa second_opinion.py), so 120 s covers both calls.
# Threshold, period and what to check when it fires: infra/README.md §6 (2026-10-01 V12).

locals {
  # The Provider values ai-qa emits; the same list as the dynamic metric_query in ai_qa_daily_cost.
  ai_qa_providers = toset(["bedrock", "anthropic", "bedrock-converse", "openai-mantle"])
}

resource "aws_cloudwatch_metric_alarm" "ai_qa_latency_p95" {
  for_each            = local.ai_qa_providers
  alarm_name          = "developercards-${var.env}-ai-qa-latency-p95-${each.key}"
  alarm_description   = "AI QA review latency p95 for provider ${each.key} exceeded 120 s over one hour (per card, primary + second reviewer)."
  namespace           = var.metrics_namespace
  metric_name         = "AiQaLatency"
  extended_statistic  = "p95"
  dimensions          = { Service = "ai-qa", Provider = each.key }
  comparison_operator = "GreaterThanThreshold"
  threshold           = 120000
  period              = 3600
  evaluation_periods  = 1
  datapoints_to_alarm = 1
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
}
