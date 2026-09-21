#!/usr/bin/env bash
# deploy.sh — package the two Lambdas and upload them (the existing zip + update-function-code flow,
# docs/low-latency-plan.md:47), then wait for each function to report LastUpdateStatus=Successful
# and prove the uploaded code is the local zip by comparing CodeSha256 with the zip's own SHA-256.
#
#   AWS_PROFILE=dev ./deploy.sh            # deploy both
#   DRY_RUN=1 ./deploy.sh                  # package only, print what would be uploaded
#   ONLY=vpc ./deploy.sh | ONLY=worker ./deploy.sh
#
# Database migrations are NOT run here: they go through POST /api/v1/admin/db/migrate (super_admin,
# src_C/Vpc/Db/Migrate.cs) — the console's Migrate button, or scripts/release with a refresh token.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; cd "$HERE"
export AWS_PROFILE="${AWS_PROFILE:-dev}"
REGION="${AWS_REGION:-ap-southeast-2}"
ARCH="${LAMBDA_ARCH:-linux-arm64}"          # both functions are arm64 (aws lambda get-function-configuration)
VPC_FN="${VPC_FN:-core-vpc}"; WORKER_FN="${WORKER_FN:-worker-lambda}"
ONLY="${ONLY:-both}"

./package_lambda_zip.sh "$ARCH"
ls -la dist/vpc.zip dist/worker.zip

sha_b64() { openssl dgst -sha256 -binary "$1" | openssl base64 -A; }   # Lambda's CodeSha256 is base64(sha256)

deploy_one() {
  local fn="$1" zip="$2" local_sha; local_sha="$(sha_b64 "$zip")"
  if [ "${DRY_RUN:-0}" = 1 ]; then echo "DRY: aws lambda update-function-code --function-name $fn --zip-file fileb://$zip (sha256 $local_sha)"; return 0; fi
  echo "== $fn <- $zip"
  aws lambda update-function-code --region "$REGION" --function-name "$fn" --zip-file "fileb://$zip" --query '[FunctionName,LastUpdateStatus,CodeSha256]' --output text
  aws lambda wait function-updated --region "$REGION" --function-name "$fn"
  local st remote_sha
  st="$(aws lambda get-function-configuration --region "$REGION" --function-name "$fn" --query 'LastUpdateStatus' --output text)"
  remote_sha="$(aws lambda get-function-configuration --region "$REGION" --function-name "$fn" --query 'CodeSha256' --output text)"
  [ "$st" = Successful ] || { echo "$fn LastUpdateStatus=$st" >&2; exit 1; }
  [ "$remote_sha" = "$local_sha" ] || { echo "$fn CodeSha256 mismatch: remote=$remote_sha local=$local_sha" >&2; exit 1; }
  echo "OK $fn CodeSha256=$remote_sha"

  # update-function-code only moves $LATEST. API Gateway invokes core-vpc through the `prod`
  # ALIAS (integration URI …:function:core-vpc:prod), so without publishing a version and moving
  # the alias the API keeps running the old build — found 2026-09-21 when the first Wave C deploy
  # left version 44 (2026-08-18) serving traffic, the console's migrate ran the OLD migration set
  # and the MCQ import hit SERVER_NOT_READY_MCQ. The worker's SQS trigger targets $LATEST, but its
  # alias is moved too so both functions read the same.
  local alias="${PUBLISH_ALIAS:-prod}"
  if aws lambda get-alias --region "$REGION" --function-name "$fn" --name "$alias" >/dev/null 2>&1; then
    local ver alias_sha
    ver="$(aws lambda publish-version --region "$REGION" --function-name "$fn" --description "deploy.sh $(date -u +%Y-%m-%dT%H:%M:%SZ) $(git -C "$HERE" rev-parse --short HEAD 2>/dev/null || echo nogit)" --query 'Version' --output text)"
    aws lambda update-alias --region "$REGION" --function-name "$fn" --name "$alias" --function-version "$ver" --query '[Name,FunctionVersion]' --output text
    alias_sha="$(aws lambda get-function-configuration --region "$REGION" --function-name "$fn:$alias" --query 'CodeSha256' --output text)"
    [ "$alias_sha" = "$local_sha" ] || { echo "$fn:$alias CodeSha256 mismatch after alias move: $alias_sha" >&2; exit 1; }
    echo "OK $fn:$alias -> version $ver (CodeSha256 verified)"
  else
    echo "note: $fn has no alias '$alias'; only \$LATEST updated"
  fi
}

[ "$ONLY" = worker ] || deploy_one "$VPC_FN" "$HERE/dist/vpc.zip"
[ "$ONLY" = vpc ]    || deploy_one "$WORKER_FN" "$HERE/dist/worker.zip"
