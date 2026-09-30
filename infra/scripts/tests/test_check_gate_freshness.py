"""Unit tests for infra/scripts/check-gate-freshness.py (stdlib unittest, no network, no model call).

Run: python3 -m unittest discover -s infra/scripts/tests -v
The evals venv is never touched here: the shipping-config loader and the gate runner are injected.
"""

import importlib.util
import io
import json
import pathlib
import subprocess
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout

SCRIPT = pathlib.Path(__file__).resolve().parents[1] / "check-gate-freshness.py"
_spec = importlib.util.spec_from_file_location("check_gate_freshness", SCRIPT)
cgf = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(cgf)

ENV_PATH = "services/ai-qa/env/prod.env.json"
PROMPTS_PATH = "services/ai-qa/src/ai_qa/prompts.py"

SHIPPING = {
    "provider": "bedrock",
    "model": "anthropic.claude-opus-5",
    "promptVersion": "qa-v4",
    "effort": "high",
    "structuredOutputsAtStart": False,
    "secondProvider": None,
    "secondModel": None,
}


def header(**overrides):
    base = {
        "type": "run",
        "provider": "bedrock",
        "model": "anthropic.claude-opus-5",
        "promptVersion": "qa-v4",
        "effort": "high",
        "structuredOutputs": "off",
        "structuredOutputsAtStart": False,
        "dataset": "seeded-v3",
    }
    base.update(overrides)
    return base


def no_shipping():
    raise AssertionError("the shipping config must not be loaded when the check does not apply")


def no_gate(path):
    raise AssertionError("the gate must not run when the check does not apply")


class IsTruthyTest(unittest.TestCase):
    def test_matches_ai_qa_settings_rule(self):
        for value in ("1", " 1 ", "true", "TRUE", "yes", "Yes"):
            self.assertTrue(cgf.is_truthy(value), value)
        for value in (None, "", "0", "false", "no", "on", "2"):
            self.assertFalse(cgf.is_truthy(value), value)


class HeaderMismatchesTest(unittest.TestCase):
    def test_matching_header_has_no_mismatch(self):
        self.assertEqual(cgf.header_mismatches(header(), SHIPPING), [])

    def test_each_shipping_key_is_compared(self):
        for key, value in (
            ("provider", "anthropic"),
            ("model", "anthropic.claude-sonnet-5"),
            ("promptVersion", "qa-v3"),
            ("effort", "medium"),
            ("structuredOutputsAtStart", True),
        ):
            mismatches = cgf.header_mismatches(header(**{key: value}), SHIPPING)
            self.assertEqual(len(mismatches), 1, key)
            self.assertIn(key, mismatches[0])

    def test_missing_header_key_is_a_mismatch(self):
        h = header()
        del h["structuredOutputsAtStart"]
        self.assertEqual(len(cgf.header_mismatches(h, SHIPPING)), 1)


class EvaluateTest(unittest.TestCase):
    def test_unchanged_passes_without_loading_anything(self):
        code, lines = cgf.evaluate([], {"AI_QA_ENABLED": "1"}, [], no_shipping, no_gate)
        self.assertEqual(code, 0)
        self.assertIn("unchanged", "\n".join(lines))

    def test_unrelated_change_counts_as_unchanged(self):
        code, lines = cgf.evaluate(["services/ai-qa/src/ai_qa/handler.py"], {"AI_QA_ENABLED": "1"}, [], no_shipping, no_gate)
        self.assertEqual(code, 0)
        self.assertIn("unchanged", "\n".join(lines))

    def test_changed_but_ai_qa_off_passes(self):
        for enabled in ("0", "false", None):
            env = {} if enabled is None else {"AI_QA_ENABLED": enabled}
            code, lines = cgf.evaluate([ENV_PATH], env, [], no_shipping, no_gate)
            self.assertEqual(code, 0, enabled)
            self.assertIn("AI QA off", "\n".join(lines))

    def test_changed_enabled_without_reports_fails(self):
        code, lines = cgf.evaluate([PROMPTS_PATH], {"AI_QA_ENABLED": "1"}, [], lambda: SHIPPING, no_gate)
        self.assertEqual(code, 1)
        self.assertIn("no committed", "\n".join(lines))

    def test_changed_enabled_with_only_mismatched_reports_fails_and_names_them(self):
        reports = [
            ("evals/reports/a.jsonl", header(provider="claude-cli")),
            ("evals/reports/b.jsonl", header(promptVersion="qa-v3")),
        ]
        code, lines = cgf.evaluate([ENV_PATH], {"AI_QA_ENABLED": "true"}, reports, lambda: SHIPPING, no_gate)
        self.assertEqual(code, 1)
        text = "\n".join(lines)
        self.assertIn("evals/reports/a.jsonl", text)
        self.assertIn("promptVersion", text)

    def test_changed_enabled_matching_report_that_passes_the_gate_passes(self):
        ran = []
        reports = [
            ("evals/reports/old.jsonl", header(promptVersion="qa-v3")),
            ("evals/reports/new.jsonl", header()),
        ]

        def gate(path):
            ran.append(path)
            return 0

        code, lines = cgf.evaluate([ENV_PATH, PROMPTS_PATH], {"AI_QA_ENABLED": "1"}, reports, lambda: SHIPPING, gate)
        self.assertEqual(code, 0)
        self.assertEqual(ran, ["evals/reports/new.jsonl"])
        self.assertIn("evals/reports/new.jsonl", "\n".join(lines))

    def test_changed_enabled_matching_report_that_fails_the_gate_fails(self):
        code, lines = cgf.evaluate(
            [ENV_PATH], {"AI_QA_ENABLED": "1"}, [("evals/reports/r.jsonl", header())], lambda: SHIPPING, lambda p: 1
        )
        self.assertEqual(code, 1)
        self.assertIn("dc-evals score --gate", "\n".join(lines))

    def test_any_passing_candidate_is_enough(self):
        reports = [("evals/reports/r1.jsonl", header()), ("evals/reports/r2.jsonl", header())]
        results = {"evals/reports/r1.jsonl": 1, "evals/reports/r2.jsonl": 0}
        code, _ = cgf.evaluate([ENV_PATH], {"AI_QA_ENABLED": "1"}, reports, lambda: SHIPPING, results.__getitem__)
        self.assertEqual(code, 0)


class ReadRunHeaderTest(unittest.TestCase):
    def test_first_run_line_is_the_header(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = pathlib.Path(tmp) / "r.jsonl"
            path.write_text(json.dumps({"type": "item"}) + "\n" + json.dumps(header()) + "\n")
            self.assertEqual(cgf.read_run_header(path)["provider"], "bedrock")

    def test_file_without_header_or_with_bad_json_returns_none(self):
        with tempfile.TemporaryDirectory() as tmp:
            empty = pathlib.Path(tmp) / "empty.jsonl"
            empty.write_text(json.dumps({"type": "item"}) + "\n")
            broken = pathlib.Path(tmp) / "broken.jsonl"
            broken.write_text("{not json\n")
            self.assertIsNone(cgf.read_run_header(empty))
            self.assertIsNone(cgf.read_run_header(broken))


def git(repo, *args):
    subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True, text=True)


class MainInGitRepoTest(unittest.TestCase):
    """End to end over a throwaway git repository: argument handling, merge base, HEAD env, tracked reports."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.repo = pathlib.Path(self._tmp.name)
        git(self.repo, "init", "-q", "-b", "main")
        git(self.repo, "config", "user.email", "ci@example.invalid")
        git(self.repo, "config", "user.name", "ci")
        git(self.repo, "config", "commit.gpgsign", "false")
        self.write(ENV_PATH, json.dumps({"AI_QA_ENABLED": "0"}))
        self.write(PROMPTS_PATH, 'PROMPT_VERSION = "qa-v4"\n')
        self.commit("base")

    def tearDown(self):
        self._tmp.cleanup()

    def write(self, rel, text):
        path = self.repo / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)

    def commit(self, message):
        git(self.repo, "add", "-A")
        git(self.repo, "commit", "-q", "-m", message)

    def run_main(self, argv, shipping=no_shipping, gate=no_gate):
        out, err = io.StringIO(), io.StringIO()
        with redirect_stdout(out), redirect_stderr(err):
            code = cgf.main(argv + ["--repo", str(self.repo)], load_shipping=shipping, run_gate=gate)
        return code, out.getvalue(), err.getvalue()

    def test_missing_base_is_usage_error(self):
        with redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit) as ctx:
                cgf.main(["--repo", str(self.repo)])
        self.assertEqual(ctx.exception.code, 2)

    def test_unknown_base_ref_is_usage_error(self):
        code, _, err = self.run_main(["--base", "no-such-ref"])
        self.assertEqual(code, 2)
        self.assertIn("no-such-ref", err)

    def test_base_head_passes_as_unchanged(self):
        code, out, _ = self.run_main(["--base", "HEAD"])
        self.assertEqual(code, 0)
        self.assertIn("unchanged", out)

    def test_prompt_change_with_ai_qa_off_passes(self):
        git(self.repo, "checkout", "-q", "-b", "feature")
        self.write(PROMPTS_PATH, 'PROMPT_VERSION = "qa-v5"\n')
        self.commit("bump prompt")
        code, out, _ = self.run_main(["--base", "main"])
        self.assertEqual(code, 0)
        self.assertIn("AI QA off", out)

    def test_enabling_ai_qa_without_report_fails(self):
        git(self.repo, "checkout", "-q", "-b", "feature")
        self.write(ENV_PATH, json.dumps({"AI_QA_ENABLED": "1"}))
        self.commit("enable")
        code, out, _ = self.run_main(["--base", "main"], shipping=lambda: SHIPPING)
        self.assertEqual(code, 1)
        self.assertIn("FAIL", out)

    def test_uncommitted_report_does_not_count(self):
        git(self.repo, "checkout", "-q", "-b", "feature")
        self.write(ENV_PATH, json.dumps({"AI_QA_ENABLED": "1"}))
        self.commit("enable")
        self.write("evals/reports/untracked.jsonl", json.dumps(header()) + "\n")
        code, _, _ = self.run_main(["--base", "main"], shipping=lambda: SHIPPING, gate=lambda p: 0)
        self.assertEqual(code, 1)

    def test_enabling_ai_qa_with_committed_passing_report_passes(self):
        git(self.repo, "checkout", "-q", "-b", "feature")
        self.write(ENV_PATH, json.dumps({"AI_QA_ENABLED": "1"}))
        self.write("evals/reports/2026-10-01-bedrock-run.jsonl", json.dumps(header()) + "\n")
        self.write("evals/reports/notes.md", "not a run\n")
        self.commit("enable with evidence")
        gated = []

        def gate(path):
            gated.append(path)
            return 0

        code, out, _ = self.run_main(["--base", "main"], shipping=lambda: SHIPPING, gate=gate)
        self.assertEqual(code, 0, out)
        self.assertEqual(gated, ["evals/reports/2026-10-01-bedrock-run.jsonl"])

    def test_change_already_on_base_is_not_rechecked(self):
        # The merge base, not the base tip, is the comparison point: a change merged to main after the
        # branch was cut is main's business, not this branch's.
        git(self.repo, "checkout", "-q", "-b", "feature")
        git(self.repo, "checkout", "-q", "main")
        self.write(ENV_PATH, json.dumps({"AI_QA_ENABLED": "1"}))
        self.commit("main enables")
        git(self.repo, "checkout", "-q", "feature")
        self.write("README.md", "x\n")
        self.commit("unrelated")
        code, out, _ = self.run_main(["--base", "main"])
        self.assertEqual(code, 0)
        self.assertIn("unchanged", out)

    def test_unreadable_head_env_is_usage_error(self):
        git(self.repo, "checkout", "-q", "-b", "feature")
        self.write(ENV_PATH, "{not json")
        self.commit("break env")
        code, _, err = self.run_main(["--base", "main"])
        self.assertEqual(code, 2)
        self.assertIn(ENV_PATH, err)


if __name__ == "__main__":
    unittest.main()
