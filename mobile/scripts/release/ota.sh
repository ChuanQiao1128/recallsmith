#!/usr/bin/env bash
# ota.sh "<message>" — publish an OTA to channel production (runtime = app.json version).
# DRY_RUN=1 checks the required EXPO_PUBLIC_* names and prints the command without publishing.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; MOBILE="$(cd "$HERE/../.." && pwd)"; cd "$MOBILE"
MESSAGE="${1:-}"
[ -n "$MESSAGE" ] || { echo 'usage: ota.sh "<message>"' >&2; exit 2; }
REQUIRED_NAMES=(EXPO_PUBLIC_API_BASE EXPO_PUBLIC_AWS_REGION EXPO_PUBLIC_COGNITO_USER_POOL_ID EXPO_PUBLIC_COGNITO_USER_POOL_CLIENT_ID EXPO_PUBLIC_RC_IOS_API_KEY)
VERSION=$(node -p "require('./app.json').expo.version")
echo "ota: runtime=$VERSION channel=production environment=production"
command -v eas >/dev/null || { echo "eas-cli missing" >&2; exit 2; }
eas whoami >/dev/null 2>&1 || { echo "eas not logged in (eas login)" >&2; exit 2; }
# Names only — never echo eas env:list output or the lines $NAMES came from.
NAMES=$(eas env:list --environment production --format short --non-interactive 2>/dev/null | grep -oE 'EXPO_PUBLIC_[A-Z0-9_]+' | sort -u || true)
MISSING=()
for name in "${REQUIRED_NAMES[@]}"; do
  printf '%s\n' "$NAMES" | grep -qx "$name" || MISSING+=("$name")
done
if [ "${#MISSING[@]}" -gt 0 ]; then
  echo "ota: missing EXPO_PUBLIC name(s) in the EAS production environment: ${MISSING[*]}" >&2
  exit 3
fi
export EXPO_PUBLIC_ENV=production
if [ "${DRY_RUN:-0}" = 1 ]; then
  echo "DRY: eas update --channel production --environment production --platform ios --message \"$MESSAGE\" --non-interactive"; exit 0
fi
eas update --channel production --environment production --platform ios --message "$MESSAGE" --non-interactive
