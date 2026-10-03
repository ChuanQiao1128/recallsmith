"""check-lambda-runtimes.py against small Terraform trees (stdlib unittest, offline).

Run: python3 -m unittest discover -s infra/scripts/tests -v
"""

import pathlib
import subprocess
import sys
import tempfile
import unittest

SCRIPT = pathlib.Path(__file__).resolve().parents[1] / "check-lambda-runtimes.py"
REPO_INFRA = pathlib.Path(__file__).resolve().parents[2]


def run(infra, today="2026-10-03"):
    return subprocess.run([sys.executable, str(SCRIPT), "--today", today, "--infra", str(infra)],
                          capture_output=True, text=True)


class CheckLambdaRuntimesTest(unittest.TestCase):
    def tree(self, **files):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        infra = pathlib.Path(tmp.name) / "infra"
        for name, text in files.items():
            path = infra / "modules" / (name + ".tf")
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text)
        return infra

    # Pinned to the day the table was read, so this test does not age; the CI step runs on the real date.
    def test_repository_tree_passes_on_2026_10_03(self):
        result = run(REPO_INFRA)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_dotnet8_fails_inside_90_days(self):
        result = run(self.tree(fn='resource "aws_lambda_function" "f" {\n  runtime = "dotnet8"\n}\n'))
        self.assertEqual(result.returncode, 1)
        self.assertIn("dotnet8 deprecates on 2026-11-10 (38 days left", result.stdout)

    def test_dotnet10_passes(self):
        result = run(self.tree(fn='  runtime                        = "dotnet10"\n'))
        self.assertEqual(result.returncode, 0, result.stdout)

    def test_unknown_runtime_fails(self):
        result = run(self.tree(fn='  runtime = "dotnet9"\n'))
        self.assertEqual(result.returncode, 1)
        self.assertIn("dotnet9 is not in the deprecation table", result.stdout)

    def test_non_literal_runtime_fails(self):
        result = run(self.tree(fn="  runtime = var.lambda_runtime\n"))
        self.assertEqual(result.returncode, 1)
        self.assertIn("not a string literal", result.stdout)

    def test_comments_are_ignored(self):
        text = ('  runtime = "python3.12" # was "dotnet8"\n'
                '  # runtime = "dotnet8"\n'
                '  // runtime = "dotnet8"\n'
                '  /*\n  runtime = "dotnet8"\n  */\n')
        result = run(self.tree(fn=text))
        self.assertEqual(result.returncode, 0, result.stdout)
        self.assertIn("1 checked", result.stdout)

    def test_already_deprecated_fails(self):
        result = run(self.tree(fn='  runtime = "dotnet8"\n'), today="2026-12-01")
        self.assertEqual(result.returncode, 1)
        self.assertIn("already deprecated", result.stdout)

    def test_no_runtime_is_an_input_error(self):
        result = run(self.tree(fn='resource "x" "y" {}\n'))
        self.assertEqual(result.returncode, 2)


if __name__ == "__main__":
    unittest.main()
