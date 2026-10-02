#!/usr/bin/env bash
# F06 (r24x, p-tests-1): mutation test for the route guard in infra/modules/api/gateway.tf.
# Offline: copies infra/ to a temp dir, applies one mutation at a time to the module's gateway.tf and runs
# `terraform validate` on envs/prod (init -backend=false, providers from the lock file / plugin cache).
# The unmutated copy must validate; every mutation must fail validate. No plan, no apply, no AWS call.
# Usage: bash docs/delivery/r24x-issues/F06-route-guard-test.sh   (from the repo root)
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

# name | python expression over `s` (the gateway.tf text) that returns the mutated text
mutations=(
  'route deleted, throttle kept|re.sub(r"\n\s*public_events\s*=\s*\{[^\n]*\n", "\n", s)'
  'auth none -> mobile|s.replace("route_key = \"POST /api/v1/public/events\", integration = \"core_vpc\", auth = \"none\"", "route_key = \"POST /api/v1/public/events\", integration = \"core_vpc\", auth = \"mobile\"")'
  'auth none -> console|s.replace("route_key = \"POST /api/v1/public/events\", integration = \"core_vpc\", auth = \"none\"", "route_key = \"POST /api/v1/public/events\", integration = \"core_vpc\", auth = \"console\"")'
  'greedy route key|s.replace("route_key = \"POST /api/v1/public/events\"", "route_key = \"POST /api/v1/public/{proxy+}\"")'
  'greedy key on route and throttle|s.replace("POST /api/v1/public/events", "POST /api/v1/public/{proxy+}")'
  'integration core_vpc -> edge_public|s.replace("route_key = \"POST /api/v1/public/events\", integration = \"core_vpc\"", "route_key = \"POST /api/v1/public/events\", integration = \"edge_public\"")'
  'throttle 10/5 -> 50/25|re.sub(r"(\"POST /api/v1/public/events\"\s*=\s*)\{ burst = 10, rate = 5 \}", r"\1{ burst = 50, rate = 25 }", s)'
  'throttle removed|re.sub(r"\n\s*\"POST /api/v1/public/events\"\s*=\s*\{[^\n]*\n", "\n", s)'
  'orphan throttle key|s.replace("\"POST /api/v1/public/events\"                         = { burst = 10, rate = 5 }", "\"POST /api/v1/public/events\"                         = { burst = 10, rate = 5 }\n    \"POST /api/v1/public/other\" = { burst = 10, rate = 5 }")'
)

for m in "${mutations[@]}"; do
  name=${m%%|*}
  expr=${m#*|}
  EXPR="$expr" python3 - "$work/gateway.tf.orig" "$gw" <<'PY'
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
  else
    echo "ok   mutation rejected: $name"
  fi
  cp "$work/gateway.tf.orig" "$gw"
done

[ "$fail" -eq 0 ] && echo "F06 ROUTE GUARD OK"
exit "$fail"
