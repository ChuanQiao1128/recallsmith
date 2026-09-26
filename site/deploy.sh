#!/usr/bin/env bash
# deploy.sh — publish the landing page: sync site/ into the site bucket (index.html as
# no-cache), invalidate the distribution, then read back index.html's hash from the live host.
#
#   AWS_PROFILE=dev SITE_DISTRIBUTION_ID=<terraform output -raw site_distribution_id> ./deploy.sh
#   DRY_RUN=1 ./deploy.sh        (prints the commands, touches nothing)
#
# Supervisor-only (E00 §0): workers run this with DRY_RUN=1 only.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; cd "$HERE"
export AWS_PROFILE="${AWS_PROFILE:-dev}"
BUCKET="${SITE_BUCKET:-developercards-site-622994489535}"
DIST_ID="${SITE_DISTRIBUTION_ID:-}"
SITE_URL="${SITE_URL:-https://developercards.app}"
REGION="${AWS_REGION:-ap-southeast-2}"

[ -f index.html ] || { echo "index.html missing" >&2; exit 1; }
if [ "${DRY_RUN:-0}" = 1 ]; then
  echo "DRY: aws s3 sync . s3://$BUCKET --delete --exclude deploy.sh --exclude '.*' --exclude index.html --cache-control 'public,max-age=3600'"
  echo "DRY: aws s3 cp index.html s3://$BUCKET/index.html --cache-control no-cache --content-type text/html"
  echo "DRY: aws cloudfront create-invalidation --distribution-id ${DIST_ID:-<SITE_DISTRIBUTION_ID>} --paths '/*'"
  echo "DRY: curl -fsSL $SITE_URL/index.html | shasum -a 256"; exit 0
fi
[ -n "$DIST_ID" ] || { echo "SITE_DISTRIBUTION_ID is required (terraform output -raw site_distribution_id)" >&2; exit 1; }
aws s3 sync . "s3://$BUCKET" --region "$REGION" --delete --exclude deploy.sh --exclude '.*' --exclude index.html --cache-control "public,max-age=3600"
aws s3 cp index.html "s3://$BUCKET/index.html" --region "$REGION" --cache-control no-cache --content-type text/html
INV="$(aws cloudfront create-invalidation --distribution-id "$DIST_ID" --paths '/*' --query 'Invalidation.Id' --output text)"
echo "INVALIDATION=$INV"
aws cloudfront wait invalidation-completed --distribution-id "$DIST_ID" --id "$INV"
LOCAL="$(shasum -a 256 index.html | cut -c1-16)"
REMOTE="$(curl -fsSL "$SITE_URL/index.html" | shasum -a 256 | cut -c1-16)"
[ "$LOCAL" = "$REMOTE" ] || { echo "live index.html ($REMOTE) != local ($LOCAL)" >&2; exit 1; }
echo "OK site index.html sha256[0:16]=$REMOTE"
