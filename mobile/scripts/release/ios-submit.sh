#!/usr/bin/env bash
# ios-submit.sh [profile] — upload the newest finished EAS build to App Store Connect / TestFlight.
# Uses the App Store Connect API key stored on EAS (no local Apple login needed).
# DRY_RUN=1 prints the command without running it.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; MOBILE="$(cd "$HERE/../.." && pwd)"; cd "$MOBILE"
PROFILE="${1:-production}"
command -v eas >/dev/null || { echo "eas-cli missing" >&2; exit 2; }
if [ "${DRY_RUN:-0}" = 1 ]; then
  echo "DRY: eas submit --platform ios --profile $PROFILE --latest --non-interactive --wait"; exit 0
fi
LOG="${TMPDIR:-/tmp}/eas-submit-$$.log"
eas submit --platform ios --profile "$PROFILE" --latest --non-interactive --wait 2>&1 | tee "$LOG"
rc=${PIPESTATUS[0]}
[ "$rc" -eq 0 ] || { echo "eas submit failed (rc=$rc); see $LOG" >&2; exit "$rc"; }
SUB=$(grep -Eo 'submissions/[0-9a-f-]+' "$LOG" | head -1 | sed 's|submissions/||' || true)
echo "SUBMISSION_ID=${SUB:-unknown}"
