"""R27 EDGE: edge-public is retired from infra (stdlib unittest, offline).

Run: python3 -m unittest discover -s infra/scripts/tests -v
Static checks over the Terraform sources plus the EDGE plan allow-list, run through the real plan
gate (check-plan.py) on synthetic plans. `terraform test` cannot name a resource that no longer
exists, so the removed resources are checked here, as in test_r26_snowflake_retired.py.
"""

import json
import pathlib
import re
import subprocess
import sys
import unittest

REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]
INFRA = REPO_ROOT / "infra"
ALLOW = REPO_ROOT / "docs" / "delivery" / "r27-issues" / "EDGE.plan-allow.json"
CHECK_PLAN = INFRA / "scripts" / "check-plan.py"
ARCHIVE = REPO_ROOT / "archive" / "edge-public-2025-12-28"

PERMISSION_SIDS = [
    "3249e15a-5957-5b6d-b271-1c7d73f1c800",
    "666d2528-5c6a-5fce-a7e9-4bbcaae132a9",
    "70ec633b-6621-5c8b-9278-9ba3d2987025",
]
ROUTE_KEYS = ["edge_ai", "edge_billing", "edge_admin_cognito", "options_ai", "options_billing", "options_admin_cognito"]
LOG_GROUP = "module.api.aws_cloudwatch_log_group.edge_public"


def all_tf():
    return {p: p.read_text() for p in INFRA.rglob("*.tf") if ".terraform" not in p.parts}


def tf_text(*parts):
    return INFRA.joinpath(*parts).read_text()


class EdgePublicRetiredTest(unittest.TestCase):
    def test_edge_public_is_named_only_by_the_removed_block(self):
        # Every non-comment line of Terraform that names edge_public, anywhere under infra/. The one
        # that may remain is the removed block's `from` (the log group is forgotten, not destroyed).
        hits = []
        for path, text in all_tf().items():
            for line in text.splitlines():
                code = line.split("#", 1)[0]
                if "edge_public" in code or "edge-public" in code:
                    hits.append((str(path.relative_to(REPO_ROOT)), code.strip()))
        self.assertEqual(hits, [("infra/modules/api/edge_public.tf", "from = aws_cloudwatch_log_group.edge_public")])

    def test_no_edge_public_route_keys(self):
        gateway = tf_text("modules", "api", "gateway.tf")
        for key in ROUTE_KEYS:
            self.assertNotRegex(gateway, r"(?m)^\s*" + key + r"\s*=", key + " route still in local.routes")
        for prefix in ("/api/v1/ai/", "/api/v1/billing/", "/api/v1/admin/cognito/"):
            self.assertNotIn('route_key = "ANY ' + prefix, gateway)
            self.assertNotIn('route_key = "OPTIONS ' + prefix, gateway)

    def test_log_group_is_forgotten_not_destroyed(self):
        text = tf_text("modules", "api", "edge_public.tf")
        self.assertNotIn("resource ", text)
        block = re.search(r"removed\s*\{(.*)\}", text, re.S)
        self.assertIsNotNone(block, "the removed block for the log group is missing")
        self.assertRegex(block.group(1), r"from\s*=\s*aws_cloudwatch_log_group\.edge_public\b")
        self.assertRegex(block.group(1), r"lifecycle\s*\{\s*destroy\s*=\s*false\s*\}")

    def test_terraform_is_new_enough_for_removed_blocks(self):
        # removed {} with lifecycle { destroy = false } needs Terraform >= 1.7.
        versions = tf_text("envs", "prod", "versions.tf")
        match = re.search(r'required_version\s*=\s*">=\s*1\.(\d+)', versions)
        self.assertIsNotNone(match)
        self.assertGreaterEqual(int(match.group(1)), 7)


class ArchiveTest(unittest.TestCase):
    def test_archive_holds_the_reviewed_source_and_no_live_manifest(self):
        self.assertTrue((ARCHIVE / "README.md").is_file())
        self.assertTrue((ARCHIVE / "src" / "public" / "handler.js").is_file())
        # Named so GitHub's dependency graph (and Dependabot security updates) does not read the
        # archived lockfile as a live manifest.
        self.assertTrue((ARCHIVE / "package.json.archived").is_file())
        self.assertTrue((ARCHIVE / "package-lock.json.archived").is_file())
        self.assertFalse((ARCHIVE / "package.json").exists())
        self.assertFalse((ARCHIVE / "package-lock.json").exists())
        self.assertFalse((ARCHIVE / "node_modules").exists())


class AllowListTest(unittest.TestCase):
    EXPECTED = {
        **{'module.api.aws_apigatewayv2_route.this["%s"]' % k: "delete" for k in ROUTE_KEYS},
        "module.api.aws_apigatewayv2_integration.edge_public": "delete",
        **{'module.api.aws_lambda_permission.edge_public["%s"]' % s: "delete" for s in PERMISSION_SIDS},
        "module.api.aws_lambda_function.edge_public": "delete",
        LOG_GROUP: "forget",
        "module.identity.aws_iam_role.edge_public": "delete",
        "module.identity.aws_iam_role_policy.edge_public_cognito": "delete",
        "module.identity.aws_iam_policy.edge_public_logs": "delete",
        "module.identity.aws_iam_role_policy_attachment.edge_public_logs": "delete",
    }

    def test_allow_list_is_exact(self):
        allow = json.loads(ALLOW.read_text())
        self.assertIs(allow.get("tags_only_updates"), False)
        self.assertEqual(allow.get("changes"), self.EXPECTED)
        self.assertNotIn("outputs", allow, "EDGE changes no root output; an outputs entry would admit one")

    def test_permission_keys_match_the_module_source_of_truth(self):
        # The for_each keys came from modules/api/main.tf before EDGE removed them; the import ids
        # in docs/delivery/r16-issues/E01.imports.txt are the adopted state addresses.
        adopted = (REPO_ROOT / "docs" / "delivery" / "r16-issues" / "E01.imports.txt").read_text()
        for sid in PERMISSION_SIDS:
            self.assertIn('module.api.aws_lambda_permission.edge_public["%s"]' % sid, adopted)


def _rc(address, actions, before, after):
    return {"address": address, "mode": "managed", "change": {"actions": actions, "before": before, "after": after}}


def edge_plan():
    """The plan EDGE is expected to produce, reduced to what check-plan.py reads."""
    gone = {"name": "x"}
    changes = [_rc(address, [action], gone, None) for address, action in AllowListTest.EXPECTED.items()]
    changes.append(_rc("module.api.aws_apigatewayv2_route.this[\"options_admin\"]", ["no-op"], {"k": 1}, {"k": 1}))
    changes.append(_rc("module.api.aws_apigatewayv2_stage.default", ["no-op"], {"k": 1}, {"k": 1}))
    return {"resource_changes": changes, "output_changes": {"api_endpoint": {"actions": ["no-op"]}}}


class AllowListAgainstPlanTest(unittest.TestCase):
    """Runs the real plan gate (check-plan.py) with EDGE.plan-allow.json on synthetic plans."""

    def gate(self, plan, allow=True, summary=False):
        cmd = [sys.executable, str(CHECK_PLAN), "--plan", "-"]
        if allow:
            cmd += ["--allow", str(ALLOW)]
        if summary:
            cmd.append("--summary")
        return subprocess.run(cmd, input=json.dumps(plan), capture_output=True, text=True, check=False)

    def assert_rejected(self, plan, needle):
        result = self.gate(plan)
        self.assertEqual(result.returncode, 1, result.stdout)
        self.assertIn(needle, result.stderr)

    def test_expected_plan_passes_with_one_forget(self):
        result = self.gate(edge_plan(), summary=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("PLAN OK 16", result.stdout)
        self.assertIn(LOG_GROUP + "  forget  ", result.stdout)
        self.assertIn("delete=15 replace=0 outputs=0 forget=1", result.stdout)

    def test_destroying_the_log_group_is_rejected(self):
        # The one thing EDGE must never do: delete the records. A removed block without
        # destroy = false (or no removed block at all) plans the log group as a delete.
        plan = edge_plan()
        for entry in plan["resource_changes"]:
            if entry["address"] == LOG_GROUP:
                entry["change"]["actions"] = ["delete"]
        self.assert_rejected(plan, "action mismatch (want forget) " + LOG_GROUP)

    def test_a_forget_is_never_admitted_by_an_empty_plan_check(self):
        plan = {"resource_changes": [_rc(LOG_GROUP, ["forget"], {"name": "x"}, None)]}
        result = self.gate(plan, allow=False)
        self.assertEqual(result.returncode, 1, result.stdout)
        self.assertIn("unexpected forget " + LOG_GROUP, result.stderr)

    def test_unknown_action_set_still_stops_the_gate(self):
        plan = {"resource_changes": [_rc(LOG_GROUP, ["forget", "create"], {"name": "x"}, {"name": "x"})]}
        result = self.gate(plan)
        self.assertEqual(result.returncode, 2)
        self.assertIn("unknown action set", result.stderr)

    def test_extra_delete_is_rejected(self):
        plan = edge_plan()
        plan["resource_changes"].append(_rc("module.api.aws_apigatewayv2_integration.core_vpc", ["delete"], {"id": "x"}, None))
        self.assert_rejected(plan, "unlisted delete module.api.aws_apigatewayv2_integration.core_vpc")

    def test_route_left_behind_is_stale(self):
        plan = edge_plan()
        plan["resource_changes"] = [e for e in plan["resource_changes"]
                                    if e["address"] != 'module.api.aws_apigatewayv2_route.this["options_ai"]']
        self.assert_rejected(plan, 'stale allow entry module.api.aws_apigatewayv2_route.this["options_ai"]')

    def test_stage_update_is_rejected(self):
        plan = edge_plan()
        plan["resource_changes"].append(_rc("module.api.aws_apigatewayv2_stage.dev", ["update"],
                                            {"route_settings": [1]}, {"route_settings": []}))
        self.assert_rejected(plan, "unlisted update module.api.aws_apigatewayv2_stage.dev")


def runbook_section(text, heading):
    start = text.index(heading)
    rest = text[start + len(heading):]
    level = heading.split(" ", 1)[0]
    ends = [m.start() for m in re.finditer(r"^#{2,%d} " % len(level), rest, re.M)]
    return rest[:ends[0]] if ends else rest


class RunbookTest(unittest.TestCase):
    """The console's create/list form is gone; the commands that replace it live in the RUNBOOK."""

    def test_console_admin_accounts_section(self):
        section = runbook_section(tf_text("RUNBOOK.md"), "## 13. Console admin accounts (after edge-public, 2026-10-04)")
        flat = " ".join(section.split())
        for command in ("list-users-in-group", "admin-create-user", "admin-add-user-to-group",
                        "admin-disable-user", "admin-delete-user"):
            self.assertIn("aws cognito-idp " + command, flat, command)
        self.assertIn("--profile devcards-admin", flat)
        self.assertIn("ap-southeast-2_4Vf8uCXKt", flat)
        self.assertIn("--message-action SUPPRESS", flat)
        self.assertIn("Name=email_verified,Value=true", flat)
        self.assertIn("EDGE.plan-allow.json", flat)
        self.assertRegex(flat, r"console (build )?first", "retirement order: console before terraform apply")
        self.assertIn("Rollback", section)

    def test_pool_id_matches_terraform(self):
        variables = tf_text("envs", "prod", "variables.tf")
        self.assertRegex(variables, r'variable "console_pool_id" \{[^}]*default = "ap-southeast-2_4Vf8uCXKt"')


if __name__ == "__main__":
    unittest.main()
