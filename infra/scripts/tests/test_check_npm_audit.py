"""Unit tests for infra/scripts/check-npm-audit.py (stdlib unittest, no network, no npm).

Run: python3 -m unittest discover -s infra/scripts/tests -v
"""

import importlib.util
import io
import json
import pathlib
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout

SCRIPT = pathlib.Path(__file__).resolve().parents[1] / "check-npm-audit.py"
_spec = importlib.util.spec_from_file_location("check_npm_audit", SCRIPT)
cna = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(cna)

REPO_ROOT = SCRIPT.parents[2]
TAR = "GHSA-23hp-3jrh-7fpw"
WS = "GHSA-96hv-2xvq-fx4p"


def via(ghsa, name, severity):
    return {"name": name, "severity": severity, "title": f"{name} advisory", "url": f"https://github.com/advisories/{ghsa}"}


def report(*advisories):
    """An npm audit v2 report; each advisory is listed under its package and under a dependent."""
    vulns = {}
    for adv in advisories:
        vulns[adv["name"]] = {"name": adv["name"], "severity": adv["severity"], "via": [adv]}
        vulns[f"dependent-of-{adv['name']}"] = {"severity": adv["severity"], "via": [adv["name"]]}
    return {"auditReportVersion": 2, "vulnerabilities": vulns, "metadata": {}}


def entry(ghsa, package, severity="high", expires="2026-11-03", **overrides):
    return {"id": ghsa, "package": package, "severity": severity, "reason": "build-time only", "expires": expires, **overrides}


class GateTest(unittest.TestCase):
    def run_gate(self, audit, entries, today="2026-10-03"):
        with tempfile.TemporaryDirectory() as tmp:
            audit_path = pathlib.Path(tmp, "audit.json")
            allow_path = pathlib.Path(tmp, "allow.json")
            audit_path.write_text(audit if isinstance(audit, str) else json.dumps(audit))
            allow_path.write_text(json.dumps(entries if isinstance(entries, dict) else {"entries": entries}))
            out, err = io.StringIO(), io.StringIO()
            with redirect_stdout(out), redirect_stderr(err):
                code = cna.main(["--allowlist", str(allow_path), "--audit-json", str(audit_path), "--today", today])
        return code, out.getvalue() + err.getvalue()

    def test_passes_when_every_high_and_critical_advisory_is_allowlisted(self):
        code, out = self.run_gate(
            report(via(TAR, "tar", "critical"), via(WS, "ws", "high")),
            [entry(TAR, "tar", "critical"), entry(WS, "ws")],
        )
        self.assertEqual(code, 0, out)
        self.assertIn("PASS: 2 allowlisted", out)

    def test_a_new_high_advisory_fails(self):
        code, out = self.run_gate(report(via(TAR, "tar", "critical"), via(WS, "ws", "high")), [entry(TAR, "tar", "critical")])
        self.assertEqual(code, 1, out)
        self.assertIn(f"{WS} ws (high)", out)
        self.assertIn("not on the allowlist", out)

    def test_the_same_id_on_another_package_is_not_covered(self):
        code, out = self.run_gate(report(via(WS, "ws", "high")), [entry(WS, "other-package")])
        self.assertEqual(code, 1, out)

    def test_moderate_and_low_never_fail(self):
        code, out = self.run_gate(report(via(WS, "ws", "moderate"), via(TAR, "tar", "low")), [])
        self.assertEqual(code, 0, out)
        self.assertIn("0 critical, 0 high, 1 moderate, 1 low", out)

    def test_an_entry_expires_on_its_date(self):
        audit = report(via(WS, "ws", "high"))
        self.assertEqual(self.run_gate(audit, [entry(WS, "ws")], today="2026-11-02")[0], 0)
        code, out = self.run_gate(audit, [entry(WS, "ws")], today="2026-11-03")
        self.assertEqual(code, 1, out)
        self.assertIn("expired on 2026-11-03", out)

    def test_an_expired_entry_fails_even_when_no_longer_reported(self):
        code, out = self.run_gate(report(), [entry(WS, "ws", expires="2026-10-01")])
        self.assertEqual(code, 1, out)

    def test_a_raised_severity_needs_re_review(self):
        code, out = self.run_gate(report(via(WS, "ws", "critical")), [entry(WS, "ws", "high")])
        self.assertEqual(code, 1, out)
        self.assertIn("allowlisted as high", out)

    def test_an_entry_no_longer_reported_is_a_warning(self):
        code, out = self.run_gate(report(via(WS, "ws", "moderate")), [entry(WS, "ws")])
        self.assertEqual(code, 0, out)
        self.assertIn("::warning::", out)

    def test_an_npm_error_report_is_unreadable_input(self):
        code, out = self.run_gate({"error": {"code": "ENOTFOUND", "summary": "registry unreachable"}}, [])
        self.assertEqual(code, 2, out)
        self.assertIn("ENOTFOUND", out)

    def test_an_empty_report_is_unreadable_input(self):
        self.assertEqual(self.run_gate("", [])[0], 2)

    def test_malformed_allowlist_entries_are_unreadable_input(self):
        audit = report(via(WS, "ws", "high"))
        for bad in (
            [entry(WS, "ws", reason="")],
            [entry(WS, "ws", expires="next month")],
            [entry(WS, "ws", severity="moderate")],
            [entry("CVE-2026-1", "ws")],
            [entry(WS, "ws"), entry(WS, "ws")],
        ):
            with self.subTest(bad=bad):
                self.assertEqual(self.run_gate(audit, bad)[0], 2)


class CommittedAllowlistTest(unittest.TestCase):
    def test_mobile_allowlist_is_well_formed(self):
        path = REPO_ROOT / "mobile" / "npm-audit-allowlist.json"
        cna.load_allowlist(json.loads(path.read_text()))  # raises InputError on a malformed entry


if __name__ == "__main__":
    unittest.main()
