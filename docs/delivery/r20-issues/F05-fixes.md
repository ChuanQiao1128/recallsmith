# F05 fixes: R20 review findings for infra/CI (V12, V13)

Issue #586, R20X fix round, wave P. Scope: `.github/workflows/ci.yml`, `infra/**`,
`docs/delivery/r20-issues/{V12,V13,F05}-*`. CI and a stdlib script only. Nothing was planned,
applied or deployed, no AWS call was made, and no model was called. `evals/` was not changed
(another wave owns it).

Each finding was confirmed against the code first. The new tests in
`infra/scripts/tests/test_check_gate_freshness.py` were run against the unchanged script and
failed (47 tests: 4 failures, 14 errors), then passed after the fix (47 OK).

### p-correctness-1

Status: fixed

Confirmed: `header_mismatches` compares only the version label, and nothing linked the label to
the prompt text. A rewritten SYSTEM_PROMPT under `qa-v4` matched an old qa-v4 run.

Fix (as the supervisor asked, no `evals/` change): `infra/scripts/check-gate-freshness.py`
`prompt_bump_problems()` parses prompts.py at the merge base and at HEAD with `ast`. It drops the
docstring, and comments are not in the AST, then compares:
- every top-level statement except the version labels and the automation-only names
  (`AUTOMATION_ADDENDUM`, `SYSTEM_PROMPT_AUTOMATION`). A change there needs both
  `PROMPT_VERSION` and `PROMPT_VERSION_AUTOMATION` bumped, because the automation prompt is
  `SYSTEM_PROMPT + AUTOMATION_ADDENDUM`.
- the automation-only names. A change there needs `PROMPT_VERSION_AUTOMATION` bumped.

Only labels that exist at HEAD are required. A prompts.py that does not parse is exit 2. This
rule fails with exit 1 whether AI QA is on or off, because turning AI QA on later would match the
old label.

Tests: `PromptBumpProblemsTest` (9 cases, including the real prompts.py with one changed word),
`EvaluateTest.test_prompt_problems_fail_even_with_ai_qa_off`,
`MainInGitRepoTest.test_prompt_text_change_without_version_bump_fails` (the reviewer's scenario:
AI QA on, a committed qa-v4 run that passes the gate, SYSTEM_PROMPT rewritten, exit 1), and
`test_prompt_comment_change_with_matching_evidence_passes`.

### p-correctness-2

Status: fixed

Confirmed: `evals_shipping_config` called `json.loads(result.stdout)` bare, and `main` caught only
`UsageError`, so a warning line on stdout meant a traceback and exit 1.

Fix: `infra/scripts/check-gate-freshness.py` turns a `ValueError` into `UsageError("shipping config
is not JSON: ...")`. It also raises `UsageError` when the result is not a JSON object or lacks one
of the five MATCH_KEYS. All of these are exit 2.

Tests: `EvalsShippingConfigTest` (valid object; empty stdout and a warning line before the JSON;
a list, a string and an incomplete object) and `MainInGitRepoTest.test_non_json_shipping_config_exits_2`
(end to end with the uv call faked: exit 2 and "not JSON" on stderr).

### p-security-1

Status: fixed

Confirmed: `TRIGGER_PATHS` was only the env file and prompts.py. `shipping_config()` also depends on
`ai_qa.settings` and `ai_qa.providers`, and the prompt pair in use comes from `ai_qa/profiles.py`.
The prompt-text part of this finding is the same as p-correctness-1.

Fix: `infra/scripts/check-gate-freshness.py` triggers on the env file or on any file under
`services/ai-qa/src/ai_qa/` (`AI_QA_SRC`, `is_trigger()`), as the supervisor asked. It adds the
prompt bump rule from p-correctness-1.

Tests: `EvaluateTest.test_any_ai_qa_package_change_triggers` (settings.py, providers.py,
profiles.py, handler.py and prompts.py each fail with AI QA on and no evidence), plus the
p-correctness-1 tests. `test_unrelated_change_counts_as_unchanged` now uses paths outside the
package (`services/ai-qa/tests/...`, `services/ai-qa/README.md`, `README.md`). Before, it used
`ai_qa/handler.py`, which is now a trigger by design.

Remaining: `evals/src/dc_evals/score.py` (`shipping_config` itself) is not a trigger. Adding
`evals/` would make every evals PR a trigger. It is documented in infra/README.md §3.

### p-security-2

Status: fixed

Confirmed: on push, `github.base_ref` is empty, so the base was `origin/main`. On main, the merge
base is HEAD and the diff is empty. `MainInGitRepoTest.test_push_to_main_with_merge_base_of_main_sees_nothing`
records this behaviour of `--base main`.

Fix:
- `infra/scripts/check-gate-freshness.py` has a new `--before SHA`, mutually exclusive with
  `--base`. It compares with that commit. It falls back to `HEAD~1` when SHA is empty, all zeros
  (the first push of a branch) or not in the clone (a force push). It prints the base it used.
- `.github/workflows/ci.yml` uses `--base origin/<base_ref>` on `pull_request` and
  `--before "$BEFORE_SHA"` (`github.event.before`) on every other event. Both values go through
  `env`.

Tests: `test_push_compares_with_the_before_commit` (a push to main that enables AI QA with no
evidence is exit 1), `test_push_without_usable_before_falls_back_to_the_parent` (empty, all
zeros, unknown sha) and `test_base_and_before_are_exclusive`. The old script failed these: it had
no `--before`.

Owner step (not code): add the `python` job to the required checks for PRs into main. Branch
protection is outside this repo.

### p-tests-1

Status: fixed

Confirmed: the `infra` job ran fmt, init and validate on `infra/envs/prod` only.

Fix: `.github/workflows/ci.yml` `infra` job now runs
`terraform -chdir=infra/modules/observability init -backend=false -input=false`, then
`terraform -chdir=infra/modules/observability test`. The lock that init writes in the module
directory is never committed from CI. Corrected V12-notes.md and infra/README.md, which implied
the test was enforced.

Test: run locally on a scratch copy of the module with terraform 1.16.3: `init` then `test`
gives "Success! 2 passed, 0 failed". `actionlint .github/workflows/ci.yml` is clean.

### p-tests-2

Status: fixed

Confirmed: same root cause as p-security-1. No test covered a settings.py or providers.py change.

Fix: the same `AI_QA_SRC` trigger. The script docstring, infra/README.md §3 and V13-notes.md now
describe the real trigger set.

Tests: `MainInGitRepoTest.test_providers_change_with_ai_qa_on_needs_evidence`. AI QA is on at the
base, and a PR flips `structured_outputs_on` in providers.py: exit 1, where the old script printed
"unchanged". Also `EvaluateTest.test_any_ai_qa_package_change_triggers`.

### p-tests-3

Status: fixed

Confirmed: every test injected `load_shipping` and `run_gate`.

Fix: `infra/scripts/tests/test_check_gate_freshness.py` `RealEvalsWiringTest`, skipped when `uv`
is not on PATH. In CI it runs, because the `python` job installs uv and has already synced the
evals venv in the step before.
- `test_shipping_config_has_every_match_key` runs the real `evals_shipping_config(repo root)`.
- `test_gate_rejects_a_committed_claude_cli_run` runs the real `evals_score_gate` on the newest
  committed `claude-cli` run and expects a non-zero exit. Locally it exits 1 with "provider
  'claude-cli' is not one of ['anthropic', 'bedrock']". The test skips if no claude-cli run is
  committed.

Neither test calls a model: `dc-evals score` re-scores a committed file offline.

## Commands run

| Command | Result |
|---|---|
| `python3 -m unittest discover -s infra/scripts/tests -v` | 47 tests OK (uv present, so the real-wiring tests ran) |
| `python3 infra/scripts/check-gate-freshness.py --base HEAD` | PASS unchanged, exit 0 |
| `python3 infra/scripts/check-gate-freshness.py --before 0000000000000000000000000000000000000000` | compares with HEAD~1, PASS unchanged, exit 0 |
| `python3 infra/scripts/check-gate-freshness.py --base origin/main` | PASS unchanged, exit 0 |
| `terraform fmt -check -recursive infra` | OK |
| `terraform -chdir=<scratch copy of infra/modules/observability> init -backend=false -input=false && ... test` | 2 passed, 0 failed |
| `actionlint .github/workflows/ci.yml` | clean |
| `BASE=delivery/r20x-p bash F05.verify.sh` | F05 VERIFY OK |
