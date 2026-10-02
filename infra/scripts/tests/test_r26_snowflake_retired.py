"""R26 P03: Snowflake and the analytics outbox are retired from infra (stdlib unittest, offline).

Run: python3 -m unittest discover -s infra/scripts/tests -v
Static checks over the Terraform sources plus the P03 plan allow-list. `terraform test` cannot name a
resource that no longer exists, so the removed resources are checked here; the dashboard layout is
checked by infra/modules/observability/tests/outbox_retired_r26.tftest.hcl.
"""

import json
import pathlib
import re
import unittest

REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]
INFRA = REPO_ROOT / "infra"
ALLOW = REPO_ROOT / "docs" / "delivery" / "r26-issues" / "P03.plan-allow.json"


def tf_text(*parts):
    return (INFRA.joinpath(*parts)).read_text()


def all_tf():
    return {p: p.read_text() for p in INFRA.rglob("*.tf") if ".terraform" not in p.parts}


class SnowflakeRetiredTest(unittest.TestCase):
    def test_no_snowflake_in_terraform(self):
        hits = sorted(str(p.relative_to(REPO_ROOT)) for p, text in all_tf().items() if re.search("snowflake", text, re.I))
        self.assertEqual(hits, [], "Snowflake role/policy/variable/import still referenced")

    def test_no_snowflake_in_tfvars_example(self):
        self.assertNotIn("snowflake", tf_text("envs", "prod", "prod.auto.tfvars.example").lower())

    def test_runbook_has_no_snowflake_step(self):
        self.assertNotIn("TF_VAR_snowflake_external_id", tf_text("RUNBOOK.md"))


class OutboxRetiredTest(unittest.TestCase):
    def test_no_outbox_alarm_or_metric(self):
        hits = sorted(str(p.relative_to(REPO_ROOT)) for p, text in all_tf().items()
                      if "OutboxPending" in text or "outbox_backlog" in text)
        self.assertEqual(hits, [], "outbox alarm or dashboard widget still defined")

    def test_core_vpc_has_no_analytics_object_grant(self):
        policies = tf_text("modules", "identity", "policies.tf")
        block = policies[policies.index('resource "aws_iam_role_policy" "core_vpc"'):]
        block = block[:block.index("\nresource ")] if "\nresource " in block else block
        self.assertNotIn("analytics/", block)
        self.assertIn('"${local.content_bucket_arn}/content/*"', block)

    def test_analytics_raw_lifecycle_rule_kept(self):
        buckets = tf_text("modules", "data", "buckets.tf")
        self.assertIn('id     = "analytics-raw-400d"', buckets)
        self.assertIn('prefix = "analytics/raw/"', buckets)


class AllowListTest(unittest.TestCase):
    EXPECTED = {
        "module.identity.aws_iam_role.snowflake": "delete",
        "module.identity.aws_iam_policy.snowflake_read": "delete",
        'module.identity.aws_iam_role_policy_attachment.snowflake["read"]': "delete",
        "module.identity.aws_iam_role_policy.core_vpc": {"action": "update", "keys": ["policy"]},
        "module.observability.aws_cloudwatch_metric_alarm.outbox_backlog": "delete",
        "module.observability.aws_cloudwatch_dashboard.prod": {"action": "update", "keys": ["dashboard_body"]},
    }

    def test_allow_list_is_exact(self):
        allow = json.loads(ALLOW.read_text())
        self.assertIs(allow.get("tags_only_updates"), False)
        self.assertEqual(allow.get("changes"), self.EXPECTED)
        self.assertEqual(allow.get("outputs", []), [])


if __name__ == "__main__":
    unittest.main()
