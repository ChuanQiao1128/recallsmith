#!/usr/bin/env bash
# scripts/cd/restore-point.sh — what production looked like before a CD deploy, and the way back to it.
#
#   restore-point.sh record  <dir> <deploy-target>...   before the first change: every prod alias the targets move,
#                                                       the console's index.html, the whole site bucket
#   restore-point.sh restore <dir>                      after a failed deploy or smoke: put back whatever moved
#   restore-point.sh summary <dir>                      markdown rows for the job summary (before / now / rollback)
#
# The deploy job of .github/workflows/cd.yml runs `record` right after it has credentials and before any deploy
# step, and `restore` in its `if: failure() || cancelled()` step, so smoke and rollback live in the job that was
# approved. `restore` only touches what changed since `record`:
#   - a Lambda alias whose version differs from the recorded one goes back with scripts/rollback.sh (which checks the
#     version is Active/Successful and re-reads the alias). An alias recorded on $LATEST (a Python function's first
#     deploy, see services/lambda-release.sh) goes to the version lambda-release.sh froze the live code into.
#   - the console's index.html, when its ETag changed, is uploaded again (no-cache) and the distribution invalidated.
#     The hashed assets of the old build are still in the bucket (frontend/deploy.sh never deletes them), so the old
#     index.html is the whole old console.
#   - the site bucket, when its listing changed, is synced back from the copy (`--delete`, the way site/deploy.sh
#     syncs it) and its distribution invalidated.
# It goes on after a failed item and exits 1 if any item could not be restored. Prints names, versions and ETags only.
set -euo pipefail
set +x
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=scripts/lib/targets.sh
source "$ROOT/scripts/lib/targets.sh"

REGION="${AWS_REGION:-ap-southeast-2}"
ALIAS="${PUBLISH_ALIAS:-prod}"
CONSOLE_BUCKET="${CONSOLE_BUCKET:-recallsmith-console-622994489535}"
CONSOLE_DISTRIBUTION_ID="${CONSOLE_DISTRIBUTION_ID:-E85FKUMZZWQWX}"
SITE_BUCKET="${SITE_BUCKET:-developercards-site-622994489535}"
SITE_DISTRIBUTION_ID="${SITE_DISTRIBUTION_ID:-}"
aws_profile_default

die() { echo "restore-point: $*" >&2; exit 1; }

alias_version() {
  aws lambda get-alias --region "$REGION" --function-name "$1" --name "$ALIAS" --query 'FunctionVersion' --output text
}

console_etag() {
  aws s3api head-object --bucket "$CONSOLE_BUCKET" --key index.html --query 'ETag' --output text
}

site_listing() {
  aws s3api list-objects-v2 --bucket "$SITE_BUCKET" --query 'Contents[].[Key,ETag]' --output text | LC_ALL=C sort
}

invalidate() {
  local dist="$1" inv
  inv="$(aws cloudfront create-invalidation --distribution-id "$dist" --paths '/*' --query 'Invalidation.Id' --output text)"
  aws cloudfront wait invalidation-completed --distribution-id "$dist" --id "$inv"
  echo "  invalidation $inv on $dist completed"
}

cmd_record() {
  local dir="${1:?usage: record <dir> <deploy-target>...}" t lt fn v lambdas
  shift
  [ "$#" -gt 0 ] || die "record: no deploy target given"
  mkdir -p "$dir"
  : > "$dir/aliases.tsv"
  for t in "$@"; do
    lambdas="$(target_lambdas "$t")" || die "record: unknown deploy target '$t'"
    for lt in $lambdas; do
      fn="$(target_function "$lt")"
      v="$(alias_version "$fn")" || die "record: cannot read $fn:$ALIAS"
      [ -n "$v" ] || die "record: $fn:$ALIAS has no version"
      printf '%s\t%s\t%s\n' "$lt" "$fn" "$v" >> "$dir/aliases.tsv"
      echo "recorded $fn:$ALIAS = $v"
    done
    case "$t" in
      console)
        mkdir -p "$dir/console"
        aws s3 cp --only-show-errors "s3://$CONSOLE_BUCKET/index.html" "$dir/console/index.html"
        console_etag > "$dir/console/etag.tmp"
        mv "$dir/console/etag.tmp" "$dir/console/etag"   # written last: no etag file means no console restore point
        echo "recorded console index.html ETag $(cat "$dir/console/etag")"
        ;;
      site)
        mkdir -p "$dir/site/files"
        aws s3 sync --only-show-errors "s3://$SITE_BUCKET" "$dir/site/files"
        site_listing > "$dir/site/listing.tmp"
        mv "$dir/site/listing.tmp" "$dir/site/listing"
        echo "recorded site bucket: $(wc -l < "$dir/site/listing" | tr -d ' ') object(s)"
        ;;
    esac
  done
}

# freeze_version <fn> → the newest version lambda-release.sh published as the pre-deploy freeze of $LATEST
freeze_version() {
  aws lambda list-versions-by-function --region "$REGION" --function-name "$1" \
    --query "Versions[?starts_with(Description, 'pre-deploy freeze of the live')].Version" --output text \
    | tr '\t' '\n' | grep -E '^[0-9]+$' | sort -n | tail -n 1
}

cmd_restore() {
  local dir="${1:?usage: restore <dir>}" failed=0 lt fn v cur target cur_etag
  if [ ! -d "$dir" ]; then
    echo "restore-point: no restore point at $dir: nothing was recorded, so nothing was changed"
    return 0
  fi
  if [ -s "$dir/aliases.tsv" ]; then
    # The file is read on fd 3 so nothing below (aws, rollback.sh) can swallow its lines from stdin.
    while IFS="$(printf '\t')" read -r lt fn v <&3; do
      [ -n "$lt" ] || continue
      if ! cur="$(alias_version "$fn")"; then
        echo "FAILED $fn:$ALIAS: cannot read the alias (recorded $v)" >&2
        failed=1
        continue
      fi
      if [ "$cur" = "$v" ]; then
        echo "unchanged $fn:$ALIAS = $v"
        continue
      fi
      target="$v"
      # shellcheck disable=SC2016  # the literal alias target $LATEST
      if [ "$v" = '$LATEST' ]; then
        target="$(freeze_version "$fn" || true)"
        if [ -z "$target" ]; then
          echo "FAILED $fn:$ALIAS: recorded on \$LATEST and no pre-deploy freeze version found; now $cur" >&2
          failed=1
          continue
        fi
        echo "$fn:$ALIAS was on \$LATEST before the deploy; its live code was frozen as version $target"
      fi
      echo "rolling back $fn:$ALIAS $cur -> $target"
      if ! "$ROOT/scripts/rollback.sh" "$lt" "$target" </dev/null; then
        echo "FAILED $fn:$ALIAS: scripts/rollback.sh $lt $target" >&2
        failed=1
      fi
    done 3< "$dir/aliases.tsv"
  fi
  if [ -f "$dir/console/etag" ]; then
    if ! cur_etag="$(console_etag)"; then
      echo "FAILED console: cannot read index.html" >&2
      failed=1
    elif [ "$cur_etag" = "$(cat "$dir/console/etag")" ]; then
      echo "unchanged console index.html"
    elif aws s3 cp --only-show-errors "$dir/console/index.html" "s3://$CONSOLE_BUCKET/index.html" \
      --cache-control no-cache --content-type text/html && invalidate "$CONSOLE_DISTRIBUTION_ID"; then
      echo "restored console index.html (ETag $(cat "$dir/console/etag"))"
    else
      echo "FAILED console: index.html not restored" >&2
      failed=1
    fi
  fi
  if [ -f "$dir/site/listing" ]; then
    if [ "$(site_listing 2>/dev/null || echo unreadable)" = "$(cat "$dir/site/listing")" ]; then
      echo "unchanged site bucket"
    elif [ -z "$SITE_DISTRIBUTION_ID" ]; then
      echo "FAILED site: SITE_DISTRIBUTION_ID is not set" >&2
      failed=1
    elif aws s3 sync --only-show-errors "$dir/site/files" "s3://$SITE_BUCKET" --delete --exclude index.html \
      --cache-control 'public,max-age=3600' \
      && aws s3 cp --only-show-errors "$dir/site/files/index.html" "s3://$SITE_BUCKET/index.html" \
        --cache-control no-cache --content-type text/html \
      && invalidate "$SITE_DISTRIBUTION_ID"; then
      echo "restored site bucket"
    else
      echo "FAILED site: bucket not restored" >&2
      failed=1
    fi
  fi
  if [ "$failed" = 1 ]; then
    echo "ROLLBACK INCOMPLETE: restore what is marked FAILED by hand (infra/RUNBOOK.md §12)" >&2
    return 1
  fi
  echo "ROLLBACK OK: production is back at the restore point"
}

cmd_summary() {
  local dir="${1:?usage: summary <dir>}" lt fn v cur
  [ -s "$dir/aliases.tsv" ] || return 0
  echo "| Lambda (alias $ALIAS) | before this run | now | roll back with |"
  echo "|---|---|---|---|"
  while IFS="$(printf '\t')" read -r lt fn v <&3; do
    [ -n "$lt" ] || continue
    cur="$(alias_version "$fn" 2>/dev/null </dev/null || echo '?')"
    echo "| \`$fn\` | $v | $cur | \`scripts/rollback.sh $lt $v\` (or Run workflow: rollback_target=$lt, rollback_version=$v) |"
  done 3< "$dir/aliases.tsv"
}

case "${1:-}" in
  record) shift; cmd_record "$@" ;;
  restore) shift; cmd_restore "$@" ;;
  summary) shift; cmd_summary "$@" ;;
  *) echo "usage: scripts/cd/restore-point.sh {record <dir> <deploy-target>...|restore <dir>|summary <dir>}" >&2; exit 2 ;;
esac
