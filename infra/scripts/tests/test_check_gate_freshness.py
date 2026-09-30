"""Unit tests for infra/scripts/check-gate-freshness.py (stdlib unittest, no network, no model call).

Run: python3 -m unittest discover -s infra/scripts/tests -v
The shipping-config loader and the gate runner are injected everywhere except RealEvalsWiringTest,
which runs the real `uv run --project evals` wiring offline (no model call) and is skipped when uv
is absent.
"""

import importlib.util
import io
import json
import pathlib
import shutil
import subprocess
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from unittest import mock

SCRIPT = pathlib.Path(__file__).resolve().parents[1] / "check-gate-freshness.py"
_spec = importlib.util.spec_from_file_location("check_gate_freshness", SCRIPT)
cgf = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(cgf)

ENV_PATH = "services/ai-qa/env/prod.env.json"
PROMPTS_PATH = "services/ai-qa/src/ai_qa/prompts.py"
REPO_ROOT = SCRIPT.parents[2]
NULL_SHA = "0" * 40


def prompts_module(system="Review the card.", version="qa-v4", addendum="Be strict.", auto_version="qa-v4-auto", comment=""):
    """A small stand-in for ai_qa/prompts.py with the same top-level shape."""
    return (
        f'"""Prompts.{comment}"""\n\n'
        "from __future__ import annotations\n\n"
        f"PROMPT_VERSION = {version!r}\n"
        f"{comment and '# ' + comment}\n"
        f"SYSTEM_PROMPT = {system!r}\n"
        f"PROMPT_VERSION_AUTOMATION = {auto_version!r}\n"
        f"AUTOMATION_ADDENDUM = {addendum!r}\n"
        "SYSTEM_PROMPT_AUTOMATION = SYSTEM_PROMPT + AUTOMATION_ADDENDUM\n"
    )

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
        for path in ("services/ai-qa/tests/test_handler.py", "services/ai-qa/README.md", "README.md"):
            code, lines = cgf.evaluate([path], {"AI_QA_ENABLED": "1"}, [], no_shipping, no_gate)
            self.assertEqual(code, 0, path)
            self.assertIn("unchanged", "\n".join(lines))

    def test_any_ai_qa_package_change_triggers(self):
        # p-security-1 / p-tests-2: settings.py, providers.py and profiles.py also decide what ships.
        for name in ("settings.py", "providers.py", "profiles.py", "handler.py", "prompts.py"):
            path = "services/ai-qa/src/ai_qa/" + name
            code, lines = cgf.evaluate([path], {"AI_QA_ENABLED": "1"}, [], lambda: SHIPPING, no_gate)
            self.assertEqual(code, 1, path)
            self.assertIn(path, "\n".join(lines))

    def test_prompt_problems_fail_even_with_ai_qa_off(self):
        code, lines = cgf.evaluate([PROMPTS_PATH], {"AI_QA_ENABLED": "0"}, [], no_shipping, no_gate, ["PROMPT_VERSION unchanged"])
        self.assertEqual(code, 1)
        self.assertIn("PROMPT_VERSION unchanged", "\n".join(lines))

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


class PromptBumpProblemsTest(unittest.TestCase):
    """p-correctness-1: a prompt text change must bump the version label the evidence is matched on."""

    def test_identical_source_has_no_problem(self):
        self.assertEqual(cgf.prompt_bump_problems(prompts_module(), prompts_module()), [])

    def test_comment_and_docstring_only_change_needs_no_bump(self):
        self.assertEqual(cgf.prompt_bump_problems(prompts_module(), prompts_module(comment="reworded")), [])

    def test_system_prompt_change_without_any_bump_names_both_versions(self):
        problems = cgf.prompt_bump_problems(prompts_module(), prompts_module(system="Review the card harder."))
        text = "\n".join(problems)
        self.assertEqual(len(problems), 2, text)
        self.assertIn("PROMPT_VERSION ", text)
        self.assertIn("PROMPT_VERSION_AUTOMATION", text)

    def test_system_prompt_change_with_only_prompt_version_bump_still_needs_automation_bump(self):
        problems = cgf.prompt_bump_problems(prompts_module(), prompts_module(system="New.", version="qa-v5"))
        self.assertEqual(len(problems), 1)
        self.assertIn("PROMPT_VERSION_AUTOMATION", problems[0])

    def test_system_prompt_change_with_both_bumps_passes(self):
        head = prompts_module(system="New.", version="qa-v5", auto_version="qa-v5-auto")
        self.assertEqual(cgf.prompt_bump_problems(prompts_module(), head), [])

    def test_addendum_change_needs_only_the_automation_bump(self):
        self.assertEqual(len(cgf.prompt_bump_problems(prompts_module(), prompts_module(addendum="Stricter."))), 1)
        head = prompts_module(addendum="Stricter.", auto_version="qa-v4-auto2")
        self.assertEqual(cgf.prompt_bump_problems(prompts_module(), head), [])

    def test_version_absent_at_head_is_not_required(self):
        base = 'PROMPT_VERSION = "qa-v1"\nSYSTEM_PROMPT = "a"\n'
        head = 'PROMPT_VERSION = "qa-v2"\nSYSTEM_PROMPT = "b"\n'
        self.assertEqual(cgf.prompt_bump_problems(base, head), [])

    def test_unparsable_source_is_usage_error(self):
        with self.assertRaises(cgf.UsageError):
            cgf.prompt_bump_problems(prompts_module(), "SYSTEM_PROMPT = (\n")

    def test_real_prompts_module_parses(self):
        source = (REPO_ROOT / PROMPTS_PATH).read_text(encoding="utf-8")
        self.assertEqual(cgf.prompt_bump_problems(source, source), [])
        changed = source.replace("pre-publish quality reviewer", "pre-publish reviewer", 1)
        self.assertNotEqual(changed, source)
        self.assertEqual(len(cgf.prompt_bump_problems(source, changed)), 2)


class EvalsShippingConfigTest(unittest.TestCase):
    """p-correctness-2: unreadable shipping-config output is exit 2 (UsageError), never a traceback."""

    def run_with_stdout(self, stdout):
        done = subprocess.CompletedProcess(args=[], returncode=0, stdout=stdout, stderr="")
        with mock.patch.object(cgf.subprocess, "run", return_value=done):
            return cgf.evals_shipping_config("/nonexistent")

    def test_valid_object_is_returned(self):
        self.assertEqual(self.run_with_stdout(json.dumps(SHIPPING) + "\n"), SHIPPING)

    def test_non_json_stdout_is_usage_error(self):
        for stdout in ("", "DeprecationWarning: something\n" + json.dumps(SHIPPING) + "\n"):
            with self.assertRaises(cgf.UsageError) as ctx:
                self.run_with_stdout(stdout)
            self.assertIn("not JSON", str(ctx.exception))

    def test_non_object_or_incomplete_json_is_usage_error(self):
        for value in ([1, 2], "bedrock", {"provider": "bedrock"}):
            with self.assertRaises(cgf.UsageError):
                self.run_with_stdout(json.dumps(value))


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
        self.write(PROMPTS_PATH, prompts_module())
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
        self.write(PROMPTS_PATH, prompts_module(system="New.", version="qa-v5", auto_version="qa-v5-auto"))
        self.commit("bump prompt")
        code, out, _ = self.run_main(["--base", "main"])
        self.assertEqual(code, 0)
        self.assertIn("AI QA off", out)

    def test_prompt_text_change_without_version_bump_fails(self):
        # p-correctness-1: an old qa-v4 run would otherwise match and pass the gate.
        self.write(ENV_PATH, json.dumps({"AI_QA_ENABLED": "1"}))
        self.write("evals/reports/qa-v4-run.jsonl", json.dumps(header()) + "\n")
        self.commit("enabled with qa-v4 evidence")
        git(self.repo, "checkout", "-q", "-b", "feature")
        self.write(PROMPTS_PATH, prompts_module(system="Rewritten prompt."))
        self.commit("rewrite prompt, no bump")
        code, out, _ = self.run_main(["--base", "main"], shipping=lambda: SHIPPING, gate=lambda p: 0)
        self.assertEqual(code, 1, out)
        self.assertIn("PROMPT_VERSION", out)

    def test_prompt_comment_change_with_matching_evidence_passes(self):
        self.write(ENV_PATH, json.dumps({"AI_QA_ENABLED": "1"}))
        self.write("evals/reports/qa-v4-run.jsonl", json.dumps(header()) + "\n")
        self.commit("enabled with qa-v4 evidence")
        git(self.repo, "checkout", "-q", "-b", "feature")
        self.write(PROMPTS_PATH, prompts_module(comment="clarify"))
        self.commit("comment only")
        code, out, _ = self.run_main(["--base", "main"], shipping=lambda: SHIPPING, gate=lambda p: 0)
        self.assertEqual(code, 0, out)

    def test_providers_change_with_ai_qa_on_needs_evidence(self):
        # p-tests-2: providers.py decides structuredOutputsAtStart but was not a trigger.
        self.write(ENV_PATH, json.dumps({"AI_QA_ENABLED": "1"}))
        self.write("services/ai-qa/src/ai_qa/providers.py", "def structured_outputs_on(s):\n    return False\n")
        self.commit("enabled")
        git(self.repo, "checkout", "-q", "-b", "feature")
        self.write("services/ai-qa/src/ai_qa/providers.py", "def structured_outputs_on(s):\n    return True\n")
        self.commit("auto resolves to on")
        code, out, _ = self.run_main(["--base", "main"], shipping=lambda: SHIPPING)
        self.assertEqual(code, 1, out)
        self.assertIn("services/ai-qa/src/ai_qa/providers.py", out)

    def enable_on_main(self):
        before = subprocess.run(["git", "-C", str(self.repo), "rev-parse", "HEAD"], capture_output=True, text=True, check=True).stdout.strip()
        self.write(ENV_PATH, json.dumps({"AI_QA_ENABLED": "1"}))
        self.commit("push to main: enable without evidence")
        return before

    def test_push_to_main_with_merge_base_of_main_sees_nothing(self):
        # The p-security-2 gap: on main itself, the merge base with main is HEAD.
        self.enable_on_main()
        code, out, _ = self.run_main(["--base", "main"])
        self.assertEqual(code, 0)
        self.assertIn("unchanged", out)

    def test_push_compares_with_the_before_commit(self):
        # p-security-2: a push is checked against github.event.before.
        before = self.enable_on_main()
        code, out, _ = self.run_main(["--before", before], shipping=lambda: SHIPPING)
        self.assertEqual(code, 1, out)
        self.assertIn(ENV_PATH, out)

    def test_push_without_usable_before_falls_back_to_the_parent(self):
        self.enable_on_main()
        for before in ("", NULL_SHA, "1234567890abcdef1234567890abcdef12345678"):
            code, out, _ = self.run_main(["--before", before], shipping=lambda: SHIPPING)
            self.assertEqual(code, 1, (before, out))
            self.assertIn("HEAD~1", out)

    def test_base_and_before_are_exclusive(self):
        with redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit) as ctx:
                cgf.main(["--base", "main", "--before", NULL_SHA, "--repo", str(self.repo)])
        self.assertEqual(ctx.exception.code, 2)

    def test_non_json_shipping_config_exits_2(self):
        git(self.repo, "checkout", "-q", "-b", "feature")
        self.write(ENV_PATH, json.dumps({"AI_QA_ENABLED": "1"}))
        self.commit("enable")
        done = subprocess.CompletedProcess(args=[], returncode=0, stdout="a warning line\n", stderr="")
        real_run = subprocess.run
        fake = lambda cmd, **kw: done if cmd[:2] == ["uv", "run"] else real_run(cmd, **kw)  # noqa: E731
        with mock.patch.object(cgf.subprocess, "run", side_effect=fake):
            out, err = io.StringIO(), io.StringIO()
            with redirect_stdout(out), redirect_stderr(err):
                code = cgf.main(["--base", "main", "--repo", str(self.repo)], run_gate=no_gate)
        self.assertEqual(code, 2, out.getvalue() + err.getvalue())
        self.assertIn("not JSON", err.getvalue())

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


@unittest.skipIf(shutil.which("uv") is None, "uv is not installed")
class RealEvalsWiringTest(unittest.TestCase):
    """p-tests-3: the real `uv run --project evals` calls against this repository (offline, no model call)."""

    def test_shipping_config_has_every_match_key(self):
        shipping = cgf.evals_shipping_config(str(REPO_ROOT))
        for key in cgf.MATCH_KEYS:
            self.assertIn(key, shipping)

    def test_gate_rejects_a_committed_claude_cli_run(self):
        proxies = [rel for rel, h in cgf.committed_reports(str(REPO_ROOT)) if h.get("provider") == "claude-cli"]
        if not proxies:
            self.skipTest("no committed claude-cli run under evals/reports")
        with redirect_stderr(io.StringIO()):
            code = cgf.evals_score_gate(str(REPO_ROOT), proxies[-1])
        self.assertNotEqual(code, 0)


if __name__ == "__main__":
    unittest.main()
