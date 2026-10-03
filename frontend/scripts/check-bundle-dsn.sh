#!/usr/bin/env bash
# scripts/check-bundle-dsn.sh [dist-dir] — a console bundle built elsewhere must report to the Sentry DSN this deploy
# would have built with. CD builds the console without AWS credentials, taking the DSN from the repository variable
# CONSOLE_SENTRY_DSN (a copy; the SSM String parameter stays the source of truth). This resolves the DSN the way
# deploy.sh does (scripts/resolve-sentry-dsn.sh: VITE_SENTRY_DSN from the environment, else SSM) and exits 1 when one
# is resolved and no file under dist-dir (default dist) contains it, so a stale or missing copy stops the deploy
# before anything is uploaded. With no DSN resolved there is nothing to compare: exit 0.
#
# Run by deploy.sh with PREBUILT=1, and by CD's deploy job before the first change. Never prints the DSN.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
DIST="${1:-$HERE/../dist}"
[ -f "$DIST/index.html" ] || { echo "check-bundle-dsn: $DIST/index.html missing" >&2; exit 1; }

# shellcheck source=frontend/scripts/resolve-sentry-dsn.sh
source "$HERE/resolve-sentry-dsn.sh"

if [ -z "$VITE_SENTRY_DSN" ]; then
  echo "check-bundle-dsn: no DSN resolved, nothing to compare"
  exit 0
fi
if grep -rqF -- "$VITE_SENTRY_DSN" "$DIST"; then
  echo "check-bundle-dsn: the bundle carries the resolved DSN"
  exit 0
fi
{
  echo "check-bundle-dsn: no file under $DIST carries the DSN resolved for this deploy, so this console would not"
  echo "report to Sentry (or would report to another project). Rebuild with VITE_SENTRY_DSN set to the value of"
  echo "/developercards/prod/console-sentry-dsn; in CD that is the repository variable CONSOLE_SENTRY_DSN."
} >&2
exit 1
