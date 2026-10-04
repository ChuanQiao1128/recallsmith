#!/usr/bin/env bash
# scripts/smoke.sh — the production smoke test CD runs right after a deploy, inside the same job (a second job would
# need a second approval), so a failure here triggers the automatic rollback. CD also runs it once BEFORE the deploy,
# as the baseline (SMOKE_BASELINE below).
#
#   [1/2] health           GET $API_URL/health -> HTTP 200 and "ok": true (the body is {"success":true,"data":{"ok":true},…})
#   [2/2] synthetic-check  aws lambda invoke developercards-synthetic-check:prod {"job":"synthetic-check"}
#                          -> {"ok": true, "failed": []}: api-health, cdn-manifest, cdn-deck, console-index,
#                          api-auth-guard, api-sync-guard, remote-config, cognito-console and cognito-mobile against
#                          the live hosts (services/synthetic-check, infra/RUNBOOK.md §8)
#
#   scripts/smoke.sh                 # needs lambda:InvokeFunction on developercards-synthetic-check:prod: the CD role
#                                    # has it, devcards-deploy does not; locally run AWS_PROFILE=devcards-admin (MFA)
#   DRY_RUN=1 scripts/smoke.sh       # print the two checks, call nothing
#   SMOKE_REPORT=<file>              # also append one "name<TAB>PASS|FAIL|TOLERATED|SKIPPED<TAB>detail<TAB>failing items"
#                                    # line per check (CD job summary; the 4th column is what SMOKE_BASELINE reads)
#   SMOKE_BASELINE=<file>            # the SMOKE_REPORT of a run before the deploy: a failure counts only when it is
#                                    # new. Failing items (health; the synthetic check's failed check names, or
#                                    # invoke / function-error / not-ok / unreadable) that the baseline already had are
#                                    # TOLERATED, so a check that was red before a deploy (maybe the very thing the
#                                    # deploy fixes) does not roll every deploy back. Without the file, every failure
#                                    # counts.
#
# Exit 0 when nothing newly fails, 1 on a failure (SMOKE FAIL), 3 outside GitHub Actions when the synthetic check could
# not run with this identity (AccessDenied: SMOKE INCOMPLETE, not a verdict on the deploy). Inside GitHub Actions an
# AccessDenied is a failure: the CD role must be able to invoke it.
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
BASELINE="${SMOKE_BASELINE:-}"

if [ "${DRY_RUN:-0}" = 1 ]; then
  echo "[1/2] health: GET $API_URL/health -> 200 and \"ok\":true (dry run)"
  echo "[2/2] synthetic-check: aws lambda invoke --function-name $SYNTHETIC_FN:$ALIAS --payload '{\"job\":\"synthetic-check\"}' -> {\"ok\":true,\"failed\":[]} (dry run)"
  exit 0
fi
command -v jq >/dev/null || { echo "jq is required" >&2; exit 1; }
command -v curl >/dev/null || { echo "curl is required" >&2; exit 1; }
aws_profile_default
if [ -n "$BASELINE" ] && [ ! -f "$BASELINE" ]; then
  echo "smoke: no baseline at $BASELINE: every failure counts" >&2
  BASELINE=""
fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

clean() { printf '%s' "$1" | tr '\t\n' '  '; }
report() { [ -z "$REPORT" ] || printf '%s\t%s\t%s\t%s\n' "$1" "$2" "$(clean "$3")" "$(clean "$4")" >> "$REPORT"; }

# baseline_failing <name> → the items that check already failed on before the deploy (empty when it passed); exit 1
# when there is no baseline row for it
baseline_failing() {
  [ -n "$BASELINE" ] || return 1
  awk -F '\t' -v n="$1" '$1 == n { found = 1; f = $4 } END { if (!found) exit 1; print f }' "$BASELINE"
}

# minus <items> <items> → the words of the first that are not in the second
minus() {
  local w out=""
  for w in $1; do word_in "$w" "$2" || out="${out:+$out }$w"; done
  echo "$out"
}

# check_health → 0 when /health answers 200 with ok true; DETAIL says why not, FAILING names it.
check_health() {
  local code
  code="$(curl -sS -o "$work/health.json" -w '%{http_code}' --max-time 20 "$API_URL/health" 2>"$work/curl.err" || true)"
  if [ "$code" != 200 ]; then
    DETAIL="HTTP ${code:-none}"
    if [ -s "$work/curl.err" ]; then DETAIL="$DETAIL ($(head -c 200 "$work/curl.err" | tr '\n' ' '))"; fi
    FAILING=health
    return 1
  fi
  if ! jq -e '(.ok == true) or (.data.ok == true)' "$work/health.json" >/dev/null 2>&1; then
    DETAIL="HTTP 200 without \"ok\":true"
    FAILING=health
    return 1
  fi
  DETAIL="HTTP 200, ok true"
}

# check_synthetic → 0 when the synthetic check reports ok with no failed check; DETAIL names the failed checks and
# FAILING lists them (or invoke / function-error / not-ok / unreadable).
check_synthetic() {
  local fe
  rm -f "$work/synthetic.json"
  if ! fe="$(aws lambda invoke --region "$REGION" --function-name "$SYNTHETIC_FN:$ALIAS" \
    --cli-binary-format raw-in-base64-out --payload '{"job":"synthetic-check"}' \
    "$work/synthetic.json" --query 'FunctionError' --output text 2>"$work/aws.err")"; then
    DETAIL="invoke failed: $(head -c 300 "$work/aws.err" | tr '\n' ' ')"
    FAILING=invoke
    if [ "${GITHUB_ACTIONS:-}" != true ] && grep -q 'AccessDenied' "$work/aws.err"; then DENIED=1; fi
    return 1
  fi
  if [ -n "$fe" ] && [ "$fe" != None ]; then
    DETAIL="FunctionError=$fe"
    FAILING=function-error
    return 1
  fi
  if ! jq -e '.ok == true and .failed == []' "$work/synthetic.json" >/dev/null 2>&1; then
    DETAIL="failed checks: $(jq -r '(.failed // ["<unreadable response>"]) | join(", ")' "$work/synthetic.json" 2>/dev/null || echo '<unreadable response>')"
    FAILING="$(jq -r '(.failed // empty) | map(tostring | gsub("[^A-Za-z0-9_.:-]"; "_")) | join(" ")' "$work/synthetic.json" 2>/dev/null || true)"
    if [ -z "$FAILING" ]; then
      if jq -e 'type == "object"' "$work/synthetic.json" >/dev/null 2>&1; then FAILING=not-ok; else FAILING=unreadable; fi
    fi
    return 1
  fi
  DETAIL="ok true, failed []"
}

# run_check <k> <name> <function>
run_check() {
  local k="$1" name="$2" fn="$3" attempt=1 before new
  while :; do
    DETAIL=""
    FAILING=""
    DENIED=0
    if "$fn"; then
      echo "[$k/2] $name: PASS ($DETAIL)"
      report "$name" PASS "$DETAIL" ""
      return 0
    fi
    if [ "$DENIED" = 1 ]; then
      echo "[$k/2] $name: SKIPPED: this identity may not invoke $SYNTHETIC_FN:$ALIAS (${AWS_PROFILE:-environment credentials}); run AWS_PROFILE=devcards-admin scripts/smoke.sh" >&2
      report "$name" SKIPPED "$DETAIL" "$FAILING"
      SKIPPED="${SKIPPED:+$SKIPPED, }$name"
      return 0
    fi
    if before="$(baseline_failing "$name")"; then
      new="$(minus "$FAILING" "$before")"
      if [ -z "$new" ]; then
        echo "[$k/2] $name: TOLERATED: failing before this deploy too ($DETAIL)"
        report "$name" TOLERATED "$DETAIL (failing before the deploy too)" "$FAILING"
        TOLERATED="${TOLERATED:+$TOLERATED, }$name"
        return 0
      fi
      DETAIL="$DETAIL; new since the deploy: $new"
    fi
    if [ "$attempt" -ge "$ATTEMPTS" ]; then
      echo "[$k/2] $name: FAIL after $attempt attempt(s): $DETAIL" >&2
      report "$name" FAIL "$DETAIL" "$FAILING"
      return 1
    fi
    echo "[$k/2] $name: attempt $attempt failed ($DETAIL); retrying in ${RETRY_SECONDS}s"
    attempt=$((attempt + 1))
    sleep "$RETRY_SECONDS"
  done
}

failed=0
SKIPPED=""
TOLERATED=""
run_check 1 health check_health || failed=1
run_check 2 synthetic-check check_synthetic || failed=1
if [ "$failed" = 1 ]; then
  echo "SMOKE FAIL" >&2
  exit 1
fi
if [ -n "$SKIPPED" ]; then
  echo "SMOKE INCOMPLETE: $SKIPPED did not run (AccessDenied). This is not a verdict on the deploy: devcards-deploy cannot invoke the synthetic check; rerun with AWS_PROFILE=devcards-admin (MFA)." >&2
  exit 3
fi
if [ -n "$TOLERATED" ]; then
  echo "SMOKE OK: nothing newly failing (still failing as before the deploy: $TOLERATED)"
else
  echo "SMOKE OK"
fi
