"""R26 P03: Snowflake and the analytics outbox are retired from infra (stdlib unittest, offline).

Run: python3 -m unittest discover -s infra/scripts/tests -v
Static checks over the Terraform sources plus the P03 plan allow-list. `terraform test` cannot name a
resource that no longer exists, so the removed resources are checked here; the dashboard layout is
checked by infra/modules/observability/tests/outbox_retired_r26.tftest.hcl.
"""

import copy
import json
import pathlib
import re
import subprocess
import sys
import unittest

REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]
INFRA = REPO_ROOT / "infra"
ALLOW = REPO_ROOT / "docs" / "delivery" / "r26-issues" / "P03.plan-allow.json"
CHECK_PLAN = INFRA / "scripts" / "check-plan.py"
P03_NOTES = REPO_ROOT / "docs" / "delivery" / "r26-issues" / "P03-notes.md"
P03_VERIFY = REPO_ROOT / "docs" / "delivery" / "r26-issues" / "P03.verify.sh"


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
        self.assertNotIn("outputs", allow, "P03 changes no root output; an outputs entry would admit one")


def _rc(address, actions, before, after):
    return {"address": address, "mode": "managed", "change": {"actions": actions, "before": before, "after": after}}


def p03_plan():
    """The plan P03 is expected to produce, reduced to what check-plan.py reads."""
    gone = {"name": "x"}
    return {
        "resource_changes": [
            _rc("module.identity.aws_iam_role.snowflake", ["delete"], gone, None),
            _rc("module.identity.aws_iam_policy.snowflake_read", ["delete"], gone, None),
            _rc('module.identity.aws_iam_role_policy_attachment.snowflake["read"]', ["delete"], gone, None),
            _rc("module.observability.aws_cloudwatch_metric_alarm.outbox_backlog", ["delete"], gone, None),
            _rc("module.identity.aws_iam_role_policy.core_vpc", ["update"],
                {"name": "developercards-core-vpc-scoped", "policy": "old"},
                {"name": "developercards-core-vpc-scoped", "policy": "new"}),
            _rc("module.observability.aws_cloudwatch_dashboard.prod", ["update"],
                {"dashboard_name": "developercards-prod", "dashboard_body": "old"},
                {"dashboard_name": "developercards-prod", "dashboard_body": "new"}),
            _rc("module.data.aws_s3_bucket.core_vpc", ["no-op"], {"bucket": "b"}, {"bucket": "b"}),
        ],
        "output_changes": {"core_vpc_role_arn": {"actions": ["no-op"]}},
    }


class AllowListAgainstPlanTest(unittest.TestCase):
    """Runs the real plan gate (check-plan.py) with P03.plan-allow.json on synthetic plans."""

    def gate(self, plan):
        return subprocess.run(
            [sys.executable, str(CHECK_PLAN), "--plan", "-", "--allow", str(ALLOW)],
            input=json.dumps(plan), capture_output=True, text=True, check=False)

    def test_expected_plan_passes(self):
        result = self.gate(p03_plan())
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("PLAN OK 6", result.stdout)

    def assert_rejected(self, plan, needle):
        result = self.gate(plan)
        self.assertEqual(result.returncode, 1, result.stdout)
        self.assertIn(needle, result.stderr)

    def test_extra_key_on_core_vpc_is_rejected(self):
        plan = p03_plan()
        change = plan["resource_changes"][4]["change"]
        change["after"]["name"] = "renamed"
        self.assert_rejected(plan, "keys not allowed (name) module.identity.aws_iam_role_policy.core_vpc")

    def test_extra_key_on_dashboard_is_rejected(self):
        plan = p03_plan()
        plan["resource_changes"][5]["change"]["after"]["dashboard_name"] = "other"
        self.assert_rejected(plan, "keys not allowed (dashboard_name) module.observability.aws_cloudwatch_dashboard.prod")

    def test_extra_delete_is_rejected(self):
        plan = p03_plan()
        plan["resource_changes"].append(
            _rc("module.data.aws_s3_bucket_lifecycle_configuration.core_vpc", ["delete"], {"id": "x"}, None))
        self.assert_rejected(plan, "unlisted delete module.data.aws_s3_bucket_lifecycle_configuration.core_vpc")

    def test_tags_only_update_is_rejected(self):
        plan = p03_plan()
        plan["resource_changes"][6] = _rc("module.data.aws_s3_bucket.core_vpc", ["update"],
                                          {"tags": {"a": "1"}}, {"tags": {"a": "2"}})
        self.assert_rejected(plan, "unlisted update module.data.aws_s3_bucket.core_vpc")

    def test_missing_delete_is_stale(self):
        plan = p03_plan()
        del plan["resource_changes"][3]
        self.assert_rejected(plan, "stale allow entry module.observability.aws_cloudwatch_metric_alarm.outbox_backlog")

    def test_output_change_is_rejected(self):
        plan = p03_plan()
        plan["output_changes"]["snowflake_role_arn"] = {"actions": ["delete"]}
        self.assert_rejected(plan, "unlisted output change snowflake_role_arn")

    def test_replace_instead_of_update_is_rejected(self):
        plan = copy.deepcopy(p03_plan())
        plan["resource_changes"][4]["change"]["actions"] = ["delete", "create"]
        self.assert_rejected(plan, "action mismatch (want update) module.identity.aws_iam_role_policy.core_vpc")


def runbook_section(text, heading):
    start = text.index(heading)
    rest = text[start + len(heading):]
    level = heading.split(" ", 1)[0]
    ends = [m.start() for m in re.finditer(r"^#{2,%d} " % len(level), rest, re.M)]
    return rest[:ends[0]] if ends else rest


class DeployOrderDocumentedTest(unittest.TestCase):
    """p-security-1 / x-deploy-1: the order and roll-forward rules live in the RUNBOOK, not only in the notes."""

    def assert_rules(self, section, where):
        flat = " ".join(section.split())
        self.assertRegex(flat, r"core-vpc R26 build (is deployed )?first", where + ": deploy order")
        self.assertIn("analytics/raw/", flat, where + ": why the old build breaks")
        self.assertRegex(flat, r"[Rr]oll forward only", where + ": roll forward only after 045")
        self.assertIn("analytics_event_outbox", flat, where + ": why a pre-R26 version breaks")
        self.assertIn("confirmDestructive=", flat, where + ": migrate stops before a destructive migration")

    def test_r26_section(self):
        self.assert_rules(runbook_section(tf_text("RUNBOOK.md"), "## 9. R26"), "R26 section")

    def test_core_vpc_rollback_section(self):
        self.assert_rules(runbook_section(tf_text("RUNBOOK.md"), "### Rollback of core-vpc (R26)"),
                          "core-vpc rollback section")

    def test_plan_step_points_at_the_gate(self):
        self.assertIn("§9", runbook_section(tf_text("RUNBOOK.md"), "## 3. Apply (supervisor only)"))


class NotesNameOnlyRepoFilesTest(unittest.TestCase):
    """p-tests-2: every docs/delivery or infra path the P03 notes name exists in the repo."""

    def test_verify_script_is_committed(self):
        self.assertTrue(P03_VERIFY.is_file(), "P03.verify.sh is named by the notes but not committed")

    def test_named_paths_exist(self):
        notes = P03_NOTES.read_text()
        named = set(re.findall(r"`((?:infra|docs)/[^`\s*<]+)`", notes))
        named |= {"docs/delivery/r26-issues/" + n for n in re.findall(r"`(P03\.[a-z.-]+)`", notes)}
        missing = sorted(n for n in named if not (REPO_ROOT / n).exists())
        self.assertEqual(missing, [])


if __name__ == "__main__":
    unittest.main()
