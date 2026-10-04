"""R29 HARDEN: the console and site security headers, and the HARDEN plan allow-list (stdlib unittest, offline).

Run: python3 -m unittest discover -s infra/scripts/tests -v

infra/modules/edge/security_headers.json is the one source of the headers: Terraform builds the two CloudFront response
headers policies from it (security_headers.tf) and the console's Playwright smoke serves the built bundle with it
(frontend/scripts/serve-with-headers.mjs; tests/e2e/cspGuard.ts fails a test on any CSP violation). These tests pin
what the browser run cannot see: the policy stays strict (no 'unsafe-inline' or 'unsafe-eval', no framing, no plugin
content), it names the API and Cognito origins the production console is built with (frontend/.env.production), the
landing page stays a page the site policy can load (no script, no inline style, nothing from another origin), and
both distributions point at the new policies. The last part runs the real plan gate (check-plan.py) with
HARDEN.plan-allow.json on the plan HARDEN is expected to produce. The route throttles are checked by the route guard in
infra/modules/api/gateway.tf (terraform validate) and its mutation test docs/delivery/r29-issues/HARDEN-route-guard-test.sh.
"""

import json
import pathlib
import re
import subprocess
import sys
import unittest

REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]
EDGE = REPO_ROOT / "infra" / "modules" / "edge"
HEADERS = EDGE / "security_headers.json"
POLICY_TF = EDGE / "security_headers.tf"
ENV_PRODUCTION = REPO_ROOT / "frontend" / ".env.production"
SITE = REPO_ROOT / "site"
ALLOW = REPO_ROOT / "docs" / "delivery" / "r29-issues" / "HARDEN.plan-allow.json"
CHECK_PLAN = REPO_ROOT / "infra" / "scripts" / "check-plan.py"
MANAGED_SECURITY_HEADERS_POLICY = "67f7725c-6f97-4210-82d7-5512b31e9d03"


def headers():
    return json.loads(HEADERS.read_text())


def directives(target):
    """{directive: [sources]} of one CSP in security_headers.json."""
    out = {}
    for entry in headers()["content_security_policy"][target]:
        name, *sources = entry.split()
        if name in out:
            raise AssertionError(f"{target}: directive {name} appears twice")
        out[name] = sources
    return out


def origin(url):
    match = re.match(r"^(https://[^/]+)", url.strip())
    if match is None:
        raise AssertionError(f"not an https URL: {url!r}")
    return match.group(1)


def env_production():
    values = {}
    for line in ENV_PRODUCTION.read_text().splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            key, value = line.split("=", 1)
            values[key.strip()] = value.strip()
    return values


class ConsoleCspTest(unittest.TestCase):
    def setUp(self):
        self.csp = directives("console")

    def test_no_unsafe_keyword_and_no_wildcard_anywhere(self):
        for target in ("console", "site"):
            for entry in headers()["content_security_policy"][target]:
                self.assertNotIn("'unsafe-", entry, f"{target}: {entry}")
                self.assertNotRegex(entry, r"(^|\s)(\*|https:|http:|data:\*)(\s|$)", f"{target}: {entry}")
                self.assertNotIn("http://", entry, f"{target}: {entry}")

    def test_scripts_and_styles_are_same_origin_only(self):
        self.assertEqual(self.csp["default-src"], ["'self'"])
        self.assertEqual(self.csp["script-src"], ["'self'"])
        self.assertEqual(self.csp["style-src"], ["'self'"])
        self.assertEqual(self.csp["font-src"], ["'self'"])
        # data: for the favicon, which index.html inlines as an SVG data URI.
        self.assertEqual(self.csp["img-src"], ["'self'", "data:"])

    def test_framing_plugins_base_and_forms_are_closed(self):
        self.assertEqual(self.csp["frame-ancestors"], ["'none'"])
        self.assertEqual(self.csp["frame-src"], ["'none'"])
        self.assertEqual(self.csp["object-src"], ["'none'"])
        self.assertEqual(self.csp["base-uri"], ["'none'"])
        self.assertEqual(self.csp["form-action"], ["'self'"])

    def test_connect_src_is_exactly_the_api_cognito_and_sentry_ingest(self):
        env = env_production()
        api = origin(env["VITE_API_BASE"])
        cognito = origin(env["VITE_COGNITO_DOMAIN"])
        self.assertEqual(api, "https://api.developercards.app")
        connect = self.csp["connect-src"]
        self.assertEqual(connect[0], "'self'")
        self.assertIn(api, connect)
        self.assertIn(cognito, connect)
        sentry = [s for s in connect if s not in ("'self'", api, cognito)]
        self.assertEqual(len(sentry), 1, connect)
        # The console DSN's ingest origin (org timeawake-limited, US); the DSN itself lives in SSM and CI, not here.
        self.assertRegex(sentry[0], r"^https://o\d+\.ingest\.us\.sentry\.io$")

    def test_the_console_index_html_has_no_inline_script(self):
        index = (REPO_ROOT / "frontend" / "index.html").read_text()
        for tag in re.findall(r"<script\b[^>]*>", index):
            self.assertRegex(tag, r'\bsrc="/', f"inline or cross-origin script in frontend/index.html: {tag}")
        self.assertNotIn("<style", index)
        self.assertNotRegex(index, r"\sstyle=")


class SiteCspTest(unittest.TestCase):
    def test_site_policy_allows_only_its_own_stylesheet_and_images(self):
        self.assertEqual(directives("site"), {
            "default-src": ["'none'"],
            "style-src": ["'self'"],
            "img-src": ["'self'"],
            "base-uri": ["'none'"],
            "form-action": ["'none'"],
            "frame-ancestors": ["'none'"],
        })

    def test_the_landing_page_needs_nothing_else(self):
        for page in SITE.glob("*.html"):
            html = page.read_text()
            self.assertNotIn("<script", html, page.name)
            self.assertNotIn("<style", html, page.name)
            self.assertNotRegex(html, r"\sstyle=", page.name)
            self.assertNotIn("<form", html, page.name)
            self.assertNotIn("<iframe", html, page.name)
            for tag, attr in re.findall(r"<(link|img|source|video|audio|embed|object)\b[^>]*\b(?:href|src)=\"([^\"]+)\"", html):
                self.assertNotRegex(attr, r"^(https?:)?//", f"{page.name}: <{tag}> loads {attr} from another origin")
        for sheet in SITE.glob("*.css"):
            css = sheet.read_text()
            self.assertNotIn("@import", css, sheet.name)
            self.assertNotIn("url(", css, sheet.name)


class HeaderPolicyTest(unittest.TestCase):
    def test_the_other_headers(self):
        h = headers()
        self.assertEqual(h["frame_option"], "DENY")
        self.assertEqual(h["referrer_policy"], "strict-origin-when-cross-origin")
        self.assertGreaterEqual(h["strict_transport_security"]["max_age_sec"], 31536000)
        self.assertTrue(h["strict_transport_security"]["include_subdomains"])
        for feature in ("camera", "microphone", "geolocation", "payment", "usb"):
            self.assertIn(f"{feature}=()", h["permissions_policy"])

    def test_terraform_builds_both_policies_from_the_json_and_both_distributions_use_them(self):
        tf = POLICY_TF.read_text()
        self.assertIn('jsondecode(file("${path.module}/security_headers.json"))', tf)
        self.assertIn('join("; ", local.security_headers.content_security_policy[each.key])', tf)
        self.assertIn('var.manage_domain ? ["console", "site"] : ["console"]', tf)
        # The five security headers and Permissions-Policy replace whatever an origin sends.
        self.assertEqual(len(re.findall(r"\boverride\s*=\s*true\b", tf)), 6)
        self.assertNotRegex(tf, r"\boverride\s*=\s*false\b")
        cdn = (EDGE / "cdn.tf").read_text()
        site = (EDGE / "site.tf").read_text()
        self.assertIn('response_headers_policy_id = aws_cloudfront_response_headers_policy.security["console"].id', cdn)
        self.assertIn('response_headers_policy_id = aws_cloudfront_response_headers_policy.security["site"].id', site)
        self.assertNotIn(MANAGED_SECURITY_HEADERS_POLICY, cdn + site)

    def test_the_local_server_reads_the_same_file(self):
        server = (REPO_ROOT / "frontend" / "scripts" / "serve-with-headers.mjs").read_text()
        self.assertIn("../../infra/modules/edge/security_headers.json", server)
        config = (REPO_ROOT / "frontend" / "playwright.config.ts").read_text()
        self.assertIn("node scripts/serve-with-headers.mjs --root dist --port 5173 --target console", config)
        for spec in (REPO_ROOT / "frontend" / "tests" / "e2e").glob("*.spec.ts"):
            self.assertIn("from './cspGuard'", spec.read_text(), spec.name)


def _rc(address, actions, keys=None):
    before = None if actions == ["create"] else {key: 1 for key in (keys or ["k"])}
    after = {key: 2 for key in (keys or ["k"])}
    return {"address": address, "mode": "managed", "change": {"actions": actions, "before": before, "after": after}}


def harden_plan():
    """The plan HARDEN is expected to produce, reduced to what check-plan.py reads."""
    changes = []
    for address, want in json.loads(ALLOW.read_text())["changes"].items():
        if isinstance(want, str):
            changes.append(_rc(address, [want]))
        else:
            changes.append(_rc(address, [want["action"]], want["keys"]))
    changes.append(_rc("module.edge.aws_cloudfront_distribution.content", ["no-op"]))
    return {"resource_changes": changes, "output_changes": {"site_distribution_id": {"actions": ["no-op"]}}}


class AllowListAgainstPlanTest(unittest.TestCase):
    """Runs the real plan gate (check-plan.py) with HARDEN.plan-allow.json on synthetic plans."""

    def gate(self, plan, summary=False):
        cmd = [sys.executable, str(CHECK_PLAN), "--plan", "-", "--allow", str(ALLOW)]
        if summary:
            cmd.append("--summary")
        return subprocess.run(cmd, input=json.dumps(plan), capture_output=True, text=True, check=False)

    def test_allow_list_is_two_creates_and_four_updates(self):
        allow = json.loads(ALLOW.read_text())
        self.assertFalse(allow["tags_only_updates"])
        self.assertNotIn("outputs", allow)
        changes = allow["changes"]
        self.assertEqual(sorted(a for a, w in changes.items() if w == "create"), [
            'module.edge.aws_cloudfront_response_headers_policy.security["console"]',
            'module.edge.aws_cloudfront_response_headers_policy.security["site"]',
        ])
        self.assertEqual({a: w for a, w in changes.items() if w != "create"}, {
            "module.api.aws_apigatewayv2_stage.default": {"action": "update", "keys": ["route_settings"]},
            "module.api.aws_apigatewayv2_stage.dev": {"action": "update", "keys": ["route_settings"]},
            "module.edge.aws_cloudfront_distribution.console": {"action": "update", "keys": ["default_cache_behavior"]},
            "module.edge.aws_cloudfront_distribution.site[0]": {"action": "update", "keys": ["default_cache_behavior"]},
        })
        self.assertFalse(any(a.startswith("module.operators.") for a in changes), "module.operators is break-glass")

    def test_expected_plan_passes(self):
        result = self.gate(harden_plan(), summary=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("PLAN OK 6", result.stdout)

    def test_a_change_to_the_content_distribution_is_rejected(self):
        plan = harden_plan()
        for entry in plan["resource_changes"]:
            if entry["address"] == "module.edge.aws_cloudfront_distribution.content":
                entry["change"]["actions"] = ["update"]
        result = self.gate(plan)
        self.assertEqual(result.returncode, 1, result.stdout)
        self.assertIn("unlisted update module.edge.aws_cloudfront_distribution.content", result.stderr)

    def test_a_distribution_change_beyond_the_headers_is_rejected(self):
        plan = harden_plan()
        for entry in plan["resource_changes"]:
            if entry["address"] == "module.edge.aws_cloudfront_distribution.console":
                entry["change"]["before"]["aliases"] = ["console.developercards.app"]
                entry["change"]["after"]["aliases"] = ["console.example.invalid"]
        result = self.gate(plan)
        self.assertEqual(result.returncode, 1, result.stdout)
        self.assertIn("module.edge.aws_cloudfront_distribution.console", result.stderr)


if __name__ == "__main__":
    unittest.main()
