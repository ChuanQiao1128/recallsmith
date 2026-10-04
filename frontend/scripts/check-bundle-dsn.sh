#!/usr/bin/env bash
# scripts/check-bundle-dsn.sh [dist-dir] — a console bundle built elsewhere must report to the Sentry DSN this deploy
# would have built with. CD builds the console without AWS credentials, taking the DSN from the repository variable
# CONSOLE_SENTRY_DSN (a copy; the SSM String parameter stays the source of truth). This resolves the DSN the way
# deploy.sh does (scripts/resolve-sentry-dsn.sh: VITE_SENTRY_DSN from the environment, else SSM) and exits 1 when one
# is resolved and no file under dist-dir (default dist) contains it, so a stale or missing copy stops the deploy
# before anything is uploaded. With no DSN resolved there is nothing to compare: exit 0.
#
# It also exits 1 when the DSN's ingest origin (https://<host after the @>) is not a source of connect-src in the
# console's enforced Content-Security-Policy, infra/modules/edge/security_headers.json (R29-REV-01). Without that, a DSN
# moved to another Sentry org or region would build and deploy green while every browser blocked every error report.
# The fix for such a refusal is a Terraform change to that file first (infra/RUNBOOK.md section 16), then the DSN.
#
# Run by deploy.sh with PREBUILT=1, and by CD's deploy job before the first change. Never prints the DSN (the origin,
# which the CSP publishes anyway, is printed on a refusal).
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
if ! grep -rqF -- "$VITE_SENTRY_DSN" "$DIST"; then
  {
    echo "check-bundle-dsn: no file under $DIST carries the DSN resolved for this deploy, so this console would not"
    echo "report to Sentry (or would report to another project). Rebuild with VITE_SENTRY_DSN set to the value of"
    echo "/developercards/prod/console-sentry-dsn; in CD that is the repository variable CONSOLE_SENTRY_DSN."
  } >&2
  exit 1
fi
echo "check-bundle-dsn: the bundle carries the resolved DSN"

# The resolver only keeps https://<key>@<host>/<project> (no port, no path), so the browser posts to https://<host>.
CSP_JSON="$(cd "$HERE/../.." && pwd)/infra/modules/edge/security_headers.json"
dsn_host="${VITE_SENTRY_DSN#*@}"
origin="https://${dsn_host%%/*}"
connect_src="$(jq -er '.content_security_policy.console[] | select(startswith("connect-src "))' "$CSP_JSON")" || {
  echo "check-bundle-dsn: cannot read the console's connect-src from $CSP_JSON; nothing deployed" >&2
  exit 1
}
if printf '%s\n' "$connect_src" | tr -s ' ' '\n' | grep -qxF -- "$origin"; then
  echo "check-bundle-dsn: the console CSP's connect-src allows the DSN's ingest origin $origin"
  exit 0
fi
{
  echo "check-bundle-dsn: the DSN's ingest origin $origin is not in connect-src of the console's enforced CSP"
  echo "($CSP_JSON), so every browser would block every error report. Add it there and let the Terraform"
  echo "pipeline apply it (infra/RUNBOOK.md section 16) before deploying a console built with this DSN."
} >&2
exit 1
