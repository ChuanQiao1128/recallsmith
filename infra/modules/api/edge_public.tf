# edge-public was retired on 2026-10-04 (R27 EDGE; owner decision, enterprise audit SDLC-05 / ENT-01): no
# invocation in the 90 days before, its source never in this repo (archived at archive/edge-public-2025-12-28/).
# The function, its routes, integration, invoke permissions and IAM role are deleted by the next apply.
#
# The log group is a record, so it is NOT deleted: this block takes it out of Terraform's state and leaves the
# group, its streams and its 30-day retention in AWS (Terraform >= 1.7; the plan shows it as "forget"). Keep the
# block until that apply has run; deleting it afterwards changes nothing.
removed {
  from = aws_cloudwatch_log_group.edge_public

  lifecycle {
    destroy = false
  }
}
