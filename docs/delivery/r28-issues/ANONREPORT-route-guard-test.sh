#!/usr/bin/env bash
# R28 ANONREPORT: mutation test for the route guard rules this change adds to infra/modules/api/gateway.tf
# (the anonymous card report route, and "every /api/v1/public/ route has a per-route throttle"). Same harness as
# docs/delivery/r24x-issues/F06-route-guard-test.sh, which still covers the public events route.
# Offline: copies infra/ to a temp dir, applies one mutation at a time to the module's gateway.tf and runs
# `terraform validate` on envs/prod (init -backend=false, providers from the lock file / plugin cache).
# The unmutated copy must validate; every mutation must fail validate with the guard's ROUTE GUARD message. No plan, no apply, no AWS call.
# Usage: bash docs/delivery/r28-issues/ANONREPORT-route-guard-test.sh   (from the repo root; set TF_PLUGIN_CACHE_DIR to stay offline)
set -euo pipefail

repo=$(git rev-parse --show-toplevel)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
rsync -a --exclude .terraform "$repo/infra/" "$work/infra/"
gw="$work/infra/modules/api/gateway.tf"
cp "$gw" "$work/gateway.tf.orig"
terraform -chdir="$work/infra/envs/prod" init -backend=false -input=false -lockfile=readonly >/dev/null

validate() { terraform -chdir="$work/infra/envs/prod" validate -no-color >"$work/out.txt" 2>&1; }

fail=0
if validate; then echo "ok   unmutated config validates"; else echo "FAIL unmutated config does not validate"; cat "$work/out.txt"; fail=1; fi

route='route_key = "POST /api/v1/public/card-reports", integration = "core_vpc", auth = "none"'
# name | python expression over `s` (the gateway.tf text) that returns the mutated text
mutations=(
  'route deleted, throttle kept|re.sub(r"\n\s*public_card_reports\s*=\s*\{[^\n]*\n", "\n", s)'
  'auth none -> mobile|s.replace(os.environ["ROUTE"], os.environ["ROUTE"].replace("auth = \"none\"", "auth = \"mobile\""))'
  'auth none -> console|s.replace(os.environ["ROUTE"], os.environ["ROUTE"].replace("auth = \"none\"", "auth = \"console\""))'
  'greedy route key|s.replace("route_key = \"POST /api/v1/public/card-reports\"", "route_key = \"POST /api/v1/public/{proxy+}\"")'
  'greedy key on route and throttle|s.replace("POST /api/v1/public/card-reports", "POST /api/v1/public/{proxy+}")'
  'integration core_vpc -> edge_public|s.replace(os.environ["ROUTE"], os.environ["ROUTE"].replace("core_vpc", "edge_public"))'
  'throttle 5/2 -> 50/25|re.sub(r"(\"POST /api/v1/public/card-reports\"\s*=\s*)\{ burst = 5, rate = 2 \}", r"\1{ burst = 50, rate = 25 }", s)'
  'throttle removed|re.sub(r"\n\s*\"POST /api/v1/public/card-reports\"\s*=\s*\{[^\n]*\n", "\n", s)'
  'another public route without a throttle|s.replace("    public_card_reports = {", "    public_other = { route_key = \"POST /api/v1/public/other\", integration = \"core_vpc\", auth = \"none\" }\n    public_card_reports = {")'
)

for m in "${mutations[@]}"; do
  name=${m%%|*}
  expr=${m#*|}
  ROUTE="$route" EXPR="$expr" python3 - "$work/gateway.tf.orig" "$gw" <<'PY'
import os, re, sys
s = open(sys.argv[1]).read()
out = eval(os.environ["EXPR"])
if out == s:
    sys.exit("mutation did not change gateway.tf: " + os.environ["EXPR"])
open(sys.argv[2], "w").write(out)
PY
  if validate; then
    echo "FAIL mutation still validates: $name"
    fail=1
  elif ! tr -s ' \n' ' ' <"$work/out.txt" | grep -q 'cannot convert "ROUTE GUARD:'; then
    echo "FAIL mutation failed validate without a ROUTE GUARD message: $name"
    cat "$work/out.txt"
    fail=1
  else
    echo "ok   mutation rejected: $name ($(tr -s ' \n' ' ' <"$work/out.txt" | sed -n 's/.*cannot convert "\(ROUTE GUARD:.*\)" to bool.*/\1/p'))"
  fi
  cp "$work/gateway.tf.orig" "$gw"
done

[ "$fail" -eq 0 ] && echo "ANONREPORT ROUTE GUARD OK"
exit "$fail"
