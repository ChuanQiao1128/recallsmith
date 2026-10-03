#!/usr/bin/env bash
# deploy.sh — package the two Lambdas and upload them (the existing zip + update-function-code flow,
# docs/low-latency-plan.md:47), then wait for each function to report LastUpdateStatus=Successful
# and prove the uploaded code is the local zip by comparing CodeSha256 with the zip's own SHA-256.
#
# Every deploy also overlays each function's environment BEFORE publish-version, because the Lambda
# environment is frozen into each published version: the committed non-secret file (env/$ENV.env.json)
# plus the decrypted SSM values under /developercards/$ENV, merged onto the live environment so the
# two unspellable keys and every stray key survive (E00 §2.6.3). No runtime fetch, no VPC endpoint,
# no egress — the values reach the function only as env vars written here (or by CD in E11).
#
#   AWS_PROFILE=devcards-deploy ./deploy.sh                 # deploy both, inject env
#   DRY_RUN=1 ./deploy.sh                       # package only, print what would be uploaded/injected
#   INJECT_ENV=0 ENV=prod ./deploy.sh           # code-only deploy, environment left untouched
#   ONLY=vpc ./deploy.sh | ONLY=worker ./deploy.sh
#   LAMBDA_RUNTIME=dotnet10 (default)           # the Lambda runtime set before publish-version; it must
#                                               # match the zip's target framework (net10.0)
#   PREBUILT=1 ./deploy.sh                      # ship dist/vpc.zip + dist/worker.zip as they are (CD: built without
#                                               # AWS credentials and sha256-verified); no packaging, no SDK needed
#
# Needs the .NET 10 SDK on PATH (package_lambda_zip.sh stops with instructions otherwise), except with PREBUILT=1.
#
# Production deploys run in CD (.github/workflows/cd.yml, infra/RUNBOOK.md §12). From a laptop (not DRY_RUN, not in
# GitHub Actions) ../scripts/deploy-preflight.sh first requires a clean tree, HEAD = origin/main and green CI on it;
# BREAK_GLASS=1 overrides that with a loud warning. AWS_PROFILE defaults to devcards-deploy (MFA) only when the
# environment carries no credentials of its own (CD's OIDC session does).
#
# Database migrations are NOT run here: they go through POST /api/v1/admin/db/migrate (super_admin,
# src_C/Vpc/Db/Migrate.cs) — the console's Migrate button, or scripts/release with a refresh token.
set -euo pipefail
set +x
HERE="$(cd "$(dirname "$0")" && pwd)"; cd "$HERE"
source "$HERE/scripts/merge-env.sh"
# R25X F04: the RevenueCat secret key leaf is the notifier's (it calls RevenueCat from outside the VPC); core-vpc has no
# egress and never gets it. Skipped like notify-recipient, and listed as optional with no mapping, so every injecting
# deploy also removes a stale REVENUECAT_SECRET_API_KEY that the R25 G04 mapping may have left on core-vpc.
SSM_NOT_ENV="${SSM_NOT_ENV%]},\"revenuecat-secret-api-key\"]"
SSM_OPTIONAL_ENV="${SSM_OPTIONAL_ENV%]},\"REVENUECAT_SECRET_API_KEY\"]"
# Credentials already in the environment (CD's OIDC session, `aws configure export-credentials`) win over a profile
# default: CD has no devcards-deploy profile, and naming one would fail every aws call.
[ -n "${AWS_PROFILE:-}${AWS_ACCESS_KEY_ID:-}${AWS_SESSION_TOKEN:-}${AWS_WEB_IDENTITY_TOKEN_FILE:-}" ] || export AWS_PROFILE=devcards-deploy
REGION="${AWS_REGION:-ap-southeast-2}"
ARCH="${LAMBDA_ARCH:-linux-arm64}"          # both functions are arm64 (aws lambda get-function-configuration)
LAMBDA_RUNTIME="${LAMBDA_RUNTIME:-dotnet10}"
VPC_FN="${VPC_FN:-core-vpc}"; WORKER_FN="${WORKER_FN:-worker-lambda}"
ONLY="${ONLY:-both}"
ENV="${ENV:-prod}"
INJECT_ENV="${INJECT_ENV:-1}"
ENV_FILE="$HERE/env/$ENV.env.json"
SSM_PATH="/developercards/$ENV"

command -v jq >/dev/null || { echo "jq is required" >&2; exit 1; }
file_env="$(jq -c . "$ENV_FILE")"          # a missing or invalid ENV_FILE is a hard error

"$HERE/../scripts/deploy-preflight.sh" src_C/deploy.sh

if [ "${PREBUILT:-0}" = 1 ]; then
  # CD's deploy job: the build job packaged these (same script, same ARCH) without AWS credentials and the deploy job
  # checked them against the build's SHA256SUMS. Rebuilding here would ship bytes nobody verified.
  zips=""
  [ "$ONLY" = worker ] || zips="dist/vpc.zip"
  [ "$ONLY" = vpc ] || zips="${zips:+$zips }dist/worker.zip"
  for z in $zips; do
    [ -s "$z" ] || { echo "PREBUILT=1 but $HERE/$z is missing; nothing deployed" >&2; exit 1; }
  done
  echo "PREBUILT=1: deploying $zips as built"
  # shellcheck disable=SC2086
  ls -la $zips
else
  ./package_lambda_zip.sh "$ARCH"
  ls -la dist/vpc.zip dist/worker.zip
fi

sha_b64() { openssl dgst -sha256 -binary "$1" | openssl base64 -A; }   # Lambda's CodeSha256 is base64(sha256)

# The decrypted SSM values, fetched once per run (not per function) and only for a real injecting
# deploy: a DRY_RUN or an INJECT_ENV=0 run never touches AWS here.
SECRETS_ALL=""
if [ "${DRY_RUN:-0}" != 1 ] && [ "$INJECT_ENV" = 1 ]; then
  SECRETS_ALL="$(ssm_to_env "$(aws ssm get-parameters-by-path --region "$REGION" --path "$SSM_PATH" --with-decryption --output json)")"
  # An internal-secret leaf still at its Terraform placeholder is never deployed (R18C L2): it is dropped with a
  # warning here, so drop_absent_optional below also removes a stale copy from the live environment.
  SECRETS_ALL="$(drop_placeholder_secrets "$SECRETS_ALL")"
fi

# deploy_one <fn> <zip> <file_overlay_json> <secret_keys_json>
deploy_one() {
  local fn="$1" zip="$2" local_sha; local_sha="$(sha_b64 "$zip")"
  if [ "${DRY_RUN:-0}" = 1 ]; then
    echo "DRY: aws lambda update-function-code --function-name $fn --zip-file fileb://$zip (sha256 $local_sha)"
    if [ "$INJECT_ENV" = 1 ]; then
      echo "DRY: $fn env overlay keys: $(jq -r 'keys | join(",")' <<<"$3")"
      echo "DRY: $fn secret keys from $SSM_PATH: $(jq -r 'join(",")' <<<"$4")"
    else
      echo "DRY: $fn environment left as is (INJECT_ENV=0)"
    fi
    echo "DRY: aws lambda update-function-configuration --function-name $fn --runtime $LAMBDA_RUNTIME, then aws lambda wait function-updated (only if Runtime is not already $LAMBDA_RUNTIME; checked after either way)"
    echo "DRY: aws lambda publish-version --function-name $fn, then update-alias ${PUBLISH_ALIAS:-prod} to it (CodeSha256 and Runtime verified on the alias, ROLLBACK line printed)"
    return 0
  fi
  echo "== $fn <- $zip"

  # Overlay the environment BEFORE publish-version, so the published version freezes the merged env.
  if [ "$INJECT_ENV" = 1 ]; then
    local current secrets merged
    current="$(aws lambda get-function-configuration --region "$REGION" --function-name "$fn" --query 'Environment.Variables' --output json)"
    secrets="$(pick_keys "$SECRETS_ALL" "$4")"
    # An optional secret (a -previous rotation leaf, a per-route secret) whose leaf is gone leaves the env too.
    current="$(drop_absent_optional "$current" "$secrets")"
    merged="$(merge_env "$current" "$3" "$secrets")"
    aws lambda update-function-configuration --region "$REGION" --function-name "$fn" --environment "$(jq -cn --argjson v "$merged" '{Variables: $v}')" --query 'LastUpdateStatus' --output text
    aws lambda wait function-updated --region "$REGION" --function-name "$fn"
    echo "OK $fn environment: $(jq -r 'keys | length' <<<"$merged") keys"
  else
    echo "note: INJECT_ENV=0 — environment left as is"
  fi

  aws lambda update-function-code --region "$REGION" --function-name "$fn" --zip-file "fileb://$zip" --query '[FunctionName,LastUpdateStatus,CodeSha256]' --output text
  aws lambda wait function-updated --region "$REGION" --function-name "$fn"
  local st remote_sha
  st="$(aws lambda get-function-configuration --region "$REGION" --function-name "$fn" --query 'LastUpdateStatus' --output text)"
  remote_sha="$(aws lambda get-function-configuration --region "$REGION" --function-name "$fn" --query 'CodeSha256' --output text)"
  [ "$st" = Successful ] || { echo "$fn LastUpdateStatus=$st" >&2; exit 1; }
  [ "$remote_sha" = "$local_sha" ] || { echo "$fn CodeSha256 mismatch: remote=$remote_sha local=$local_sha" >&2; exit 1; }
  echo "OK $fn CodeSha256=$remote_sha"

  # Runtime, on both the INJECT_ENV=1 and =0 paths, after the code and before publish-version: the
  # zip targets net10.0, so the version about to be published must say dotnet10 (net10.0 assemblies
  # cannot load on the .NET 8 runtime). Between the code update and this step $LATEST is net10 code on
  # the old runtime; nothing user-visible runs $LATEST, since API Gateway invokes core-vpc through its
  # alias and the worker's SQS event source mapping targets the worker alias (infra/modules/worker/
  # function.tf). A published version keeps the runtime it was published with, so the ROLLBACK line
  # below (alias back to the previous version) also brings back dotnet8 together with the old code.
  local rt
  rt="$(aws lambda get-function-configuration --region "$REGION" --function-name "$fn" --query 'Runtime' --output text)"
  if [ "$rt" != "$LAMBDA_RUNTIME" ]; then
    echo "$fn Runtime $rt -> $LAMBDA_RUNTIME"
    aws lambda update-function-configuration --region "$REGION" --function-name "$fn" --runtime "$LAMBDA_RUNTIME" --query '[FunctionName,Runtime,LastUpdateStatus]' --output text
    aws lambda wait function-updated --region "$REGION" --function-name "$fn"
    rt="$(aws lambda get-function-configuration --region "$REGION" --function-name "$fn" --query 'Runtime' --output text)"
  fi
  [ "$rt" = "$LAMBDA_RUNTIME" ] || { echo "$fn Runtime=$rt, expected $LAMBDA_RUNTIME" >&2; exit 1; }
  echo "OK $fn Runtime=$rt"

  # update-function-code only moves $LATEST. API Gateway invokes core-vpc through the `prod`
  # ALIAS (integration URI …:function:core-vpc:prod), so without publishing a version and moving
  # the alias the API keeps running the old build — found 2026-09-21 when the first Wave C deploy
  # left version 44 (2026-08-18) serving traffic, the console's migrate ran the OLD migration set
  # and the MCQ import hit SERVER_NOT_READY_MCQ. The worker's SQS event source mapping targets its
  # alias too (infra/modules/worker/function.tf), so the worker needs the same publish and move.
  local alias="${PUBLISH_ALIAS:-prod}"
  if aws lambda get-alias --region "$REGION" --function-name "$fn" --name "$alias" >/dev/null 2>&1; then
    local ver alias_sha alias_rt prev_ver
    # Read before the move so the ROLLBACK line the RUNBOOK refers to names the version that was serving.
    prev_ver="$(aws lambda get-alias --region "$REGION" --function-name "$fn" --name "$alias" --query 'FunctionVersion' --output text)"
    ver="$(aws lambda publish-version --region "$REGION" --function-name "$fn" --description "deploy.sh $(date -u +%Y-%m-%dT%H:%M:%SZ) $(git -C "$HERE" rev-parse --short HEAD 2>/dev/null || echo nogit)" --query 'Version' --output text)"
    aws lambda update-alias --region "$REGION" --function-name "$fn" --name "$alias" --function-version "$ver" --query '[Name,FunctionVersion]' --output text
    # Printed as soon as the alias has moved, so a failed check below still leaves the way back on screen.
    echo "ROLLBACK: aws lambda update-alias --region $REGION --function-name $fn --name $alias --function-version $prev_ver"
    alias_sha="$(aws lambda get-function-configuration --region "$REGION" --function-name "$fn:$alias" --query 'CodeSha256' --output text)"
    [ "$alias_sha" = "$local_sha" ] || { echo "$fn:$alias CodeSha256 mismatch after alias move: $alias_sha" >&2; exit 1; }
    alias_rt="$(aws lambda get-function-configuration --region "$REGION" --function-name "$fn:$alias" --query 'Runtime' --output text)"
    [ "$alias_rt" = "$LAMBDA_RUNTIME" ] || { echo "$fn:$alias Runtime=$alias_rt after alias move, expected $LAMBDA_RUNTIME" >&2; exit 1; }
    echo "OK $fn:$alias -> version $ver (CodeSha256 and Runtime=$alias_rt verified)"
  else
    echo "note: $fn has no alias '$alias'; only \$LATEST updated"
  fi
}

# core-vpc gets every mapped secret present under the path; the worker gets only its projection of
# the non-secret file (WORKER_FILE_KEYS) and PGPASSWORD (WORKER_SECRET_KEYS).
[ "$ONLY" = worker ] || deploy_one "$VPC_FN" "$HERE/dist/vpc.zip" "$file_env" "$(jq -c 'to_entries | map(.value)' <<<"$SSM_TO_ENV")"
[ "$ONLY" = vpc ]    || deploy_one "$WORKER_FN" "$HERE/dist/worker.zip" "$(pick_keys "$file_env" "$WORKER_FILE_KEYS")" "$WORKER_SECRET_KEYS"
