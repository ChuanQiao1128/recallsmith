#!/usr/bin/env bash
# scripts/tests/cd-scripts.test.sh — offline tests of the CD and deploy scripts against fake `aws`, `gh` and `curl`
# (scripts/tests/stubs/) first on PATH. No network, no AWS, no credentials: every child runs under `env -i` with only
# the variables a case sets, so neither the owner's AWS_PROFILE nor a CI variable can leak in.
#
#   bash scripts/tests/cd-scripts.test.sh        # CI: job "infra"; needs bash, git, jq, python3, openssl, zip
#
# Covered: PREBUILT in src_C/deploy.sh, frontend/deploy.sh and services/deploy-python-lambda.sh (no build tool is ever
# called); the AWS_PROFILE default in all four deploy scripts (only when the environment has no credentials); secret
# masking in src_C/deploy.sh (::add-mask:: in GitHub Actions only, the environment never on a command line, an AWS
# error that quotes it never printed); a DRY_RUN console deploy calls no AWS; the local preflight in all four deploy
# scripts (clean tree, HEAD = origin/main, the push run of ci.yml green; BREAK_GLASS=1; DRY_RUN and GitHub Actions skip
# it); scripts/rollback.sh; scripts/cd/restore-point.sh record/restore/summary (same-size site changes, a partial
# deploy, failing CloudFront calls, the order of the slow part, exit 3 when nothing was recorded); scripts/smoke.sh
# (retries, the pre-deploy baseline, AccessDenied outside CD); scripts/cd/plan.sh (classify, changed, select,
# last-deployed and latest-success with forged records, still-current, decide: only commits on main, main's tip when
# green); scripts/cd/artifact.sh stage/verify (site only, exactly the expected files, tarball members); and the static
# facts of .github/workflows/cd.yml and ci.yml that a wrong edit would break (pinned actions, OIDC only where approved,
# the concurrency condition = the plan job's `if`, guards before credentials, required check names = ci.yml job names).
# Bash 3.2 compatible, like the scripts it tests.
# SC2046: deploy_cmd's words are split on purpose (VAR=value prefixes for env -i); SC2016: literal $ and backticks.
# shellcheck disable=SC2046,SC2016
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
for tool in git jq python3 openssl zip; do
  command -v "$tool" >/dev/null || { echo "cd-scripts.test.sh needs $tool" >&2; exit 1; }
done

T="$(mktemp -d "${TMPDIR:-/tmp}/cd-scripts-test.XXXXXX")"
trap 'rm -rf "$T"' EXIT
BIN="$T/bin"; MIRROR="$T/mirror"; ORIGIN="$T/origin.git"
STATE="$T/state.json"; LOG="$T/calls.jsonl"; S3="$T/s3"; GHD="$T/gh"
mkdir -p "$BIN" "$T/home" "$T/tmp" "$S3" "$GHD"
BASE_PATH="$PATH"

PASS=0; FAILED=0
ok() { PASS=$((PASS + 1)); echo "ok   $*"; }
bad() { FAILED=$((FAILED + 1)); echo "FAIL $*"; [ ! -s "$T/out" ] || sed 's/^/     out: /' "$T/out" | tail -n 15; [ ! -s "$T/err" ] || sed 's/^/     err: /' "$T/err" | tail -n 15; }
check() { local desc="$1"; shift; if "$@"; then ok "$desc"; else bad "$desc"; fi; }
has() { grep -qF -- "$2" "$1"; }          # has <file> <text>
hasnt() { ! grep -qF -- "$2" "$1"; }
calls() { grep -c -F -- "$1" "$LOG" 2>/dev/null || true; }   # calls <text> → number of logged calls containing it
none() { [ "$(calls "$1")" = 0 ]; }

# ----------------------------------------------------------------------------------------------------- stubs
cp "$REPO/scripts/tests/stubs/aws" "$REPO/scripts/tests/stubs/gh" "$REPO/scripts/tests/stubs/curl" "$BIN/"
for tool in dotnet npm uv; do
  printf '#!/bin/sh\necho "{\\"tool\\": \\"%s\\"}" >> "$STUB_LOG"\necho "stub %s must not run here" >&2\nexit 97\n' "$tool" "$tool" > "$BIN/$tool"
done
chmod +x "$BIN"/*

# child env: only what a case passes. run <cmd...> → RC, $T/out, $T/err
clean() {
  env -i PATH="$BIN:$BASE_PATH" HOME="$T/home" TMPDIR="$T/tmp" LC_ALL=C \
    STUB_STATE="$STATE" STUB_LOG="$LOG" STUB_S3="$S3" STUB_GH_DIR="$GHD" \
    GIT_CONFIG_NOSYSTEM=1 "$@"
}
run() { set +e; clean "$@" >"$T/out" 2>"$T/err"; RC=$?; set -e; }
# setstate <python statement on s> — edit the fake AWS state
setstate() { python3 - "$STATE" "$1" <<'PY'
import json, sys
s = json.load(open(sys.argv[1])); exec(sys.argv[2]); json.dump(s, open(sys.argv[1], "w"))
PY
}

DSN='https://abc123@o1.ingest.example.invalid/42'
LONG='0123456789abcdef0123456789abcdef0123'
fn_json() {   # fn_json <alias> <highest version>
  python3 - "$1" "$2" <<'PY'
import json, sys
alias, top = sys.argv[1], int(sys.argv[2])
vers = {str(i): {"sha": f"OLD{i}", "runtime": "dotnet10", "state": "Active", "env": {"KEEP": "1"}, "description": f"v{i}"} for i in range(1, top + 1)}
print(json.dumps({"alias": alias, "latest": {"sha": f"OLD{top}", "runtime": "dotnet10", "env": {"KEEP": "1"}}, "versions": vers}))
PY
}
reset_state() {
  : > "$LOG"
  rm -f "$LOG.health"
  rm -rf "$S3"; mkdir -p "$S3/recallsmith-console-622994489535" "$S3/developercards-site-622994489535"
  printf '<html>old console</html>\n' > "$S3/recallsmith-console-622994489535/index.html"
  printf 'old chunk\n' > "$S3/recallsmith-console-622994489535/app-old.js"
  printf '<html>old site</html>\n' > "$S3/developercards-site-622994489535/index.html"
  # The same size as site/styles.css: a deploy that changes a colour keeps the size, and `aws s3 sync` alone would
  # then never put the old file back.
  python3 -c 'import sys; n = int(sys.argv[1]); sys.stdout.write(("old css\n" + "x" * n)[:n])' \
    "$(wc -c < "$MIRROR/site/styles.css" | tr -d ' ')" > "$S3/developercards-site-622994489535/styles.css"
  cat > "$STATE" <<EOF
{"functions": {
  "core-vpc": $(fn_json 75 75),
  "worker-lambda": $(fn_json 27 27),
  "developercards-synthetic-check": $(fn_json 3 3),
  "developercards-notifier": $(fn_json '$LATEST' 0)
 },
 "ssm": {"pg-password": "$LONG", "migrate-secret": "$LONG", "internal-shared-secret": "$LONG",
         "rc-webhook-auth-production": "$LONG", "rc-webhook-auth-development": "$LONG", "analytics-salt": "$LONG",
         "console-sentry-dsn": "$DSN"},
 "dsn": "$DSN",
 "invoke": {"developercards-synthetic-check": {"ok": true, "failed": []}}
}
EOF
}
jstate() { python3 -c "import json,sys; s=json.load(open('$STATE')); print(eval(sys.argv[1]))" "$1"; }

# CI fixtures (the Actions API, scripts/deploy-preflight.sh checks_verdict): ci_runs <sha|@SHA@> <run id>... prints a
# list of push runs of ci.yml on main; jobs_green <run id> writes that run's nine green jobs.
ci_runs() {
  python3 - "$@" <<'PY'
import json, sys
sha, ids = sys.argv[1], sys.argv[2:]
print(json.dumps({"workflow_runs": [{"id": int(i), "event": "push", "head_branch": "main", "head_sha": sha,
                                     "path": ".github/workflows/ci.yml"} for i in ids]}))
PY
}
jobs_green() {
  "$REPO/scripts/deploy-preflight.sh" --list-checks | python3 -c '
import json, sys
names = [l.rstrip("\n") for l in sys.stdin if l.strip()]
print(json.dumps({"jobs": [{"name": n, "status": "completed", "conclusion": "success"} for n in names]}))' > "$GHD/jobs-$1.json"
}
# jobs_edit <run id> <python statement on d>
jobs_edit() { python3 - "$GHD/jobs-$1.json" "$2" <<'PY'
import json, sys
d = json.load(open(sys.argv[1])); exec(sys.argv[2]); json.dump(d, open(sys.argv[1], "w"))
PY
}
default_ci_green() { ci_runs @SHA@ 500 > "$GHD/ci-runs.json"; jobs_green 500; }

# ----------------------------------------------------------------------------------------------------- mirror repo
# The files the scripts need, at their repo paths, in a throwaway git repo with a local bare origin.
mkdir -p "$MIRROR"
( cd "$REPO" && tar -cf - .gitignore scripts src_C/deploy.sh src_C/package_lambda_zip.sh src_C/scripts/merge-env.sh \
    src_C/env/prod.env.json frontend/deploy.sh frontend/scripts/resolve-sentry-dsn.sh frontend/scripts/check-bundle-dsn.sh \
    site services/deploy-python-lambda.sh services/lambda-release.sh services/synthetic-check/pyproject.toml \
    services/synthetic-check/env services/synthetic-check/src/synthetic_check ) | ( cd "$MIRROR" && tar -xf - )
git_m() { git -C "$MIRROR" -c user.name=test -c user.email=test@example.invalid -c commit.gpgsign=false "$@"; }
git init -q --bare "$ORIGIN"
git_m init -q -b main 2>/dev/null || { git_m init -q && git_m checkout -q -b main; }
git_m add -A && git_m commit -q -m mirror
git_m remote add origin "$ORIGIN" && git_m push -q origin main
HEAD_SHA="$(git_m rev-parse HEAD)"
default_ci_green

# ===================================================================================================== static
echo "# syntax and workflow facts"
for f in scripts/rollback.sh scripts/smoke.sh scripts/deploy-preflight.sh scripts/lib/targets.sh scripts/cd/plan.sh \
  scripts/cd/restore-point.sh scripts/cd/artifact.sh scripts/tests/cd-scripts.test.sh src_C/deploy.sh frontend/deploy.sh \
  frontend/scripts/check-bundle-dsn.sh frontend/scripts/resolve-sentry-dsn.sh site/deploy.sh \
  services/deploy-python-lambda.sh services/lambda-release.sh; do
  check "bash -n $f" bash -n "$REPO/$f"
done

ci_names="$(sed -n 's/^    name: //p' "$REPO/.github/workflows/ci.yml" | LC_ALL=C sort)"
req_names="$("$REPO/scripts/deploy-preflight.sh" --list-checks | LC_ALL=C sort)"
check "deploy-preflight.sh REQUIRED_CHECKS = the nine job names of ci.yml" [ "$ci_names" = "$req_names" ]
check "nine required checks" [ "$(printf '%s\n' "$req_names" | grep -c .)" = 9 ]

CD="$REPO/.github/workflows/cd.yml"
python3 - "$CD" "$REPO/.github/workflows/ci.yml" > "$T/cdfacts" <<'PY'
import re, sys
text = open(sys.argv[1]).read()
ci = open(sys.argv[2]).read()
norm = lambda s: re.sub(r"\s+", " ", s).strip()
group = re.search(r"concurrency:\n  group: >-\n(.*?)\n  cancel-in-progress", text, re.S).group(1)
cond_group = norm(re.search(r"\$\{\{ \((.*)\)\s*&& 'production'", norm(group)).group(1))
plan_if = re.search(r"\n  plan:\n.*?\n    if: >-\n(.*?)\n    runs-on", text, re.S).group(1)
main_only = "(github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main')"
print("same_condition", cond_group == norm(plan_if).replace("github.event_name == 'workflow_dispatch'", main_only, 1))
uses = re.findall(r"uses: (\S+)(.*)", text)
print("pinned", all(re.fullmatch(r"[\w.-]+/[\w.-]+@[0-9a-f]{40}", u) and re.fullmatch(r" # v\d+\.\d+\.\d+", c) for u, c in uses), len(uses))
jobs = re.split(r"\n  (?=[a-z][\w-]*:\n)", text.split("\njobs:\n", 1)[1])
body = {j.split(":", 1)[0].strip(): j for j in jobs}
env_jobs = sorted(n for n, j in body.items() if "\n    environment:" in j)
oidc_jobs = sorted(n for n, j in body.items() if "id-token: write" in j)
print("environment_jobs", ",".join(env_jobs))
print("oidc_jobs", ",".join(oidc_jobs))
print("top_permissions", "\npermissions:\n  contents: read\n" in text)
print("no_cancel", "cancel-in-progress: false" in text)
print("role", "role-to-assume: arn:aws:iam::622994489535:role/developercards-gha-prod" in text)
print("workflow_run", bool(re.search(r"workflow_run:\n    workflows: \[CI\]\n    types: \[completed\]\n    branches: \[main\]", text)))
plan, deploy, rollback = body["plan"], body["deploy"], body["rollback"]
before = lambda j, a, b: a in j and b in j and j.index(a) < j.index(b)
print("plan_runs_main_scripts", "ref: ${{ github.sha }}" in plan and "workflow_run.head_sha ||" not in plan)
print("plan_on_main_guard_first", before(plan, "git merge-base --is-ancestor \"$RUN_SHA\" refs/remotes/origin/main", "scripts/cd/plan.sh decide"))
print("deploy_stale_guard_before_credentials", before(deploy, "scripts/cd/plan.sh still-current", "configure-aws-credentials"))
print("deploy_verify_before_credentials", before(deploy, "artifact.sh verify", "configure-aws-credentials"))
print("deploy_baseline_before_record", before(deploy, "SMOKE_REPORT=\"$RUNNER_TEMP/smoke-before.tsv\"", "restore-point.sh record"))
print("deploy_smoke_uses_baseline", "SMOKE_BASELINE=\"$RUNNER_TEMP/smoke-before.tsv\"" in deploy)
print("rollback_stale_guard_before_credentials", before(rollback, "scripts/cd/plan.sh still-current", "configure-aws-credentials"))
print("ci_push_branches_only", bool(re.search(r"\non:\n(?:  #.*\n)*  push:\n    branches: \['\*\*'\]\n", ci)))
PY
check "cd.yml: concurrency condition = plan job's if + main-only dispatch" has "$T/cdfacts" "same_condition True"
check "cd.yml: every uses: pinned to a 40-hex SHA with # vX.Y.Z" grep -q '^pinned True' "$T/cdfacts"
check "cd.yml: only deploy and rollback name an environment" has "$T/cdfacts" "environment_jobs deploy,rollback"
check "cd.yml: only deploy and rollback get id-token: write" has "$T/cdfacts" "oidc_jobs deploy,rollback"
check "cd.yml: top-level permissions contents: read" has "$T/cdfacts" "top_permissions True"
check "cd.yml: never cancels in-flight" has "$T/cdfacts" "no_cancel True"
check "cd.yml: assumes developercards-gha-prod" has "$T/cdfacts" "role True"
check "cd.yml: triggered by CI completing on main" has "$T/cdfacts" "workflow_run True"
check "cd.yml: the plan runs main's scripts (checkout of github.sha), never the pushed commit's" has "$T/cdfacts" "plan_runs_main_scripts True"
check "cd.yml: the on-main guard runs inline before plan.sh" has "$T/cdfacts" "plan_on_main_guard_first True"
check "cd.yml: deploy refuses a stale plan before any credential" has "$T/cdfacts" "deploy_stale_guard_before_credentials True"
check "cd.yml: deploy verifies the artifact before any credential" has "$T/cdfacts" "deploy_verify_before_credentials True"
check "cd.yml: deploy smokes a baseline before the restore point" has "$T/cdfacts" "deploy_baseline_before_record True"
check "cd.yml: the smoke after the deploy reads the baseline" has "$T/cdfacts" "deploy_smoke_uses_baseline True"
check "cd.yml: rollback refuses a stale plan before any credential" has "$T/cdfacts" "rollback_stale_guard_before_credentials True"
check "ci.yml: push runs on branches only (a tag runs no CI)" has "$T/cdfacts" "ci_push_branches_only True"
for wf in "$REPO"/.github/workflows/*.yml; do
  if grep -qE '^\s+(- )?uses: [^#]*@v[0-9]' "$wf"; then bad "$(basename "$wf"): a uses: pinned to a tag"; else ok "$(basename "$wf"): no tag-pinned uses:"; fi
done

# ===================================================================================================== profile default
echo "# AWS_PROFILE defaults to devcards-deploy only without credentials in the environment"
profiles() { python3 -c "
import json
seen = {json.loads(l).get('profile') for l in open('$LOG') if '\"argv\"' in l}
print(','.join(sorted(seen)))"; }
keys() { python3 -c "
import json
print(all(json.loads(l)['has_key'] for l in open('$LOG') if '\"argv\"' in l))"; }
mkdir -p "$MIRROR/src_C/dist" "$MIRROR/services/synthetic-check/build" "$MIRROR/frontend/dist/assets"
printf 'vpc zip bytes\n' > "$MIRROR/src_C/dist/vpc.zip"
printf 'worker zip bytes\n' > "$MIRROR/src_C/dist/worker.zip"
printf 'python zip bytes\n' > "$MIRROR/services/synthetic-check/build/synthetic-check.zip"
printf '<html><script src="/assets/app-new.js"></script></html>\n' > "$MIRROR/frontend/dist/index.html"
printf 'const dsn="%s";\n' "$DSN" > "$MIRROR/frontend/dist/assets/app-new.js"
# deploy_cmd <name> → the env-free command line that deploys that script for real against the stubs (site and python
# without GITHUB_ACTIONS: their local preflight runs, against a clean mirror at origin/main with green CI)
deploy_cmd() {
  case "$1" in
    src_C) echo "PREBUILT=1 GITHUB_ACTIONS=true $MIRROR/src_C/deploy.sh" ;;
    frontend) echo "PREBUILT=1 GITHUB_ACTIONS=true $MIRROR/frontend/deploy.sh" ;;
    site) echo "SITE_DISTRIBUTION_ID=EML9BSZ8EXMQ1 $MIRROR/site/deploy.sh" ;;
    python) echo "PREBUILT=1 $MIRROR/services/deploy-python-lambda.sh synthetic-check" ;;
  esac
}
for s in src_C frontend site python; do
  reset_state; run $(deploy_cmd "$s")
  check "$s: deploys against the stub (rc=$RC)" [ "$RC" = 0 ]
  check "$s: no credentials in env -> AWS_PROFILE=devcards-deploy" [ "$(profiles)" = devcards-deploy ]
  reset_state; run AWS_ACCESS_KEY_ID=AKIASTUB AWS_SECRET_ACCESS_KEY=stub AWS_SESSION_TOKEN=stub $(deploy_cmd "$s")
  if [ "$RC" = 0 ] && [ "$(profiles)" = "" ] && [ "$(keys)" = True ]; then ok "$s: OIDC-style env credentials -> no AWS_PROFILE (rc=$RC)"; else bad "$s: OIDC-style env credentials -> no AWS_PROFILE (rc=$RC)"; fi
  reset_state; run AWS_WEB_IDENTITY_TOKEN_FILE=/dev/null $(deploy_cmd "$s")
  check "$s: AWS_WEB_IDENTITY_TOKEN_FILE -> no AWS_PROFILE" [ "$(profiles)" = "" ]
  reset_state; run AWS_PROFILE=devcards-admin $(deploy_cmd "$s")
  check "$s: an operator's AWS_PROFILE is kept" [ "$(profiles)" = devcards-admin ]
done

# ===================================================================================================== PREBUILT
echo "# PREBUILT"
reset_state; run PREBUILT=1 GITHUB_ACTIONS=true "$MIRROR/src_C/deploy.sh"
check "src_C PREBUILT: never runs dotnet / package_lambda_zip.sh" none '"tool": "dotnet"'
check "src_C PREBUILT: core-vpc prod alias moved 75 -> 76" [ "$(jstate 's["functions"]["core-vpc"]["alias"]')" = 76 ]
check "src_C PREBUILT: worker-lambda prod alias moved 27 -> 28" [ "$(jstate 's["functions"]["worker-lambda"]["alias"]')" = 28 ]
check "src_C PREBUILT: prints the ROLLBACK line" has "$T/out" "--function-name core-vpc --name prod --function-version 75"
check "src_C PREBUILT: SSM secrets injected into the new version" [ "$(jstate 's["functions"]["core-vpc"]["versions"]["76"]["env"]["PGPASSWORD"]')" = "$LONG" ]
check "src_C PREBUILT: the DSN leaf never becomes an env var" [ "$(jstate '"console-sentry-dsn" in json.dumps(s["functions"]["core-vpc"]["versions"]["76"]["env"])')" = False ]
mv "$MIRROR/src_C/dist/worker.zip" "$T/worker.zip"
reset_state; run PREBUILT=1 GITHUB_ACTIONS=true "$MIRROR/src_C/deploy.sh"
check "src_C PREBUILT: a missing zip refuses (rc=$RC)" [ "$RC" = 1 ]
check "src_C PREBUILT: ... naming it" has "$T/err" "dist/worker.zip is missing"
check "src_C PREBUILT: ... before any Lambda change" none '"update-function-code"'
reset_state; run PREBUILT=1 GITHUB_ACTIONS=true ONLY=vpc "$MIRROR/src_C/deploy.sh"
if [ "$RC" = 0 ] && [ "$(jstate 's["functions"]["worker-lambda"]["alias"]')" = 27 ]; then ok "src_C PREBUILT ONLY=vpc needs only vpc.zip (rc=$RC)"; else bad "src_C PREBUILT ONLY=vpc needs only vpc.zip (rc=$RC)"; fi
mv "$T/worker.zip" "$MIRROR/src_C/dist/worker.zip"

reset_state; run PREBUILT=1 UV=/nonexistent/uv "$MIRROR/services/deploy-python-lambda.sh" synthetic-check
check "python PREBUILT: deploys with no uv on hand (rc=$RC)" [ "$RC" = 0 ]
check "python PREBUILT: never runs uv or the tests" none '"tool": "uv"'
check "python PREBUILT: alias moved 3 -> 4" [ "$(jstate 's["functions"]["developercards-synthetic-check"]["alias"]')" = 4 ]
mv "$MIRROR/services/synthetic-check/build/synthetic-check.zip" "$T/py.zip"
reset_state; run PREBUILT=1 "$MIRROR/services/deploy-python-lambda.sh" synthetic-check
if [ "$RC" = 1 ] && none '"update-function-code"'; then ok "python PREBUILT: a missing zip refuses (rc=$RC)"; else bad "python PREBUILT: a missing zip refuses (rc=$RC)"; fi
mv "$T/py.zip" "$MIRROR/services/synthetic-check/build/synthetic-check.zip"

reset_state; run PREBUILT=1 GITHUB_ACTIONS=true "$MIRROR/frontend/deploy.sh"
check "console PREBUILT: never runs npm" none '"tool": "npm"'
check "console PREBUILT: index.html uploaded and read back" has "$S3/recallsmith-console-622994489535/index.html" "app-new.js"
check "console PREBUILT: old chunks kept" [ -f "$S3/recallsmith-console-622994489535/app-old.js" ]
check "console PREBUILT: never prints the DSN" hasnt "$T/out" "abc123"
printf 'const dsn="";\n' > "$MIRROR/frontend/dist/assets/app-new.js"
reset_state; run PREBUILT=1 GITHUB_ACTIONS=true "$MIRROR/frontend/deploy.sh"
if [ "$RC" = 1 ] && has "$T/err" "CONSOLE_SENTRY_DSN"; then ok "console PREBUILT: a bundle without the SSM DSN refuses (rc=$RC)"; else bad "console PREBUILT: a bundle without the SSM DSN refuses (rc=$RC)"; fi
check "console PREBUILT: ... before any upload" none '"s3", "sync"'
setstate 's["dsn"] = ""'
: > "$LOG"; run PREBUILT=1 GITHUB_ACTIONS=true "$MIRROR/frontend/deploy.sh"
check "console PREBUILT: no DSN in SSM -> nothing to compare, deploys (rc=$RC)" [ "$RC" = 0 ]
printf 'const dsn="%s";\n' "$DSN" > "$MIRROR/frontend/dist/assets/app-new.js"

reset_state; run DRY_RUN=1 PREBUILT=1 "$MIRROR/frontend/deploy.sh"
if [ "$RC" = 0 ] && none '"argv"' && has "$T/out" "DRY: aws s3 sync"; then ok "console DRY_RUN: no AWS call at all, no SSM lookup of the DSN (rc=$RC)"; else bad "console DRY_RUN: no AWS call at all, no SSM lookup of the DSN (rc=$RC)"; fi
reset_state; run DRY_RUN=1 PREBUILT=1 CONSOLE_SENTRY_DSN_PARAM=/developercards/prod/console-sentry-dsn "$MIRROR/frontend/deploy.sh"
if [ "$RC" = 0 ] && [ "$(calls '"get-parameter"')" -ge 1 ] && has "$T/out" "VITE_SENTRY_DSN: set"; then ok "console DRY_RUN: an explicit CONSOLE_SENTRY_DSN_PARAM still reads the DSN"; else bad "console DRY_RUN: an explicit CONSOLE_SENTRY_DSN_PARAM still reads the DSN"; fi

# ===================================================================================================== secrets
echo "# secrets in src_C/deploy.sh: masked in GitHub Actions, never on a command line, never in an error"
reset_state
setstate 's["ssm"]["analytics-salt"] = "salt-line-one-0123456789\nsalt-line-two-0123456789"; s["ssm"]["migrate-secret"] = "mig%25ret-0123456789abcdef"; s["functions"]["core-vpc"]["latest"]["env"] = {"KEEP": "1", "PGUSER": "live-pguser-value", "STRAY_SECRET": "stray-secret-value-0123", "CONTENT_BUCKET": "core-vpc-like-name", "EXPECT_ENV_PRODUCTION": "production"}'
run PREBUILT=1 GITHUB_ACTIONS=true "$MIRROR/src_C/deploy.sh"
check "secrets: deploy in GitHub Actions succeeds (rc=$RC)" [ "$RC" = 0 ]
check "secrets: every decrypted SSM value is registered with ::add-mask::" has "$T/out" "::add-mask::$LONG"
check "secrets: ... the leaves that never become env vars too (the DSN)" has "$T/out" "::add-mask::$DSN"
if has "$T/out" "::add-mask::salt-line-one-0123456789" && has "$T/out" "::add-mask::salt-line-two-0123456789"; then ok "secrets: a multi-line value is masked line by line"; else bad "secrets: a multi-line value is masked line by line"; fi
check "secrets: '%' is escaped for the runner (%25)" has "$T/out" "::add-mask::mig%2525ret-0123456789abcdef"
check "secrets: a live env value outside the committed file is masked (stray secret)" has "$T/out" "::add-mask::stray-secret-value-0123"
if hasnt "$T/out" "::add-mask::1" && hasnt "$T/out" "::add-mask::live-pguser-value"; then ok "secrets: committed keys and values under 8 characters are not masked"; else bad "secrets: committed keys and values under 8 characters are not masked"; fi
if hasnt "$T/out" "::add-mask::core-vpc-like-name" && hasnt "$T/out" "::add-mask::production"; then ok "secrets: uncommitted non-secret keys (a bucket name, an environment name) are not masked"; else bad "secrets: uncommitted non-secret keys (a bucket name, an environment name) are not masked"; fi
check "secrets: no secret value on any aws command line (environment passed as file://)" hasnt "$LOG" "$LONG"
check "secrets: ... update-function-configuration got --environment file://" has "$LOG" '"--environment", "file://'
check "secrets: the environment file is gone afterwards" [ -z "$(find "$T/tmp" -name env.json)" ]
if [ "$(cat "$T/out" "$T/err" | grep -v '^::add-mask::' | grep -c -- "$LONG")" = 0 ]; then ok "secrets: no secret printed outside ::add-mask:: lines"; else bad "secrets: no secret printed outside ::add-mask:: lines"; fi
reset_state; run PREBUILT=1 BREAK_GLASS=1 "$MIRROR/src_C/deploy.sh"
if [ "$RC" = 0 ] && hasnt "$T/out" "::add-mask::" && hasnt "$T/out" "$LONG"; then ok "secrets: outside GitHub Actions no ::add-mask:: line (it would print the value)"; else bad "secrets: outside GitHub Actions no ::add-mask:: line (it would print the value)"; fi
reset_state; setstate 's["fail_env_update"] = True'
run PREBUILT=1 GITHUB_ACTIONS=true "$MIRROR/src_C/deploy.sh"
if [ "$RC" = 1 ] && has "$T/err" "InvalidParameterValueException"; then ok "secrets: an environment update error stops the deploy and names the AWS error code (rc=$RC)"; else bad "secrets: an environment update error stops the deploy and names the AWS error code (rc=$RC)"; fi
if [ "$(cat "$T/out" "$T/err" | grep -v '^::add-mask::' | grep -c -- "$LONG")" = 0 ] && hasnt "$T/err" "String measured"; then ok "secrets: ... and never prints the AWS message that quotes the environment"; else bad "secrets: ... and never prints the AWS message that quotes the environment"; fi
check "secrets: ... before any code update" none '"update-function-code"'

# ===================================================================================================== preflight
echo "# local preflight"
reset_state; run PREBUILT=1 "$MIRROR/src_C/deploy.sh"
if [ "$RC" = 0 ] && has "$T/out" "preflight (src_C/deploy.sh): OK"; then ok "preflight: clean tree at origin/main with green CI deploys (rc=$RC)"; else bad "preflight: clean tree at origin/main with green CI deploys (rc=$RC)"; fi
check "preflight: asked GitHub for the ci.yml push runs of HEAD" [ "$(calls "actions/workflows/ci.yml/runs?head_sha=$HEAD_SHA")" -ge 1 ]
printf 'x\n' > "$MIRROR/src_C/untracked.cs"
reset_state; run PREBUILT=1 "$MIRROR/src_C/deploy.sh"
if [ "$RC" = 1 ] && has "$T/err" "working tree is not clean"; then ok "preflight: an untracked file refuses (rc=$RC)"; else bad "preflight: an untracked file refuses (rc=$RC)"; fi
check "preflight: ... before any AWS call" none '"argv"'
reset_state; run PREBUILT=1 BREAK_GLASS=1 "$MIRROR/src_C/deploy.sh"
if [ "$RC" = 0 ] && [ "$(jstate 's["functions"]["core-vpc"]["alias"]')" = 76 ]; then ok "preflight: BREAK_GLASS=1 deploys anyway (rc=$RC)"; else bad "preflight: BREAK_GLASS=1 deploys anyway (rc=$RC)"; fi
check "preflight: ... with a loud warning" has "$T/err" "BREAK_GLASS=1: deploying ANYWAY"
reset_state; run PREBUILT=1 "$MIRROR/frontend/deploy.sh"
if [ "$RC" = 1 ] && none '"s3", "sync"'; then ok "preflight: frontend/deploy.sh refuses a dirty tree too (rc=$RC)"; else bad "preflight: frontend/deploy.sh refuses a dirty tree too (rc=$RC)"; fi
reset_state; run PREBUILT=1 "$MIRROR/services/deploy-python-lambda.sh" synthetic-check
if [ "$RC" = 1 ] && has "$T/err" "working tree is not clean" && none '"argv"'; then ok "preflight: services/deploy-python-lambda.sh refuses a dirty tree too, before any AWS call (rc=$RC)"; else bad "preflight: services/deploy-python-lambda.sh refuses a dirty tree too, before any AWS call (rc=$RC)"; fi
reset_state; run SITE_DISTRIBUTION_ID=EML9BSZ8EXMQ1 "$MIRROR/site/deploy.sh"
if [ "$RC" = 1 ] && has "$T/err" "working tree is not clean" && none '"argv"'; then ok "preflight: site/deploy.sh refuses a dirty tree too, before any AWS call (rc=$RC)"; else bad "preflight: site/deploy.sh refuses a dirty tree too, before any AWS call (rc=$RC)"; fi
reset_state; run PREBUILT=1 BREAK_GLASS=1 "$MIRROR/services/deploy-python-lambda.sh" synthetic-check
if [ "$RC" = 0 ] && has "$T/err" "BREAK_GLASS=1: deploying ANYWAY"; then ok "preflight: python BREAK_GLASS=1 deploys with the warning (rc=$RC)"; else bad "preflight: python BREAK_GLASS=1 deploys with the warning (rc=$RC)"; fi
run DRY_RUN=1 "$MIRROR/scripts/deploy-preflight.sh" test
if [ "$RC" = 0 ] && has "$T/out" "skipped, DRY_RUN=1"; then ok "preflight: DRY_RUN=1 never needs it (rc=$RC)"; else bad "preflight: DRY_RUN=1 never needs it (rc=$RC)"; fi
run GITHUB_ACTIONS=true "$MIRROR/scripts/deploy-preflight.sh" test
check "preflight: skipped inside GitHub Actions (rc=$RC)" [ "$RC" = 0 ]
rm "$MIRROR/src_C/untracked.cs"
git_m commit -q --allow-empty -m "local only"
reset_state; run PREBUILT=1 "$MIRROR/src_C/deploy.sh"
if [ "$RC" = 1 ] && has "$T/err" "is not origin/main"; then ok "preflight: HEAD ahead of origin/main refuses (rc=$RC)"; else bad "preflight: HEAD ahead of origin/main refuses (rc=$RC)"; fi
git_m reset -q --hard "$HEAD_SHA"
jobs_edit 500 'd["jobs"][3]["conclusion"] = "failure"'
reset_state; run PREBUILT=1 "$MIRROR/src_C/deploy.sh"
if [ "$RC" = 1 ] && has "$T/out" "completed/failure  backend (dotnet test)"; then ok "preflight: a failed required job refuses (rc=$RC)"; else bad "preflight: a failed required job refuses (rc=$RC)"; fi
ci_runs @SHA@ 500 501 > "$GHD/ci-runs.json"; jobs_green 501
reset_state; run PREBUILT=1 "$MIRROR/src_C/deploy.sh"
check "preflight: the newest ci.yml run on the commit is the verdict (a newer green run counts) (rc=$RC)" [ "$RC" = 0 ]
default_ci_green
jobs_edit 500 'd["jobs"] = [j for j in d["jobs"] if j["name"] != "frontend (playwright smoke)"]'
reset_state; run PREBUILT=1 "$MIRROR/src_C/deploy.sh"
if [ "$RC" = 1 ] && has "$T/out" "MISSING  frontend (playwright smoke)"; then ok "preflight: a missing required job refuses (rc=$RC)"; else bad "preflight: a missing required job refuses (rc=$RC)"; fi
default_ci_green
python3 - "$GHD/ci-runs.json" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
r = d["workflow_runs"][0]
d["workflow_runs"] = [dict(r, head_branch="feature"), dict(r, id=601, event="pull_request"), dict(r, id=602, path=".github/workflows/fake-ci.yml")]
json.dump(d, open(sys.argv[1], "w"))
PY
jobs_green 601; jobs_green 602
reset_state; run PREBUILT=1 "$MIRROR/src_C/deploy.sh"
if [ "$RC" = 1 ] && has "$T/out" "no push run of .github/workflows/ci.yml on main"; then ok "preflight: green jobs of another branch, a pull request or another workflow never count (rc=$RC)"; else bad "preflight: green jobs of another branch, a pull request or another workflow never count (rc=$RC)"; fi
rm "$GHD/ci-runs.json"
reset_state; run PREBUILT=1 "$MIRROR/src_C/deploy.sh"
if [ "$RC" = 1 ] && has "$T/err" "could not be read"; then ok "preflight: unreadable CI result refuses (rc=$RC)"; else bad "preflight: unreadable CI result refuses (rc=$RC)"; fi
default_ci_green

# ===================================================================================================== rollback.sh
echo "# rollback.sh"
reset_state
run "$MIRROR/scripts/rollback.sh" nope 3;            check "rollback: unknown target -> exit 2" [ "$RC" = 2 ]
run "$MIRROR/scripts/rollback.sh" worker abc;        check "rollback: non-numeric version -> exit 2" [ "$RC" = 2 ]
run "$MIRROR/scripts/rollback.sh" worker;            check "rollback: missing version -> exit 2" [ "$RC" = 2 ]
run "$MIRROR/scripts/rollback.sh" vpc 73
if [ "$RC" = 1 ] && none '"update-alias"'; then ok "rollback: core-vpc below 74 refused (RUNBOOK §9) (rc=$RC)"; else bad "rollback: core-vpc below 74 refused (RUNBOOK §9) (rc=$RC)"; fi
run DRY_RUN=1 "$MIRROR/scripts/rollback.sh" worker 25
if [ "$RC" = 0 ] && none '"argv"' && has "$T/out" "update-alias"; then ok "rollback: DRY_RUN prints and calls nothing"; else bad "rollback: DRY_RUN prints and calls nothing"; fi
run "$MIRROR/scripts/rollback.sh" worker 25
if [ "$RC" = 0 ] && [ "$(jstate 's["functions"]["worker-lambda"]["alias"]')" = 25 ]; then ok "rollback: worker 27 -> 25 (rc=$RC)"; else bad "rollback: worker 27 -> 25 (rc=$RC)"; fi
if has "$T/out" "OK worker-lambda:prod -> version 25 (was 27)" && has "$T/out" "UNDO: scripts/rollback.sh worker 27"; then ok "rollback: prints OK and the UNDO line"; else bad "rollback: prints OK and the UNDO line"; fi
check "rollback: used the deploy profile" [ "$(profiles)" = devcards-deploy ]
setstate 's["functions"]["worker-lambda"]["versions"]["24"]["state"] = "Failed"'
run "$MIRROR/scripts/rollback.sh" worker 24
if [ "$RC" = 1 ] && [ "$(jstate 's["functions"]["worker-lambda"]["alias"]')" = 25 ]; then ok "rollback: a version that is not Active is refused, alias untouched (rc=$RC)"; else bad "rollback: a version that is not Active is refused, alias untouched (rc=$RC)"; fi
run "$MIRROR/scripts/rollback.sh" worker 99
if [ "$RC" != 0 ] && [ "$(jstate 's["functions"]["worker-lambda"]["alias"]')" = 25 ]; then ok "rollback: a version that does not exist fails (rc=$RC)"; else bad "rollback: a version that does not exist fails (rc=$RC)"; fi

# ===================================================================================================== restore point
echo "# restore point: record, deploy, restore"
reset_state
RP="$T/restore-point"; rm -rf "$RP"
run "$MIRROR/scripts/cd/restore-point.sh" record "$RP" backend synthetic-check notifier console site
check "record: rc=$RC" [ "$RC" = 0 ]
check "record: four aliases recorded" [ "$(wc -l < "$RP/aliases.tsv" | tr -d ' ')" = 4 ]
run PREBUILT=1 GITHUB_ACTIONS=true "$MIRROR/src_C/deploy.sh"
run PREBUILT=1 "$MIRROR/services/deploy-python-lambda.sh" synthetic-check
mkdir -p "$MIRROR/services/notifier/src/notifier" "$MIRROR/services/notifier/env" "$MIRROR/services/notifier/build"
printf '[project]\nname="n"\n' > "$MIRROR/services/notifier/pyproject.toml"
printf '{}\n' > "$MIRROR/services/notifier/env/prod.env.json"
printf 'n zip\n' > "$MIRROR/services/notifier/build/notifier.zip"
git_m add services/notifier && git_m commit -q -m notifier && git_m push -q origin main
run PREBUILT=1 "$MIRROR/services/deploy-python-lambda.sh" notifier
if [ "$RC" = 0 ] && [ "$(jstate 's["functions"]["developercards-notifier"]["alias"]')" = 2 ]; then ok "notifier first deploy (alias on \$LATEST) froze the live code (rc=$RC)"; else bad "notifier first deploy (alias on \$LATEST) froze the live code (rc=$RC)"; fi
run PREBUILT=1 GITHUB_ACTIONS=true "$MIRROR/frontend/deploy.sh"
# CD's checkout is fresh, so every site file is newer than its object: the deploy re-uploads all of them.
touch "$MIRROR/site/index.html" "$MIRROR/site/styles.css"
run SITE_DISTRIBUTION_ID=EML9BSZ8EXMQ1 "$MIRROR/site/deploy.sh"
check "site deploy replaced the bucket" hasnt "$S3/developercards-site-622994489535/index.html" "old site"
check "site deploy replaced the same-size styles.css" cmp -s "$S3/developercards-site-622994489535/styles.css" "$MIRROR/site/styles.css"
printf 'added by the deploy\n' > "$S3/developercards-site-622994489535/new-page.html"
: > "$LOG"
run SITE_DISTRIBUTION_ID=EML9BSZ8EXMQ1 "$MIRROR/scripts/cd/restore-point.sh" restore "$RP"
if [ "$RC" = 0 ] && has "$T/out" "ROLLBACK OK"; then ok "restore: rc=$RC"; else bad "restore: rc=$RC"; fi
check "restore: core-vpc back on 75" [ "$(jstate 's["functions"]["core-vpc"]["alias"]')" = 75 ]
check "restore: worker-lambda back on 27" [ "$(jstate 's["functions"]["worker-lambda"]["alias"]')" = 27 ]
check "restore: synthetic-check back on 3" [ "$(jstate 's["functions"]["developercards-synthetic-check"]["alias"]')" = 3 ]
check "restore: notifier (was \$LATEST) back on its freeze version 1, never \$LATEST" [ "$(jstate 's["functions"]["developercards-notifier"]["alias"]')" = 1 ]
check "restore: console index.html back to the old build" has "$S3/recallsmith-console-622994489535/index.html" "old console"
if has "$S3/developercards-site-622994489535/index.html" "old site" && has "$S3/developercards-site-622994489535/styles.css" "old css"; then ok "restore: site bucket back, the same-size styles.css included"; else bad "restore: site bucket back, the same-size styles.css included"; fi
check "restore: an object the deploy added is removed" [ ! -f "$S3/developercards-site-622994489535/new-page.html" ]
check "restore: the site listing is read back and verified" has "$T/out" "listing verified"
python3 - "$LOG" > "$T/order" <<'PY'
import json, sys
lines = [json.loads(l).get("argv", []) for l in open(sys.argv[1])]
s3 = [i for i, a in enumerate(lines) if a[:1] in (["s3"], ["s3api"])]
inv = [i for i, a in enumerate(lines) if a[:2] == ["cloudfront", "create-invalidation"]]
wait = [i for i, a in enumerate(lines) if a[:2] == ["cloudfront", "wait"]]
print("order", bool(inv) and max(s3) < min(inv) and len(inv) == 2 and max(inv) < min(wait))
PY
check "restore: every bucket first, then both invalidations, then the waits" has "$T/order" "order True"
check "restore: the state is printed before the slow part" has "$T/out" "rollback in progress:"
run "$MIRROR/scripts/cd/restore-point.sh" restore "$RP"
if [ "$RC" = 0 ] && has "$T/out" "unchanged core-vpc:prod = 75" && has "$T/out" "unchanged console index.html" && has "$T/out" "unchanged site bucket"; then ok "restore: second run changes nothing"; else bad "restore: second run changes nothing"; fi
run "$MIRROR/scripts/cd/restore-point.sh" restore "$T/never-recorded"
if [ "$RC" = 3 ] && has "$T/out" "nothing was recorded"; then ok "restore: no restore point -> exit 3 (nothing to roll back), not 'restored'"; else bad "restore: no restore point -> exit 3 (nothing to roll back), not 'restored'"; fi
run "$MIRROR/scripts/cd/restore-point.sh" summary "$RP"
check "summary: a row with the rollback command" has "$T/out" '`scripts/rollback.sh vpc 75`'
if has "$T/out" '`scripts/rollback.sh notifier 1`' && hasnt "$T/out" 'rollback_version=$LATEST'; then ok "summary: an alias that was on \$LATEST names its freeze version, never \$LATEST"; else bad "summary: an alias that was on \$LATEST names its freeze version, never \$LATEST"; fi
setstate 's["functions"]["core-vpc"]["alias"] = "76"; s["functions"]["core-vpc"]["versions"]["75"]["state"] = "Failed"'
run "$MIRROR/scripts/cd/restore-point.sh" restore "$RP"
if [ "$RC" = 1 ] && has "$T/err" "ROLLBACK INCOMPLETE"; then ok "restore: a failed item -> rc=1 and ROLLBACK INCOMPLETE"; else bad "restore: a failed item -> rc=1 and ROLLBACK INCOMPLETE"; fi

echo "# restore point: a partial deploy (core-vpc moved, worker-lambda failed)"
reset_state; RP2="$T/rp-partial"; rm -rf "$RP2"
run "$MIRROR/scripts/cd/restore-point.sh" record "$RP2" backend
setstate 's["fail_code_update"] = ["worker-lambda"]'
run PREBUILT=1 GITHUB_ACTIONS=true "$MIRROR/src_C/deploy.sh"
if [ "$RC" != 0 ] && [ "$(jstate 's["functions"]["core-vpc"]["alias"]')" = 76 ] && [ "$(jstate 's["functions"]["worker-lambda"]["alias"]')" = 27 ]; then ok "partial: the deploy failed half way (vpc on 76, worker still 27)"; else bad "partial: the deploy failed half way (vpc on 76, worker still 27)"; fi
setstate 's["fail_code_update"] = []'
run "$MIRROR/scripts/cd/restore-point.sh" restore "$RP2"
if [ "$RC" = 0 ] && [ "$(jstate 's["functions"]["core-vpc"]["alias"]')" = 75 ] && has "$T/out" "unchanged worker-lambda:prod = 27"; then ok "partial: restore moves back only what moved"; else bad "partial: restore moves back only what moved"; fi

echo "# restore point: CloudFront failures are failures"
console_cycle() {   # record the console, deploy it, then apply <state edit> and restore with <env>...
  reset_state; rm -rf "$T/rp-cf"
  run "$MIRROR/scripts/cd/restore-point.sh" record "$T/rp-cf" console
  run PREBUILT=1 GITHUB_ACTIONS=true "$MIRROR/frontend/deploy.sh"
  setstate "$1"; shift
  : > "$LOG"
  run "$@" "$MIRROR/scripts/cd/restore-point.sh" restore "$T/rp-cf"
}
console_cycle 's["fail_invalidation"] = True'
if [ "$RC" = 1 ] && has "$T/err" "FAILED invalidation on E85FKUMZZWQWX" && has "$T/err" "ROLLBACK INCOMPLETE"; then ok "restore: create-invalidation failing -> FAILED, rc=1"; else bad "restore: create-invalidation failing -> FAILED, rc=1"; fi
check "restore: ... index.html is restored all the same" has "$S3/recallsmith-console-622994489535/index.html" "old console"
console_cycle 's["fail_invalidation_wait"] = True'
if [ "$RC" = 1 ] && has "$T/err" "not completed in time"; then ok "restore: an invalidation that does not complete -> FAILED, rc=1"; else bad "restore: an invalidation that does not complete -> FAILED, rc=1"; fi
console_cycle 's["fail_invalidation_wait"] = True' RESTORE_SKIP_WAIT=true
if [ "$RC" = 0 ] && has "$T/out" "not waiting for" && none '"cloudfront", "wait"'; then ok "restore: on a cancel (RESTORE_SKIP_WAIT=true) the invalidations are created, not waited for"; else bad "restore: on a cancel (RESTORE_SKIP_WAIT=true) the invalidations are created, not waited for"; fi
console_cycle 's["functions"]["core-vpc"]["alias"] = "75"' GITHUB_ACTIONS=true
check "restore: in GitHub Actions the state line is an ::error:: annotation" has "$T/out" "::error::rollback in progress:"

# ===================================================================================================== smoke
echo "# smoke"
reset_state
run SMOKE_ATTEMPTS=1 SMOKE_REPORT="$T/smoke.tsv" "$MIRROR/scripts/smoke.sh"
if [ "$RC" = 0 ] && has "$T/out" "SMOKE OK"; then ok "smoke: healthy production passes (rc=$RC)"; else bad "smoke: healthy production passes (rc=$RC)"; fi
if has "$LOG" '"--function-name", "developercards-synthetic-check:prod"' && has "$LOG" '{\"job\":\"synthetic-check\"}'; then ok "smoke: invoked synthetic-check:prod with the job payload"; else bad "smoke: invoked synthetic-check:prod with the job payload"; fi
check "smoke: report has two PASS lines" [ "$(grep -c PASS "$T/smoke.tsv")" = 2 ]
run SMOKE_ATTEMPTS=2 SMOKE_RETRY_SECONDS=0 STUB_HEALTH_CODE=502 "$MIRROR/scripts/smoke.sh"
if [ "$RC" = 1 ] && has "$T/err" "health: FAIL after 2 attempt(s): HTTP 502"; then ok "smoke: /health 502 fails after the retries (rc=$RC)"; else bad "smoke: /health 502 fails after the retries (rc=$RC)"; fi
rm -f "$LOG.health"
run SMOKE_ATTEMPTS=3 SMOKE_RETRY_SECONDS=0 STUB_HEALTH_SEQ=502,200 "$MIRROR/scripts/smoke.sh"
if [ "$RC" = 0 ] && has "$T/out" "attempt 1 failed (HTTP 502)" && has "$T/out" "[1/2] health: PASS"; then ok "smoke: a check that passes on attempt 2 passes (rc=$RC)"; else bad "smoke: a check that passes on attempt 2 passes (rc=$RC)"; fi
run SMOKE_ATTEMPTS=1 STUB_HEALTH_BODY='{"success":true,"data":{"ok":false}}' "$MIRROR/scripts/smoke.sh"
check "smoke: 200 without ok:true fails" [ "$RC" = 1 ]
setstate 's["invoke"]["developercards-synthetic-check"] = {"ok": False, "failed": ["cdn-deck", "console-index"]}'
run SMOKE_ATTEMPTS=1 "$MIRROR/scripts/smoke.sh"
if [ "$RC" = 1 ] && has "$T/err" "failed checks: cdn-deck, console-index"; then ok "smoke: a failed synthetic check fails and names it (rc=$RC)"; else bad "smoke: a failed synthetic check fails and names it (rc=$RC)"; fi
setstate 's["invoke"]["developercards-synthetic-check"] = {"ok": True, "failed": ["api-auth-guard"]}'
run SMOKE_ATTEMPTS=1 "$MIRROR/scripts/smoke.sh"
if [ "$RC" = 1 ] && has "$T/err" "failed checks: api-auth-guard"; then ok "smoke: ok true with a non-empty failed list still fails"; else bad "smoke: ok true with a non-empty failed list still fails"; fi
setstate 's["invoke"]["developercards-synthetic-check"] = {"ok": True, "failed": []}; s["invoke_error"] = "Unhandled"'
run SMOKE_ATTEMPTS=1 "$MIRROR/scripts/smoke.sh"
if [ "$RC" = 1 ] && has "$T/err" "FunctionError=Unhandled"; then ok "smoke: a FunctionError fails"; else bad "smoke: a FunctionError fails"; fi
: > "$LOG"; run DRY_RUN=1 "$MIRROR/scripts/smoke.sh"
if [ "$RC" = 0 ] && [ "$(calls '"curl"')" = 0 ] && none '"argv"'; then ok "smoke: DRY_RUN calls nothing"; else bad "smoke: DRY_RUN calls nothing"; fi

echo "# smoke: the pre-deploy baseline"
reset_state; rm -f "$T/before.tsv" "$T/after.tsv"
setstate 's["invoke"]["developercards-synthetic-check"] = {"ok": False, "failed": ["cdn-deck"]}'
run SMOKE_ATTEMPTS=1 SMOKE_REPORT="$T/before.tsv" "$MIRROR/scripts/smoke.sh"
if [ "$RC" = 1 ] && grep -q "$(printf 'synthetic-check\tFAIL\t.*\tcdn-deck$')" "$T/before.tsv"; then ok "baseline: a red baseline is recorded with its failing items"; else bad "baseline: a red baseline is recorded with its failing items"; fi
run SMOKE_ATTEMPTS=1 SMOKE_BASELINE="$T/before.tsv" SMOKE_REPORT="$T/after.tsv" "$MIRROR/scripts/smoke.sh"
if [ "$RC" = 0 ] && has "$T/out" "synthetic-check: TOLERATED" && grep -q "$(printf '\tTOLERATED\t')" "$T/after.tsv"; then ok "baseline: a check failing the same way before the deploy is tolerated, no rollback (rc=$RC)"; else bad "baseline: a check failing the same way before the deploy is tolerated, no rollback (rc=$RC)"; fi
setstate 's["invoke"]["developercards-synthetic-check"] = {"ok": False, "failed": ["cdn-deck", "api-auth-guard"]}'
run SMOKE_ATTEMPTS=1 SMOKE_BASELINE="$T/before.tsv" "$MIRROR/scripts/smoke.sh"
if [ "$RC" = 1 ] && has "$T/err" "new since the deploy: api-auth-guard"; then ok "baseline: a check that newly fails still fails (rc=$RC)"; else bad "baseline: a check that newly fails still fails (rc=$RC)"; fi
run SMOKE_ATTEMPTS=1 STUB_HEALTH_CODE=502 SMOKE_BASELINE="$T/before.tsv" "$MIRROR/scripts/smoke.sh"
if [ "$RC" = 1 ] && has "$T/err" "health: FAIL"; then ok "baseline: health was green before, so a 502 now fails (rc=$RC)"; else bad "baseline: health was green before, so a 502 now fails (rc=$RC)"; fi
run SMOKE_ATTEMPTS=1 SMOKE_BASELINE="$T/no-such-baseline.tsv" "$MIRROR/scripts/smoke.sh"
if [ "$RC" = 1 ] && has "$T/err" "every failure counts"; then ok "baseline: a missing baseline file means every failure counts (rc=$RC)"; else bad "baseline: a missing baseline file means every failure counts (rc=$RC)"; fi

echo "# smoke: AccessDenied on the synthetic check"
reset_state; setstate 's["invoke_denied"] = True'
run SMOKE_ATTEMPTS=1 "$MIRROR/scripts/smoke.sh"
if [ "$RC" = 3 ] && has "$T/err" "SMOKE INCOMPLETE" && has "$T/err" "AWS_PROFILE=devcards-admin"; then ok "smoke: locally, AccessDenied (devcards-deploy) is INCOMPLETE (exit 3) with the profile to use, not FAIL"; else bad "smoke: locally, AccessDenied (devcards-deploy) is INCOMPLETE (exit 3) with the profile to use, not FAIL"; fi
run SMOKE_ATTEMPTS=1 GITHUB_ACTIONS=true "$MIRROR/scripts/smoke.sh"
if [ "$RC" = 1 ] && has "$T/err" "SMOKE FAIL"; then ok "smoke: in CD, AccessDenied is a failure (the CD role must invoke it)"; else bad "smoke: in CD, AccessDenied is a failure (the CD role must invoke it)"; fi

# ===================================================================================================== plan
echo "# plan.sh"
run "$MIRROR/scripts/cd/plan.sh" classify src_C/Vpc/Db/Migrations/046.sql src_C/env/prod.env.json src_C/scripts/merge-env.sh \
  src_C/Tests/X.cs src_C/Public/P.cs src_C/README.md frontend/src/App.tsx frontend/tests/a.test.ts frontend/README.md \
  site/index.html services/ai-qa/src/ai_qa/prompts.py services/ai-qa/tests/test_x.py services/notifier/env/prod.env.json \
  services/deploy-python-lambda.sh mobile/App.tsx infra/envs/prod/main.tf docs/x.md .github/workflows/cd.yml scripts/smoke.sh
check "plan classify: the path table" [ "$(tr '\n' ' ' < "$T/out")" = "backend backend backend - - - console - - site ai-qa - notifier - - - - - - " ]
P="$T/planrepo"; PO="$T/planorigin.git"; mkdir -p "$P"; cp -R "$MIRROR/scripts" "$P/"
gp() { git -C "$P" -c user.name=t -c user.email=t@example.invalid -c commit.gpgsign=false "$@"; }
git init -q --bare "$PO"
gp init -q -b main 2>/dev/null || { gp init -q && gp checkout -q -b main; }
gp remote add origin "$PO"
mkdir -p "$P/docs" "$P/src_C/env" "$P/frontend/src" "$P/mobile" "$P/site"
echo a > "$P/docs/a.md"; gp add -A; gp commit -q -m base; C0="$(gp rev-parse HEAD)"
echo b > "$P/docs/b.md"; echo m > "$P/mobile/App.tsx"; gp add -A; gp commit -q -m docs; C1="$(gp rev-parse HEAD)"
echo c > "$P/src_C/X.cs"; echo '{"AUTOMATION_MODE":"live"}' > "$P/src_C/env/prod.env.json"; gp add -A; gp commit -q -m backend; C2="$(gp rev-parse HEAD)"
echo d > "$P/frontend/src/a.ts"; gp add -A; gp commit -q -m console; C3="$(gp rev-parse HEAD)"
gp push -q origin main
run "$P/scripts/cd/plan.sh" changed "$C0" "$C1"; if [ "$RC" = 0 ] && [ "$(cat "$T/out")" = "" ]; then ok "changed: docs + mobile only -> nothing"; else bad "changed: docs + mobile only -> nothing"; fi
run "$P/scripts/cd/plan.sh" changed "$C0" "$C3"; check "changed: since the last deployment, all commits count" [ "$(cat "$T/out")" = "backend console" ]
run "$P/scripts/cd/plan.sh" changed "$C2" "$C3"; check "changed: console only" [ "$(cat "$T/out")" = console ]
run "$P/scripts/cd/plan.sh" changed "" "$C1"; check "changed: no deployment on record -> every target" [ "$(cat "$T/out")" = "backend ai-qa notifier source-watcher synthetic-check webhook-dispatcher console site" ]
run "$P/scripts/cd/plan.sh" changed "$C3" "$C3"; if [ "$RC" = 0 ] && [ "$(cat "$T/out")" = "" ]; then ok "changed: same commit -> nothing"; else bad "changed: same commit -> nothing"; fi
run "$P/scripts/cd/plan.sh" changed "$C3" "$C1"; if [ "$RC" = 0 ] && [ "$(cat "$T/out")" = "" ] && has "$T/err" "older than the last deployment"; then ok "changed: an older commit never deploys backwards"; else bad "changed: an older commit never deploys backwards"; fi
gp checkout -q -b side "$C0"; echo s > "$P/docs/s.md"; gp add -A; gp commit -q -m side; CS="$(gp rev-parse HEAD)"; gp checkout -q main
run "$P/scripts/cd/plan.sh" changed "$CS" "$C3"; if [ "$(wc -w < "$T/out" | tr -d ' ')" = 8 ] && has "$T/err" "not an ancestor"; then ok "changed: diverged history -> every target, with a warning"; else bad "changed: diverged history -> every target, with a warning"; fi
run "$P/scripts/cd/plan.sh" changed 1111111111111111111111111111111111111111 "$C3"; check "changed: base not in the clone -> every target" [ "$(wc -w < "$T/out" | tr -d ' ')" = 8 ]
run "$P/scripts/cd/plan.sh" select "site, backend"; check "select: put in deploy order" [ "$(cat "$T/out")" = "backend site" ]
run "$P/scripts/cd/plan.sh" select all; check "select: all" [ "$(wc -w < "$T/out" | tr -d ' ')" = 8 ]
run "$P/scripts/cd/plan.sh" select "backend vpc"; check "select: unknown target -> exit 2" [ "$RC" = 2 ]
run "$P/scripts/cd/plan.sh" select 'backend;rm -rf /'; check "select: shell characters -> exit 2" [ "$RC" = 2 ]

# Deployment records, newest first. Only 4 (a rollback), 3 (partial), 2 and 1 (full) are genuine: 9 is a failed CD
# deployment with a success status added later that borrows another, successful job; 8 was set by a job of another
# workflow; 7 by a job that failed; 6 was made with a personal token; 5 failed; and 2 carries a later forged success
# status for C3 on top of its own (C1).
GH_REPO_URL="https://github.com/o/r"
python3 - "$GHD/deployments.json" <<'PY'
import json, sys
made = {9: "github-actions", 8: "github-actions", 7: "github-actions", 6: None, 5: "github-actions",
        4: "github-actions", 3: "github-actions", 2: "github-actions", 1: "github-actions"}
json.dump([{"id": i, "created_at": f"2026-10-{i:02d}T00:00:00Z",
            "performed_via_github_app": ({"slug": a} if a else None)} for i, a in made.items()], open(sys.argv[1], "w"))
PY
st() { echo "{\"state\": \"$1\", \"environment_url\": \"$2\", \"log_url\": \"$GH_REPO_URL/actions/runs/$3/job/$4\"}"; }
started() { st in_progress "" "$1" "$2"; }   # the status GitHub sets when the job that runs the deployment starts
cd_job() {   # cd_job <run> <job> <name> <conclusion> [workflow path]
  echo "{\"run_id\": $1, \"name\": \"$3\", \"status\": \"completed\", \"conclusion\": \"$4\"}" > "$GHD/job-$2.json"
  echo "{\"path\": \"${5:-.github/workflows/cd.yml}\", \"head_branch\": \"main\"}" > "$GHD/run-$1.json"
}
echo "[$(st success "$GH_REPO_URL/commit/$C3#cd-full" 20 21), $(started 90 91)]" > "$GHD/statuses-9.json"; cd_job 90 91 "deploy (production)" failure
echo "[$(st success "$GH_REPO_URL/commit/$C3#cd-full" 80 81), $(started 80 81)]" > "$GHD/statuses-8.json"; cd_job 80 81 "deploy (production)" success .github/workflows/evil.yml
echo "[$(st success "$GH_REPO_URL/commit/$C3#cd-full" 70 71), $(started 70 71)]" > "$GHD/statuses-7.json"; cd_job 70 71 "deploy (production)" failure
echo "[$(st success "$GH_REPO_URL/commit/$C3#cd-full" 60 61), $(started 60 61)]" > "$GHD/statuses-6.json"; cd_job 60 61 "deploy (production)" success
echo "[$(st failure "$GH_REPO_URL/commit/$C3#cd-full" 50 51), $(started 50 51)]" > "$GHD/statuses-5.json"; cd_job 50 51 "deploy (production)" failure
echo "[$(st success "$GH_REPO_URL/actions/runs/40#cd-rollback" 40 41), $(started 40 41)]" > "$GHD/statuses-4.json"; cd_job 40 41 "rollback (production)" success
echo "[$(st success "$GH_REPO_URL/commit/$C3#cd-partial" 30 31), $(started 30 31)]" > "$GHD/statuses-3.json"; cd_job 30 31 "deploy (production)" success
echo "[$(st success "$GH_REPO_URL/commit/$C3#cd-full" 20 21), {\"state\": \"inactive\", \"environment_url\": \"\"}, $(st success "$GH_REPO_URL/commit/$C1#cd-full" 20 21), $(started 20 21)]" > "$GHD/statuses-2.json"; cd_job 20 21 "deploy (production)" success
echo "[$(st success "$GH_REPO_URL/commit/$C0#cd-full" 10 11), $(started 10 11)]" > "$GHD/statuses-1.json"; cd_job 10 11 "deploy (production)" success
run GITHUB_REPOSITORY=o/r "$P/scripts/cd/plan.sh" last-deployed
check "last-deployed: the newest genuine #cd-full (C1), skipping failed, partial, rollback, forged, borrowed and token-made records" [ "$(cat "$T/out")" = "$C1" ]
if has "$T/err" "deployment 9 carries a success status that the job which ran it" && has "$T/err" "deployment 8 carries" && has "$T/err" "deployment 7 carries"; then ok "last-deployed: says which records it ignored"; else bad "last-deployed: says which records it ignored"; fi
run GITHUB_REPOSITORY=o/r CD_SCAN_LIMIT=5 "$P/scripts/cd/plan.sh" last-deployed
if [ "$RC" = 0 ] && [ "$(cat "$T/out")" = "" ]; then ok "last-deployed: looks at no more than CD_SCAN_LIMIT deployments"; else bad "last-deployed: looks at no more than CD_SCAN_LIMIT deployments"; fi
run GITHUB_REPOSITORY=o/other "$P/scripts/cd/plan.sh" last-deployed
if [ "$RC" = 0 ] && [ "$(cat "$T/out")" = "" ]; then ok "last-deployed: another repository's URL never counts"; else bad "last-deployed: another repository's URL never counts"; fi
run GITHUB_REPOSITORY=o/r "$P/scripts/cd/plan.sh" latest-success
check "latest-success: the newest genuine CD deployment of any kind (the rollback, 4)" [ "$(cat "$T/out")" = 4 ]
run GITHUB_REPOSITORY=o/r "$P/scripts/cd/plan.sh" still-current 4
check "still-current: no deployment since the plan -> go on (rc=$RC)" [ "$RC" = 0 ]
run GITHUB_REPOSITORY=o/r "$P/scripts/cd/plan.sh" still-current 2
if [ "$RC" = 1 ] && has "$T/err" "Re-run all jobs"; then ok "still-current: a newer deployment since the plan -> refused (a re-run of an old failed job)"; else bad "still-current: a newer deployment since the plan -> refused (a re-run of an old failed job)"; fi
run GITHUB_REPOSITORY=o/r "$P/scripts/cd/plan.sh" still-current ""
check "still-current: the plan saw none, one exists now -> refused" [ "$RC" = 1 ]
run GITHUB_REPOSITORY=o/r "$P/scripts/cd/plan.sh" still-current '4; true'
check "still-current: a malformed id refuses" [ "$RC" = 1 ]

run EVENT=workflow_run RUN_SHA="$C3" GITHUB_REPOSITORY=o/r DEPLOY_REPO=o/r GITHUB_STEP_SUMMARY="$T/summary.md" "$P/scripts/cd/plan.sh" decide
if [ "$RC" = 0 ] && has "$T/out" "targets=backend console" && has "$T/out" "base=$C1" && has "$T/out" "last_success=4"; then ok "decide (push): targets since the last full deployment, and the newest deployment it saw"; else bad "decide (push): targets since the last full deployment, and the newest deployment it saw"; fi
if has "$T/out" "deploy=true" && has "$T/out" "scope=full" && has "$T/out" "has_backend=true" && has "$T/out" "has_site=false" && has "$T/out" "python="; then ok "decide (push): deploy=true, scope=full, flags"; else bad "decide (push): deploy=true, scope=full, flags"; fi
check "decide: stdout is only key=value lines (GITHUB_OUTPUT)" [ "$(grep -cv '^[a-z_]*=' "$T/out")" = 0 ]
check "decide: writes the plan to the step summary, one line per item" grep -qx -- "- targets: backend console" "$T/summary.md"
check "decide: flags a changed environment file for the approver" grep -q "environment files changed.*src_C/env/prod.env.json" "$T/summary.md"
run EVENT=workflow_run RUN_SHA="$CS" GITHUB_REPOSITORY=o/r DEPLOY_REPO=o/r "$P/scripts/cd/plan.sh" decide
if [ "$RC" = 1 ] && has "$T/err" "is not on main" && hasnt "$T/out" "deploy=true"; then ok "decide (push): a commit that is not on main (a tag named main) is refused"; else bad "decide (push): a commit that is not on main (a tag named main) is refused"; fi
ci_runs "$C3" 700 > "$GHD/ci-runs-$C3.json"; jobs_green 700; jobs_edit 700 'd["jobs"][0]["conclusion"] = "failure"'
run EVENT=workflow_run RUN_SHA="$C1" GITHUB_REPOSITORY=o/r DEPLOY_REPO=o/r "$P/scripts/cd/plan.sh" decide
if [ "$RC" = 0 ] && has "$T/out" "deploy=false" && has "$T/out" "sha=$C1" && has "$T/err" "::warning::main has newer commits"; then ok "decide (push, nothing new; main's tip not green): deploy=false, with a warning naming the newer commits"; else bad "decide (push, nothing new; main's tip not green): deploy=false, with a warning naming the newer commits"; fi
rm "$GHD/ci-runs-$C3.json"
run EVENT=workflow_run RUN_SHA="$C1" GITHUB_REPOSITORY=o/r DEPLOY_REPO=o/r GITHUB_STEP_SUMMARY="$T/summary2.md" "$P/scripts/cd/plan.sh" decide
if [ "$RC" = 0 ] && has "$T/out" "sha=$C3" && has "$T/out" "targets=backend console" && grep -q "CI started this run for .$C1" "$T/summary2.md"; then ok "decide (push, out of order): main's tip is newer and green -> this run deploys the tip"; else bad "decide (push, out of order): main's tip is newer and green -> this run deploys the tip"; fi
mv "$GHD/statuses-3.json" "$T/statuses-3.json"
run EVENT=workflow_run RUN_SHA="$C3" GITHUB_REPOSITORY=o/r DEPLOY_REPO=o/r "$P/scripts/cd/plan.sh" decide
check "decide: a GitHub API error fails the plan instead of guessing (rc=$RC)" [ "$RC" = 1 ]
mv "$T/statuses-3.json" "$GHD/statuses-3.json"
run EVENT=workflow_dispatch REF=refs/heads/feature DISPATCH_SHA="$C3" GITHUB_REPOSITORY=o/r "$P/scripts/cd/plan.sh" decide
if [ "$RC" = 1 ] && has "$T/err" "CD deploys main only"; then ok "decide (dispatch): refused off main"; else bad "decide (dispatch): refused off main"; fi
run EVENT=workflow_dispatch REF=refs/heads/main DISPATCH_SHA="$C3" IN_TARGETS="site console" GITHUB_REPOSITORY=o/r DEPLOY_REPO=o/r "$P/scripts/cd/plan.sh" decide
if [ "$RC" = 0 ] && has "$T/out" "targets=console site" && has "$T/out" "scope=partial" && has "$T/out" "last_success=4"; then ok "decide (dispatch): explicit list -> partial, with the newest deployment it saw"; else bad "decide (dispatch): explicit list -> partial, with the newest deployment it saw"; fi
run EVENT=workflow_dispatch REF=refs/heads/main DISPATCH_SHA="$C3" IN_TARGETS=all GITHUB_REPOSITORY=o/r DEPLOY_REPO=o/r "$P/scripts/cd/plan.sh" decide
if has "$T/out" "scope=full" && has "$T/out" "python=ai-qa notifier source-watcher synthetic-check webhook-dispatcher"; then ok "decide (dispatch): all -> full"; else bad "decide (dispatch): all -> full"; fi
ci_runs "$C3" 701 > "$GHD/ci-runs-$C3.json"; jobs_green 701; jobs_edit 701 'd["jobs"][0]["conclusion"] = "failure"'
run EVENT=workflow_dispatch REF=refs/heads/main DISPATCH_SHA="$C3" IN_TARGETS=all GITHUB_REPOSITORY=o/r DEPLOY_REPO=o/r "$P/scripts/cd/plan.sh" decide
if [ "$RC" = 1 ] && has "$T/err" "CD deploys green commits only"; then ok "decide (dispatch): red CI on main refuses"; else bad "decide (dispatch): red CI on main refuses"; fi
rm "$GHD/ci-runs-$C3.json"
run EVENT=workflow_dispatch REF=refs/heads/main DISPATCH_SHA="$C3" IN_ROLLBACK_TARGET=worker IN_ROLLBACK_VERSION=26 GITHUB_REPOSITORY=o/r "$P/scripts/cd/plan.sh" decide
if [ "$RC" = 0 ] && has "$T/out" "mode=rollback" && has "$T/out" "deploy=false" && has "$T/out" "rollback_version=26" && has "$T/out" "last_success=4"; then ok "decide (dispatch): rollback mode, no deploy, with the newest deployment it saw"; else bad "decide (dispatch): rollback mode, no deploy, with the newest deployment it saw"; fi
run EVENT=workflow_dispatch REF=refs/heads/main DISPATCH_SHA="$C3" IN_ROLLBACK_TARGET=worker IN_ROLLBACK_VERSION='26; true' GITHUB_REPOSITORY=o/r "$P/scripts/cd/plan.sh" decide
check "decide (dispatch): a non-numeric rollback version refuses" [ "$RC" = 1 ]
run EVENT=pull_request GITHUB_REPOSITORY=o/r "$P/scripts/cd/plan.sh" decide
check "decide: any other event refuses" [ "$RC" = 1 ]
echo e > "$P/site/index.html"; gp add -A; gp commit -q -m site; C4="$(gp rev-parse HEAD)"; gp push -q origin main
run EVENT=workflow_run RUN_SHA="$C3" GITHUB_REPOSITORY=o/r DEPLOY_REPO=o/r "$P/scripts/cd/plan.sh" decide
if [ "$RC" = 0 ] && has "$T/out" "sha=$C4" && has "$T/out" "targets=backend console site"; then ok "decide (push): a run replaced in the queue by an older one still deploys main's green tip"; else bad "decide (push): a run replaced in the queue by an older one still deploys main's green tip"; fi

# ===================================================================================================== artifact
echo "# artifact.sh"
OUT="$T/cd-out"
# resum <dir> → rewrite <dir>/SHA256SUMS for the files in it (the way a compromised build job would) and print its sha256
resum() {
  python3 - "$1" <<'PY'
import hashlib, os, sys
d = sys.argv[1]
files = sorted(os.path.relpath(os.path.join(r, f), d) for r, _, fs in os.walk(d) for f in fs if f != "SHA256SUMS")
open(os.path.join(d, "SHA256SUMS"), "w").write("".join(f"{hashlib.sha256(open(os.path.join(d, f), 'rb').read()).hexdigest()}  {f}\n" for f in files))
print(hashlib.sha256(open(os.path.join(d, "SHA256SUMS"), "rb").read()).hexdigest())
PY
}
run "$MIRROR/scripts/cd/artifact.sh" stage "$OUT" backend synthetic-check console site
if [ "$RC" = 0 ] && grep -qE '^[0-9a-f]{64}$' "$T/out"; then ok "stage: rc=$RC, prints a sha256"; else bad "stage: rc=$RC, prints a sha256"; fi
SUM="$(cat "$T/out")"
check "stage: SHA256SUMS lists the four files and TARGETS" [ "$(wc -l < "$OUT/SHA256SUMS" | tr -d ' ')" = 5 ]
rm -rf "$MIRROR/src_C/dist" "$MIRROR/frontend/dist"
run "$MIRROR/scripts/cd/artifact.sh" verify "$OUT" "$SUM" backend synthetic-check console site
if [ "$RC" = 0 ] && [ -s "$MIRROR/src_C/dist/vpc.zip" ] && [ -f "$MIRROR/frontend/dist/index.html" ]; then ok "verify: rc=$RC, files back in place"; else bad "verify: rc=$RC, files back in place"; fi
run "$MIRROR/scripts/cd/artifact.sh" verify "$OUT" "$SUM" backend synthetic-check console
if [ "$RC" = 1 ] && has "$T/err" "refusing to deploy"; then ok "verify: an artifact built for another target list refuses"; else bad "verify: an artifact built for another target list refuses"; fi
run "$MIRROR/scripts/cd/artifact.sh" verify "$OUT" "$(printf '%064d' 0)" backend
if [ "$RC" = 1 ] && has "$T/err" "refusing to deploy"; then ok "verify: a manifest the build job did not make refuses"; else bad "verify: a manifest the build job did not make refuses"; fi
printf 'tampered\n' >> "$OUT/src_C/dist/vpc.zip"
run "$MIRROR/scripts/cd/artifact.sh" verify "$OUT" "$SUM" backend synthetic-check console site
check "verify: a changed file refuses" [ "$RC" = 1 ]
run "$MIRROR/scripts/cd/artifact.sh" stage "$OUT" backend
SUM="$(cat "$T/out")"
printf 'extra\n' > "$OUT/extra.bin"
run "$MIRROR/scripts/cd/artifact.sh" verify "$OUT" "$SUM" backend
check "verify: an unlisted extra file refuses" [ "$RC" = 1 ]
rm "$OUT/extra.bin"
run "$MIRROR/scripts/cd/artifact.sh" verify "$OUT" "$SUM" backend console
if [ "$RC" = 1 ] && has "$T/err" "frontend/console-dist.tgz"; then ok "verify: a target whose file is absent refuses"; else bad "verify: a target whose file is absent refuses"; fi

echo "# artifact.sh: a site-only deploy"
run "$MIRROR/scripts/cd/artifact.sh" stage "$OUT" site
if [ "$RC" = 0 ] && [ "$(cut -c67- "$OUT/SHA256SUMS")" = TARGETS ]; then ok "stage: site alone stages TARGETS only (rc=$RC)"; else bad "stage: site alone stages TARGETS only (rc=$RC)"; fi
SUM="$(cat "$T/out")"
run "$MIRROR/scripts/cd/artifact.sh" verify "$OUT" "$SUM" site
check "verify: site alone verifies (rc=$RC)" [ "$RC" = 0 ]

echo "# artifact.sh: a build job that adds files"
smoke_before="$(cat "$MIRROR/scripts/smoke.sh")"; deploy_before="$(cat "$MIRROR/frontend/deploy.sh")"
run "$MIRROR/scripts/cd/artifact.sh" stage "$OUT" console
mkdir -p "$OUT/scripts"; printf 'echo PWNED\n' > "$OUT/scripts/smoke.sh"; SUM="$(resum "$OUT")"
run "$MIRROR/scripts/cd/artifact.sh" verify "$OUT" "$SUM" console
if [ "$RC" = 1 ] && has "$T/err" "need exactly" && [ "$(cat "$MIRROR/scripts/smoke.sh")" = "$smoke_before" ]; then ok "verify: a listed file no target needs (scripts/smoke.sh) refuses, nothing overwritten"; else bad "verify: a listed file no target needs (scripts/smoke.sh) refuses, nothing overwritten"; fi
evil_tgz() {   # evil_tgz <kind>: a console-dist.tgz with dist/index.html plus one bad member, re-summed
  run "$MIRROR/scripts/cd/artifact.sh" stage "$OUT" console
  python3 - "$OUT/frontend/console-dist.tgz" "$1" <<'PY'
import io, sys, tarfile
path, kind = sys.argv[1], sys.argv[2]
with tarfile.open(path, "w:gz") as t:
    def add(name, data=b"x", **kw):
        info = tarfile.TarInfo(name)
        for k, v in kw.items():
            setattr(info, k, v)
        if info.type == tarfile.REGTYPE:
            info.size = len(data)
            t.addfile(info, io.BytesIO(data))
        else:
            t.addfile(info)
    add("dist/index.html", b"<html>evil</html>")
    if kind == "outside":
        add("deploy.sh", b"echo PWNED\n")
    elif kind == "symlink":
        add("dist/link", type=tarfile.SYMTYPE, linkname="/etc/passwd")
    elif kind == "hardlink":
        add("dist/hard", type=tarfile.LNKTYPE, linkname="dist/index.html")
    elif kind == "dotdot":
        add("dist/../deploy.sh", b"echo PWNED\n")
PY
  SUM="$(resum "$OUT")"
  run "$MIRROR/scripts/cd/artifact.sh" verify "$OUT" "$SUM" console
}
printf '<html>kept</html>\n' > "$MIRROR/frontend/dist/index.html"
for kind in outside symlink hardlink dotdot; do
  evil_tgz "$kind"
  if [ "$RC" = 1 ] && has "$T/err" "refusing to deploy" && [ "$(cat "$MIRROR/frontend/deploy.sh")" = "$deploy_before" ] && has "$MIRROR/frontend/dist/index.html" "kept"; then
    ok "verify: a console tarball with a member $kind dist/ (or a link) refuses, frontend/ untouched"
  else
    bad "verify: a console tarball with a member $kind dist/ (or a link) refuses, frontend/ untouched"
  fi
done

echo
echo "cd-scripts.test.sh: $PASS passed, $FAILED failed"
[ "$FAILED" = 0 ]
