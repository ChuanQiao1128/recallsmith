#!/usr/bin/env bash
# deploy.sh — the README "Deployment" section as one command: build, sync hashed assets as immutable,
# upload index.html as no-cache, invalidate the distribution, then read back index.html's hash.
#
# Old hashed assets are kept on purpose, so tabs opened before a deploy can still load their chunks.
# Pruning is manual; see `frontend/README.md` → Deployment.
#
#   AWS_PROFILE=devcards-deploy ./deploy.sh        DRY_RUN=1 ./deploy.sh (build + print commands, no AWS call)
#   Sentry: VITE_SENTRY_DSN from the environment, else the SSM String parameter named by CONSOLE_SENTRY_DSN_PARAM
#   (default /developercards/prod/console-sentry-dsn; a DRY_RUN reads it only when CONSOLE_SENTRY_DSN_PARAM is set
#   explicitly); blank means the build reports nothing.
#   PREBUILT=1 ./deploy.sh   ship dist/ as it is (CD: built without AWS credentials, sha256-verified); no build, but
#                            dist must carry the DSN resolved as above (scripts/check-bundle-dsn.sh)
#
# Production deploys run in CD (.github/workflows/cd.yml, infra/RUNBOOK.md §12). From a laptop (not DRY_RUN, not in
# GitHub Actions) ../scripts/deploy-preflight.sh first requires a clean tree, HEAD = origin/main and green CI on it;
# BREAK_GLASS=1 overrides that with a loud warning. AWS_PROFILE defaults to devcards-deploy (MFA) only when the
# environment carries no credentials of its own (CD's OIDC session does).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; cd "$HERE"
# Credentials already in the environment (CD's OIDC session, `aws configure export-credentials`) win over a profile
# default: CD has no devcards-deploy profile, and naming one would fail every aws call.
[ -n "${AWS_PROFILE:-}${AWS_ACCESS_KEY_ID:-}${AWS_SESSION_TOKEN:-}${AWS_WEB_IDENTITY_TOKEN_FILE:-}" ] || export AWS_PROFILE=devcards-deploy
BUCKET="${CONSOLE_BUCKET:-recallsmith-console-622994489535}"
DIST_ID="${CONSOLE_DISTRIBUTION_ID:-E85FKUMZZWQWX}"     # d12pfy1rhi3ekm.cloudfront.net
REGION="${AWS_REGION:-ap-southeast-2}"
CONSOLE_URL="${CONSOLE_URL:-https://console.developercards.app}"
"$HERE/../scripts/deploy-preflight.sh" frontend/deploy.sh
# A dry run calls no AWS at all, like every other deploy script's: no SSM lookup of the DSN (devcards-deploy needs the
# owner's MFA, and a headless lookup would fail into a DSN-less build without saying why). VITE_SENTRY_DSN, or an
# explicitly set CONSOLE_SENTRY_DSN_PARAM, still brings one in.
if [ "${DRY_RUN:-0}" = 1 ] && [ -z "${VITE_SENTRY_DSN:-}" ] && [ -z "${CONSOLE_SENTRY_DSN_PARAM+set}" ]; then
  export CONSOLE_SENTRY_DSN_PARAM=''
  echo "DRY_RUN: no SSM lookup for the Sentry DSN (set VITE_SENTRY_DSN or CONSOLE_SENTRY_DSN_PARAM to build with one)"
fi
# Sets VITE_SENTRY_DSN (or leaves it blank) and VITE_BUILD_ID for the build; never fails and never prints the DSN.
source scripts/resolve-sentry-dsn.sh

if [ "${PREBUILT:-0}" = 1 ]; then
  # CD's deploy job: the build job built dist/ without AWS credentials (DSN from the repository variable
  # CONSOLE_SENTRY_DSN) and the deploy job checked it against the build's SHA256SUMS. Rebuilding here would ship bytes
  # nobody verified; a bundle that lacks the DSN resolved above would ship a console that reports nothing.
  [ -f dist/index.html ] || { echo "PREBUILT=1 but $HERE/dist/index.html is missing; nothing deployed" >&2; exit 1; }
  bash scripts/check-bundle-dsn.sh dist
  echo "PREBUILT=1: deploying dist/ as built"
else
  npm run build
fi
[ -f dist/index.html ] || { echo "dist/index.html missing after build" >&2; exit 1; }
if [ "${DRY_RUN:-0}" = 1 ]; then
  echo "DRY: aws s3 sync dist s3://$BUCKET --exclude index.html --cache-control 'public,max-age=31536000,immutable'"
  echo "DRY: aws s3 cp dist/index.html s3://$BUCKET/index.html --cache-control no-cache --content-type text/html"
  echo "DRY: aws cloudfront create-invalidation --distribution-id $DIST_ID --paths '/*'"; exit 0
fi
aws s3 sync dist "s3://$BUCKET" --region "$REGION" --exclude index.html --cache-control "public,max-age=31536000,immutable"
aws s3 cp dist/index.html "s3://$BUCKET/index.html" --region "$REGION" --cache-control no-cache --content-type text/html
INV="$(aws cloudfront create-invalidation --distribution-id "$DIST_ID" --paths '/*' --query 'Invalidation.Id' --output text)"
echo "INVALIDATION=$INV"
aws cloudfront wait invalidation-completed --distribution-id "$DIST_ID" --id "$INV"
LOCAL="$(shasum -a 256 dist/index.html | cut -c1-16)"
REMOTE="$(curl -fsSL "$CONSOLE_URL/index.html" | shasum -a 256 | cut -c1-16)"
[ "$LOCAL" = "$REMOTE" ] || { echo "live index.html ($REMOTE) != built ($LOCAL)" >&2; exit 1; }
echo "OK console index.html sha256[0:16]=$REMOTE"
