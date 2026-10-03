#!/usr/bin/env bash
# deploy.sh — the README "Deployment" section as one command: build, sync hashed assets as immutable,
# upload index.html as no-cache, invalidate the distribution, then read back index.html's hash.
#
# Old hashed assets are kept on purpose, so tabs opened before a deploy can still load their chunks.
# Pruning is manual; see `frontend/README.md` → Deployment.
#
#   AWS_PROFILE=devcards-deploy ./deploy.sh        DRY_RUN=1 ./deploy.sh (build + print commands)
#   Sentry: VITE_SENTRY_DSN from the environment, else the SSM String parameter named by CONSOLE_SENTRY_DSN_PARAM
#   (default /developercards/prod/console-sentry-dsn); blank means the build reports nothing.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; cd "$HERE"
export AWS_PROFILE="${AWS_PROFILE:-devcards-deploy}"
BUCKET="${CONSOLE_BUCKET:-recallsmith-console-622994489535}"
DIST_ID="${CONSOLE_DISTRIBUTION_ID:-E85FKUMZZWQWX}"     # d12pfy1rhi3ekm.cloudfront.net
REGION="${AWS_REGION:-ap-southeast-2}"
CONSOLE_URL="${CONSOLE_URL:-https://console.developercards.app}"
# Sets VITE_SENTRY_DSN (or leaves it blank) and VITE_BUILD_ID for the build; never fails and never prints the DSN.
source scripts/resolve-sentry-dsn.sh

npm run build
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
