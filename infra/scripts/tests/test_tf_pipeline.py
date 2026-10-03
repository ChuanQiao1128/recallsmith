"""Unit tests for infra/scripts/tf-pipeline.py and the static facts of the Terraform pipeline (stdlib unittest).

Run: python3 -m unittest discover -s infra/scripts/tests -v   (CI: job "python")
Offline: throwaway git repositories, synthetic plan JSON and a fake Actions API; no AWS, no network, no gh.
Covered: which files are plan-affecting (and that terraform.yml's push paths say the same, non-ASCII paths
included), the pull request rule (at least one allow file with a Terraform change; several are combined when they
agree; the allow file's shape and path), preflight (providers other than hashicorp/aws, provisioners,
aws_lambda_invocation, action blocks, *.tf.json, outside modules), the allow files a push to main selects, the
refusal of a commit older than the last one that changed AWS, the break-glass guard on a plan (module.operators and
moves into or out of it, denied resource types, the audit and state buckets, trust policies naming anything but an
AWS service, escalating grants and admin attachments, provisioners), the error diagnosis that never quotes a
message, the bootstrap allow file TFCI against check-plan.py, the workflow's step bodies under bash -e (stubbed
python3, terraform and aws), and the static facts of terraform.yml, ci.yml and the developercards-gha-infra role
(its deny never blocks a refresh read) that a wrong edit would break.
"""

import contextlib
import fnmatch
import importlib.util
import io
import json
import os
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile
import unicodedata
import unittest

SCRIPT = pathlib.Path(__file__).resolve().parents[1] / "tf-pipeline.py"
_spec = importlib.util.spec_from_file_location("tf_pipeline", SCRIPT)
tfp = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(tfp)

REPO_ROOT = SCRIPT.parents[2]
CHECK_PLAN = REPO_ROOT / "infra" / "scripts" / "check-plan.py"
WORKFLOW = REPO_ROOT / ".github" / "workflows" / "terraform.yml"
CI = REPO_ROOT / ".github" / "workflows" / "ci.yml"
CD = REPO_ROOT / ".github" / "workflows" / "cd.yml"
OPERATORS = REPO_ROOT / "infra" / "modules" / "operators"
PROD_MAIN = REPO_ROOT / "infra" / "envs" / "prod" / "main.tf"
TFCI = REPO_ROOT / "docs" / "delivery" / "r27-issues" / "TFCI.plan-allow.json"
REPO = "ChuanQiao1128/recallsmith"

ALLOW_OK = {"tags_only_updates": False, "changes": {"module.api.aws_apigatewayv2_route.this[\"x\"]": "create"}}
LOCK_AWS = 'provider "registry.terraform.io/hashicorp/aws" {\n  version = "6.0.0"\n}\n'


def capture(fn, *args, **kwargs):
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        result = fn(*args, **kwargs)
    return result, out.getvalue() + err.getvalue()


class GitRepo:
    """A throwaway repository; commit({path: text or None}) returns the new sha (None deletes)."""

    def __init__(self):
        self.dir = tempfile.mkdtemp(prefix="tfp-test-")
        self.git("init", "-q", "-b", "main")
        self.git("config", "user.email", "t@example.invalid")
        self.git("config", "user.name", "t")
        self.git("config", "commit.gpgsign", "false")

    def git(self, *args):
        return subprocess.run(["git"] + list(args), cwd=self.dir, check=True, stdout=subprocess.PIPE,
                              stderr=subprocess.PIPE, universal_newlines=True).stdout.strip()

    def commit(self, files, msg="c"):
        for path, text in files.items():
            full = os.path.join(self.dir, path)
            if text is None:
                os.remove(full)
                continue
            os.makedirs(os.path.dirname(full), exist_ok=True)
            with open(full, "w") as handle:
                handle.write(text if isinstance(text, str) else json.dumps(text))
        self.git("add", "-A")
        self.git("commit", "-q", "--allow-empty", "-m", msg)
        return self.git("rev-parse", "HEAD")

    def close(self):
        shutil.rmtree(self.dir, ignore_errors=True)


class InRepo(unittest.TestCase):
    """Runs each test inside a fresh repository with one base commit (the script reads files relative to cwd)."""

    def setUp(self):
        self.repo = GitRepo()
        self.cwd = os.getcwd()
        os.chdir(self.repo.dir)
        self.base = self.repo.commit({"infra/envs/prod/main.tf": "# base\n", "README.md": "x\n",
                                      "infra/envs/prod/.terraform.lock.hcl": LOCK_AWS}, "base")

    def tearDown(self):
        os.chdir(self.cwd)
        self.repo.close()


class PathsTest(unittest.TestCase):
    def test_plan_affecting(self):
        yes = ["infra/envs/prod/main.tf", "infra/modules/api/gateway.tf", "infra/envs/prod/.terraform.lock.hcl",
               "infra/bootstrap/placeholder.zip", "infra/modules/identity/branding/spa.settings.json"]
        no = ["infra/RUNBOOK.md", "infra/README.md", "infra/scripts/check-plan.py",
              "infra/scripts/tests/test_tf_pipeline.py", "infra/modules/observability/tests/ai_qa_r20.tftest.hcl",
              "infra/envs/prod/prod.auto.tfvars.example", "infra/.gitignore", "docs/x.md", "src_C/x.cs",
              "docs/delivery/r27-issues/TFCI.plan-allow.json"]
        for path in yes:
            self.assertTrue(tfp.plan_affecting(path), path)
        for path in no:
            self.assertFalse(tfp.plan_affecting(path), path)

    def test_allow_file_names(self):
        self.assertTrue(tfp.is_allow_file("docs/delivery/r27-issues/TFCI.plan-allow.json"))
        self.assertTrue(tfp.is_allow_file("docs/delivery/ops/OPS01.plan-allow.json"))
        self.assertFalse(tfp.is_allow_file("docs/delivery/r27-issues/TFCI.json"))
        self.assertFalse(tfp.is_allow_file("infra/TFCI.plan-allow.json"))

    def test_push_paths_equal_the_workflow(self):
        text = WORKFLOW.read_text()
        block = re.search(r"\n  push:\n    branches: \[main\]\n(?:    #.*\n)*    paths:\n((?:      - .*\n)+)", text)
        self.assertIsNotNone(block, "terraform.yml on.push.paths not found")
        paths = [line.strip()[2:].strip("'\"") for line in block.group(1).splitlines()]
        self.assertEqual(paths, tfp.PUSH_PATHS)

    def test_push_paths_match_plan_affecting(self):
        # GitHub's filter (last matching pattern wins) agrees with plan_affecting() + is_allow_file() on samples.
        def matches(path):
            hit = False
            for pattern in tfp.PUSH_PATHS:
                neg = pattern.startswith("!")
                glob = pattern[1:] if neg else pattern
                rx = "^" + re.escape(glob).replace(r"\*\*/", "(?:.*/)?").replace(r"\*\*", ".*").replace(r"\*", "[^/]*") + "$"
                if re.match(rx, path):
                    hit = not neg
            return hit
        samples = ["infra/envs/prod/main.tf", "infra/RUNBOOK.md", "infra/README.md", "infra/scripts/x.py",
                   "infra/scripts/tests/t.py", "infra/modules/observability/tests/a.tftest.hcl",
                   "infra/envs/prod/prod.auto.tfvars.example", "infra/.gitignore", "infra/bootstrap/placeholder.zip",
                   "infra/modules/identity/branding/spa.settings.json", "docs/delivery/r27-issues/TFCI.plan-allow.json",
                   "docs/delivery/r27-issues/notes.md", "src_C/deploy.sh"]
        for path in samples:
            self.assertEqual(matches(path), tfp.plan_affecting(path) or tfp.is_allow_file(path), path)


class AddressTest(unittest.TestCase):
    def test_parse_address(self):
        self.assertEqual(tfp.parse_address("module.operators.aws_iam_role.gha_infra"), ("operators", "aws_iam_role"))
        self.assertEqual(tfp.parse_address('module.api.aws_lambda_permission.p["a.b"]'), ("api", "aws_lambda_permission"))
        self.assertEqual(tfp.parse_address('module.x["k.1"].module.y.aws_s3_bucket.b'), ("x", "aws_s3_bucket"))
        self.assertEqual(tfp.parse_address("aws_iam_user.u"), (None, "aws_iam_user"))
        self.assertEqual(tfp.parse_address("module.edge.data.aws_iam_policy_document.d"), ("edge", "aws_iam_policy_document"))

    def test_break_glass_reason(self):
        self.assertIn("module.operators", tfp.break_glass_reason("module.operators.aws_iam_role.gha_prod"))
        self.assertIn("module.operators", tfp.break_glass_reason('module.operators["a"].aws_iam_role.r'))
        self.assertIn("aws_iam_user", tfp.break_glass_reason("module.identity.aws_iam_user.bot"))
        self.assertIn("aws_iam_access_key", tfp.break_glass_reason("aws_iam_access_key.k"))
        self.assertIn("aws_cloudtrail", tfp.break_glass_reason("module.observability.aws_cloudtrail.management"))
        self.assertIn("aws_organizations_policy", tfp.break_glass_reason("aws_organizations_policy.p"))
        self.assertIsNone(tfp.break_glass_reason("module.observability.aws_cloudwatch_metric_alarm.a"))
        self.assertIsNone(tfp.break_glass_reason("module.identity.aws_iam_role.core_vpc"))
        self.assertIsNone(tfp.break_glass_reason("module.operatorsx.aws_iam_role.r"))


class AllowShapeTest(unittest.TestCase):
    def test_every_committed_allow_file_has_the_shape(self):
        files = sorted((REPO_ROOT / "docs" / "delivery").rglob("*" + tfp.ALLOW_SUFFIX))
        self.assertGreater(len(files), 30)
        for path in files:
            data, problems = tfp.load_allow(str(path.relative_to(REPO_ROOT)), str(REPO_ROOT))
            self.assertEqual(problems, [], str(path))

    def test_bad_shapes(self):
        def problems(data):
            return " / ".join(tfp.allow_problems(data))
        self.assertIn("JSON object", problems([]))
        self.assertIn('"changes"', problems({"change": {}}))
        self.assertIn("unknown key", problems({"change": {}, "changes": {}}))
        self.assertIn("unknown action", problems({"changes": {"a.b": "destroy"}}))
        self.assertIn("unknown action", problems({"changes": {"a.b": {"keys": ["x"]}}}))
        self.assertIn('"keys"', problems({"changes": {"a.b": {"action": "update", "keys": "policy"}}}))
        self.assertIn('"outputs"', problems({"changes": {}, "outputs": "x"}))
        self.assertIn("tags_only_updates", problems({"changes": {}, "tags_only_updates": "no"}))
        self.assertIn("does not exist", problems({"changes": {}, "expect_imports": "nope/none.txt"}))
        self.assertEqual(problems({"changes": {}, "_note": "x", "outputs": ["o"], "tags_only_updates": True}), "")


class PrCheckTest(InRepo):
    def run_check(self, files):
        self.repo.git("checkout", "-q", "-b", "pr")
        self.repo.commit(files)
        return capture(tfp.pr_check, "main")

    def test_terraform_change_with_one_allow_file_passes(self):
        rc, out = self.run_check({"infra/modules/api/gateway.tf": "# x\n",
                                  "docs/delivery/r99/X.plan-allow.json": ALLOW_OK})
        self.assertEqual(rc, 0, out)
        self.assertIn("PR CHECK OK", out)

    def test_terraform_change_without_allow_file_fails(self):
        rc, out = self.run_check({"infra/modules/api/gateway.tf": "# x\n"})
        self.assertEqual(rc, 1, out)
        self.assertIn("adds or changes no docs/delivery", out)

    def test_a_release_with_two_agreeing_allow_files_passes(self):
        rc, out = self.run_check({"infra/modules/api/gateway.tf": "# x\n",
                                  "docs/delivery/r99/X.plan-allow.json": ALLOW_OK,
                                  "docs/delivery/r99/Y.plan-allow.json": {"changes": {"aws_sqs_queue.q": "create"}}})
        self.assertEqual(rc, 0, out)
        self.assertIn("2 allow file(s)", out)

    def test_contradicting_allow_files_fail(self):
        rc, out = self.run_check({"infra/modules/api/gateway.tf": "# x\n",
                                  "docs/delivery/r99/X.plan-allow.json": {"changes": {"aws_sqs_queue.q": "create"}},
                                  "docs/delivery/r99/Y.plan-allow.json": {"changes": {"aws_sqs_queue.q": "delete"}}})
        self.assertEqual(rc, 1, out)
        self.assertIn("conflicting actions", out)

    def test_docs_only_infra_change_needs_no_allow_file(self):
        rc, out = self.run_check({"infra/RUNBOOK.md": "x\n", "infra/scripts/x.py": "x\n",
                                  "infra/modules/observability/tests/a.tftest.hcl": "x\n"})
        self.assertEqual(rc, 0, out)

    def test_allow_file_of_the_wrong_shape_fails(self):
        rc, out = self.run_check({"infra/envs/prod/main.tf": "# changed\n",
                                  "docs/delivery/r99/X.plan-allow.json": {"change": {}}})
        self.assertEqual(rc, 1, out)
        self.assertIn("unknown key", out)

    def test_unparsable_allow_file_fails(self):
        rc, out = self.run_check({"infra/envs/prod/main.tf": "# changed\n",
                                  "docs/delivery/r99/X.plan-allow.json": "{not json"})
        self.assertEqual(rc, 1, out)

    def test_break_glass_allow_file_is_a_warning_in_a_pull_request(self):
        rc, out = self.run_check({"infra/modules/operators/main.tf": "# x\n",
                                  "docs/delivery/r99/X.plan-allow.json": {"changes": {"module.operators.aws_iam_role.r": "create"}}})
        self.assertEqual(rc, 0, out)
        self.assertIn("::warning::", out)
        self.assertIn("locally", out)

    def test_deleted_allow_file_does_not_count(self):
        self.repo.commit({"docs/delivery/r99/OLD.plan-allow.json": ALLOW_OK})
        rc, out = self.run_check({"docs/delivery/r99/OLD.plan-allow.json": None,
                                  "infra/envs/prod/main.tf": "# changed\n",
                                  "docs/delivery/r99/NEW.plan-allow.json": ALLOW_OK})
        self.assertEqual(rc, 0, out)

    def test_unknown_base_is_a_usage_error(self):
        with self.assertRaises(tfp.UsageError):
            tfp.pr_check("origin/nope")


class SelectTest(InRepo):
    def select(self, files, before=None):
        after = self.repo.commit(files)
        return capture(tfp.select, self.base if before is None else before, after)

    def test_one_allow_file_is_selected(self):
        (rc, outputs, summary), out = self.select({"infra/modules/api/gateway.tf": "# x\n",
                                                   "docs/delivery/r99/X.plan-allow.json": ALLOW_OK})
        self.assertEqual(rc, 0, out)
        self.assertEqual(outputs, {"apply": "true", "allow": "docs/delivery/r99/X.plan-allow.json"})
        self.assertIn('| `module.api.aws_apigatewayv2_route.this["x"]` | create | - |', summary)

    def test_merge_commit_range(self):
        self.repo.git("checkout", "-q", "-b", "feature")
        self.repo.commit({"infra/modules/api/gateway.tf": "# x\n"})
        self.repo.commit({"docs/delivery/r99/X.plan-allow.json": ALLOW_OK})
        self.repo.git("checkout", "-q", "main")
        self.repo.git("merge", "-q", "--no-ff", "-m", "Merge pull request", "feature")
        after = self.repo.git("rev-parse", "HEAD")
        (rc, outputs, _), out = capture(tfp.select, self.base, after)
        self.assertEqual((rc, outputs["allow"]), (0, "docs/delivery/r99/X.plan-allow.json"), out)

    def test_an_allow_file_alone_runs_the_apply(self):
        (rc, outputs, _), out = self.select({"docs/delivery/r99/X.plan-allow.json": ALLOW_OK})
        self.assertEqual((rc, outputs["apply"]), (0, "true"), out)

    def test_no_allow_file_with_a_terraform_change_needs_an_empty_plan(self):
        (rc, outputs, summary), out = self.select({"infra/envs/prod/main.tf": "# reworded comment\n"})
        self.assertEqual(rc, 0, out)
        self.assertEqual(outputs, {"apply": "true", "allow": ""})
        self.assertIn("only if the plan is empty", out)

    def test_nothing_plan_affecting_requests_no_approval(self):
        (rc, outputs, _), out = self.select({"infra/RUNBOOK.md": "x\n"})
        self.assertEqual((rc, outputs["apply"]), (0, "false"), out)

    def test_a_release_brings_several_allow_files(self):
        # release/r25 (#711) merged P02 and F05 into main in one push, each with its own allow file.
        (rc, outputs, summary), out = self.select({
            "infra/modules/api/gateway.tf": "# x\n",
            "docs/delivery/r99/X.plan-allow.json": ALLOW_OK,
            "docs/delivery/r99/Y.plan-allow.json": {"changes": {"aws_sqs_queue.q": "create"}}})
        self.assertEqual(rc, 0, out)
        self.assertEqual(outputs, {"apply": "true",
                                   "allow": "docs/delivery/r99/X.plan-allow.json docs/delivery/r99/Y.plan-allow.json"})
        self.assertIn("| `aws_sqs_queue.q` | create | - |", summary)
        self.assertIn("- 2 allow files (a release of several changes): the plan must match their union", summary)

    def test_contradicting_allow_files_are_refused(self):
        (rc, outputs, _), out = self.select({"docs/delivery/r99/X.plan-allow.json": {"changes": {"aws_sqs_queue.q": "create"}},
                                             "docs/delivery/r99/Y.plan-allow.json": {"changes": {"aws_sqs_queue.q": "forget"}}})
        self.assertEqual((rc, outputs["apply"]), (1, "false"), out)
        self.assertIn("aws_sqs_queue.q is listed with conflicting actions", out)

    def test_one_break_glass_file_in_a_release_stops_it(self):
        (rc, outputs, _), out = self.select({"docs/delivery/r99/X.plan-allow.json": ALLOW_OK,
                                             "docs/delivery/r99/Y.plan-allow.json": {"changes": {"module.operators.aws_iam_role.r": "update"}}})
        self.assertEqual((rc, outputs["apply"]), (1, "false"), out)

    def test_break_glass_allow_files_are_refused_before_approval(self):
        for address in ("module.operators.aws_iam_role.gha_prod", "module.identity.aws_iam_user.bot",
                        "module.observability.aws_cloudtrail.management"):
            (rc, outputs, _), out = self.select({"docs/delivery/r99/X.plan-allow.json": {"changes": {address: "update"}}})
            self.assertEqual((rc, outputs["apply"]), (1, "false"), address + out)
            self.assertIn("locally", out)

    def test_the_bootstrap_allow_file_is_refused(self):
        (rc, outputs, _), out = self.select({"infra/modules/operators/main.tf": "# x\n",
                                             "docs/delivery/r27-issues/TFCI.plan-allow.json": TFCI.read_text()})
        self.assertEqual((rc, outputs["apply"]), (1, "false"), out)
        self.assertIn("module.operators.aws_iam_role.gha_infra", out)

    def test_expected_imports_are_refused(self):
        (rc, _, _), out = self.select({"docs/delivery/r99/I.imports.txt": "module.api.aws_lambda_function.f\n",
                                       "docs/delivery/r99/X.plan-allow.json": {"changes": {},
                                                                               "expect_imports": "docs/delivery/r99/I.imports.txt"}})
        self.assertEqual(rc, 1, out)
        self.assertIn("import", out)

    def test_wrong_shape_is_refused(self):
        (rc, _, _), out = self.select({"docs/delivery/r99/X.plan-allow.json": {"changes": {"a.b": "destroy"}}})
        self.assertEqual(rc, 1, out)

    def test_unusable_before_is_refused(self):
        for before in ("", tfp.NULL_SHA, "1" * 40):
            (rc, outputs, _), out = self.select({"infra/envs/prod/main.tf": "# x\n"}, before=before)
            self.assertEqual((rc, outputs["apply"]), (1, "false"), before + out)

    def test_force_push_is_refused(self):
        self.repo.git("checkout", "-q", "-b", "other", self.base + "~0")
        side = self.repo.commit({"infra/envs/prod/main.tf": "# side\n"})
        self.repo.git("checkout", "-q", "main")
        (rc, _, _), out = self.select({"infra/envs/prod/main.tf": "# x\n"}, before=side)
        self.assertEqual(rc, 1, out)
        self.assertIn("not an ancestor", out)


class CombineTest(unittest.TestCase):
    def test_merge_specs(self):
        upd = lambda *keys: {"action": "update", "keys": list(keys)}
        cases = [
            ("create", "create", "create"),
            ("update", upd("policy"), "update"),
            (upd("policy"), upd("tags", "policy"), {"action": "update", "keys": ["policy", "tags"]}),
            ("create", upd("policy"), "create"),
            (upd("policy"), "replace", "replace"),
            ("create", "delete", None),
            ("delete", "update", None),
            ("forget", "delete", None),
            ("replace", "create", None),
        ]
        for first, second, want in cases:
            self.assertEqual(tfp.merge_specs(first, second), want, (first, second))
            self.assertEqual(tfp.merge_specs(second, first), want, (second, first))

    def test_combine(self):
        combined, conflicts = tfp.combine([
            ("a", {"tags_only_updates": False, "changes": {"x.a": "create", "x.b": {"action": "update", "keys": ["k1"]}},
                   "outputs": ["o1"]}),
            ("b", {"tags_only_updates": True, "changes": {"x.b": {"action": "update", "keys": ["k2"]}, "x.c": "delete"},
                   "outputs": ["o2", "o1"]}),
            ("c", {"changes": {"x.c": "create"}}),
        ])
        self.assertEqual(combined["changes"], {"x.a": "create", "x.b": {"action": "update", "keys": ["k1", "k2"]},
                                               "x.c": "delete"})
        self.assertEqual(combined["outputs"], ["o1", "o2"])
        self.assertTrue(combined["tags_only_updates"])
        self.assertEqual(conflicts, [("x.c", ["b", "c"])])

    def test_combined_file_gates_a_plan_with_check_plan(self):
        with tempfile.TemporaryDirectory() as tmp:
            cwd = os.getcwd()
            os.chdir(tmp)
            try:
                os.makedirs("docs/delivery/r99")
                for name, data in (("X", {"changes": {"aws_sqs_queue.q": "create"}, "outputs": ["queue_url"]}),
                                   ("Y", {"changes": {"aws_sqs_queue.q": {"action": "update", "keys": ["tags"]},
                                                      "aws_cloudwatch_metric_alarm.a": {"action": "update", "keys": ["threshold"]}}})):
                    with open("docs/delivery/r99/%s.plan-allow.json" % name, "w") as handle:
                        json.dump(data, handle)
                rc, out = capture(tfp.run_combine, ["docs/delivery/r99/X.plan-allow.json",
                                                    "docs/delivery/r99/Y.plan-allow.json"], "allow.json")
                self.assertEqual(rc, 0, out)
                self.assertIn("COMBINED 2 allow file(s), 2 address(es)", out)
                with open("plan.json", "w") as handle:
                    json.dump(plan(resource("aws_sqs_queue.q", ["create"], after={"name": "q"}),
                                   resource("aws_cloudwatch_metric_alarm.a", ["update"], before={"threshold": 1},
                                            after={"threshold": 2}),
                                   outputs={"queue_url": {"actions": ["create"]}}), handle)
                proc = subprocess.run([sys.executable, str(CHECK_PLAN), "--plan", "plan.json", "--allow", "allow.json"],
                                      stdout=subprocess.PIPE, stderr=subprocess.PIPE, universal_newlines=True)
                self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)
                self.assertIn("PLAN OK 2", proc.stdout)
                rc, out = capture(tfp.run_combine, ["docs/delivery/r99/X.plan-allow.json", "docs/delivery/r99/none.plan-allow.json"],
                                  "allow2.json")
                self.assertEqual(rc, 1, out)
                self.assertFalse(os.path.exists("allow2.json"))
            finally:
                os.chdir(cwd)


class StaleTest(InRepo):
    def api(self, runs, jobs):
        calls = []

        def fake(path):
            calls.append(path)
            if "/jobs" in path:
                run_id = path.split("/runs/")[1].split("/")[0]
                return {"jobs": jobs.get(run_id, [])}
            return {"workflow_runs": runs}
        fake.calls = calls
        return fake

    def run_entry(self, run_id, sha, **kw):
        entry = {"id": run_id, "head_sha": sha, "path": tfp.WORKFLOW_PATH, "event": "push", "head_branch": "main",
                 "conclusion": "success", "head_repository": {"full_name": REPO}}
        entry.update(kw)
        return entry

    def applied(self, conclusion="success", step="success"):
        """The jobs of one run: select, and the apply job with its step "apply the saved plan"."""
        steps = [{"name": "plan to a saved file (never printed)", "conclusion": "success"},
                 {"name": tfp.APPLY_STEP, "conclusion": step},
                 {"name": "the second plan must be empty", "conclusion": "skipped" if step == "skipped" else conclusion}]
        return [{"name": "select (no AWS)", "conclusion": "success"},
                {"name": tfp.APPLY_JOB, "conclusion": conclusion, "steps": steps}]

    def setUp(self):
        super().setUp()
        self.old = self.repo.commit({"infra/envs/prod/main.tf": "# old\n"})
        self.new = self.repo.commit({"infra/envs/prod/main.tf": "# new\n"})

    def test_a_newer_applied_commit_makes_an_old_run_stale(self):
        api = self.api([self.run_entry(7, self.new)], {"7": self.applied()})
        rc, out = capture(tfp.stale, self.old, REPO, "9", api)
        self.assertEqual(rc, 1, out)
        self.assertIn("already applied", out)

    def test_current_when_nothing_newer_was_applied(self):
        cases = [
            ([], {}),
            ([self.run_entry(7, self.old)], {"7": self.applied()}),                       # same commit
            ([self.run_entry(7, self.base)], {"7": self.applied()}),                      # older commit
            ([self.run_entry(7, self.new)], {"7": self.applied("skipped", "skipped")}),   # apply job skipped
            # refused at the guard or the gate: the apply step never ran, nothing changed AWS
            ([self.run_entry(7, self.new, conclusion="failure")], {"7": self.applied("failure", "skipped")}),
            ([self.run_entry(7, self.new, conclusion="failure")], {"7": [{"name": tfp.APPLY_JOB, "conclusion": "failure"}]}),
            ([self.run_entry(7, self.new, conclusion=None, status="in_progress")],
             {"7": self.applied(None, None)}),                                              # still running
            ([self.run_entry(7, self.new, event="workflow_dispatch")], {"7": self.applied()}),
            ([self.run_entry(7, self.new, path=".github/workflows/evil.yml")], {"7": self.applied()}),
            ([self.run_entry(7, self.new, head_repository={"full_name": "fork/recallsmith"})], {"7": self.applied()}),
            ([self.run_entry(9, self.new)], {"9": self.applied()}),                       # this run itself
            ([self.run_entry(7, "f" * 40)], {"7": self.applied()}),                       # not in the clone
        ]
        for runs, jobs in cases:
            rc, out = capture(tfp.stale, self.old, REPO, "9", self.api(runs, jobs))
            self.assertEqual(rc, 0, json.dumps(runs) + out)

    def test_gh_api_without_the_workflow_on_record(self):
        # The first push of terraform.yml: GitHub may not list the workflow yet (404) -> no run, nothing applied.
        bindir = tempfile.mkdtemp(prefix="tfp-gh-")
        try:
            with open(os.path.join(bindir, "gh"), "w") as handle:
                handle.write('#!/bin/sh\ncase "$2" in *"/actions/workflows/"*|*"/runs/1/"*) '
                             'echo "gh: Not Found (HTTP 404)" >&2; exit 1;; esac\necho \'{"ok": 1}\'\n')
            os.chmod(os.path.join(bindir, "gh"), 0o755)
            path = os.environ["PATH"]
            os.environ["PATH"] = bindir + os.pathsep + path
            try:
                self.assertEqual(tfp.gh_api("repos/o/r/actions/workflows/terraform.yml/runs?x=1"), {"workflow_runs": []})
                self.assertEqual(tfp.gh_api("repos/o/r/actions/runs/2/jobs"), {"ok": 1})
                with self.assertRaises(tfp.UsageError):
                    tfp.gh_api("repos/o/r/actions/runs/1/jobs")
            finally:
                os.environ["PATH"] = path
        finally:
            shutil.rmtree(bindir, ignore_errors=True)

    def test_only_descendants_cost_a_jobs_call(self):
        api = self.api([self.run_entry(7, self.base), self.run_entry(8, self.old)], {})
        capture(tfp.stale, self.old, REPO, "9", api)
        self.assertEqual([c for c in api.calls if "/jobs" in c], [])


def resource(address, actions, rtype=None, before=None, after=None, importing=False, mode="managed", unknown=None):
    rtype = rtype or tfp.parse_address(address)[1]
    change = {"actions": actions, "before": before, "after": after, "after_unknown": unknown or {}}
    if importing:
        change["importing"] = {"id": "secret-import-id"}
    return {"address": address, "mode": mode, "type": rtype, "change": change}


def plan(*entries, outputs=None):
    return {"resource_changes": list(entries), "output_changes": outputs or {}}


def trust(principal):
    return json.dumps({"Version": "2012-10-17", "Statement": [
        {"Effect": "Allow", "Action": "sts:AssumeRole", "Principal": principal}]})


class GuardTest(unittest.TestCase):
    def guard(self, p):
        rc, counts, refusals, _ = tfp.guard(p)
        return rc, counts, refusals

    def test_routine_changes_pass(self):
        rc, counts, refusals = self.guard(plan(
            resource("module.api.aws_apigatewayv2_route.this[\"x\"]", ["create"], after={"route_key": "GET /x"}),
            resource("module.observability.aws_cloudwatch_metric_alarm.a", ["update"], before={"threshold": 1},
                     after={"threshold": 2}),
            resource("module.data.aws_s3_bucket_lifecycle_configuration.content", ["update"],
                     before={"bucket": "developercards-content"}, after={"bucket": "developercards-content"}),
            resource("module.identity.aws_iam_role.r", ["create"],
                     after={"assume_role_policy": trust({"Service": "lambda.amazonaws.com"})}),
            resource("module.edge.data.aws_iam_policy_document.d", ["read"], mode="data"),
            resource("module.api.aws_lambda_function.f", ["no-op"])))
        self.assertEqual((rc, refusals), (0, []))
        self.assertEqual(counts, {"effective": 4, "moved": 0, "importing": 0, "outputs": 0})

    def test_module_operators_is_refused(self):
        for actions in (["create"], ["update"], ["delete"], ["delete", "create"], ["forget"]):
            rc, _, refusals = self.guard(plan(resource("module.operators.aws_iam_role.gha_infra", actions)))
            self.assertEqual(rc, 1, actions)
            self.assertIn("module.operators", refusals[0][1])

    def test_importing_into_module_operators_is_refused(self):
        rc, counts, refusals = self.guard(plan(resource("module.operators.aws_iam_role.x", ["no-op"], importing=True)))
        self.assertEqual(rc, 1)
        self.assertEqual(counts["importing"], 1)

    def test_imports_are_refused(self):
        rc, counts, refusals = self.guard(plan(resource("module.api.aws_lambda_function.f", ["no-op"], importing=True)))
        self.assertEqual((rc, counts["importing"]), (1, 1))
        self.assertIn("import", refusals[0][1])

    def test_denied_resource_types_are_refused(self):
        for address in ("module.observability.aws_cloudtrail.management", "aws_iam_user.bot", "aws_iam_access_key.k",
                        "aws_iam_openid_connect_provider.p", "aws_iam_virtual_mfa_device.m",
                        "aws_organizations_account.a", "aws_account_alternate_contact.c"):
            rc, _, refusals = self.guard(plan(resource(address, ["update"], before={}, after={})))
            self.assertEqual(rc, 1, address)

    def test_audit_and_state_buckets_are_refused(self):
        for bucket in tfp.PROTECTED_BUCKETS:
            for rtype, before, after in (("aws_s3_bucket_policy", {"bucket": bucket}, {"bucket": bucket}),
                                         ("aws_s3_bucket", {"bucket": bucket}, None),
                                         ("aws_s3_bucket_lifecycle_configuration", None, {"bucket": bucket})):
                rc, _, refusals = self.guard(plan(resource("module.observability.%s.cloudtrail" % rtype, ["update"],
                                                           rtype=rtype, before=before, after=after)))
                self.assertEqual(rc, 1, (bucket, rtype))
                self.assertIn("bucket", refusals[0][1])

    def test_trust_policies_may_name_only_aws_services(self):
        bad = [{"AWS": "arn:aws:iam::111122223333:root"}, {"Federated": "arn:aws:iam::1:oidc-provider/x"}, "*",
               {"Service": "lambda.amazonaws.com", "AWS": "*"}, {}]
        for principal in bad:
            rc, _, refusals = self.guard(plan(resource("module.identity.aws_iam_role.r", ["create"],
                                                       after={"assume_role_policy": trust(principal)})))
            self.assertEqual(rc, 1, principal)
            self.assertIn("trust policy", refusals[0][1])
        rc, _, _ = self.guard(plan(resource("module.identity.aws_iam_role.r", ["update"],
                                            before={"assume_role_policy": trust({"Service": "lambda.amazonaws.com"})},
                                            after={"assume_role_policy": trust({"AWS": "*"})})))
        self.assertEqual(rc, 1)
        not_principal = json.dumps({"Statement": [{"Effect": "Allow", "NotPrincipal": {"AWS": "x"}}]})
        rc, _, _ = self.guard(plan(resource("aws_iam_role.r", ["create"], after={"assume_role_policy": not_principal})))
        self.assertEqual(rc, 1)

    def test_unknown_trust_is_refused_and_unchanged_trust_passes(self):
        rc, _, refusals = self.guard(plan(resource("aws_iam_role.r", ["create"], after={},
                                                   unknown={"assume_role_policy": True})))
        self.assertEqual(rc, 1)
        self.assertIn("unknown until apply", refusals[0][1])
        same = trust({"AWS": "arn:aws:iam::1:user/legacy"})
        rc, _, _ = self.guard(plan(resource("aws_iam_role.r", ["update"], before={"assume_role_policy": same, "tags": {}},
                                            after={"assume_role_policy": same, "tags": {"a": "b"}})))
        self.assertEqual(rc, 0)
        rc, _, _ = self.guard(plan(resource("aws_iam_role.r", ["delete"], before={"assume_role_policy": same})))
        self.assertEqual(rc, 0)

    def test_apply_needed(self):
        empty = plan(resource("module.api.aws_lambda_function.f", ["no-op"]))
        outputs_only = plan(outputs={"operator_role_arns": {"actions": ["update"]}})
        forget = plan(resource("module.api.aws_cloudwatch_log_group.edge_public", ["forget"]))
        for p, needed in ((empty, "false"), (outputs_only, "true"), (forget, "true")):
            with tempfile.TemporaryDirectory() as tmp:
                path, out_file = os.path.join(tmp, "plan.json"), os.path.join(tmp, "out")
                with open(path, "w") as handle:
                    json.dump(p, handle)
                rc, out = capture(tfp.run_guard, path, out_file)
                self.assertEqual(rc, 0, out)
                with open(out_file) as handle:
                    self.assertEqual(handle.read(), "apply_needed=%s\n" % needed)

    def test_a_refusal_never_prints_values(self):
        secret = "s3cr3t-value-0123"
        p = plan(resource("module.operators.aws_iam_role.r", ["update"], before={"description": secret},
                          after={"description": secret + "x"}, importing=True),
                 resource("aws_iam_role.t", ["create"], after={"assume_role_policy": trust({"AWS": secret})}))
        with tempfile.TemporaryDirectory() as tmp:
            path, out_file = os.path.join(tmp, "plan.json"), os.path.join(tmp, "out")
            with open(path, "w") as handle:
                json.dump(p, handle)
            rc, out = capture(tfp.run_guard, path, out_file)
            with open(out_file) as handle:
                written = handle.read()
        self.assertEqual(rc, 1)
        self.assertEqual(written, "apply_needed=false\n")
        self.assertIn("REFUSED module.operators.aws_iam_role.r", out)
        self.assertIn("REFUSED aws_iam_role.t", out)
        self.assertNotIn(secret, out)
        self.assertNotIn("secret-import-id", out)

    def test_unreadable_plan_is_a_usage_error(self):
        self.assertEqual(capture(tfp.main, ["guard", "--plan", "/nonexistent/plan.json"])[0], 2)


TF_ERRORS = """
Planning failed. Terraform encountered an error while generating this plan.

Error: creating IAM Role (developercards-x): operation error IAM: CreateRole, https response error StatusCode: 403, RequestID: 1a2b, api error AccessDenied: User: arn:aws:sts::622994489535:assumed-role/developercards-gha-infra/gha-tf-1-1 is not authorized to perform: iam:CreateRole on resource: s3cr3t-detail

  with module.identity.aws_iam_role.x,
  on ../../modules/identity/main.tf line 1, in resource "aws_iam_role" "x":
   1: resource "aws_iam_role" "x" {

Error: updating Lambda Function (core-vpc) configuration: operation error Lambda: UpdateFunctionConfiguration, https response error StatusCode: 400, api error InvalidParameterValueException: Lambda was unable to configure your environment variables because the environment variables you have provided exceeded the 4KB limit. String measured: {"PG_PASSWORD":"hunter2"}

  with module.api.aws_lambda_function.core_vpc,

Error: expected length of name to be in the range (1 - 64), got hunter2hunter2
"""


class DiagnoseTest(unittest.TestCase):
    def test_sanitized(self):
        lines = tfp.diagnose(TF_ERRORS)
        self.assertEqual(lines, [
            "ERROR creating IAM Role | module.identity.aws_iam_role.x | IAM CreateRole | 403 | AccessDenied",
            "ERROR updating Lambda Function | module.api.aws_lambda_function.core_vpc | Lambda UpdateFunctionConfiguration | 400 | InvalidParameterValueException",
            "ERROR expected length of name to be in the | - | - | - | -",  # the first eight words at most
        ])
        joined = "\n".join(lines)
        for secret in ("hunter2", "s3cr3t", "PG_PASSWORD", "622994489535", "1a2b"):
            self.assertNotIn(secret, joined)

    def test_missing_logs(self):
        rc, out = capture(tfp.run_diagnose, ["/nonexistent/a.log"])
        self.assertEqual(rc, 0)
        self.assertIn("no Terraform error line found", out)


class BootstrapAllowTest(unittest.TestCase):
    """The TFCI allow file against check-plan.py, on the plan the bootstrap apply is expected to show."""

    def bootstrap_plan(self, extra=()):
        entries = [resource("module.operators.aws_iam_role.gha_infra", ["create"], after={"name": "developercards-gha-infra"}),
                   resource("module.operators.aws_iam_role_policy_attachment.gha_infra", ["create"], after={}),
                   resource("module.operators.aws_iam_role_policy.gha_infra_deny", ["create"], after={}),
                   resource("module.operators.aws_iam_role.gha_prod", ["no-op"]),
                   resource("module.operators.aws_iam_openid_connect_provider.github", ["no-op"])]
        return plan(*(entries + list(extra)), outputs={"operator_role_arns": {"actions": ["update"]},
                                                      "operator_base_policy_arn": {"actions": ["no-op"]}})

    def check_plan(self, p):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "plan.json")
            with open(path, "w") as handle:
                json.dump(p, handle)
            proc = subprocess.run([sys.executable, str(CHECK_PLAN), "--plan", path, "--allow", str(TFCI)],
                                  stdout=subprocess.PIPE, stderr=subprocess.PIPE, universal_newlines=True)
        return proc.returncode, proc.stdout + proc.stderr

    def test_expected_bootstrap_plan_passes(self):
        rc, out = self.check_plan(self.bootstrap_plan())
        self.assertEqual(rc, 0, out)
        self.assertIn("PLAN OK 3", out)

    def test_anything_else_fails(self):
        rc, out = self.check_plan(self.bootstrap_plan([resource("module.operators.aws_iam_role.gha_prod", ["update"],
                                                                before={"description": "a"}, after={"description": "b"})]))
        self.assertEqual(rc, 1, out)

    def test_guard_refuses_it(self):
        rc, _, refusals, _ = tfp.guard(self.bootstrap_plan())
        self.assertEqual(rc, 1)
        self.assertEqual(sorted(a for a, _ in refusals), [
            "module.operators.aws_iam_role.gha_infra", "module.operators.aws_iam_role_policy.gha_infra_deny",
            "module.operators.aws_iam_role_policy_attachment.gha_infra"])


def jobs_of(text):
    body = text.split("\njobs:\n", 1)[1]
    parts = re.split(r"\n  (?=[a-z][\w-]*:\n)", "\n" + body)
    return {p.split(":", 1)[0].strip(): p for p in parts if p.strip()}


def before(text, first, second):
    return first in text and second in text and text.index(first) < text.index(second)


class WorkflowFactsTest(unittest.TestCase):
    def setUp(self):
        self.text = WORKFLOW.read_text()
        self.jobs = jobs_of(self.text)

    def test_jobs(self):
        self.assertEqual(sorted(self.jobs), ["apply", "plan", "select"])
        self.assertIn("\n    name: apply (infra-prod)\n", self.jobs["apply"])
        self.assertEqual(tfp.APPLY_JOB, "apply (infra-prod)")

    def test_triggers(self):
        on = self.text.split("\non:\n", 1)[1].split("\npermissions:", 1)[0]
        self.assertEqual(re.findall(r"^  (\w+):", on, re.M), ["push", "workflow_dispatch"])
        self.assertNotIn("pull_request", on)
        self.assertIn("    branches: [main]\n", on)

    def test_permissions_and_environments(self):
        self.assertIn("\npermissions:\n  contents: read\n", self.text)
        env_jobs = sorted(n for n, j in self.jobs.items() if "\n    environment:" in j)
        oidc_jobs = sorted(n for n, j in self.jobs.items() if "id-token: write" in j)
        self.assertEqual(env_jobs, ["apply", "plan"])
        self.assertEqual(oidc_jobs, ["apply", "plan"])
        for name in env_jobs:
            self.assertIn("    environment:\n      name: infra-prod\n", self.jobs[name])
            self.assertIn("role-to-assume: arn:aws:iam::622994489535:role/developercards-gha-infra\n", self.jobs[name])
            self.assertIn("TF_VAR_alert_email: ${{ secrets.TF_VAR_ALERT_EMAIL }}", self.jobs[name])
        self.assertNotIn("developercards-gha-prod", self.text)
        self.assertNotIn("configure-aws-credentials", self.jobs["select"])
        self.assertIn("if: github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main'", self.jobs["plan"])

    def test_concurrency_never_cancels(self):
        self.assertIn("\nconcurrency:\n", self.text)
        self.assertIn("  cancel-in-progress: false\n", self.text)
        self.assertNotIn("cancel-in-progress: true", self.text)

    def test_pins_equal_ci_and_cd(self):
        known = {}
        for path in (CI, CD):
            for action, sha, tag in re.findall(r"uses: ([\w.-]+/[\w.-]+)@([0-9a-f]{40}) # (v\d+\.\d+\.\d+)", path.read_text()):
                known[action] = (sha, tag)
        uses = re.findall(r"uses: (\S+)(.*)", self.text)
        self.assertGreater(len(uses), 0)
        for ref, comment in uses:
            m = re.fullmatch(r"([\w.-]+/[\w.-]+)@([0-9a-f]{40})", ref)
            self.assertIsNotNone(m, ref)
            self.assertEqual(known.get(m.group(1)), (m.group(2), comment.strip()[2:]), ref)

    def test_apply_order(self):
        apply = self.jobs["apply"]
        creds = "configure-aws-credentials"
        self.assertTrue(before(apply, 'git merge-base --is-ancestor "$GITHUB_SHA" refs/remotes/origin/main', creds))
        self.assertTrue(before(apply, "tf-pipeline.py stale", creds))
        self.assertTrue(before(apply, "TF_VAR_ALERT_EMAIL is not set", creds))
        self.assertTrue(before(apply, "plan -input=false", "tf-pipeline.py guard"))
        self.assertTrue(before(apply, 'read -r -a allow_files <<< "$ALLOW"', creds))
        self.assertTrue(before(apply, 'tf-pipeline.py combine --out "$RUNNER_TEMP/tf/allow.json" "${allow_files[@]}"',
                               creds))
        self.assertNotIn("$ALLOW\n", apply)
        self.assertNotIn("SC2086", apply)
        self.assertTrue(before(apply, "tf-pipeline.py preflight", creds))
        self.assertTrue(before(apply, "tf-pipeline.py guard", "check-plan.py --plan \"$RUNNER_TEMP/tf/plan.json\" --allow"))
        self.assertTrue(before(apply, '--allow "$RUNNER_TEMP/tf/allow.json"', " apply -input=false"))
        self.assertIn('apply -input=false -no-color -lock-timeout=10m "$RUNNER_TEMP/tf/apply.tfplan"', apply)
        self.assertTrue(before(apply, " apply -input=false", "check-plan.py --plan \"$RUNNER_TEMP/tf/second.json\" >"))
        self.assertIn("-lock-timeout=", apply)
        self.assertIn("if: steps.guard.outputs.apply_needed == 'true'", apply)

    def test_select_order(self):
        select = self.jobs["select"]
        self.assertTrue(before(select, 'git merge-base --is-ancestor "$GITHUB_SHA" refs/remotes/origin/main',
                               "tf-pipeline.py select"))
        self.assertTrue(before(select, "tf-pipeline.py stale", "tf-pipeline.py select"))
        self.assertIn("BEFORE: ${{ github.event.before }}", select)
        self.assertIn("if: needs.select.outputs.apply == 'true'", self.jobs["apply"])

    def test_terraform_output_never_reaches_the_log(self):
        # Every terraform command (with its continuation lines) sends stdout and stderr to a file under $RUNNER_TEMP.
        commands = re.findall(r"terraform -chdir=\S+ (?:init|plan|apply|show)(?:[^\n]*\\\n)*[^\n]*", self.text)
        self.assertGreaterEqual(len(commands), 9)
        for command in commands:
            self.assertIn("-no-color", command, command)
            self.assertRegex(command, r'> "\$RUNNER_TEMP/tf/[\w.]+"', command)
            self.assertRegex(command, r"2>(&1|> \"\$RUNNER_TEMP/tf/[\w.]+\")", command)
        self.assertNotIn("upload-artifact", self.text)
        self.assertNotIn("TF_LOG", self.text)
        self.assertNotRegex(self.text, r"cat \"\$RUNNER_TEMP/tf/(plan|apply|init|second)\.(log|json)\"")
        for name in ("apply", "plan"):
            self.assertIn('rm -rf "$RUNNER_TEMP/tf"', self.jobs[name])

    def test_checkout_never_persists_credentials(self):
        self.assertEqual(self.text.count("persist-credentials: false"), self.text.count("actions/checkout@"))


class CiFactsTest(unittest.TestCase):
    def test_nine_required_job_names_unchanged(self):
        names = re.findall(r"^    name: (.*)$", CI.read_text(), re.M)
        self.assertEqual(names, [
            "mobile (typecheck + vitest + expo export)", "frontend (vitest + build)", "frontend (playwright smoke)",
            "backend (dotnet test)", "python (uv lock + pytest)",
            "infra (terraform fmt/validate + agent routes + deploy scripts)", "tools/mcp-server (build + vitest)",
            "integrations/n8n (signature verifier + recipe logic)", "tools/author-runner (build + vitest)"])

    def test_infra_job_runs_the_pull_request_rule(self):
        infra = jobs_of(CI.read_text())["infra"]
        self.assertIn("fetch-depth: 0", infra)
        step = infra[infra.index("name: Terraform allow-list rule"):]
        step = step[:step.index("\n      - ")]
        # Every run but a push to main: a branch push reports a check of the same name for the same commit as its
        # pull request, and that one must not pass by skipping the rule.
        self.assertIn("if: github.ref != 'refs/heads/main'", step)
        self.assertNotIn("event_name", step)
        self.assertIn("BASE_REF: origin/${{ github.base_ref || 'main' }}", step)
        self.assertIn('python3 infra/scripts/tf-pipeline.py pr-check --base "$BASE_REF"', step)
        self.assertNotIn("id-token", CI.read_text())


def hcl_block(text, header):
    start = text.index(header)
    depth, i = 0, text.index("{", start)
    while True:
        if text[i] == "{":
            depth += 1
        elif text[i] == "}":
            depth -= 1
            if depth == 0:
                return text[start:i + 1]
        i += 1


class GhaInfraRoleTest(unittest.TestCase):
    def setUp(self):
        self.main = (OPERATORS / "main.tf").read_text()
        self.variables = (OPERATORS / "variables.tf").read_text()

    def test_trust_is_exactly_the_infra_prod_environment(self):
        trust = hcl_block(self.main, 'data "aws_iam_policy_document" "trust_github_infra"')
        self.assertIn('actions = ["sts:AssumeRoleWithWebIdentity"]', trust)
        self.assertIn("identifiers = [aws_iam_openid_connect_provider.github.arn]", trust)
        self.assertEqual(re.findall(r'test\s*=\s*"(\w+)"', trust), ["StringEquals", "StringEquals"])
        self.assertIn('variable = "token.actions.githubusercontent.com:aud"\n      values   = ["sts.amazonaws.com"]', trust)
        self.assertIn('variable = "token.actions.githubusercontent.com:sub"\n      values   = '
                      '["repo:${var.github_repository}:environment:${var.github_infra_environment}"]', trust)
        env = hcl_block(self.variables, 'variable "github_infra_environment"')
        self.assertIn('default = "infra-prod"', env)
        repo = hcl_block(self.variables, 'variable "github_repository"')
        self.assertIn('default = "%s"' % REPO, repo)
        name = hcl_block(self.variables, 'variable "gha_infra_role_name"')
        self.assertIn('default = "developercards-gha-infra"', name)

    def test_role_and_admin_attachment(self):
        role = hcl_block(self.main, 'resource "aws_iam_role" "gha_infra"')
        self.assertIn("assume_role_policy   = data.aws_iam_policy_document.trust_github_infra.json", role)
        attach = hcl_block(self.main, 'resource "aws_iam_role_policy_attachment" "gha_infra"')
        self.assertIn('policy_arn = "arn:aws:iam::aws:policy/AdministratorAccess"', attach)
        deny = hcl_block(self.main, 'resource "aws_iam_role_policy" "gha_infra_deny"')
        self.assertIn("role   = aws_iam_role.gha_infra.id", deny)

    def statements(self):
        doc = hcl_block(self.main, 'data "aws_iam_policy_document" "gha_infra_deny"')
        found = {}
        for block in re.findall(r"\n  statement \{(.*?)\n  \}", doc, re.S):
            self.assertRegex(block, r'effect\s*=\s*"Deny"')
            sid = re.search(r'sid\s*=\s*"(\w+)"', block).group(1)
            acts = re.search(r"actions\s*=\s*\[(.*?)\]", block, re.S).group(1)
            code = "\n".join(line.split("#", 1)[0] for line in acts.splitlines())
            found[sid] = (re.findall(r'"([^"]+)"', code), re.search(r"resources\s*=\s*(.*)", block).group(1))
        return found

    def denies(self, sid, action):
        patterns = self.statements()[sid][0]
        return any(fnmatch.fnmatchcase(action, p) for p in patterns)

    def test_deny_covers_the_design(self):
        credentials = ["iam:CreateUser", "iam:CreateAccessKey", "iam:CreateLoginProfile", "iam:UpdateLoginProfile",
                       "iam:AttachUserPolicy", "iam:PutUserPolicy", "iam:AddUserToGroup",
                       "iam:CreateServiceSpecificCredential", "iam:UploadSSHPublicKey", "iam:UpdateAccessKey",
                       "iam:EnableMFADevice", "iam:CreateVirtualMFADevice", "iam:CreateOpenIDConnectProvider",
                       "iam:UpdateOpenIDConnectProviderThumbprint", "iam:DeleteOpenIDConnectProvider",
                       "iam:AddClientIDToOpenIDConnectProvider", "iam:CreateSAMLProvider", "iam:PutGroupPolicy"]
        for action in credentials:
            self.assertTrue(self.denies("NoStaticOrHumanCredentials", action), action)
        for action in ["iam:CreateRole", "iam:PassRole", "iam:CreateServiceLinkedRole", "iam:PutRolePolicy",
                       "iam:GetRole", "iam:CreatePolicy"]:
            self.assertFalse(self.denies("NoStaticOrHumanCredentials", action), action)
        for action in ["cloudtrail:StopLogging", "cloudtrail:DeleteTrail", "cloudtrail:UpdateTrail",
                       "cloudtrail:PutEventSelectors"]:
            self.assertTrue(self.denies("NoAuditTampering", action), action)
        roles = self.statements()["NoOperatorOrCiRoleChanges"]
        for action in ["iam:UpdateAssumeRolePolicy", "iam:PutRolePolicy", "iam:DeleteRolePolicy", "iam:AttachRolePolicy",
                       "iam:DetachRolePolicy", "iam:DeleteRole", "iam:UpdateRole"]:
            self.assertIn(action, roles[0])
        self.assertEqual(roles[1].strip(), "local.gha_infra_protected_role_arns")
        for action in ["organizations:LeaveOrganization", "account:PutAlternateContact", "account:EnableRegion"]:
            self.assertTrue(self.denies("NoAccountChanges", action), action)
        self.assertEqual(self.statements()["NoOperatorBasePolicyChanges"][1].strip(),
                         "[aws_iam_policy.operator_base.arn]")

    def test_protected_roles_are_all_five(self):
        local = hcl_block(self.main, "locals {\n  # Built from names")
        for ref in ("aws_iam_role.agent_readonly.name", "aws_iam_role.deployer.name", "aws_iam_role.admin_mfa.name",
                    "aws_iam_role.gha_prod.name", "var.gha_infra_role_name"):
            self.assertIn(ref, local)
        names = re.findall(r'^\s+name\s+=\s+"([\w-]+)"', self.main, re.M)
        for name in ("devcards-agent-readonly", "devcards-deployer", "devcards-admin-mfa", "developercards-gha-prod"):
            self.assertIn(name, names)

    def test_protected_buckets_match_the_prod_wiring(self):
        text = PROD_MAIN.read_text().replace("${var.account_id}", "622994489535")
        self.assertIn('audit_bucket_name = "%s"' % tfp.PROTECTED_BUCKETS[0], text)
        self.assertIn('state_bucket_name = "%s"' % tfp.PROTECTED_BUCKETS[1], text)
        backend = (REPO_ROOT / "infra" / "envs" / "prod" / "backend.tf").read_text()
        self.assertIn('bucket       = "%s"' % tfp.PROTECTED_BUCKETS[1], backend)
        trail = (REPO_ROOT / "infra" / "modules" / "observability" / "retention.tf").read_text()
        self.assertIn('cloudtrail_bucket_name = "developercards-cloudtrail-${var.account_id}"', trail)

    def test_output(self):
        outputs = (REPO_ROOT / "infra" / "envs" / "prod" / "outputs.tf").read_text()
        self.assertIn("gha_infra      = module.operators.gha_infra_role_arn", outputs)


class NonAsciiPathTest(InRepo):
    """git quotes a non-ASCII path ("infra/envs/prod/na\303\257ve.tf") unless -z: it must still count."""
    NAME = "infra/envs/prod/naïve.tf"

    def test_changed_files_are_verbatim(self):
        after = self.repo.commit({self.NAME: "# x\n", "docs/a b.md": "x\n"})
        got = sorted((st, unicodedata.normalize("NFC", p)) for st, p in tfp.changed_files(self.base, after))
        self.assertEqual(got, [("A", "docs/a b.md"), ("A", self.NAME)])

    def test_pull_request_needs_an_allow_file(self):
        self.repo.git("checkout", "-q", "-b", "pr")
        self.repo.commit({self.NAME: "# x\n"})
        rc, out = capture(tfp.pr_check, "main")
        self.assertEqual(rc, 1, out)
        self.assertIn("adds or changes no docs/delivery", out)

    def test_select_runs_the_apply(self):
        after = self.repo.commit({self.NAME: "# x\n"})
        (rc, outputs, _), out = capture(tfp.select, self.base, after)
        self.assertEqual((rc, outputs), (0, {"apply": "true", "allow": ""}), out)


class AllowPathTest(unittest.TestCase):
    def test_paths(self):
        self.assertIsNone(tfp.allow_path_problem("docs/delivery/r27-issues/TFCI.plan-allow.json"))
        for bad in ("docs/delivery/x/*.plan-allow.json", "docs/delivery/x/[a].plan-allow.json",
                    "docs/delivery/x/a?.plan-allow.json", "docs/delivery/a b.plan-allow.json",
                    "docs/delivery/../x.plan-allow.json", "/docs/delivery/x.plan-allow.json",
                    "docs/delivery/x/naïve.plan-allow.json", "docs/delivery/x/$(id).plan-allow.json",
                    "infra/x.plan-allow.json", "docs/delivery/x/a.json"):
            self.assertIsNotNone(tfp.allow_path_problem(bad), bad)

    def test_committed_allow_files_have_plain_paths(self):
        for path in (REPO_ROOT / "docs" / "delivery").rglob("*" + tfp.ALLOW_SUFFIX):
            rel = path.relative_to(REPO_ROOT).as_posix()
            self.assertIsNone(tfp.allow_path_problem(rel), rel)

    def test_combine_refuses_a_glob(self):
        with tempfile.TemporaryDirectory() as tmp:
            cwd = os.getcwd()
            os.chdir(tmp)
            try:
                os.makedirs("docs/delivery/x")
                for name in ("NEW", "OLD"):
                    with open("docs/delivery/x/%s.plan-allow.json" % name, "w") as handle:
                        json.dump({"changes": {"aws_sqs_queue.%s" % name.lower(): "create"}}, handle)
                rc, out = capture(tfp.run_combine, ["docs/delivery/x/*.plan-allow.json"], "allow.json")
                self.assertEqual(rc, 1, out)
                self.assertIn("A-Z a-z 0-9", out)
                self.assertFalse(os.path.exists("allow.json"))
            finally:
                os.chdir(cwd)


class SelectPathTest(InRepo):
    def test_a_glob_named_allow_file_is_refused(self):
        after = self.repo.commit({"docs/delivery/r99/*.plan-allow.json": ALLOW_OK})
        (rc, outputs, _), out = capture(tfp.select, self.base, after)
        self.assertEqual((rc, outputs["apply"]), (1, "false"), out)


class PreflightTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="tfp-pre-")
        self.write("infra/envs/prod/.terraform.lock.hcl", LOCK_AWS)
        self.write("infra/envs/prod/main.tf", 'module "api" {\n  source = "../../modules/api"\n\n  name = "x"\n}\n')
        self.write("infra/modules/api/main.tf", 'resource "aws_sqs_queue" "q" {\n  name = "q"\n}\n')

    def tearDown(self):
        shutil.rmtree(self.dir, ignore_errors=True)

    def write(self, path, text):
        full = os.path.join(self.dir, path)
        os.makedirs(os.path.dirname(full), exist_ok=True)
        with open(full, "w") as handle:
            handle.write(text)

    def problems(self):
        return " / ".join(tfp.preflight(self.dir))

    def test_clean_tree_passes(self):
        self.assertEqual(self.problems(), "")
        rc, out = capture(tfp.run_preflight, self.dir)
        self.assertEqual(rc, 0, out)
        self.assertIn("PREFLIGHT OK", out)

    def test_the_repository_passes(self):
        self.assertEqual(tfp.preflight(str(REPO_ROOT)), [])

    def test_providers_other_than_aws_are_refused(self):
        self.write("infra/envs/prod/.terraform.lock.hcl", LOCK_AWS + 'provider "registry.terraform.io/hashicorp/external" {\n}\n')
        self.assertIn("lists provider registry.terraform.io/hashicorp/external", self.problems())
        os.remove(os.path.join(self.dir, "infra/envs/prod/.terraform.lock.hcl"))
        self.assertIn("is missing", self.problems())
        self.write("infra/envs/prod/.terraform.lock.hcl", "# nothing\n")
        self.assertIn("lists no provider", self.problems())

    def test_code_that_runs_is_refused(self):
        cases = {
            'resource "terraform_data" "x" {\n  provisioner "local-exec" {\n    command = "id"\n  }\n}\n': "provisioner",
            'resource null_resource x {\n  provisioner local-exec {\n    command = "id"\n  }\n}\n': "provisioner",
            'data "aws_lambda_invocation" "x" {\n  function_name = "f"\n  input = "{}"\n}\n': "aws_lambda_invocation",
            'ephemeral "aws_lambda_invocation" "x" {\n}\n': "aws_lambda_invocation",
            'resource aws_lambda_invocation x {\n}\n': "aws_lambda_invocation",
            'action "aws_lambda_invoke" "x" {\n  config {\n    function_name = "f"\n  }\n}\n': "action block",
            'module "m" {\n  source = "git::https://example.com/m.git"\n}\n': "outside this repository",
            'module "m" {\n  source = "terraform-aws-modules/vpc/aws"\n}\n': "outside this repository",
            'module "m" {\n  source = local.where\n}\n': "no plain string source",
        }
        for text, want in cases.items():
            self.write("infra/modules/api/extra.tf", text)
            self.assertIn(want, self.problems(), text)
        self.write("infra/modules/api/extra.tf", "x")
        self.write("infra/modules/api/extra.tf.json", '{"resource": {}}')
        self.assertIn("JSON configuration", self.problems())

    def test_lookalikes_pass(self):
        self.write("infra/modules/api/extra.tf", (
            '# provisioner "local-exec" { is never used here\n'
            'resource "aws_wafv2_web_acl" "w" {\n  default_action {\n    allow {}\n  }\n  rule {\n    action {\n'
            '      block {}\n    }\n  }\n}\n'
            'resource "aws_s3_object" "o" {\n  source = "${path.module}/x.txt"\n}\n'
            'module "inner" {\n  source = "./inner"\n}\n'))
        # Terraform's own module cache is not configuration.
        self.write("infra/envs/prod/.terraform/modules/x/main.tf", 'resource "a" "b" {\n  provisioner "local-exec" {}\n}\n')
        self.assertEqual(self.problems(), "")

    def test_run_preflight_reports_errors(self):
        self.write("infra/modules/api/extra.tf", 'data "aws_lambda_invocation" "x" {\n}\n')
        rc, out = capture(tfp.run_preflight, self.dir)
        self.assertEqual(rc, 1, out)
        self.assertIn("::error::PREFLIGHT infra/modules/api/extra.tf", out)


class PrCheckPreflightTest(InRepo):
    def test_pull_request_with_a_provisioner_fails(self):
        self.repo.git("checkout", "-q", "-b", "pr")
        self.repo.commit({"infra/modules/api/x.tf": 'resource "terraform_data" "x" {\n  provisioner "local-exec" {\n'
                                                    '    command = "id"\n  }\n}\n',
                          "docs/delivery/r99/X.plan-allow.json": {"changes": {"module.api.terraform_data.x": "create"}}})
        rc, out = capture(tfp.pr_check, "main")
        self.assertEqual(rc, 1, out)
        self.assertIn("PREFLIGHT", out)
        self.assertNotIn("PR CHECK OK", out)


class StaleMoreTest(StaleTest):
    def stale_with(self, conclusion, jobs):
        return capture(tfp.stale, self.old, REPO, "9", self.api([self.run_entry(7, self.new, conclusion=conclusion)],
                                                                   {"7": jobs}))

    def test_an_apply_under_a_red_second_plan_counts(self):
        rc, out = self.stale_with("failure", self.applied("failure", "success"))
        self.assertEqual(rc, 1, out)

    def test_an_apply_that_failed_part_way_counts(self):
        rc, out = self.stale_with("failure", self.applied("failure", "failure"))
        self.assertEqual(rc, 1, out)

    def test_a_cancelled_apply_counts(self):
        rc, out = self.stale_with("cancelled", self.applied("cancelled", "cancelled"))
        self.assertEqual(rc, 1, out)

    def test_an_earlier_attempt_counts(self):
        # Attempt 1 applied and went red on the second plan; attempt 2 (a re-run) stopped at the gate.
        rc, out = self.stale_with("failure", self.applied("failure", "success") + self.applied("failure", "skipped"))
        self.assertEqual(rc, 1, out)

    def test_an_empty_plan_confirmed_in_sync_counts(self):
        rc, out = self.stale_with("success", self.applied("success", "skipped"))
        self.assertEqual(rc, 1, out)

    def test_the_queries(self):
        api = self.api([self.run_entry(7, self.new)], {"7": self.applied()})
        capture(tfp.stale, self.old, REPO, "9", api)
        self.assertNotIn("status=", api.calls[0])
        self.assertIn("per_page=100", api.calls[0])
        self.assertIn("filter=all", api.calls[1])


def policy(*statements):
    return json.dumps({"Version": "2012-10-17", "Statement": list(statements)})


SERVICE_TRUST = trust({"Service": "lambda.amazonaws.com"})


class GuardMoreTest(unittest.TestCase):
    def guard(self, *entries, configuration=None):
        p = plan(*entries)
        if configuration is not None:
            p["configuration"] = configuration
        return tfp.guard(p)

    def moved(self, address, previous, actions=("no-op",), **kw):
        entry = resource(address, list(actions), **kw)
        entry["previous_address"] = previous
        return entry

    def test_moves_out_of_and_into_module_operators_are_refused(self):
        rc, counts, refusals, _ = self.guard(self.moved("aws_iam_role_policy.ops",
                                                        "module.operators.aws_iam_role_policy.gha_infra_deny",
                                                        ("update",), before={"name": "a"}, after={"name": "b"}))
        self.assertEqual(rc, 1)
        self.assertIn("moved from module.operators", refusals[0][1])
        rc, counts, refusals, _ = self.guard(self.moved("module.operators.aws_iam_role.x", "module.identity.aws_iam_role.x"))
        self.assertEqual((rc, counts["moved"]), (1, 1))

    def test_a_routine_move_needs_an_apply(self):
        p = plan(self.moved("module.api.aws_sqs_queue.new", "module.api.aws_sqs_queue.old"))
        rc, counts, refusals, _ = tfp.guard(p)
        self.assertEqual((rc, counts["moved"], counts["effective"]), (0, 1, 0))
        with tempfile.TemporaryDirectory() as tmp:
            path, out_file = os.path.join(tmp, "plan.json"), os.path.join(tmp, "out")
            with open(path, "w") as handle:
                json.dump(p, handle)
            rc, out = capture(tfp.run_guard, path, out_file)
            with open(out_file) as handle:
                self.assertEqual(handle.read(), "apply_needed=true\n")
        self.assertIn("moved=1", out)

    def test_escalating_grants_are_refused(self):
        bad = [
            {"Effect": "Allow", "Action": "*", "Resource": "*"},
            {"Effect": "Allow", "Action": ["iam:*"], "Resource": "arn:aws:iam::1:role/x"},
            {"Effect": "Allow", "Action": "IAM:PutRolePolicy", "Resource": "arn:aws:iam::1:role/x"},
            {"Effect": "Allow", "Action": "iam:Put*", "Resource": "arn:aws:iam::1:role/x"},
            {"Effect": "Allow", "Action": "iam:CreateRole", "Resource": "arn:aws:iam::1:role/x"},
            {"Effect": "Allow", "Action": "sts:AssumeRole", "Resource": "*"},
            {"Effect": "Allow", "Action": "sts:Assume*", "NotResource": "arn:aws:iam::1:role/x"},
            {"Effect": "Allow", "Action": "iam:PassRole", "Resource": ["arn:aws:iam::1:role/x", "*"]},
            {"Effect": "Allow", "NotAction": "s3:*", "Resource": "*"},
            {"Action": "*", "Resource": "*"},
        ]
        for st in bad:
            for rtype in tfp.POLICY_TYPES:
                rc, _, refusals, _ = self.guard(resource("module.identity.%s.p" % rtype, ["create"], rtype=rtype,
                                                         after={"policy": policy({"Effect": "Allow", "Action": "s3:GetObject",
                                                                                  "Resource": "*"}, st)}))
                self.assertEqual(rc, 1, (rtype, st))
            rc, _, refusals, _ = self.guard(resource("module.identity.aws_iam_role.r", ["update"],
                                                     before={"assume_role_policy": SERVICE_TRUST},
                                                     after={"assume_role_policy": SERVICE_TRUST,
                                                            "inline_policy": [{"name": "x", "policy": policy(st)}]}))
            self.assertEqual(rc, 1, st)
            self.assertIn("inline_policy", refusals[0][1])

    def test_ordinary_grants_pass(self):
        ok = policy({"Effect": "Allow", "Action": ["sqs:SendMessage"], "Resource": ["arn:aws:sqs:ap-southeast-2:1:q"]},
                    {"Effect": "Allow", "Action": ["ec2:CreateNetworkInterface"], "Resource": "*"},
                    {"Effect": "Allow", "Action": "sts:AssumeRole", "Resource": "arn:aws:iam::1:role/scoped"},
                    {"Effect": "Allow", "Action": "iam:PassRole", "Resource": "arn:aws:iam::1:role/scheduler"},
                    {"Effect": "Allow", "Action": ["iam:GetRole", "iam:ListRoles"], "Resource": "*"},
                    {"Effect": "Deny", "Action": "*", "Resource": "*"})
        rc, _, refusals, unchecked = self.guard(
            resource("module.identity.aws_iam_role_policy.p", ["update"], before={"policy": "{}"}, after={"policy": ok}),
            resource("module.identity.aws_iam_policy.p", ["create"], after={"policy": ok}),
            resource("module.identity.aws_iam_role_policy_attachment.rds", ["create"],
                     after={"policy_arn": "arn:aws:iam::aws:policy/service-role/AmazonRDSEnhancedMonitoringRole"}),
            resource("module.identity.aws_iam_role_policy.gone", ["delete"],
                     before={"policy": policy({"Effect": "Allow", "Action": "*", "Resource": "*"})}))
        self.assertEqual((rc, refusals, unchecked), (0, [], []))

    def test_admin_attachments_are_refused(self):
        cases = [("aws_iam_role_policy_attachment", {"policy_arn": "arn:aws:iam::aws:policy/AdministratorAccess"}),
                 ("aws_iam_policy_attachment", {"policy_arn": "arn:aws:iam::aws:policy/IAMFullAccess"}),
                 ("aws_iam_role_policy_attachments_exclusive", {"policy_arns": ["arn:aws:iam::aws:policy/PowerUserAccess"]}),
                 ("aws_iam_role", {"assume_role_policy": SERVICE_TRUST,
                                   "managed_policy_arns": ["arn:aws:iam::aws:policy/AdministratorAccess"]})]
        for rtype, after in cases:
            rc, _, refusals, _ = self.guard(resource("module.identity.%s.x" % rtype, ["create"], rtype=rtype, after=after))
            self.assertEqual(rc, 1, rtype)
            self.assertIn("attaches the AWS managed policy", refusals[0][1])

    def test_unknown_policies_are_named_not_refused(self):
        entry = resource("module.identity.aws_iam_role_policy.new_queue", ["create"], after={},
                         unknown={"policy": True})
        rc, _, refusals, unchecked = self.guard(entry)
        self.assertEqual((rc, refusals, unchecked), (0, [], [("module.identity.aws_iam_role_policy.new_queue", "policy")]))
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "plan.json")
            with open(path, "w") as handle:
                json.dump(plan(entry), handle)
            rc, out = capture(tfp.run_guard, path)
        self.assertEqual(rc, 0)
        self.assertIn("::warning::UNCHECKED module.identity.aws_iam_role_policy.new_queue: its policy", out)
        self.assertIn("unchecked=1", out)

    def test_a_new_role_with_computed_inline_policies_is_not_unchecked(self):
        rc, _, refusals, unchecked = self.guard(resource(
            "module.identity.aws_iam_role.new", ["create"], after={"assume_role_policy": SERVICE_TRUST},
            unknown={"inline_policy": True, "managed_policy_arns": True, "arn": True}))
        self.assertEqual((rc, refusals, unchecked), (0, [], []))
        rc, _, _, unchecked = self.guard(resource(
            "module.identity.aws_iam_role.new", ["create"],
            after={"assume_role_policy": SERVICE_TRUST, "inline_policy": [{"name": "x"}]},
            unknown={"inline_policy": [{"policy": True}]}))
        self.assertEqual((rc, unchecked), (0, [("module.identity.aws_iam_role.new", "inline_policy")]))

    def test_deferred_policy_documents_are_checked(self):
        def doc(actions):
            return resource("module.identity.data.aws_iam_policy_document.d", ["read"], mode="data",
                            rtype="aws_iam_policy_document",
                            after={"statement": [{"effect": "Allow", "actions": actions, "resources": None}]})
        rc, _, refusals, _ = self.guard(doc(["iam:*"]))
        self.assertEqual(rc, 1)
        rc, _, _, _ = self.guard(doc(["sqs:SendMessage"]))
        self.assertEqual(rc, 0)

    def test_configuration_that_runs_code_is_refused(self):
        configuration = {"root_module": {
            "resources": [{"address": "aws_sqs_queue.q", "mode": "managed", "type": "aws_sqs_queue"}],
            "module_calls": {"api": {"module": {
                "resources": [{"address": "terraform_data.x", "mode": "managed", "type": "terraform_data",
                               "provisioners": [{"type": "local-exec"}]}],
                "module_calls": {"inner": {"module": {"resources": [
                    {"address": "data.aws_lambda_invocation.i", "mode": "data", "type": "aws_lambda_invocation"}]}}}}}}}}
        rc, _, refusals, _ = self.guard(configuration=configuration)
        self.assertEqual(rc, 1)
        self.assertEqual([a for a, _ in refusals], ["module.api.terraform_data.x",
                                                    "module.api.module.inner.data.aws_lambda_invocation.i"])

    def test_a_refusal_never_prints_policy_text(self):
        secret = "s3cr3t-sid-0123"
        p = plan(resource("module.identity.aws_iam_policy.p", ["create"],
                          after={"policy": policy({"Sid": secret, "Effect": "Allow", "Action": "*", "Resource": "*"})}))
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "plan.json")
            with open(path, "w") as handle:
                json.dump(p, handle)
            rc, out = capture(tfp.run_guard, path)
        self.assertEqual(rc, 1)
        self.assertIn("REFUSED module.identity.aws_iam_policy.p", out)
        self.assertNotIn(secret, out)


# ── the workflow's step bodies, run the way GitHub runs them (bash -e, pipefail) with stubbed tools ──────────

STUB = """#!/bin/sh
# Records its arguments, then behaves as $STUB_<TOOL> says.
echo "$(basename "$0") $*" >> "$STUB_LOG"
case "$(basename "$0")" in
  python3)
    case "$STUB_PYTHON" in
      fail) echo "PLAN VIOLATION: unlisted create aws_sqs_queue.q" >&2; exit 1 ;;
      empty) echo "PLAN EMPTY"; exit 0 ;;
      *) echo "aws_sqs_queue.q  create  -"; echo "PLAN OK 1"; exit 0 ;;
    esac ;;
  terraform)
    case "$*" in
      *"state push"*) [ "$STUB_PUSH" = ok ] && exit 0; echo "Error: cannot push" >&2; exit 1 ;;
      *show*) echo "{}" ;;
    esac
    exit 0 ;;
  aws) [ "$STUB_AWS" = ok ] && exit 0; exit 1 ;;
esac
"""


def step_body(text, name):
    """The `run: |` body of the step called NAME (first match in TEXT), dedented."""
    lines = text.splitlines()
    for i, line in enumerate(lines):
        if re.match(r"^\s+(?:- )?name: " + re.escape(name) + r"$", line):
            break
    else:
        raise AssertionError("no step named " + name)
    for j in range(i + 1, len(lines)):
        m = re.match(r"^(\s+)run: \|$", lines[j])
        if m:
            indent = len(m.group(1))
            body = []
            for line in lines[j + 1:]:
                if line.strip() and len(line) - len(line.lstrip()) <= indent:
                    break
                body.append(line[indent + 2:])
            return "\n".join(body) + "\n"
        if re.match(r"^\s+- ", lines[j]):
            break
    raise AssertionError("step " + name + " has no run block")


class StepBodyTest(unittest.TestCase):
    def setUp(self):
        self.text = WORKFLOW.read_text()
        self.jobs = jobs_of(self.text)
        self.tmp = tempfile.mkdtemp(prefix="tfp-step-")
        self.bin = os.path.join(self.tmp, "bin")
        self.work = os.path.join(self.tmp, "work")
        self.runner_temp = os.path.join(self.tmp, "runner")
        for d in (self.bin, self.work, os.path.join(self.runner_temp, "tf")):
            os.makedirs(d)
        for tool in ("python3", "terraform", "aws"):
            path = os.path.join(self.bin, tool)
            with open(path, "w") as handle:
                handle.write(STUB)
            os.chmod(path, 0o755)
        self.summary = os.path.join(self.tmp, "summary.md")
        self.log = os.path.join(self.tmp, "stub.log")

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def run_step(self, job, name, **env):
        script = os.path.join(self.tmp, "step.sh")
        with open(script, "w") as handle:
            handle.write(step_body(self.jobs[job], name))
        full = {"PATH": self.bin + os.pathsep + os.environ["PATH"], "RUNNER_TEMP": self.runner_temp,
                "GITHUB_STEP_SUMMARY": self.summary, "GITHUB_SHA": "a" * 40, "GITHUB_RUN_ID": "11",
                "GITHUB_RUN_ATTEMPT": "2", "STUB_LOG": self.log, "ALLOW": "", "TF_VAR_alert_email": "x@example.invalid"}
        full.update(env)
        proc = subprocess.run(["bash", "--noprofile", "--norc", "-eo", "pipefail", script], cwd=self.work, env=full,
                              stdout=subprocess.PIPE, stderr=subprocess.STDOUT, universal_newlines=True)
        return proc.returncode, proc.stdout

    def tf(self, name):
        return os.path.join(self.runner_temp, "tf", name)

    def read(self, path):
        try:
            with open(path) as handle:
                return handle.read()
        except OSError:
            return ""

    def test_gate_prints_the_violation_and_fails(self):
        for allow in ("", "docs/delivery/r99/X.plan-allow.json"):
            rc, out = self.run_step("apply", "the plan must match the allow-list (check-plan.py)", STUB_PYTHON="fail",
                                    ALLOW=allow)
            self.assertEqual(rc, 1, out)
            self.assertIn("PLAN VIOLATION: unlisted create aws_sqs_queue.q", out)
        rc, out = self.run_step("apply", "the plan must match the allow-list (check-plan.py)", STUB_PYTHON="ok",
                                ALLOW="docs/delivery/r99/X.plan-allow.json")
        self.assertEqual(rc, 0, out)
        self.assertIn("PLAN OK 1", out)

    def test_second_plan_prints_the_violation_and_fails(self):
        rc, out = self.run_step("apply", "the second plan must be empty", STUB_PYTHON="fail")
        self.assertEqual(rc, 1, out)
        self.assertIn("PLAN VIOLATION: unlisted create aws_sqs_queue.q", out)
        rc, out = self.run_step("apply", "the second plan must be empty", STUB_PYTHON="empty")
        self.assertEqual(rc, 0, out)
        self.assertIn("PLAN EMPTY", out)

    def test_plan_only_writes_the_drift_report_and_fails(self):
        rc, out = self.run_step("plan", "main and AWS must agree (check-plan.py, no allow file)", STUB_PYTHON="fail")
        self.assertEqual(rc, 1, out)
        self.assertIn("PLAN VIOLATION", out)
        summary = self.read(self.summary)
        self.assertIn("Drift or unapplied changes", summary)
        self.assertIn("    PLAN VIOLATION: unlisted create aws_sqs_queue.q", summary)

    def test_preflight_passes_allow_paths_without_globbing(self):
        os.makedirs(os.path.join(self.work, "docs/delivery/x"))
        for name in ("A", "OLD"):
            with open(os.path.join(self.work, "docs/delivery/x/%s.plan-allow.json" % name), "w") as handle:
                handle.write("{}")
        rc, out = self.run_step("apply", "preflight (no credentials yet)",
                                ALLOW="docs/delivery/x/A.plan-allow.json docs/delivery/x/*.plan-allow.json")
        self.assertEqual(rc, 0, out)
        calls = self.read(self.log).splitlines()
        self.assertIn("python3 infra/scripts/tf-pipeline.py preflight", calls)
        combine = [c for c in calls if " combine " in c]
        self.assertEqual(combine, ["python3 infra/scripts/tf-pipeline.py combine --out %s "
                                   "docs/delivery/x/A.plan-allow.json docs/delivery/x/*.plan-allow.json"
                                   % self.tf("allow.json")])

    def test_summary_survives_every_state(self):
        name = "job summary"
        base = {"GUARD": "success", "GATE": "success", "APPLY": "success", "SECOND": "failure", "NEEDED": "true"}
        # A red second plan with violations: the count, not an aborted step.
        with open(self.tf("second.txt"), "w") as handle:
            handle.write("PLAN VIOLATION: unexpected update aws_sqs_queue.q\n")
        with open(self.tf("gate.txt"), "w") as handle:
            handle.write("aws_sqs_queue.q  update  tags\n")  # no PLAN / SUMMARY line
        rc, out = self.run_step("apply", name, **base)
        self.assertEqual(rc, 0, out)
        summary = self.read(self.summary)
        self.assertIn("**NOT EMPTY**: 1 unexpected change(s), listed in the log", summary)
        self.assertIn("| `aws_sqs_queue.q` | update | tags |", summary)
        # A second plan that printed something but no violation line (a usage error): grep -c finds 0.
        with open(self.tf("second.txt"), "w") as handle:
            handle.write("usage\n")
        rc, out = self.run_step("apply", name, **base)
        self.assertEqual(rc, 0, out)
        self.assertIn("**NOT EMPTY**: 0 unexpected change(s)", self.read(self.summary))
        # Nothing ran at all.
        for f in ("second.txt", "gate.txt"):
            os.remove(self.tf(f))
        rc, out = self.run_step("apply", name, GUARD="", GATE="", APPLY="", SECOND="", NEEDED="")
        self.assertEqual(rc, 0, out)
        # The state recovery line.
        with open(self.tf("recovery.txt"), "w") as handle:
            handle.write("errored.tfstate pushed\n")
        rc, out = self.run_step("apply", name, **base)
        self.assertEqual(rc, 0, out)
        self.assertIn("- **state**: errored.tfstate pushed", self.read(self.summary))

    def test_errored_state_is_pushed_or_kept(self):
        name = "save the state if Terraform could not (errored.tfstate)"
        rc, out = self.run_step("apply", name)
        self.assertEqual(rc, 0, out)
        self.assertIn("no errored.tfstate", out)
        errored = os.path.join(self.work, "infra/envs/prod/errored.tfstate")
        os.makedirs(os.path.dirname(errored))
        for push, aws, want in (("ok", "", "errored.tfstate pushed"),
                                ("", "ok", "recovery/errored-11-2.tfstate"),
                                ("", "", "could not be pushed or kept")):
            with open(errored, "w") as handle:
                handle.write('{"secret": "value-0123"}')
            rc, out = self.run_step("apply", name, STUB_PUSH=push, STUB_AWS=aws)
            self.assertEqual(rc, 1, out)
            self.assertIn(want, out)
            self.assertIn(want, self.read(self.tf("recovery.txt")))
            self.assertFalse(os.path.exists(errored))
            self.assertNotIn("value-0123", out)
        calls = self.read(self.log)
        self.assertIn("terraform -chdir=infra/envs/prod state push -no-color -lock-timeout=10m errored.tfstate", calls)
        self.assertIn("aws s3 cp infra/envs/prod/errored.tfstate s3://recallsmith-tfstate-622994489535/recovery/", calls)
        self.assertNotIn("-force", calls)


class WorkflowMoreFactsTest(unittest.TestCase):
    def setUp(self):
        self.text = WORKFLOW.read_text()
        self.jobs = jobs_of(self.text)

    def test_no_bare_exit_code_capture(self):
        # Under bash -e a failing command never reaches a bare `rc=$?` on the next line.
        for n, line in enumerate(self.text.splitlines(), 1):
            if "rc=$?" in line and not line.lstrip().startswith("#"):
                self.assertIn("|| rc=$?", line, "terraform.yml line %d" % n)

    def test_apply_step_name_matches_the_stale_check(self):
        self.assertIn("\n        name: %s\n" % tfp.APPLY_STEP, self.jobs["apply"])

    def test_preflight_runs_before_credentials_everywhere(self):
        select = self.jobs["select"]
        self.assertTrue(before(select, "tf-pipeline.py preflight", "tf-pipeline.py select --before"))
        for job in ("apply", "plan"):
            self.assertTrue(before(self.jobs[job], "tf-pipeline.py preflight", "configure-aws-credentials"), job)

    def test_errored_state_is_handled_before_cleanup_and_never_uploaded(self):
        apply = self.jobs["apply"]
        self.assertIn("      - id: recover\n", apply)
        self.assertIn("steps.recover.outcome == 'failure'", apply)
        self.assertTrue(before(apply, "      - id: recover\n", "name: delete the plans and logs"))
        self.assertTrue(before(apply, "      - id: recover\n", "name: job summary"))
        recover = apply[apply.index("id: recover"):apply.index("name: what Terraform reported")]
        self.assertIn("if: always()", recover)
        self.assertIn('> "$RUNNER_TEMP/tf/state-push.log" 2>&1', recover)
        self.assertNotIn("-force", recover)
        self.assertIn("errored.tfstate", self.jobs["apply"].split("name: delete the plans and logs", 1)[1])
        self.assertNotIn("upload-artifact", self.text)


class GhaInfraDenyReadsTest(GhaInfraRoleTest):
    # Refresh reads of the types module.operators and the rest of envs/prod manage, plus the backend's own calls.
    REFRESH_READS = [
        "iam:GetOpenIDConnectProvider", "iam:ListOpenIDConnectProviders", "iam:ListOpenIDConnectProviderTags",
        "iam:GetRole", "iam:GetRolePolicy", "iam:ListRolePolicies", "iam:ListAttachedRolePolicies", "iam:ListRoleTags",
        "iam:ListInstanceProfilesForRole", "iam:GetPolicy", "iam:GetPolicyVersion", "iam:ListPolicyVersions",
        "iam:ListPolicyTags", "iam:GetUser", "iam:ListGroups", "iam:ListMFADevices", "iam:GetSAMLProvider",
        "cloudtrail:GetTrail", "cloudtrail:DescribeTrails", "cloudtrail:GetTrailStatus", "cloudtrail:GetEventSelectors",
        "cloudtrail:GetInsightSelectors", "cloudtrail:ListTags", "s3:GetBucketPolicy", "s3:GetBucketVersioning",
        "s3:GetLifecycleConfiguration", "s3:GetBucketAcl", "s3:GetObject", "s3:ListBucket", "sts:GetCallerIdentity",
    ]
    BACKEND = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:ListBucket"]

    def matches(self, patterns, action):
        return any(fnmatch.fnmatchcase(action.lower(), p.lower()) for p in patterns)

    def test_no_deny_blocks_a_refresh_read(self):
        for sid, (patterns, _) in self.statements().items():
            for action in self.REFRESH_READS:
                self.assertFalse(self.matches(patterns, action), "%s denies %s" % (sid, action))

    def test_credential_deny_names_write_actions_only(self):
        patterns = self.statements()["NoStaticOrHumanCredentials"][0]
        for p in patterns:
            if p.startswith("iam:"):
                self.assertNotIn("*", p, p)
                self.assertFalse(p.startswith(("iam:Get", "iam:List")), p)

    def test_no_role_hopping(self):
        patterns, resources = self.statements()["NoRoleHopping"]
        self.assertTrue(self.matches(patterns, "sts:AssumeRole"))
        self.assertEqual(resources.split("#")[0].strip(), '["*"]')
        for sid, (patterns, _) in self.statements().items():
            for action in ("sts:AssumeRoleWithWebIdentity", "sts:GetCallerIdentity"):
                self.assertFalse(self.matches(patterns, action), (sid, action))
        for path in ("providers.tf", "backend.tf", "versions.tf"):
            text = (REPO_ROOT / "infra" / "envs" / "prod" / path).read_text()
            self.assertNotIn("assume_role", text, path)
            self.assertNotIn("role_arn", text, path)

    def test_state_versions_are_kept_and_the_backend_still_works(self):
        patterns, resources = self.statements()["KeepStateVersions"]
        self.assertEqual(resources.strip(), '["${local.state_bucket_arn}/*"]')
        self.assertTrue(self.matches(patterns, "s3:DeleteObjectVersion"))
        for sid in ("KeepStateHistory", "KeepStateVersions"):
            for action in self.BACKEND:
                self.assertFalse(self.matches(self.statements()[sid][0], action), (sid, action))

    def test_the_header_comment_names_what_it_does_not_stop(self):
        self.assertNotIn("can never mint a way in that outlives the job", self.main)
        self.assertIn("What it does not stop", self.main)


class CliTest(unittest.TestCase):
    def test_usage(self):
        proc = subprocess.run([sys.executable, str(SCRIPT)], stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                              universal_newlines=True)
        self.assertEqual(proc.returncode, 2)


if __name__ == "__main__":
    unittest.main()
