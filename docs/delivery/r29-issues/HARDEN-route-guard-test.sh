#!/usr/bin/env bash
# R29 HARDEN (enterprise audit SPC-02): mutation test for the two route guard rules this change adds to
# infra/modules/api/gateway.tf: every auth = "none" route (OPTIONS preflights and GET /health included) has a
# route_throttles entry, and no route_throttles burst or rate is below 1 (0 refuses every request, 2026-09-23).
# Same harness as docs/delivery/r28-issues/ANONREPORT-route-guard-test.sh. Offline: copies infra/ to a temp dir,
# applies one mutation at a time to the module's gateway.tf and runs `terraform validate` on envs/prod
# (init -backend=false, providers from the lock file / plugin cache). The unmutated copy must validate; every
# mutation must fail validate with the guard's ROUTE GUARD message. No plan, no apply, no AWS call.
# Usage: bash docs/delivery/r29-issues/HARDEN-route-guard-test.sh   (from the repo root; set TF_PLUGIN_CACHE_DIR to stay offline)
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
  'GET /health throttle removed|re.sub(r"\n\s*\"GET /health\"\s*=\s*\{[^\n]*\n", "\n", s)'
  'OPTIONS /{proxy+} throttle removed|re.sub(r"\n\s*\"OPTIONS /\{proxy\+\}\"\s*=\s*\{[^\n]*\n", "\n", s)'
  'OPTIONS admin throttle removed|re.sub(r"\n\s*\"OPTIONS /api/v1/admin/\{proxy\+\}\"\s*=\s*\{[^\n]*\n", "\n", s)'
  'RevenueCat webhook throttle removed|re.sub(r"\n\s*\"POST /webhooks/revenuecat/production\"\s*=\s*\{[^\n]*\n", "\n", s)'
  'new unauthenticated route without a throttle|s.replace("    health          = {", "    internal_other  = { route_key = \"POST /api/internal/other\", integration = \"core_vpc\", auth = \"none\" }\n    health          = {")'
  'rate 0|s.replace("\"ANY /api/v1/user/{proxy+}\"                          = { burst = 40, rate = 20 }", "\"ANY /api/v1/user/{proxy+}\"                          = { burst = 40, rate = 0 }")'
  'burst 0|s.replace("\"GET /health\"                                        = { burst = 20, rate = 10 }", "\"GET /health\"                                        = { burst = 0, rate = 10 }")'
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
  elif ! tr -s ' \n' ' ' <"$work/out.txt" | grep -q 'cannot convert "ROUTE GUARD:'; then
    echo "FAIL mutation failed validate without a ROUTE GUARD message: $name"
    cat "$work/out.txt"
    fail=1
  else
    echo "ok   mutation rejected: $name ($(tr -s ' \n' ' ' <"$work/out.txt" | sed -n 's/.*cannot convert "\(ROUTE GUARD:.*\)" to bool.*/\1/p'))"
  fi
  cp "$work/gateway.tf.orig" "$gw"
done

[ "$fail" -eq 0 ] && echo "HARDEN ROUTE GUARD OK"
exit "$fail"
