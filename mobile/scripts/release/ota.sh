#!/usr/bin/env bash
# ota.sh "<message>" — publish an OTA to channel production (runtime = app.json version).
# DRY_RUN=1 checks the required EXPO_PUBLIC_* names and prints the command without publishing.
#
# Dual-runtime rule (binding once 1.9.0 ships): runtime-1.8.0 OTAs are published from a release/1.8.x
# checkout, runtime-1.9.0 OTAs from main. A runtime below 1.9.0 has no RNSentry native module, so a tree
# whose package.json depends on @sentry/react-native refuses to publish for it (exit 6).
# Runtime >= 1.9.0 also needs EXPO_PUBLIC_SENTRY_DSN in the EAS production environment and, after a
# successful publish, uploads the OTA's source maps (mobile/dist) to Sentry. The result is one stdout line
# SENTRY_UPLOAD=ok|failed|skipped-runtime|skipped-no-project|skipped-no-token; a failed upload still exits 0
# because the update is already live. SENTRY_ORG/SENTRY_PROJECT come from the environment, else from
# eas.json build.production.ios.env. The auth token comes from SENTRY_AUTH_TOKEN in the environment, else
# from the macOS Keychain item developercards-sentry-auth-token (only when stdin is a terminal or
# OTA_KEYCHAIN=1; never when OTA_KEYCHAIN=0). The token is inherited by the upload child only; it is never
# printed, never written to a file and never put on a command line.
# Exit codes: 0 ok · 2 usage / eas-cli missing or not logged in · 3 missing EXPO_PUBLIC name(s) ·
# 6 runtime guard (exit 5 belongs to ios-build.sh).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; MOBILE="$(cd "$HERE/../.." && pwd)"; cd "$MOBILE"
MESSAGE="${1:-}"
[ -n "$MESSAGE" ] || { echo 'usage: ota.sh "<message>"' >&2; exit 2; }
REQUIRED_NAMES=(EXPO_PUBLIC_API_BASE EXPO_PUBLIC_AWS_REGION EXPO_PUBLIC_COGNITO_USER_POOL_ID EXPO_PUBLIC_COGNITO_USER_POOL_CLIENT_ID EXPO_PUBLIC_RC_IOS_API_KEY)
VERSION=$(node -p "require('./app.json').expo.version")
# GE190=1 when the runtime (major.minor.patch, compared numerically) is at least 1.9.0.
GE190=$(node -e 'const [a, b, c] = String(process.argv[1]).split(".").map((x) => parseInt(x, 10) || 0); const v = a * 1e6 + b * 1e3 + c; console.log(v >= 1009000 ? 1 : 0)' "$VERSION")
if [ "$GE190" != 1 ] && node -e 'process.exit((require("./package.json").dependencies || {})["@sentry/react-native"] ? 0 : 1)'; then
  echo "ota: runtime $VERSION has no RNSentry native module; publish runtime-$VERSION OTAs from its release branch" >&2
  exit 6
fi
if [ "$GE190" = 1 ]; then REQUIRED_NAMES+=(EXPO_PUBLIC_SENTRY_DSN); fi
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

# Decide the Sentry source-map upload: leaves SENTRY_UPLOAD empty when the upload can run, otherwise
# sets it to the skipped-* reason. Order: runtime, then org/project, then the token.
sentry_prepare() {
  SENTRY_UPLOAD=""
  if [ "$GE190" != 1 ]; then SENTRY_UPLOAD=skipped-runtime; return 0; fi
  SENTRY_ORG="${SENTRY_ORG:-$(node -p "((require('./eas.json').build.production.ios || {}).env || {}).SENTRY_ORG || ''")}"
  SENTRY_PROJECT="${SENTRY_PROJECT:-$(node -p "((require('./eas.json').build.production.ios || {}).env || {}).SENTRY_PROJECT || ''")}"
  case "$SENTRY_ORG" in ''|REPLACE_ME_*) SENTRY_UPLOAD=skipped-no-project; return 0 ;; esac
  case "$SENTRY_PROJECT" in ''|REPLACE_ME_*) SENTRY_UPLOAD=skipped-no-project; return 0 ;; esac
  set +x
  SENTRY_TOKEN_SOURCE=""
  if [ -n "${SENTRY_AUTH_TOKEN:-}" ]; then
    SENTRY_TOKEN_SOURCE=env
  elif [ "${OTA_KEYCHAIN:-}" != 0 ] && { [ -t 0 ] || [ "${OTA_KEYCHAIN:-}" = 1 ]; }; then
    SENTRY_AUTH_TOKEN="$(security find-generic-password -s "${OTA_KEYCHAIN_SERVICE:-developercards-sentry-auth-token}" -w 2>/dev/null || true)"
    if [ -n "$SENTRY_AUTH_TOKEN" ]; then SENTRY_TOKEN_SOURCE=keychain; fi
  fi
  if [ -z "${SENTRY_AUTH_TOKEN:-}" ]; then SENTRY_UPLOAD=skipped-no-token; return 0; fi
  echo "SENTRY_TOKEN_SOURCE=$SENTRY_TOKEN_SOURCE"
}

if [ "${DRY_RUN:-0}" = 1 ]; then
  echo "DRY: eas update --channel production --environment production --platform ios --message \"$MESSAGE\" --non-interactive"
  if [ "$GE190" = 1 ]; then
    sentry_prepare
    if [ -z "$SENTRY_UPLOAD" ]; then
      echo "DRY: SENTRY_UPLOAD=ok-planned"
      echo "DRY: npx sentry-expo-upload-sourcemaps dist"
    else
      echo "DRY: SENTRY_UPLOAD=$SENTRY_UPLOAD"
    fi
  fi
  exit 0
fi
eas update --channel production --environment production --platform ios --message "$MESSAGE" --non-interactive

# The update is live from here on: the source-map upload reports its result but never fails the script.
sentry_prepare
if [ -z "$SENTRY_UPLOAD" ]; then
  set +x
  export SENTRY_ORG SENTRY_PROJECT SENTRY_AUTH_TOKEN
  if npx sentry-expo-upload-sourcemaps dist 1>&2; then
    SENTRY_UPLOAD=ok
  else
    SENTRY_UPLOAD=failed
    echo 'ota: Sentry source-map upload failed (the update is live). Re-run with the token from the Keychain item developercards-sentry-auth-token exported as SENTRY_AUTH_TOKEN: cd mobile && SENTRY_ORG=<org> SENTRY_PROJECT=<project> npx sentry-expo-upload-sourcemaps dist' >&2
  fi
fi
echo "SENTRY_UPLOAD=$SENTRY_UPLOAD"
