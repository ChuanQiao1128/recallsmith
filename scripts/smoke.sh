#!/usr/bin/env bash
# scripts/smoke.sh — the production smoke test CD runs right after a deploy, inside the same job (a second job would
# need a second approval), so a failure here triggers the automatic rollback. Exit 0 only when both checks pass.
#
#   [1/2] health           GET $API_URL/health -> HTTP 200 and "ok": true (the body is {"success":true,"data":{"ok":true},…})
#   [2/2] synthetic-check  aws lambda invoke developercards-synthetic-check:prod {"job":"synthetic-check"}
#                          -> {"ok": true, "failed": []}: api-health, cdn-manifest, cdn-deck, console-index and
#                          api-auth-guard against the live hosts (services/synthetic-check, infra/RUNBOOK.md §8)
#
#   scripts/smoke.sh                 # needs lambda:InvokeFunction on developercards-synthetic-check:prod (the CD role has it)
#   DRY_RUN=1 scripts/smoke.sh       # print the two checks, call nothing
#   SMOKE_REPORT=<file>              # also append one "name<TAB>PASS|FAIL<TAB>detail" line per check (CD job summary)
#
# Each check is tried SMOKE_ATTEMPTS times (default 3), SMOKE_RETRY_SECONDS apart (default 15), so one cold start or
# one dropped connection does not roll a good deploy back. Prints check names and failed check names only, never a
# response body or a credential.
set -euo pipefail
set +x
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=scripts/lib/targets.sh
source "$ROOT/scripts/lib/targets.sh"

API_URL="${API_URL:-https://api.developercards.app}"
SYNTHETIC_FN="${SYNTHETIC_FN:-developercards-synthetic-check}"
ALIAS="${PUBLISH_ALIAS:-prod}"
REGION="${AWS_REGION:-ap-southeast-2}"
ATTEMPTS="${SMOKE_ATTEMPTS:-3}"
RETRY_SECONDS="${SMOKE_RETRY_SECONDS:-15}"
REPORT="${SMOKE_REPORT:-}"

if [ "${DRY_RUN:-0}" = 1 ]; then
  echo "[1/2] health: GET $API_URL/health -> 200 and \"ok\":true (dry run)"
  echo "[2/2] synthetic-check: aws lambda invoke --function-name $SYNTHETIC_FN:$ALIAS --payload '{\"job\":\"synthetic-check\"}' -> {\"ok\":true,\"failed\":[]} (dry run)"
  exit 0
fi
command -v jq >/dev/null || { echo "jq is required" >&2; exit 1; }
command -v curl >/dev/null || { echo "curl is required" >&2; exit 1; }
aws_profile_default

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

report() { [ -z "$REPORT" ] || printf '%s\t%s\t%s\n' "$1" "$2" "$3" >> "$REPORT"; }

# check_health → 0 when /health answers 200 with ok true; DETAIL says why not.
check_health() {
  local code
  code="$(curl -sS -o "$work/health.json" -w '%{http_code}' --max-time 20 "$API_URL/health" 2>"$work/curl.err" || true)"
  if [ "$code" != 200 ]; then
    DETAIL="HTTP ${code:-none}"
    if [ -s "$work/curl.err" ]; then DETAIL="$DETAIL ($(head -c 200 "$work/curl.err" | tr '\n' ' '))"; fi
    return 1
  fi
  if ! jq -e '(.ok == true) or (.data.ok == true)' "$work/health.json" >/dev/null 2>&1; then
    DETAIL="HTTP 200 without \"ok\":true"
    return 1
  fi
  DETAIL="HTTP 200, ok true"
}

# check_synthetic → 0 when the synthetic check reports ok with no failed check; DETAIL names the failed checks.
check_synthetic() {
  local fe
  rm -f "$work/synthetic.json"
  if ! fe="$(aws lambda invoke --region "$REGION" --function-name "$SYNTHETIC_FN:$ALIAS" \
    --cli-binary-format raw-in-base64-out --payload '{"job":"synthetic-check"}' \
    "$work/synthetic.json" --query 'FunctionError' --output text 2>"$work/aws.err")"; then
    DETAIL="invoke failed: $(head -c 300 "$work/aws.err" | tr '\n' ' ')"
    return 1
  fi
  if [ -n "$fe" ] && [ "$fe" != None ]; then
    DETAIL="FunctionError=$fe"
    return 1
  fi
  if ! jq -e '.ok == true and .failed == []' "$work/synthetic.json" >/dev/null 2>&1; then
    DETAIL="failed checks: $(jq -r '(.failed // ["<unreadable response>"]) | join(", ")' "$work/synthetic.json" 2>/dev/null || echo '<unreadable response>')"
    return 1
  fi
  DETAIL="ok true, failed []"
}

# run_check <k> <name> <function>
run_check() {
  local k="$1" name="$2" fn="$3" attempt=1
  DETAIL=""
  while :; do
    if "$fn"; then
      echo "[$k/2] $name: PASS ($DETAIL)"
      report "$name" PASS "$DETAIL"
      return 0
    fi
    if [ "$attempt" -ge "$ATTEMPTS" ]; then
      echo "[$k/2] $name: FAIL after $attempt attempt(s): $DETAIL" >&2
      report "$name" FAIL "$DETAIL"
      return 1
    fi
    echo "[$k/2] $name: attempt $attempt failed ($DETAIL); retrying in ${RETRY_SECONDS}s"
    attempt=$((attempt + 1))
    sleep "$RETRY_SECONDS"
  done
}

failed=0
run_check 1 health check_health || failed=1
run_check 2 synthetic-check check_synthetic || failed=1
if [ "$failed" = 1 ]; then
  echo "SMOKE FAIL" >&2
  exit 1
fi
echo "SMOKE OK"
