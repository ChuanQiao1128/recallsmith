# V13 notes: CI hardening (infra job) and the AI QA gate-freshness check

Issue #567, contract R20-00 §8 (Infra/CI), facts-infra.md §1, §2, §4, §5. CI and a stdlib script
only. Nothing was planned, applied or deployed, no AWS call was made, and nothing calls a model.

## What changed

| File | Change |
|---|---|
| `.github/workflows/ci.yml` | Workflow-level `permissions: contents: read`. New job `infra`. The `python` job checks out with `fetch-depth: 0` and gains two steps: the `infra/scripts/tests` unittest run and `check-gate-freshness.py`. |
| `infra/scripts/check-gate-freshness.py` (new) | The gate-freshness check. |
| `infra/scripts/tests/test_check_gate_freshness.py` (new) | 23 stdlib unittest cases: the decision logic, header parsing, and end-to-end runs against a throwaway git repository. |
| `infra/README.md` | §3 Gates: what CI runs offline. §6: a V13 change-log entry. |

`src_C/scripts/merge-env.test.sh` is unchanged: it passes as it is on Linux (ubuntu 22.04, bash 5.1, jq 1.6, in Docker), so it needed no portability fix. `merge-env.sh` is unchanged.

## Surface shipped

**CI job `infra`** (ubuntu-latest, no secrets, no AWS credentials), in order:
1. `actions/checkout@v5`
2. `hashicorp/setup-terraform@v3` with `terraform_version: 1.16.3` and `terraform_wrapper: false` (`versions.tf` requires >= 1.10)
3. `terraform fmt -check -recursive infra`
4. `terraform -chdir=infra/envs/prod init -backend=false -input=false -lockfile=readonly`. The provider comes from the public registry. With `-lockfile=readonly`, the committed lock (two `h1:` hashes, neither for linux) is checked against its `zh:` hashes and never rewritten.
5. `terraform -chdir=infra/envs/prod validate`
6. `python3 infra/scripts/check-agent-routes.py`
7. `bash -n` on `src_C/deploy.sh`, `frontend/deploy.sh`, `services/lambda-release.sh` and `src_C/scripts/merge-env.sh`
8. `bash src_C/scripts/merge-env.test.sh`

**`python` job additions:**
- `python3 -m unittest discover -s infra/scripts/tests -v`
- `python3 infra/scripts/check-gate-freshness.py --base "$BASE_REF"`, with `BASE_REF: origin/${{ github.base_ref || 'main' }}`. The ref is passed through `env`, so it is never interpolated into the shell script.

**`infra/scripts/check-gate-freshness.py`:**

```
python3 infra/scripts/check-gate-freshness.py --base REF [--repo ROOT]
```

- **Trigger.** It takes `git merge-base REF HEAD`, then `git diff --name-only <mb> HEAD` restricted to `services/ai-qa/env/prod.env.json` and `services/ai-qa/src/ai_qa/prompts.py`.
- **Neither file changed:** prints `GATE FRESHNESS PASS: unchanged ...` and exits 0.
- **A file changed, but AI QA is off:** the HEAD env (`git show HEAD:services/ai-qa/env/prod.env.json`) has `AI_QA_ENABLED` not truthy. Truthy uses the `ai_qa.settings.is_truthy` rule: trimmed `1`, or `true`/`yes` in any case. Prints `GATE FRESHNESS PASS: AI QA off ...` and exits 0.
- **A file changed and AI QA is on:**
  1. It reads the shipping config through the evals venv: `uv run --quiet --project evals --python 3.12 python -c '... dc_evals.score.shipping_config() ...'`.
  2. It lists the tracked `.jsonl` files under `evals/reports` (`git ls-files`), so untracked files do not count, and reads each file's first `"type":"run"` header.
  3. It keeps the files whose `provider`, `model`, `promptVersion`, `effort` and `structuredOutputsAtStart` equal the shipping config, and prints a `skip <file>: <why>` line for each other file.
  4. For each match it runs `uv run ... dc-evals score <file> --gate`. The report JSON goes to /dev/null and the gate reasons go to stderr.
  5. The check passes as soon as one match exits 0. It fails (exit 1) when there is no report, no match, or no match that passes the gate.
- **Exit codes:**
  - 0: pass
  - 1: fail
  - 2: usage error, an unknown ref, a HEAD env that is not a JSON object, or a failure reading the shipping config
- **Dependencies.** The script itself uses only the standard library. The evals venv is used only on the path where the check applies, which is why `verify` can run it with a bare `python3`.
- **What the gate itself adds.** `dc-evals score --gate` also checks `secondProvider`/`secondModel`, the gate provider set, the dataset and its sha, reps and the thresholds. The header match here is only a filter that picks which runs to re-score.

## How it was tested

The unit tests were written first and failed on the base (the module was missing).

| Command | Result |
|---|---|
| `python3 -m unittest discover -s infra/scripts/tests -v` | 23 tests OK, on macOS and in ubuntu:22.04 (Docker) |
| `python3 infra/scripts/check-gate-freshness.py --base HEAD` | `PASS: unchanged`, exit 0 |
| `python3 infra/scripts/check-gate-freshness.py` | argparse usage, exit 2 |
| Scratch clone with `AI_QA_ENABLED` set to `1` on a branch, `--base origin/HEAD` | Real evals venv. Shipping = bedrock / anthropic.claude-opus-5 / qa-v4 / high / false. All seven committed runs are `claude-cli` and were skipped with reasons, so FAIL, exit 1. `evals_score_gate` on the committed qa-v4 claude-cli run exits 1 with the gate reasons. |
| `terraform fmt -check -recursive infra` | OK, on macOS (1.16.3) and in `hashicorp/terraform:1.16.3` linux/amd64 |
| `terraform -chdir=infra/envs/prod init -backend=false -input=false -lockfile=readonly` then `validate` | "The configuration is valid", on macOS and on linux/amd64. The lock file is byte-identical afterwards. |
| `python3 infra/scripts/check-agent-routes.py` | `AGENT ROUTES OK ...`, on macOS and in ubuntu:22.04 |
| `bash -n` on the four scripts | OK, on macOS and in ubuntu:22.04 |
| `bash src_C/scripts/merge-env.test.sh` | `merge-env tests OK`, on macOS and in ubuntu:22.04 |
| `actionlint .github/workflows/ci.yml` | clean |
| `V13.verify.sh` | see the final report |

## Owner steps

- **Before setting `AI_QA_ENABLED=1` in `services/ai-qa/env/prod.env.json`,** or changing that file or `services/ai-qa/src/ai_qa/prompts.py` while it is on, commit a gate-provider run under `evals/reports/` that passes `dc-evals score --gate`. Without it the `python` job fails the PR. No such run exists today: all committed runs are `claude-cli` proxy runs, and Bedrock is not allowlisted yet. While AI QA stays off, the check only prints that it passes.
- **Optional:** add the `infra` job to the branch-protection required checks on `main`.

## Deferred

- **Push events to `main` compare `main` with `origin/main`.** The diff is empty there, so the check only bites on PRs and on pushes to feature branches. That is intended: the PR is where the evidence has to be.
- **The automation reviewer (`AI_QA_AUTOMATION_*`, `PROMPT_VERSION_AUTOMATION`) is not covered.** Its evidence is the `dc-evals automation-gate` pair. The issue scopes this check to the console QA shipping config, so a matching check for the automation pair is left for a later issue.
- **The terraform version pin (1.16.3) must be bumped by hand.** `fmt -check` output can change between releases, which is why it is pinned.
