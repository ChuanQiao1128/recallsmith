#!/usr/bin/env bash
# F05 (r25x): offline tests for the P02 analytics retention change and its plan gates. No plan, no apply, no AWS call.
#   1. Runbook commands (p-correctness-1, p-security-1, p-tests-1): every `check-plan.py` command written in
#      P02-notes.md and F05-fixes.md is run as written, with a synthetic plan JSON in place of `terraform show -json`.
#      It must pass the expected plan and reject a plan with one extra change.
#   2. Allow files: P02.plan-allow.json admits exactly the one lifecycle update; F05.plan-allow.json admits exactly
#      the six F05 changes and rejects a missing, an extra or a wider change.
#   3. Lifecycle values (p-tests-2): F05-lifecycle.tftest.hcl runs as a mocked-provider `terraform test` on a temp
#      copy of infra/modules/data; the noncurrent-90d block text must equal the original; then each mutation of
#      buckets.tf (prefix, days, dropped multipart abort, filter) must fail one of the two checks.
# Usage: bash docs/delivery/r25x-issues/F05-retention-test.sh   (from the repo root)
set -euo pipefail

repo=$(git rev-parse --show-toplevel)
cd "$repo"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
fail=0
ok() { echo "ok   $*"; }
bad() { echo "FAIL $*"; fail=1; }

# ---- synthetic plans --------------------------------------------------------------------------------------
python3 - "$work" <<'PY'
import json, sys
work = sys.argv[1]

def res(address, actions, before, after):
    return {"address": address, "mode": "managed", "change": {"actions": actions, "before": before, "after": after}}

lifecycle = res("module.data.aws_s3_bucket_lifecycle_configuration.content", ["update"],
                {"bucket": "core-vpc", "rule": [{"id": "noncurrent-90d"}]},
                {"bucket": "core-vpc", "rule": [{"id": "noncurrent-90d"}, {"id": "analytics-raw-400d"}]})
policy = res("module.identity.aws_iam_role_policy.notifier", ["update"], {"name": "n", "policy": "a"}, {"name": "n", "policy": "b"})
route_list = res('module.api.aws_apigatewayv2_route.this["internal_revenuecat_deletions"]', ["create"], None,
                 {"route_key": "GET /api/v1/internal/revenuecat-deletions"})
route_report = res('module.api.aws_apigatewayv2_route.this["internal_revenuecat_deletions_report"]', ["create"], None,
                   {"route_key": "POST /api/v1/internal/revenuecat-deletions/report"})
stages = [res("module.api.aws_apigatewayv2_stage." + s, ["update"], {"name": s, "route_settings": [1]}, {"name": s, "route_settings": [1, 2]})
          for s in ("default", "dev")]
noop = res("module.data.aws_s3_bucket.content", ["no-op"], {"bucket": "core-vpc"}, {"bucket": "core-vpc"})
extra = res("module.data.aws_s3_bucket_lifecycle_configuration.premium", ["update"], {"rule": [1]}, {"rule": [2]})
wide = res("module.data.aws_s3_bucket_lifecycle_configuration.content", ["update"],
           {"bucket": "core-vpc", "rule": [1]}, {"bucket": "other", "rule": [2]})
f05 = [lifecycle, policy, route_list, route_report] + stages

plans = {
    "p02": [noop, lifecycle],
    "p02-extra": [noop, lifecycle, extra],
    "p02-replace": [res(lifecycle["address"], ["delete", "create"], {"rule": [1]}, {"rule": [2]})],
    "f05": [noop] + f05,
    "f05-extra": f05 + [extra],
    "f05-missing-route": [c for c in f05 if c is not route_report],
    "f05-wider": [wide] + f05[1:],
}
for name, changes in plans.items():
    with open(f"{work}/{name}.json", "w") as handle:
        json.dump({"format_version": "1.2", "resource_changes": changes, "output_changes": {}}, handle)
PY

# ---- 1. runbook commands, run as written ------------------------------------------------------------------
# A runbook line `terraform show -json X.tfplan | python3 infra/scripts/check-plan.py ...` becomes
# `cat <synthetic plan> | python3 infra/scripts/check-plan.py ...` with the arguments unchanged.
run_doc_cmd() { # doc, command line, plan file -> exit code
  local cmd="cat $3 | ${2#*| }"
  (bash -c "$cmd") >"$work/doc.out" 2>&1
}
for spec in "docs/delivery/r25-issues/P02-notes.md|P02.plan-allow.json|p02" \
            "docs/delivery/r25x-issues/F05-fixes.md|F05.plan-allow.json|f05"; do
  doc=${spec%%|*}; rest=${spec#*|}; allow=${rest%%|*}; plan=${rest#*|}
  cmds=$(grep -o 'terraform show -json [^`]*check-plan\.py[^`]*' "$doc" | grep -F "$allow" || true)
  if [ -z "$cmds" ]; then bad "$doc: no check-plan.py command for $allow"; continue; fi
  while IFS= read -r cmd; do
    if run_doc_cmd "$doc" "$cmd" "$work/$plan.json"; then
      ok "$doc command passes the expected plan: $(grep '^PLAN OK' "$work/doc.out")"
    else
      bad "$doc command fails on the expected plan: $cmd"; sed 's/^/     /' "$work/doc.out"
    fi
    if run_doc_cmd "$doc" "$cmd" "$work/$plan-extra.json"; then
      bad "$doc command admits an extra change: $cmd"
    elif grep -q '^PLAN VIOLATION: unlisted update' "$work/doc.out"; then
      ok "$doc command rejects an extra change"
    else
      bad "$doc command rejects an extra change for the wrong reason"; sed 's/^/     /' "$work/doc.out"
    fi
  done <<<"$cmds"
done

# ---- 2. allow files ---------------------------------------------------------------------------------------
gate() { python3 infra/scripts/check-plan.py --plan "$work/$1.json" --allow "docs/delivery/$2" >"$work/gate.out" 2>&1; }
expect_pass() { if gate "$1" "$2" && grep -qx "PLAN OK $3" "$work/gate.out"; then ok "$2 admits $1 (PLAN OK $3)"; else bad "$2 on $1"; cat "$work/gate.out"; fi; }
expect_reject() { if gate "$1" "$2"; then bad "$2 admits $1"; elif grep -q "^PLAN VIOLATION: $3" "$work/gate.out"; then ok "$2 rejects $1 ($3)"; else bad "$2 rejects $1 without '$3'"; cat "$work/gate.out"; fi; }
expect_pass p02 r25-issues/P02.plan-allow.json 1
expect_reject p02-extra r25-issues/P02.plan-allow.json "unlisted update"
expect_reject p02-replace r25-issues/P02.plan-allow.json "action mismatch"
expect_pass f05 r25x-issues/F05.plan-allow.json 6
expect_reject f05-extra r25x-issues/F05.plan-allow.json "unlisted update"
expect_reject f05-missing-route r25x-issues/F05.plan-allow.json "stale allow entry"
expect_reject f05-wider r25x-issues/F05.plan-allow.json "keys not allowed (bucket)"

# ---- 3. lifecycle values ----------------------------------------------------------------------------------
rsync -a --exclude .terraform "$repo/infra/" "$work/infra/"
mod="$work/infra/modules/data"
mkdir -p "$mod/tests"
cp docs/delivery/r25x-issues/F05-lifecycle.tftest.hcl "$mod/tests/"
cp infra/envs/prod/.terraform.lock.hcl "$mod/.terraform.lock.hcl"
terraform -chdir="$mod" init -backend=false -input=false -lockfile=readonly >/dev/null
cp "$mod/buckets.tf" "$work/buckets.tf.orig"

# The noncurrent-90d rule of the content bucket, exactly as it stood before P02 (an unset filter prefix is
# unknown at plan time, so the tftest cannot see `filter {}`; this text check does).
cat >"$work/noncurrent.expected" <<'EOF'
  rule {
    id     = "noncurrent-90d"
    status = "Enabled"

    filter {}

    noncurrent_version_expiration {
      noncurrent_days = 90
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
EOF
text_check() {
  python3 - "$mod/buckets.tf" "$work/noncurrent.expected" <<'PY'
import re, sys
s = open(sys.argv[1]).read()
m = re.search(r'resource "aws_s3_bucket_lifecycle_configuration" "content" \{\n(.*?)\n\}\n', s, re.S)
if not m:
    sys.exit("content lifecycle resource not found")
body = m.group(1)
want = open(sys.argv[2]).read()
if not body.split("\n\n", 1)[1].startswith(want):
    sys.exit("noncurrent-90d is not the first rule or its text changed")
PY
}
check() { terraform -chdir="$mod" test -no-color >"$work/test.out" 2>&1 && text_check >>"$work/test.out" 2>&1; }

if check; then ok "lifecycle tftest + noncurrent-90d text pass on buckets.tf"; else bad "lifecycle checks fail on buckets.tf"; cat "$work/test.out"; fi

# name | python expression over `s` (the buckets.tf text) that returns the mutated text
mutations=(
  'raw prefix widened to analytics/|s.replace("prefix = \"analytics/raw/\"", "prefix = \"analytics/\"")'
  'expiration 400 -> 40 days|s.replace("days = 400", "days = 40")'
  'raw noncurrent 30 -> 90 days|s.replace("noncurrent_days = 30", "noncurrent_days = 90")'
  'raw rule id renamed|s.replace("\"analytics-raw-400d\"", "\"analytics-raw\"")'
  'raw rule disabled|re.sub(r"(id     = \"analytics-raw-400d\"\n    status = )\"Enabled\"", r"\1\"Disabled\"", s)'
  'multipart abort dropped from content noncurrent-90d|s.replace("    abort_incomplete_multipart_upload {\n      days_after_initiation = 7\n    }\n  }\n\n  # R25 P02", "  }\n\n  # R25 P02", 1)'
  'content noncurrent 90 -> 60 days|s.replace("noncurrent_days = 90", "noncurrent_days = 60", 1)'
  'content noncurrent-90d filter given a prefix|s.replace("filter {}", "filter {\n      prefix = \"content/\"\n    }", 1)'
  'raw rule removed|re.sub(r"\n  # R25 P02.*?\n  rule \{.*?\n  \}\n", "\n", s, count=1, flags=re.S)'
  'premium rule gets the 400-day expiration|re.sub(r"(resource \"aws_s3_bucket_lifecycle_configuration\" \"premium\".*?filter \{\}\n)", r"\1\n    expiration {\n      days = 400\n    }\n", s, flags=re.S)'
)
for m in "${mutations[@]}"; do
  name=${m%%|*}
  expr=${m#*|}
  EXPR="$expr" python3 - "$work/buckets.tf.orig" "$mod/buckets.tf" <<'PY'
import os, re, sys
s = open(sys.argv[1]).read()
out = eval(os.environ["EXPR"])
if out == s:
    sys.exit("mutation did not change buckets.tf: " + os.environ["EXPR"])
open(sys.argv[2], "w").write(out)
PY
  if check; then bad "mutation still passes: $name"; else ok "mutation rejected: $name"; fi
  cp "$work/buckets.tf.orig" "$mod/buckets.tf"
done

[ "$fail" -eq 0 ] && echo "F05 RETENTION OK"
exit "$fail"
