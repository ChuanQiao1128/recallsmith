#!/usr/bin/env bash
# scripts/cd/restore-point.sh — what production looked like before a CD deploy, and the way back to it.
#
#   restore-point.sh record  <dir> <deploy-target>...   before the first change: every prod alias the targets move,
#                                                       the console's index.html, the whole site bucket
#   restore-point.sh restore <dir>                      after a failed deploy or smoke: put back whatever moved.
#                                                       Exit 0 restored (or nothing had moved), 1 incomplete (FAILED
#                                                       lines), 3 no restore point at <dir> (nothing was recorded, so
#                                                       the deploy never changed anything)
#   restore-point.sh summary <dir>                      markdown rows for the job summary (before / now / rollback)
#
# The deploy job of .github/workflows/cd.yml runs `record` right after it has credentials and before any deploy
# step, and `restore` in its `if: failure() || cancelled()` step, so smoke and rollback live in the job that was
# approved. `restore` only touches what changed since `record`:
#   - a Lambda alias whose version differs from the recorded one goes back with scripts/rollback.sh (which checks the
#     version is Active/Successful and re-reads the alias). An alias recorded on $LATEST (a Python function's first
#     deploy, see services/lambda-release.sh) goes to the version lambda-release.sh froze the live code into.
#   - the console's index.html, when its ETag changed, is uploaded again (no-cache) and its ETag read back. The hashed
#     assets of the old build are still in the bucket (frontend/deploy.sh never deletes them), so the old index.html is
#     the whole old console.
#   - the site bucket, when its listing changed: every recorded file is uploaded again (`cp --recursive`, never
#     `sync`, which skips a changed file of the same size: the deploy left every object newer than the copy), objects
#     the deploy added are removed (`sync --delete`), and the listing (key + ETag) is read back and must equal the
#     recorded one.
# The slow part, CloudFront, comes last: every bucket is restored first, then both invalidations are created, then
# waited for. A cancelled or timed-out run gets only a few minutes before GitHub stops the job, so RESTORE_SKIP_WAIT=true
# (cd.yml sets it on a cancel) creates the invalidations and does not wait for them. Before that part a one-line state
# is printed as an annotation (::error:: in GitHub Actions), so a job killed mid-wait still says what was restored.
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
SKIP_WAIT="${RESTORE_SKIP_WAIT:-false}"
aws_profile_default

die() { echo "restore-point: $*" >&2; exit 1; }

# note <text> — a line that stays visible on the run page (an annotation) even if the job is killed right after
note() {
  if [ "${GITHUB_ACTIONS:-}" = true ]; then echo "::error::$*"; else echo "$*"; fi
}

alias_version() {
  aws lambda get-alias --region "$REGION" --function-name "$1" --name "$ALIAS" --query 'FunctionVersion' --output text
}

console_etag() {
  aws s3api head-object --bucket "$CONSOLE_BUCKET" --key index.html --query 'ETag' --output text
}

site_listing() {
  aws s3api list-objects-v2 --bucket "$SITE_BUCKET" --query 'Contents[].[Key,ETag]' --output text | LC_ALL=C sort
}

# create_invalidation <distribution> → the invalidation id; 1 when it could not be created. Every command is checked
# here: bash ignores set -e inside a function called from an if or a && list.
create_invalidation() {
  local inv
  inv="$(aws cloudfront create-invalidation --distribution-id "$1" --paths '/*' --query 'Invalidation.Id' --output text)" || return 1
  [ -n "$inv" ] && [ "$inv" != None ] || return 1
  echo "$inv"
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

# restore_console <dir> — upload the recorded index.html again and read its ETag back
restore_console() {
  local dir="$1"
  aws s3 cp --only-show-errors "$dir/console/index.html" "s3://$CONSOLE_BUCKET/index.html" \
    --cache-control no-cache --content-type text/html || return 1
  [ "$(console_etag || true)" = "$(cat "$dir/console/etag")" ] || { echo "  console index.html ETag differs from the restore point after the upload" >&2; return 1; }
}

# restore_site <dir> — every recorded object uploaded again, the deploy's extra objects removed, index.html last, then
# the listing read back
restore_site() {
  local dir="$1"
  aws s3 cp --only-show-errors --recursive "$dir/site/files" "s3://$SITE_BUCKET" --exclude index.html \
    --cache-control 'public,max-age=3600' || return 1
  aws s3 sync --only-show-errors "$dir/site/files" "s3://$SITE_BUCKET" --delete --exclude index.html \
    --cache-control 'public,max-age=3600' || return 1
  aws s3 cp --only-show-errors "$dir/site/files/index.html" "s3://$SITE_BUCKET/index.html" \
    --cache-control no-cache --content-type text/html || return 1
  [ "$(site_listing || echo unreadable)" = "$(cat "$dir/site/listing")" ] \
    || { echo "  the site bucket's listing (key, ETag) still differs from the restore point" >&2; return 1; }
}

cmd_restore() {
  local dir="${1:?usage: restore <dir>}" failed=0 lt fn v cur target cur_etag dists="" d inv pending="" state=""
  if [ ! -d "$dir" ]; then
    echo "restore-point: no restore point at $dir: nothing was recorded, so the deploy changed nothing"
    return 3
  fi
  if [ -s "$dir/aliases.tsv" ]; then
    # The file is read on fd 3 so nothing below (aws, rollback.sh) can swallow its lines from stdin.
    while IFS="$(printf '\t')" read -r lt fn v <&3; do
      [ -n "$lt" ] || continue
      if ! cur="$(alias_version "$fn")"; then
        echo "FAILED $fn:$ALIAS: cannot read the alias (recorded $v)" >&2
        failed=1
        state="$state $fn:FAILED"
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
          state="$state $fn:FAILED"
          continue
        fi
        echo "$fn:$ALIAS was on \$LATEST before the deploy; its live code was frozen as version $target"
      fi
      echo "rolling back $fn:$ALIAS $cur -> $target"
      if "$ROOT/scripts/rollback.sh" "$lt" "$target" </dev/null; then
        state="$state $fn:$target"
      else
        echo "FAILED $fn:$ALIAS: scripts/rollback.sh $lt $target" >&2
        failed=1
        state="$state $fn:FAILED"
      fi
    done 3< "$dir/aliases.tsv"
  fi
  if [ -f "$dir/console/etag" ]; then
    if ! cur_etag="$(console_etag)"; then
      echo "FAILED console: cannot read index.html" >&2
      failed=1
      state="$state console:FAILED"
    elif [ "$cur_etag" = "$(cat "$dir/console/etag")" ]; then
      echo "unchanged console index.html"
    else
      dists="$dists $CONSOLE_DISTRIBUTION_ID"
      if restore_console "$dir"; then
        echo "restored console index.html (ETag $(cat "$dir/console/etag"))"
        state="$state console:restored"
      else
        echo "FAILED console: index.html not restored" >&2
        failed=1
        state="$state console:FAILED"
      fi
    fi
  fi
  if [ -f "$dir/site/listing" ]; then
    if [ "$(site_listing 2>/dev/null || echo unreadable)" = "$(cat "$dir/site/listing")" ]; then
      echo "unchanged site bucket"
    elif [ -z "$SITE_DISTRIBUTION_ID" ]; then
      echo "FAILED site: SITE_DISTRIBUTION_ID is not set" >&2
      failed=1
      state="$state site:FAILED"
    else
      dists="$dists $SITE_DISTRIBUTION_ID"
      if restore_site "$dir"; then
        echo "restored site bucket ($(wc -l < "$dir/site/listing" | tr -d ' ') object(s), listing verified)"
        state="$state site:restored"
      else
        echo "FAILED site: bucket not restored" >&2
        failed=1
        state="$state site:FAILED"
      fi
    fi
  fi
  if [ -n "$dists" ]; then
    note "rollback in progress:${state:- nothing moved}; CloudFront invalidations next ($dists)"
    for d in $dists; do
      if inv="$(create_invalidation "$d")"; then
        echo "  invalidation $inv on $d created"
        pending="$pending $d:$inv"
      else
        echo "FAILED invalidation on $d: not created, so its edges keep serving the deployed files until they expire" >&2
        failed=1
      fi
    done
    if [ "$SKIP_WAIT" = true ]; then
      [ -z "$pending" ] || echo "  not waiting for$pending (the run was cancelled; GitHub stops it within minutes): aws cloudfront get-invalidation --distribution-id <dist> --id <id>"
    else
      for d in $pending; do
        if aws cloudfront wait invalidation-completed --distribution-id "${d%%:*}" --id "${d#*:}"; then
          echo "  invalidation ${d#*:} on ${d%%:*} completed"
        else
          echo "FAILED invalidation ${d#*:} on ${d%%:*}: not completed in time, edges may still serve the deployed files" >&2
          failed=1
        fi
      done
    fi
  fi
  if [ "$failed" = 1 ]; then
    echo "ROLLBACK INCOMPLETE: restore what is marked FAILED by hand (infra/RUNBOOK.md §12)" >&2
    return 1
  fi
  echo "ROLLBACK OK: production is back at the restore point"
}

cmd_summary() {
  local dir="${1:?usage: summary <dir>}" lt fn v cur fv how
  [ -s "$dir/aliases.tsv" ] || return 0
  echo "| Lambda (alias $ALIAS) | before this run | now | roll back with |"
  echo "|---|---|---|---|"
  while IFS="$(printf '\t')" read -r lt fn v <&3; do
    [ -n "$lt" ] || continue
    cur="$(alias_version "$fn" 2>/dev/null </dev/null || echo '?')"
    # shellcheck disable=SC2016  # the literal alias target $LATEST
    if [ "$v" = '$LATEST' ]; then
      # Not a version rollback.sh accepts: the code $LATEST ran was frozen into a version by the deploy.
      fv="$(freeze_version "$fn" 2>/dev/null </dev/null || true)"
      if [ -n "$fv" ]; then
        how="\`scripts/rollback.sh $lt $fv\` (or Run workflow: rollback_target=$lt, rollback_version=$fv); $fv is the pre-deploy freeze of the code \$LATEST ran"
      else
        how="none: it was on \$LATEST and no pre-deploy freeze version exists"
      fi
    else
      how="\`scripts/rollback.sh $lt $v\` (or Run workflow: rollback_target=$lt, rollback_version=$v)"
    fi
    echo "| \`$fn\` | $v | $cur | $how |"
  done 3< "$dir/aliases.tsv"
}

case "${1:-}" in
  record) shift; cmd_record "$@" ;;
  restore) shift; cmd_restore "$@" ;;
  summary) shift; cmd_summary "$@" ;;
  *) echo "usage: scripts/cd/restore-point.sh {record <dir> <deploy-target>...|restore <dir>|summary <dir>}" >&2; exit 2 ;;
esac
