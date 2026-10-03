#!/usr/bin/env bash
# scripts/rollback.sh <target> <version> — move one Lambda's prod alias back to a published version, then prove it.
#
#   target: vpc (core-vpc) | worker (worker-lambda) | ai-qa | notifier | source-watcher | synthetic-check |
#           webhook-dispatcher (developercards-<target>)
#   version: a published version number, e.g. the one a deploy's ROLLBACK line or the CD job summary names
#
#   scripts/rollback.sh vpc 75                     # local break-glass (AWS_PROFILE defaults to devcards-deploy, MFA)
#   DRY_RUN=1 scripts/rollback.sh worker 27        # print the commands, call nothing
#
# Used by CD twice: the automatic rollback after a failed deploy or smoke (scripts/cd/restore-point.sh restore) and the
# manual rollback (workflow_dispatch of .github/workflows/cd.yml with rollback_target + rollback_version). Both run
# behind the production environment's approval.
#
# Before the move it checks that the version exists and is Active/Successful; after it, that the alias names that
# version, and it prints the alias's CodeSha256 and an UNDO line (the version the alias left). Code and environment of
# $LATEST are not touched: nothing serves $LATEST (API Gateway, the SQS mappings and the schedules call the alias).
#
# core-vpc is never moved below VPC_MIN_VERSION (default 74): migration 045 dropped the table versions 73 and earlier
# write to, so they cannot serve (infra/RUNBOOK.md §9). Fix forward instead.
set -euo pipefail
set +x
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=scripts/lib/targets.sh
source "$ROOT/scripts/lib/targets.sh"

usage() {
  echo "usage: scripts/rollback.sh <$(echo "$CD_ROLLBACK_TARGETS" | tr ' ' '|')> <version>" >&2
  echo "  env: AWS_REGION (ap-southeast-2), PUBLISH_ALIAS (prod), AWS_PROFILE (devcards-deploy when no credentials are set), DRY_RUN=1" >&2
  exit 2
}

[ "$#" -eq 2 ] || usage
TARGET="$1"; VERSION="$2"
FN="$(target_function "$TARGET")" || usage
[[ "$VERSION" =~ ^[1-9][0-9]{0,5}$ ]] || { echo "rollback: version must be a published version number, got '$VERSION'" >&2; exit 2; }
VPC_MIN_VERSION="${VPC_MIN_VERSION:-74}"
if [ "$TARGET" = vpc ] && [ "$VERSION" -lt "$VPC_MIN_VERSION" ]; then
  echo "rollback: refusing core-vpc version $VERSION: versions below $VPC_MIN_VERSION predate migration 045 and cannot serve (infra/RUNBOOK.md §9); fix forward" >&2
  exit 1
fi
REGION="${AWS_REGION:-ap-southeast-2}"
ALIAS="${PUBLISH_ALIAS:-prod}"
aws_profile_default

if [ "${DRY_RUN:-0}" = 1 ]; then
  echo "DRY: aws lambda get-function-configuration --region $REGION --function-name $FN --qualifier $VERSION (must be Active/Successful)"
  echo "DRY: aws lambda update-alias --region $REGION --function-name $FN --name $ALIAS --function-version $VERSION"
  echo "DRY: aws lambda get-alias --region $REGION --function-name $FN --name $ALIAS (must name $VERSION)"
  exit 0
fi

before="$(aws lambda get-alias --region "$REGION" --function-name "$FN" --name "$ALIAS" --query 'FunctionVersion' --output text)"
state="$(aws lambda get-function-configuration --region "$REGION" --function-name "$FN" --qualifier "$VERSION" \
  --query '[State,LastUpdateStatus]' --output text)"
if [ "$state" != "$(printf 'Active\tSuccessful')" ]; then
  echo "rollback: $FN version $VERSION is not Active/Successful (got: $state); $FN:$ALIAS left on $before" >&2
  exit 1
fi

if [ "$before" = "$VERSION" ]; then
  echo "rollback: $FN:$ALIAS already on version $VERSION"
else
  aws lambda update-alias --region "$REGION" --function-name "$FN" --name "$ALIAS" --function-version "$VERSION" \
    --query '[Name,FunctionVersion]' --output text
fi

after="$(aws lambda get-alias --region "$REGION" --function-name "$FN" --name "$ALIAS" --query 'FunctionVersion' --output text)"
[ "$after" = "$VERSION" ] || { echo "rollback: $FN:$ALIAS reads version $after after the move, expected $VERSION" >&2; exit 1; }
sha="$(aws lambda get-function-configuration --region "$REGION" --function-name "$FN:$ALIAS" --query 'CodeSha256' --output text)"
echo "OK $FN:$ALIAS -> version $VERSION (was $before) CodeSha256=$sha"
case "$before" in
  '' | *[!0-9]*) ;;
  *) [ "$before" = "$VERSION" ] || echo "UNDO: scripts/rollback.sh $TARGET $before" ;;
esac
