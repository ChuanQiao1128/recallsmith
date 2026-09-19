#!/usr/bin/env bash
# ios-build.sh [profile] — production iOS build on EAS, non-interactive.
# Prints "BUILD_ID=<id>" and "ARTIFACT=<url>" on success; exits non-zero otherwise.
# DRY_RUN=1 prints the command without running it.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; MOBILE="$(cd "$HERE/../.." && pwd)"; cd "$MOBILE"
PROFILE="${1:-production}"
VERSION=$(node -p "require('./app.json').expo.version")
BUILD=$(node -p "require('./app.json').expo.ios.buildNumber")
echo "app.json: version=$VERSION buildNumber=$BUILD profile=$PROFILE"
command -v eas >/dev/null || { echo "eas-cli missing" >&2; exit 2; }
eas whoami >/dev/null 2>&1 || { echo "eas not logged in (eas login)" >&2; exit 2; }
if [ "${DRY_RUN:-0}" = 1 ]; then
  echo "DRY: eas build --platform ios --profile $PROFILE --non-interactive --json --wait"; exit 0
fi
OUT="${TMPDIR:-/tmp}/eas-build-$$.json"
# --json keeps stdout machine-readable; human noise goes to stderr and the log.
eas build --platform ios --profile "$PROFILE" --non-interactive --json --wait > "$OUT" 2> "${OUT%.json}.log" \
  || { echo "eas build failed; see ${OUT%.json}.log" >&2; tail -20 "${OUT%.json}.log" >&2; exit 1; }
ID=$(jq -r '.[0].id // .id // empty' "$OUT")
STATUS=$(jq -r '.[0].status // .status // empty' "$OUT")
URL=$(jq -r '.[0].artifacts.buildUrl // .artifacts.buildUrl // empty' "$OUT")
[ "$STATUS" = FINISHED ] || { echo "build $ID ended with status $STATUS" >&2; exit 1; }
echo "BUILD_ID=$ID"; echo "ARTIFACT=$URL"; echo "VERSION=$VERSION"; echo "BUILD_NUMBER=$BUILD"
