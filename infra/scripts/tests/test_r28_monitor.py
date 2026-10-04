"""R28 MONITOR: who the api-4xx-rate alarm counts as a user, and the MONITOR plan allow-list (stdlib unittest, offline).

Run: python3 -m unittest discover -s infra/scripts/tests -v

The access-log filters in infra/modules/observability/alarms_r28.tf leave out every route key in
`local.api_non_user_routes` (a trailing * is a prefix match, as in a CloudWatch JSON filter). The independent review
(F1) found the server-to-server callbacks counted as users: about 12 requests an hour against a few app requests a
day, so a refusal of every app request could never reach the 50 % rate. These tests tie that list to the gateway's
routes (infra/modules/api/gateway.tf `local.routes`): every unauthenticated callback and the author runner's routes are
left out, no app or console route is, and every entry still matches a route. The second part runs the real plan gate
(check-plan.py) with MONITOR.plan-allow.json on the plan MONITOR is expected to produce.
"""

import json
import pathlib
import re
import subprocess
import sys
import unittest

REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]
INFRA = REPO_ROOT / "infra"
GATEWAY = INFRA / "modules" / "api" / "gateway.tf"
ALARMS = INFRA / "modules" / "observability" / "alarms_r28.tf"
ALLOW = REPO_ROOT / "docs" / "delivery" / "r28-issues" / "MONITOR.plan-allow.json"
CHECK_PLAN = INFRA / "scripts" / "check-plan.py"

# The unmatched catch-alls: console-authorized, but no app or console call lands on them (scanners, retired paths).
CATCH_ALLS = {"ANY /{proxy+}", "$default"}
# Unauthenticated routes that real users call: the liveness route and the app's anonymous install funnel.
USER_FACING_UNAUTHENTICATED = {"GET /health", "POST /api/v1/public/events", "POST /api/v1/public/card-reports"}
RUNNER_PREFIX = "POST /api/v1/authoring/automation/runner/"


def gateway_routes():
    """{route_key: auth} from gateway.tf's `routes = { name = { route_key = ..., integration = ..., auth = ... } }`."""
    text = GATEWAY.read_text()
    block = text[text.index("  routes = {"):text.index("  integration_ids = {")]
    found = re.findall(r'^\s+\w+\s*=\s*\{\s*route_key\s*=\s*"([^"]+)",\s*integration\s*=\s*"\w+",\s*auth\s*=\s*"(\w+)"\s*\}', block, re.M)
    return dict(found)


def non_user_routes():
    text = ALARMS.read_text()
    block = re.search(r"api_non_user_routes = \[(.*?)\]", text, re.S)
    assert block is not None
    return re.findall(r'"([^"]+)"', block.group(1))


def matches(pattern, route_key):
    return route_key.startswith(pattern[:-1]) if pattern.endswith("*") else route_key == pattern


class ApiUserFilterTest(unittest.TestCase):
    def setUp(self):
        self.routes = gateway_routes()
        self.excluded = non_user_routes()

    def is_excluded(self, route_key):
        return any(matches(p, route_key) for p in self.excluded)

    def test_the_gateway_routes_are_read(self):
        # A parse that finds nothing would make every assertion below vacuous.
        self.assertGreaterEqual(len(self.routes), 30)
        self.assertEqual(self.routes["GET /api/v1/me"], "mobile")
        self.assertEqual(self.routes["POST /api/internal/automation/tick"], "none")

    def test_every_server_to_server_callback_is_left_out(self):
        callbacks = [k for k, auth in self.routes.items()
                     if auth == "none" and not k.startswith("OPTIONS ") and k not in USER_FACING_UNAUTHENTICATED]
        self.assertTrue(callbacks)
        for key in callbacks:
            self.assertTrue(self.is_excluded(key), f"{key} (no JWT: a signed callback) counts as a user's request")

    def test_the_runner_is_left_out(self):
        runner = [k for k in self.routes if k.startswith(RUNNER_PREFIX)]
        self.assertEqual(len(runner), 3)
        for key in runner:
            self.assertTrue(self.is_excluded(key), key)

    def test_no_app_or_console_route_is_left_out(self):
        for key, auth in self.routes.items():
            if key in CATCH_ALLS or key.startswith(RUNNER_PREFIX):
                continue
            if auth in ("mobile", "console", "agent") or key.startswith("OPTIONS ") or key in USER_FACING_UNAUTHENTICATED:
                self.assertFalse(self.is_excluded(key), f"{key} ({auth}) is a user route and must be counted")

    def test_every_entry_matches_a_route(self):
        for pattern in self.excluded:
            self.assertTrue(any(matches(pattern, k) for k in self.routes), f"{pattern} matches no gateway route")
            if pattern.endswith("*"):
                self.assertNotIn("*", pattern[:-1], "a JSON filter wildcard only at the end here")

    def test_the_tftest_pins_the_same_list(self):
        test = (INFRA / "modules" / "observability" / "tests" / "monitor_r28.tftest.hcl").read_text()
        for pattern in self.excluded:
            self.assertIn('($.routeKey != \\"%s\\")' % pattern, test)


def _rc(address, actions):
    before = None if actions == ["create"] else {"k": 1}
    after = {"k": 2}
    return {"address": address, "mode": "managed", "change": {"actions": actions, "before": before, "after": after}}


def monitor_plan():
    """The plan MONITOR is expected to produce, reduced to what check-plan.py reads."""
    allow = json.loads(ALLOW.read_text())["changes"]
    changes = []
    for address, want in allow.items():
        action = want if isinstance(want, str) else want["action"]
        entry = _rc(address, [action])
        if not isinstance(want, str):
            entry["change"]["before"] = {key: 1 for key in want["keys"]}
            entry["change"]["after"] = {key: 2 for key in want["keys"]}
        changes.append(entry)
    changes.append(_rc("module.observability.aws_cloudwatch_metric_alarm.synthetic_check_failing", ["no-op"]))
    return {"resource_changes": changes, "output_changes": {"api_endpoint": {"actions": ["no-op"]}}}


class AllowListAgainstPlanTest(unittest.TestCase):
    """Runs the real plan gate (check-plan.py) with MONITOR.plan-allow.json on synthetic plans."""

    def gate(self, plan, summary=False):
        cmd = [sys.executable, str(CHECK_PLAN), "--plan", "-", "--allow", str(ALLOW)]
        if summary:
            cmd.append("--summary")
        return subprocess.run(cmd, input=json.dumps(plan), capture_output=True, text=True, check=False)

    def test_allow_list_is_eight_creates_and_four_updates(self):
        allow = json.loads(ALLOW.read_text())["changes"]
        creates = sorted(a for a, w in allow.items() if w == "create")
        self.assertEqual(creates, sorted([
            "module.observability.aws_cloudwatch_log_metric_filter.api_user_requests",
            "module.observability.aws_cloudwatch_log_metric_filter.api_user_4xx",
            "module.observability.aws_cloudwatch_log_metric_filter.api_429",
            "module.observability.aws_cloudwatch_log_metric_filter.core_vpc_auth_rejects",
            "module.observability.aws_cloudwatch_metric_alarm.api_4xx_rate",
            "module.observability.aws_cloudwatch_metric_alarm.api_429",
            "module.observability.aws_cloudwatch_metric_alarm.core_vpc_auth_rejects",
            "module.observability.aws_cloudwatch_metric_alarm.synthetic_remote_config_failing",
        ]))
        self.assertEqual(len(allow) - len(creates), 4)
        self.assertFalse(any(a.startswith("module.operators.") for a in allow), "module.operators is break-glass")
        for address in creates:
            kind, name = address.split(".")[2:4]
            self.assertRegex(ALARMS.read_text(), r'resource "%s" "%s"' % (kind, name))

    def test_expected_plan_passes(self):
        result = self.gate(monitor_plan(), summary=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("PLAN OK 12", result.stdout)

    def test_an_unlisted_change_is_rejected(self):
        plan = monitor_plan()
        for entry in plan["resource_changes"]:
            if entry["address"].endswith(".synthetic_check_failing"):
                entry["change"]["actions"] = ["update"]
        result = self.gate(plan)
        self.assertEqual(result.returncode, 1, result.stdout)
        self.assertIn("unlisted update module.observability.aws_cloudwatch_metric_alarm.synthetic_check_failing", result.stderr)


if __name__ == "__main__":
    unittest.main()
