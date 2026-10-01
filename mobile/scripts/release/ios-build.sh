#!/usr/bin/env bash
# ios-build.sh [profile] — production iOS build on EAS, non-interactive.
# Prints "BUILD_ID=<id>" and "ARTIFACT=<url>" on success; exits non-zero otherwise.
# DRY_RUN=1 prints the command without running it (the production checks still run).
# Exit codes: 0 ok · 1 build failed · 2 eas-cli missing or not logged in · 3 production is missing
# EXPO_PUBLIC_SENTRY_DSN / SENTRY_AUTH_TOKEN in the EAS production environment · 5 Sentry org/project placeholders.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; MOBILE="$(cd "$HERE/../.." && pwd)"; cd "$MOBILE"
PROFILE="${1:-production}"
VERSION=$(node -p "require('./app.json').expo.version")
BUILD=$(node -p "require('./app.json').expo.ios.buildNumber")
echo "app.json: version=$VERSION buildNumber=$BUILD profile=$PROFILE"
# A store build uploads source maps to Sentry (eas.json production SENTRY_ORG/SENTRY_PROJECT); refuse placeholders.
if [ "$PROFILE" = production ]; then
  S_ORG=$(node -p "((require('./eas.json').build.production.ios || {}).env || {}).SENTRY_ORG || ''")
  S_PROJECT=$(node -p "((require('./eas.json').build.production.ios || {}).env || {}).SENTRY_PROJECT || ''")
  case "$S_ORG" in ''|REPLACE_ME_*) S_BAD=1 ;; *) S_BAD=0 ;; esac
  case "$S_PROJECT" in ''|REPLACE_ME_*) S_BAD=1 ;; esac
  if [ "$S_BAD" = 1 ]; then
    echo "ios-build: fill SENTRY_ORG/SENTRY_PROJECT in eas.json (production) before a store build" >&2
    exit 5
  fi
fi
command -v eas >/dev/null || { echo "eas-cli missing" >&2; exit 2; }
eas whoami >/dev/null 2>&1 || { echo "eas not logged in (eas login)" >&2; exit 2; }
# A store build also needs the Sentry names in the EAS production environment: without the DSN no Sentry
# code initialises, and without the token SENTRY_ALLOW_FAILURE turns the dSYM/source-map upload into a
# warning. Names only, like ota.sh: eas prints NAME=value (the name possibly in ANSI bold); strip the codes,
# keep what is before the first '=' and never echo the output or the lines the names came from.
if [ "$PROFILE" = production ]; then
  # eas-cli 24 rejects --non-interactive on env:list and prints the list on stderr: read both streams, stdin from /dev/null.
  NAMES=$(eas env:list --environment production --format short </dev/null 2>&1 | tr -d '\033' | sed -E 's/\[[0-9;]*m//g' | sed -nE 's/^[[:space:]]*([A-Z][A-Z0-9_]*)=.*/\1/p' | sort -u || true)
  MISSING=()
# No `printf | grep -q` here: under pipefail, grep -q exits on its first match while bash 5 is still
# writing later lines (one write per line), printf dies of SIGPIPE and the name is wrongly reported missing.
  for name in EXPO_PUBLIC_SENTRY_DSN SENTRY_AUTH_TOKEN; do
    grep -qx -- "$name" <<<"$NAMES" || MISSING+=("$name")
  done
  if [ "${#MISSING[@]}" -gt 0 ]; then
    echo "ios-build: missing name(s) in the EAS production environment: ${MISSING[*]} (eas env:create --environment production)" >&2
    exit 3
  fi
fi
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
