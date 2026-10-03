#!/usr/bin/env bash
# scripts/tests/cd-scripts.test.sh — offline tests of the CD and deploy scripts against fake `aws`, `gh` and `curl`
# (scripts/tests/stubs/) first on PATH. No network, no AWS, no credentials: every child runs under `env -i` with only
# the variables a case sets, so neither the owner's AWS_PROFILE nor a CI variable can leak in.
#
#   bash scripts/tests/cd-scripts.test.sh        # CI: job "infra"; needs bash, git, jq, python3, openssl, zip
#
# Covered: PREBUILT in src_C/deploy.sh, frontend/deploy.sh and services/deploy-python-lambda.sh (no build tool is ever
# called); the AWS_PROFILE default in all four deploy scripts (only when the environment has no credentials); the
# local preflight (clean tree, HEAD = origin/main, required checks; BREAK_GLASS=1; DRY_RUN and GitHub Actions skip it);
# scripts/rollback.sh; scripts/cd/restore-point.sh record/restore; scripts/smoke.sh; scripts/cd/plan.sh (classify,
# changed, select, last-deployed, decide); scripts/cd/artifact.sh stage/verify; and the static facts of
# .github/workflows/cd.yml that a wrong edit would break (pinned actions, OIDC only where approved, the concurrency
# condition = the plan job's `if`, required check names = ci.yml job names).
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
  rm -rf "$S3"; mkdir -p "$S3/recallsmith-console-622994489535" "$S3/developercards-site-622994489535"
  printf '<html>old console</html>\n' > "$S3/recallsmith-console-622994489535/index.html"
  printf 'old chunk\n' > "$S3/recallsmith-console-622994489535/app-old.js"
  printf '<html>old site</html>\n' > "$S3/developercards-site-622994489535/index.html"
  printf 'old css\n' > "$S3/developercards-site-622994489535/styles.css"
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

all_green() {   # all_green <file> → check runs: every required check succeeded
  "$REPO/scripts/deploy-preflight.sh" --list-checks | python3 -c '
import json, sys
names = [l.rstrip("\n") for l in sys.stdin if l.strip()]
print(json.dumps({"check_runs": [{"id": i + 1, "name": n, "status": "completed", "conclusion": "success"} for i, n in enumerate(names)]}))' > "$1"
}

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
all_green "$GHD/check-runs.json"

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
python3 - "$CD" > "$T/cdfacts" <<'PY'
import re, sys
text = open(sys.argv[1]).read()
norm = lambda s: re.sub(r"\s+", " ", s).strip()
group = re.search(r"concurrency:\n  group: >-\n(.*?)\n  cancel-in-progress", text, re.S).group(1)
cond_group = norm(re.search(r"\$\{\{ \((.*)\)\s*&& 'production'", norm(group)).group(1))
plan_if = re.search(r"\n  plan:\n.*?\n    if: >-\n(.*?)\n    runs-on", text, re.S).group(1)
main_only = "(github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main')"
print("same_condition", cond_group == norm(plan_if).replace("github.event_name == 'workflow_dispatch'", main_only, 1))
uses = re.findall(r"uses: (\S+)(.*)", text)
print("pinned", all(re.fullmatch(r"[\w.-]+/[\w.-]+@[0-9a-f]{40}", u) and re.fullmatch(r" # v\d+\.\d+\.\d+", c) for u, c in uses), len(uses))
jobs = re.split(r"\n  (?=[a-z][\w-]*:\n)", text.split("\njobs:\n", 1)[1])
env_jobs = sorted(j.split(":", 1)[0] for j in jobs if "\n    environment:" in j)
oidc_jobs = sorted(j.split(":", 1)[0] for j in jobs if "id-token: write" in j)
print("environment_jobs", ",".join(env_jobs))
print("oidc_jobs", ",".join(oidc_jobs))
print("top_permissions", "\npermissions:\n  contents: read\n" in text)
print("no_cancel", "cancel-in-progress: false" in text)
print("role", "role-to-assume: arn:aws:iam::622994489535:role/developercards-gha-prod" in text)
print("workflow_run", bool(re.search(r"workflow_run:\n    workflows: \[CI\]\n    types: \[completed\]\n    branches: \[main\]", text)))
PY
check "cd.yml: concurrency condition = plan job's if + main-only dispatch" has "$T/cdfacts" "same_condition True"
check "cd.yml: every uses: pinned to a 40-hex SHA with # vX.Y.Z" grep -q '^pinned True' "$T/cdfacts"
check "cd.yml: only deploy and rollback name an environment" has "$T/cdfacts" "environment_jobs deploy,rollback"
check "cd.yml: only deploy and rollback get id-token: write" has "$T/cdfacts" "oidc_jobs deploy,rollback"
check "cd.yml: top-level permissions contents: read" has "$T/cdfacts" "top_permissions True"
check "cd.yml: never cancels in-flight" has "$T/cdfacts" "no_cancel True"
check "cd.yml: assumes developercards-gha-prod" has "$T/cdfacts" "role True"
check "cd.yml: triggered by CI completing on main" has "$T/cdfacts" "workflow_run True"
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
# deploy_cmd <name> → the env-free command line that deploys that script for real against the stubs
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
python3 - "$STATE" <<'PY'
import json, sys
s = json.load(open(sys.argv[1])); s["dsn"] = ""; json.dump(s, open(sys.argv[1], "w"))
PY
: > "$LOG"; run PREBUILT=1 GITHUB_ACTIONS=true "$MIRROR/frontend/deploy.sh"
check "console PREBUILT: no DSN in SSM -> nothing to compare, deploys (rc=$RC)" [ "$RC" = 0 ]
printf 'const dsn="%s";\n' "$DSN" > "$MIRROR/frontend/dist/assets/app-new.js"

# ===================================================================================================== preflight
echo "# local preflight"
reset_state; run PREBUILT=1 "$MIRROR/src_C/deploy.sh"
if [ "$RC" = 0 ] && has "$T/out" "preflight (src_C/deploy.sh): OK"; then ok "preflight: clean tree at origin/main with green CI deploys (rc=$RC)"; else bad "preflight: clean tree at origin/main with green CI deploys (rc=$RC)"; fi
check "preflight: asked GitHub for the check runs of HEAD" [ "$(calls "commits/$HEAD_SHA/check-runs")" -ge 1 ]
printf 'x\n' > "$MIRROR/src_C/untracked.cs"
reset_state; run PREBUILT=1 "$MIRROR/src_C/deploy.sh"
if [ "$RC" = 1 ] && has "$T/err" "working tree is not clean"; then ok "preflight: an untracked file refuses (rc=$RC)"; else bad "preflight: an untracked file refuses (rc=$RC)"; fi
check "preflight: ... before any AWS call" none '"argv"'
reset_state; run PREBUILT=1 BREAK_GLASS=1 "$MIRROR/src_C/deploy.sh"
if [ "$RC" = 0 ] && [ "$(jstate 's["functions"]["core-vpc"]["alias"]')" = 76 ]; then ok "preflight: BREAK_GLASS=1 deploys anyway (rc=$RC)"; else bad "preflight: BREAK_GLASS=1 deploys anyway (rc=$RC)"; fi
check "preflight: ... with a loud warning" has "$T/err" "BREAK_GLASS=1: deploying ANYWAY"
reset_state; run PREBUILT=1 "$MIRROR/frontend/deploy.sh"
if [ "$RC" = 1 ] && none '"s3", "sync"'; then ok "preflight: frontend/deploy.sh refuses a dirty tree too (rc=$RC)"; else bad "preflight: frontend/deploy.sh refuses a dirty tree too (rc=$RC)"; fi
run DRY_RUN=1 "$MIRROR/scripts/deploy-preflight.sh" test
if [ "$RC" = 0 ] && has "$T/out" "skipped, DRY_RUN=1"; then ok "preflight: DRY_RUN=1 never needs it (rc=$RC)"; else bad "preflight: DRY_RUN=1 never needs it (rc=$RC)"; fi
run GITHUB_ACTIONS=true "$MIRROR/scripts/deploy-preflight.sh" test
check "preflight: skipped inside GitHub Actions (rc=$RC)" [ "$RC" = 0 ]
rm "$MIRROR/src_C/untracked.cs"
git_m commit -q --allow-empty -m "local only"
reset_state; run PREBUILT=1 "$MIRROR/src_C/deploy.sh"
if [ "$RC" = 1 ] && has "$T/err" "is not origin/main"; then ok "preflight: HEAD ahead of origin/main refuses (rc=$RC)"; else bad "preflight: HEAD ahead of origin/main refuses (rc=$RC)"; fi
git_m reset -q --hard "$HEAD_SHA"
python3 - "$GHD/check-runs.json" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
d["check_runs"][3]["conclusion"] = "failure"
json.dump(d, open(sys.argv[1], "w"))
PY
reset_state; run PREBUILT=1 "$MIRROR/src_C/deploy.sh"
if [ "$RC" = 1 ] && has "$T/out" "completed/failure  backend (dotnet test)"; then ok "preflight: a failed required check refuses (rc=$RC)"; else bad "preflight: a failed required check refuses (rc=$RC)"; fi
python3 - "$GHD/check-runs.json" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
d["check_runs"].append(dict(d["check_runs"][3], id=99, conclusion="success"))
json.dump(d, open(sys.argv[1], "w"))
PY
reset_state; run PREBUILT=1 "$MIRROR/src_C/deploy.sh"
check "preflight: a re-run that succeeded counts (latest attempt wins) (rc=$RC)" [ "$RC" = 0 ]
python3 - "$GHD/check-runs.json" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
d["check_runs"] = [c for c in d["check_runs"] if c["name"] != "frontend (playwright smoke)"]
json.dump(d, open(sys.argv[1], "w"))
PY
reset_state; run PREBUILT=1 "$MIRROR/src_C/deploy.sh"
if [ "$RC" = 1 ] && has "$T/out" "MISSING  frontend (playwright smoke)"; then ok "preflight: a missing required check refuses (rc=$RC)"; else bad "preflight: a missing required check refuses (rc=$RC)"; fi
rm "$GHD/check-runs.json"
reset_state; run PREBUILT=1 "$MIRROR/src_C/deploy.sh"
if [ "$RC" = 1 ] && has "$T/err" "could not be read"; then ok "preflight: unreadable CI result refuses (rc=$RC)"; else bad "preflight: unreadable CI result refuses (rc=$RC)"; fi
all_green "$GHD/check-runs.json"

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
python3 - "$STATE" <<'PY'
import json, sys
s = json.load(open(sys.argv[1])); s["functions"]["worker-lambda"]["versions"]["24"]["state"] = "Failed"; json.dump(s, open(sys.argv[1], "w"))
PY
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
run PREBUILT=1 "$MIRROR/services/deploy-python-lambda.sh" notifier || true
mkdir -p "$MIRROR/services/notifier/src/notifier" "$MIRROR/services/notifier/env" "$MIRROR/services/notifier/build"
printf '[project]\nname="n"\n' > "$MIRROR/services/notifier/pyproject.toml"
printf '{}\n' > "$MIRROR/services/notifier/env/prod.env.json"
printf 'n zip\n' > "$MIRROR/services/notifier/build/notifier.zip"
git_m add services/notifier && git_m commit -q -m notifier
run PREBUILT=1 "$MIRROR/services/deploy-python-lambda.sh" notifier
if [ "$RC" = 0 ] && [ "$(jstate 's["functions"]["developercards-notifier"]["alias"]')" = 2 ]; then ok "notifier first deploy (alias on \$LATEST) froze the live code (rc=$RC)"; else bad "notifier first deploy (alias on \$LATEST) froze the live code (rc=$RC)"; fi
run PREBUILT=1 GITHUB_ACTIONS=true "$MIRROR/frontend/deploy.sh"
run SITE_DISTRIBUTION_ID=EML9BSZ8EXMQ1 "$MIRROR/site/deploy.sh"
check "site deploy replaced the bucket" hasnt "$S3/developercards-site-622994489535/index.html" "old site"
run SITE_DISTRIBUTION_ID=EML9BSZ8EXMQ1 "$MIRROR/scripts/cd/restore-point.sh" restore "$RP"
if [ "$RC" = 0 ] && has "$T/out" "ROLLBACK OK"; then ok "restore: rc=$RC"; else bad "restore: rc=$RC"; fi
check "restore: core-vpc back on 75" [ "$(jstate 's["functions"]["core-vpc"]["alias"]')" = 75 ]
check "restore: worker-lambda back on 27" [ "$(jstate 's["functions"]["worker-lambda"]["alias"]')" = 27 ]
check "restore: synthetic-check back on 3" [ "$(jstate 's["functions"]["developercards-synthetic-check"]["alias"]')" = 3 ]
check "restore: notifier (was \$LATEST) back on its freeze version 1, never \$LATEST" [ "$(jstate 's["functions"]["developercards-notifier"]["alias"]')" = 1 ]
check "restore: console index.html back to the old build" has "$S3/recallsmith-console-622994489535/index.html" "old console"
if has "$S3/developercards-site-622994489535/index.html" "old site" && has "$S3/developercards-site-622994489535/styles.css" "old css"; then ok "restore: site bucket back"; else bad "restore: site bucket back"; fi
run "$MIRROR/scripts/cd/restore-point.sh" restore "$RP"
if [ "$RC" = 0 ] && has "$T/out" "unchanged core-vpc:prod = 75" && has "$T/out" "unchanged console index.html"; then ok "restore: second run changes nothing"; else bad "restore: second run changes nothing"; fi
run "$MIRROR/scripts/cd/restore-point.sh" restore "$T/never-recorded"
if [ "$RC" = 0 ] && has "$T/out" "nothing was recorded"; then ok "restore: no restore point -> nothing to do, rc=0"; else bad "restore: no restore point -> nothing to do, rc=0"; fi
run "$MIRROR/scripts/cd/restore-point.sh" summary "$RP"
check "summary: a row with the rollback command" has "$T/out" '`scripts/rollback.sh vpc 75`'
python3 - "$STATE" <<'PY'
import json, sys
s = json.load(open(sys.argv[1])); s["functions"]["core-vpc"]["alias"] = "76"; s["functions"]["core-vpc"]["versions"]["75"]["state"] = "Failed"; json.dump(s, open(sys.argv[1], "w"))
PY
run "$MIRROR/scripts/cd/restore-point.sh" restore "$RP"
if [ "$RC" = 1 ] && has "$T/err" "ROLLBACK INCOMPLETE"; then ok "restore: a failed item -> rc=1 and ROLLBACK INCOMPLETE"; else bad "restore: a failed item -> rc=1 and ROLLBACK INCOMPLETE"; fi

# ===================================================================================================== smoke
echo "# smoke"
reset_state
run SMOKE_ATTEMPTS=1 SMOKE_REPORT="$T/smoke.tsv" "$MIRROR/scripts/smoke.sh"
if [ "$RC" = 0 ] && has "$T/out" "SMOKE OK"; then ok "smoke: healthy production passes (rc=$RC)"; else bad "smoke: healthy production passes (rc=$RC)"; fi
if has "$LOG" '"--function-name", "developercards-synthetic-check:prod"' && has "$LOG" '{\"job\":\"synthetic-check\"}'; then ok "smoke: invoked synthetic-check:prod with the job payload"; else bad "smoke: invoked synthetic-check:prod with the job payload"; fi
check "smoke: report has two PASS lines" [ "$(grep -c PASS "$T/smoke.tsv")" = 2 ]
run SMOKE_ATTEMPTS=2 SMOKE_RETRY_SECONDS=0 STUB_HEALTH_CODE=502 "$MIRROR/scripts/smoke.sh"
if [ "$RC" = 1 ] && has "$T/err" "health: FAIL after 2 attempt(s): HTTP 502"; then ok "smoke: /health 502 fails after the retries (rc=$RC)"; else bad "smoke: /health 502 fails after the retries (rc=$RC)"; fi
run SMOKE_ATTEMPTS=1 STUB_HEALTH_BODY='{"success":true,"data":{"ok":false}}' "$MIRROR/scripts/smoke.sh"
check "smoke: 200 without ok:true fails" [ "$RC" = 1 ]
python3 - "$STATE" <<'PY'
import json, sys
s = json.load(open(sys.argv[1])); s["invoke"]["developercards-synthetic-check"] = {"ok": False, "failed": ["cdn-deck", "console-index"]}; json.dump(s, open(sys.argv[1], "w"))
PY
run SMOKE_ATTEMPTS=1 "$MIRROR/scripts/smoke.sh"
if [ "$RC" = 1 ] && has "$T/err" "failed checks: cdn-deck, console-index"; then ok "smoke: a failed synthetic check fails and names it (rc=$RC)"; else bad "smoke: a failed synthetic check fails and names it (rc=$RC)"; fi
python3 - "$STATE" <<'PY'
import json, sys
s = json.load(open(sys.argv[1])); s["invoke"]["developercards-synthetic-check"] = {"ok": True, "failed": ["api-auth-guard"]}; json.dump(s, open(sys.argv[1], "w"))
PY
run SMOKE_ATTEMPTS=1 "$MIRROR/scripts/smoke.sh"
if [ "$RC" = 1 ] && has "$T/err" "failed checks: api-auth-guard"; then ok "smoke: ok true with a non-empty failed list still fails"; else bad "smoke: ok true with a non-empty failed list still fails"; fi
python3 - "$STATE" <<'PY'
import json, sys
s = json.load(open(sys.argv[1])); s["invoke"]["developercards-synthetic-check"] = {"ok": True, "failed": []}; s["invoke_error"] = "Unhandled"; json.dump(s, open(sys.argv[1], "w"))
PY
run SMOKE_ATTEMPTS=1 "$MIRROR/scripts/smoke.sh"
if [ "$RC" = 1 ] && has "$T/err" "FunctionError=Unhandled"; then ok "smoke: a FunctionError fails"; else bad "smoke: a FunctionError fails"; fi
: > "$LOG"; run DRY_RUN=1 "$MIRROR/scripts/smoke.sh"
if [ "$RC" = 0 ] && [ "$(calls '"curl"')" = 0 ] && none '"argv"'; then ok "smoke: DRY_RUN calls nothing"; else bad "smoke: DRY_RUN calls nothing"; fi

# ===================================================================================================== plan
echo "# plan.sh"
run "$MIRROR/scripts/cd/plan.sh" classify src_C/Vpc/Db/Migrations/046.sql src_C/env/prod.env.json src_C/scripts/merge-env.sh \
  src_C/Tests/X.cs src_C/Public/P.cs src_C/README.md frontend/src/App.tsx frontend/tests/a.test.ts frontend/README.md \
  site/index.html services/ai-qa/src/ai_qa/prompts.py services/ai-qa/tests/test_x.py services/notifier/env/prod.env.json \
  services/deploy-python-lambda.sh mobile/App.tsx infra/envs/prod/main.tf docs/x.md .github/workflows/cd.yml scripts/smoke.sh
check "plan classify: the path table" [ "$(tr '\n' ' ' < "$T/out")" = "backend backend backend - - - console - - site ai-qa - notifier - - - - - - " ]
P="$T/planrepo"; mkdir -p "$P"; cp -R "$MIRROR/scripts" "$P/"
gp() { git -C "$P" -c user.name=t -c user.email=t@example.invalid -c commit.gpgsign=false "$@"; }
gp init -q; mkdir -p "$P/docs" "$P/src_C" "$P/frontend/src" "$P/mobile"
echo a > "$P/docs/a.md"; gp add -A; gp commit -q -m base; C0="$(gp rev-parse HEAD)"
echo b > "$P/docs/b.md"; echo m > "$P/mobile/App.tsx"; gp add -A; gp commit -q -m docs; C1="$(gp rev-parse HEAD)"
echo c > "$P/src_C/X.cs"; gp add -A; gp commit -q -m backend; C2="$(gp rev-parse HEAD)"
echo d > "$P/frontend/src/a.ts"; gp add -A; gp commit -q -m console; C3="$(gp rev-parse HEAD)"
run "$P/scripts/cd/plan.sh" changed "$C0" "$C1"; if [ "$RC" = 0 ] && [ "$(cat "$T/out")" = "" ]; then ok "changed: docs + mobile only -> nothing"; else bad "changed: docs + mobile only -> nothing"; fi
run "$P/scripts/cd/plan.sh" changed "$C0" "$C3"; check "changed: since the last deployment, all commits count" [ "$(cat "$T/out")" = "backend console" ]
run "$P/scripts/cd/plan.sh" changed "$C2" "$C3"; check "changed: console only" [ "$(cat "$T/out")" = console ]
run "$P/scripts/cd/plan.sh" changed "" "$C1"; check "changed: no deployment on record -> every target" [ "$(cat "$T/out")" = "backend ai-qa notifier source-watcher synthetic-check webhook-dispatcher console site" ]
run "$P/scripts/cd/plan.sh" changed "$C3" "$C3"; if [ "$RC" = 0 ] && [ "$(cat "$T/out")" = "" ]; then ok "changed: same commit -> nothing"; else bad "changed: same commit -> nothing"; fi
run "$P/scripts/cd/plan.sh" changed "$C3" "$C1"; if [ "$RC" = 0 ] && [ "$(cat "$T/out")" = "" ] && has "$T/err" "older than the last deployment"; then ok "changed: an older commit never deploys backwards"; else bad "changed: an older commit never deploys backwards"; fi
gp checkout -q -b side "$C0"; echo s > "$P/docs/s.md"; gp add -A; gp commit -q -m side; CS="$(gp rev-parse HEAD)"; gp checkout -q -
run "$P/scripts/cd/plan.sh" changed "$CS" "$C3"; if [ "$(wc -w < "$T/out" | tr -d ' ')" = 8 ] && has "$T/err" "not an ancestor"; then ok "changed: diverged history -> every target, with a warning"; else bad "changed: diverged history -> every target, with a warning"; fi
run "$P/scripts/cd/plan.sh" changed 1111111111111111111111111111111111111111 "$C3"; check "changed: base not in the clone -> every target" [ "$(wc -w < "$T/out" | tr -d ' ')" = 8 ]
run "$P/scripts/cd/plan.sh" select "site, backend"; check "select: put in deploy order" [ "$(cat "$T/out")" = "backend site" ]
run "$P/scripts/cd/plan.sh" select all; check "select: all" [ "$(wc -w < "$T/out" | tr -d ' ')" = 8 ]
run "$P/scripts/cd/plan.sh" select "backend vpc"; check "select: unknown target -> exit 2" [ "$RC" = 2 ]
run "$P/scripts/cd/plan.sh" select 'backend;rm -rf /'; check "select: shell characters -> exit 2" [ "$RC" = 2 ]

cat > "$GHD/deployments.json" <<EOF
[{"id": 5, "created_at": "2026-10-05T00:00:00Z"}, {"id": 4, "created_at": "2026-10-04T00:00:00Z"},
 {"id": 3, "created_at": "2026-10-03T00:00:00Z"}, {"id": 2, "created_at": "2026-10-02T00:00:00Z"},
 {"id": 1, "created_at": "2026-10-01T00:00:00Z"}]
EOF
echo "[{\"state\": \"failure\", \"environment_url\": \"https://github.com/o/r/commit/$C3#cd-full\"}]" > "$GHD/statuses-5.json"
echo "[{\"state\": \"success\", \"environment_url\": \"https://github.com/o/r/actions/runs/9#cd-rollback\"}]" > "$GHD/statuses-4.json"
echo "[{\"state\": \"success\", \"environment_url\": \"https://github.com/o/r/commit/$C3#cd-partial\"}]" > "$GHD/statuses-3.json"
echo "[{\"state\": \"inactive\", \"environment_url\": \"\"}, {\"state\": \"success\", \"environment_url\": \"https://github.com/o/r/commit/$C1#cd-full\"}]" > "$GHD/statuses-2.json"
echo "[{\"state\": \"success\", \"environment_url\": \"https://github.com/o/r/commit/$C0#cd-full\"}]" > "$GHD/statuses-1.json"
run GITHUB_REPOSITORY=o/r "$P/scripts/cd/plan.sh" last-deployed
check "last-deployed: newest successful #cd-full, skipping failed, rollback and partial runs" [ "$(cat "$T/out")" = "$C1" ]
run GITHUB_REPOSITORY=o/other "$P/scripts/cd/plan.sh" last-deployed
if [ "$RC" = 0 ] && [ "$(cat "$T/out")" = "" ]; then ok "last-deployed: another repository's URL never counts"; else bad "last-deployed: another repository's URL never counts"; fi
run EVENT=workflow_run RUN_SHA="$C3" GITHUB_REPOSITORY=o/r GITHUB_STEP_SUMMARY="$T/summary.md" "$P/scripts/cd/plan.sh" decide
if [ "$RC" = 0 ] && has "$T/out" "targets=backend console" && has "$T/out" "base=$C1"; then ok "decide (push): targets since the last full deployment"; else bad "decide (push): targets since the last full deployment"; fi
if has "$T/out" "deploy=true" && has "$T/out" "scope=full" && has "$T/out" "has_backend=true" && has "$T/out" "has_site=false" && has "$T/out" "python="; then ok "decide (push): deploy=true, scope=full, flags"; else bad "decide (push): deploy=true, scope=full, flags"; fi
check "decide: stdout is only key=value lines (GITHUB_OUTPUT)" [ "$(grep -cv '^[a-z_]*=' "$T/out")" = 0 ]
check "decide: writes the plan to the step summary, one line per item" grep -qx -- "- targets: backend console" "$T/summary.md"
run EVENT=workflow_run RUN_SHA="$C1" GITHUB_REPOSITORY=o/r "$P/scripts/cd/plan.sh" decide
if [ "$RC" = 0 ] && has "$T/out" "deploy=false" && has "$T/out" "targets="; then ok "decide (push, nothing new): deploy=false"; else bad "decide (push, nothing new): deploy=false"; fi
rm "$GHD/statuses-3.json"
run EVENT=workflow_run RUN_SHA="$C3" GITHUB_REPOSITORY=o/r "$P/scripts/cd/plan.sh" decide
check "decide: a GitHub API error fails the plan instead of guessing (rc=$RC)" [ "$RC" = 1 ]
echo "[]" > "$GHD/statuses-3.json"
run EVENT=workflow_dispatch REF=refs/heads/feature DISPATCH_SHA="$C3" GITHUB_REPOSITORY=o/r "$P/scripts/cd/plan.sh" decide
if [ "$RC" = 1 ] && has "$T/err" "CD deploys main only"; then ok "decide (dispatch): refused off main"; else bad "decide (dispatch): refused off main"; fi
all_green "$GHD/check-runs-$C3.json"
run EVENT=workflow_dispatch REF=refs/heads/main DISPATCH_SHA="$C3" IN_TARGETS="site console" GITHUB_REPOSITORY=o/r DEPLOY_REPO=o/r "$P/scripts/cd/plan.sh" decide
if [ "$RC" = 0 ] && has "$T/out" "targets=console site" && has "$T/out" "scope=partial"; then ok "decide (dispatch): explicit list -> partial"; else bad "decide (dispatch): explicit list -> partial"; fi
run EVENT=workflow_dispatch REF=refs/heads/main DISPATCH_SHA="$C3" IN_TARGETS=all GITHUB_REPOSITORY=o/r DEPLOY_REPO=o/r "$P/scripts/cd/plan.sh" decide
if has "$T/out" "scope=full" && has "$T/out" "python=ai-qa notifier source-watcher synthetic-check webhook-dispatcher"; then ok "decide (dispatch): all -> full"; else bad "decide (dispatch): all -> full"; fi
python3 - "$GHD/check-runs-$C3.json" <<'PY'
import json, sys
d = json.load(open(sys.argv[1])); d["check_runs"][0]["conclusion"] = "failure"; json.dump(d, open(sys.argv[1], "w"))
PY
run EVENT=workflow_dispatch REF=refs/heads/main DISPATCH_SHA="$C3" IN_TARGETS=all GITHUB_REPOSITORY=o/r DEPLOY_REPO=o/r "$P/scripts/cd/plan.sh" decide
if [ "$RC" = 1 ] && has "$T/err" "CD deploys green commits only"; then ok "decide (dispatch): red CI on main refuses"; else bad "decide (dispatch): red CI on main refuses"; fi
run EVENT=workflow_dispatch REF=refs/heads/main DISPATCH_SHA="$C3" IN_ROLLBACK_TARGET=worker IN_ROLLBACK_VERSION=26 GITHUB_REPOSITORY=o/r "$P/scripts/cd/plan.sh" decide
if [ "$RC" = 0 ] && has "$T/out" "mode=rollback" && has "$T/out" "deploy=false" && has "$T/out" "rollback_version=26"; then ok "decide (dispatch): rollback mode, no deploy"; else bad "decide (dispatch): rollback mode, no deploy"; fi
run EVENT=workflow_dispatch REF=refs/heads/main DISPATCH_SHA="$C3" IN_ROLLBACK_TARGET=worker IN_ROLLBACK_VERSION='26; true' GITHUB_REPOSITORY=o/r "$P/scripts/cd/plan.sh" decide
check "decide (dispatch): a non-numeric rollback version refuses" [ "$RC" = 1 ]
run EVENT=pull_request GITHUB_REPOSITORY=o/r "$P/scripts/cd/plan.sh" decide
check "decide: any other event refuses" [ "$RC" = 1 ]

# ===================================================================================================== artifact
echo "# artifact.sh"
OUT="$T/cd-out"
run "$MIRROR/scripts/cd/artifact.sh" stage "$OUT" backend synthetic-check console site
if [ "$RC" = 0 ] && grep -qE '^[0-9a-f]{64}$' "$T/out"; then ok "stage: rc=$RC, prints a sha256"; else bad "stage: rc=$RC, prints a sha256"; fi
SUM="$(cat "$T/out")"
check "stage: SHA256SUMS lists the four files" [ "$(wc -l < "$OUT/SHA256SUMS" | tr -d ' ')" = 4 ]
rm -rf "$MIRROR/src_C/dist" "$MIRROR/frontend/dist"
run "$MIRROR/scripts/cd/artifact.sh" verify "$OUT" "$SUM" backend synthetic-check console site
if [ "$RC" = 0 ] && [ -s "$MIRROR/src_C/dist/vpc.zip" ] && [ -f "$MIRROR/frontend/dist/index.html" ]; then ok "verify: rc=$RC, files back in place"; else bad "verify: rc=$RC, files back in place"; fi
run "$MIRROR/scripts/cd/artifact.sh" verify "$OUT" "$(printf '%064d' 0)" backend
if [ "$RC" = 1 ] && has "$T/err" "refusing to deploy"; then ok "verify: a manifest the build job did not make refuses"; else bad "verify: a manifest the build job did not make refuses"; fi
printf 'tampered\n' >> "$OUT/src_C/dist/vpc.zip"
run "$MIRROR/scripts/cd/artifact.sh" verify "$OUT" "$SUM" backend
check "verify: a changed file refuses" [ "$RC" = 1 ]
run "$MIRROR/scripts/cd/artifact.sh" stage "$OUT" backend
SUM="$(cat "$T/out")"
printf 'extra\n' > "$OUT/extra.bin"
run "$MIRROR/scripts/cd/artifact.sh" verify "$OUT" "$SUM" backend
check "verify: an unlisted extra file refuses" [ "$RC" = 1 ]
rm "$OUT/extra.bin"
run "$MIRROR/scripts/cd/artifact.sh" verify "$OUT" "$SUM" backend console
if [ "$RC" = 1 ] && has "$T/err" "frontend/console-dist.tgz"; then ok "verify: a target whose file is absent refuses"; else bad "verify: a target whose file is absent refuses"; fi

echo
echo "cd-scripts.test.sh: $PASS passed, $FAILED failed"
[ "$FAILED" = 0 ]
