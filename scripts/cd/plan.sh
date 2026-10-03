#!/usr/bin/env bash
# scripts/cd/plan.sh — the decisions of the `plan` job of .github/workflows/cd.yml, out of YAML so they can be tested
# (scripts/tests/cd-scripts.test.sh). Needs no AWS credential; `last-deployed` and `decide` read GitHub with gh.
#
#   plan.sh classify <path>...        one line per path: the deploy target it belongs to, or "-"
#   plan.sh changed <base|""> <head>  the deploy targets with a file changed in base..head, in deploy order
#   plan.sh select <spec>             an explicit list ("all" or target names) checked and put in deploy order
#   plan.sh last-deployed             the commit of the last successful full CD deployment to production, or nothing
#   plan.sh decide                    the plan job: reads the event from the environment, prints key=value outputs
#
# What deploys when (infra/RUNBOOK.md §12):
#   backend   src_C/**, except Tests/ and Public/ (neither is in the vpc or worker zip) and *.md
#   console   frontend/**, except tests/ and *.md
#   site      site/** (everything there is synced to the bucket)
#   <svc>     services/<svc>/**, except tests/ and *.md; svc in ai-qa notifier source-watcher synthetic-check
#             webhook-dispatcher
# Nothing else deploys: docs/, infra/ (Terraform stays local, MFA), mobile/ (OTA and binaries stay owner-driven),
# tools/, .github/, scripts/ ... A merge that touches only those makes no deploy job and so no approval request.
#
# "Changed" is measured from the last SUCCESSFUL full CD deployment, not from the previous commit: a run that was
# cancelled while queued (the concurrency group keeps one), rejected at the approval, or rolled back leaves its changes
# in the next run's diff. The deploy job marks a full deployment by its environment URL,
#   https://github.com/<repo>/commit/<sha>#cd-full
# (#cd-partial for an explicit target list, #cd-rollback for a manual rollback: neither moves the base). With no
# full deployment on record (the first run) every target deploys.
set -euo pipefail
set +x
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=scripts/lib/targets.sh
source "$ROOT/scripts/lib/targets.sh"

die() { echo "plan: $*" >&2; exit 1; }

# classify_path <path> → target or "-"
classify_path() {
  local p="$1" svc
  case "$p" in
    site/*) echo site; return ;;
    *.md) echo -; return ;;
    src_C/Tests/* | src_C/Public/*) echo -; return ;;
    src_C/*) echo backend; return ;;
    frontend/tests/*) echo -; return ;;
    frontend/*) echo console; return ;;
  esac
  for svc in $CD_PYTHON_SERVICES; do
    case "$p" in
      "services/$svc/tests/"*) echo -; return ;;
      "services/$svc/"*) echo "$svc"; return ;;
    esac
  done
  echo -
}

# in_deploy_order <space-separated targets> → the distinct targets, in CD_DEPLOY_TARGETS order, space separated
in_deploy_order() {
  local t list="${1:-}" out=""
  for t in $CD_DEPLOY_TARGETS; do
    if word_in "$t" "$list"; then out="${out:+$out }$t"; fi
  done
  echo "$out"
}

# squeeze <text> → the words of text, single-space separated, commas read as spaces; exit 2 (and no output) for
# anything but lower-case letters, digits, '-', ',' and spaces, so a workflow input can never glob or inject.
squeeze() {
  local w out=""
  [[ "${1:-}" =~ ^[a-z0-9,\ -]*$ ]] || { echo "plan: '${1:-}' holds a character other than a-z 0-9 - , and space" >&2; return 2; }
  for w in $(printf '%s' "${1:-}" | tr ',' ' '); do out="${out:+$out }$w"; done
  echo "$out"
}

cmd_classify() {
  local p
  for p in "$@"; do classify_path "$p"; done
}

# cmd_changed <base> <head> → targets on stdout (empty: nothing to deploy); why on stderr.
cmd_changed() {
  local base="${1:-}" head="${2:-}" found="" paths p t
  git -C "$ROOT" cat-file -e "${head}^{commit}" 2>/dev/null || die "commit $head is not in this clone"
  if [ -z "$base" ]; then
    echo "plan: no full CD deployment on record: every target deploys" >&2
    echo "$CD_DEPLOY_TARGETS"
    return 0
  fi
  if ! git -C "$ROOT" cat-file -e "${base}^{commit}" 2>/dev/null; then
    echo "plan: warning: the last deployed commit $base is not in this clone (history rewritten?): every target deploys" >&2
    echo "$CD_DEPLOY_TARGETS"
    return 0
  fi
  if [ "$(git -C "$ROOT" rev-parse "$base^{commit}")" = "$(git -C "$ROOT" rev-parse "$head^{commit}")" ]; then
    echo "plan: $head is what production already runs: nothing to deploy" >&2
    echo ""
    return 0
  fi
  if git -C "$ROOT" merge-base --is-ancestor "$head" "$base"; then
    # CI runs can finish out of order, and a re-run replays an old event: production already runs a newer commit.
    echo "plan: $head is older than the last deployment $base: nothing to deploy (CD never deploys backwards; use the manual rollback)" >&2
    echo ""
    return 0
  fi
  if ! git -C "$ROOT" merge-base --is-ancestor "$base" "$head"; then
    echo "plan: warning: $base (last deployment) is not an ancestor of $head (history rewritten?): every target deploys" >&2
    echo "$CD_DEPLOY_TARGETS"
    return 0
  fi
  paths="$(git -C "$ROOT" diff --no-renames --name-only "$base" "$head")" || die "git diff $base $head failed"
  while IFS= read -r p; do
    [ -n "$p" ] || continue
    t="$(classify_path "$p")"
    [ "$t" = - ] || found="$found $t"
  done <<<"$paths"
  in_deploy_order "$found"
}

# cmd_select <spec> → targets; exit 2 on an unknown name
cmd_select() {
  local spec t
  spec="$(squeeze "${1:-}")" || return 2
  if [ "$spec" = all ]; then echo "$CD_DEPLOY_TARGETS"; return 0; fi
  [ -n "$spec" ] || { echo "plan: empty target list" >&2; return 2; }
  for t in $spec; do
    word_in "$t" "$CD_DEPLOY_TARGETS" || { echo "plan: unknown target '$t' (known: $CD_DEPLOY_TARGETS, or all)" >&2; return 2; }
  done
  in_deploy_order "$spec"
}

cmd_last_deployed() {
  local repo="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}" ids id url rest prefix scanned=0
  prefix="https://github.com/$repo/commit/"
  ids="$(gh api "repos/$repo/deployments?environment=production&per_page=100" \
    --jq 'sort_by(.created_at) | reverse | .[].id')" || die "cannot list the production deployments of $repo"
  for id in $ids; do
    scanned=$((scanned + 1))
    [ "$scanned" -le "${CD_SCAN_LIMIT:-40}" ] || break
    url="$(gh api "repos/$repo/deployments/$id/statuses?per_page=100" \
      --jq '[.[] | select(.state == "success") | (.environment_url // "")] | map(select(. != "")) | .[0] // ""')" \
      || die "cannot read the statuses of deployment $id"
    case "$url" in
      "$prefix"*) ;;
      *) continue ;;
    esac
    rest="${url#"$prefix"}"
    if [[ "$rest" =~ ^([0-9a-f]{40})#cd-full$ ]]; then
      echo "${BASH_REMATCH[1]}"
      return 0
    fi
  done
  return 0
}

# out <key> <value> — one GITHUB_OUTPUT line (values here never hold a newline)
out() { printf '%s=%s\n' "$1" "$2"; }

summary() { [ -z "${GITHUB_STEP_SUMMARY:-}" ] || printf '%s\n' "$@" >> "$GITHUB_STEP_SUMMARY"; }

# cmd_decide — env: EVENT, REF, RUN_SHA (workflow_run.head_sha), DISPATCH_SHA (github.sha), IN_TARGETS,
# IN_ROLLBACK_TARGET, IN_ROLLBACK_VERSION, GITHUB_REPOSITORY, GH_TOKEN.
cmd_decide() {
  local sha spec base="" targets scope t python="" rb_target rb_version status
  case "${EVENT:-}" in
    workflow_run)
      sha="${RUN_SHA:-}"
      spec=changed
      ;;
    workflow_dispatch)
      [ "${REF:-}" = refs/heads/main ] || die "workflow_dispatch from ${REF:-?} refused: CD deploys main only (choose main in 'Use workflow from')"
      sha="${DISPATCH_SHA:-}"
      rb_target="${IN_ROLLBACK_TARGET:-none}"
      rb_version="${IN_ROLLBACK_VERSION:-}"
      if [ "$rb_target" != none ] && [ -n "$rb_target" ]; then
        word_in "$rb_target" "$CD_ROLLBACK_TARGETS" || die "unknown rollback_target '$rb_target' (known: $CD_ROLLBACK_TARGETS)"
        [[ "$rb_version" =~ ^[1-9][0-9]{0,5}$ ]] || die "rollback_version must be a published version number, got '$rb_version'"
        out mode rollback
        out deploy false
        out sha "$sha"
        out rollback_target "$rb_target"
        out rollback_version "$rb_version"
        summary "### CD plan: manual rollback" "" "Move \`$(target_function "$rb_target")\` alias \`prod\` to version **$rb_version** after approval."
        return 0
      fi
      [ -z "$rb_version" ] || die "rollback_version is set but rollback_target is not"
      spec="${IN_TARGETS:-changed}"
      ;;
    *) die "unexpected event '${EVENT:-}'" ;;
  esac
  [[ "$sha" =~ ^[0-9a-f]{40}$ ]] || die "no commit to deploy (got '$sha')"

  if [ "$EVENT" = workflow_dispatch ]; then
    # A push to main deploys only after CI succeeded (the workflow_run filter); a dispatch has to prove the same.
    "$ROOT/scripts/deploy-preflight.sh" --checks "$sha" >&2 || die "the required CI checks have not all succeeded on $sha; CD deploys green commits only"
  fi

  spec="$(squeeze "$spec")" || die "bad targets input"
  if [ "$spec" = changed ]; then
    base="$(cmd_last_deployed)"
    set +e
    targets="$(cmd_changed "$base" "$sha")"
    status=$?
    set -e
    [ "$status" = 0 ] || die "nothing deployed (see above)"
    scope=full
  else
    targets="$(cmd_select "$spec")" || die "bad target list '$spec'"
    if [ "$targets" = "$CD_DEPLOY_TARGETS" ]; then scope=full; else scope=partial; fi
  fi

  for t in $targets; do
    if word_in "$t" "$CD_PYTHON_SERVICES"; then python="${python:+$python }$t"; fi
  done
  out mode deploy
  out sha "$sha"
  out base "$base"
  out targets "$targets"
  out scope "$scope"
  if [ -n "$targets" ]; then out deploy true; else out deploy false; fi
  if word_in backend "$targets"; then out has_backend true; else out has_backend false; fi
  if word_in console "$targets"; then out has_console true; else out has_console false; fi
  if word_in site "$targets"; then out has_site true; else out has_site false; fi
  out python "$python"

  summary "### CD plan" "" \
    "- commit: \`$sha\`" \
    "- last full deployment: ${base:+\`$base\`}${base:-none on record}" \
    "- targets: ${targets:-none (no deploy job, no approval request)}" \
    "- scope: $scope"
  if [ -n "$base" ] && [ -n "$targets" ] && git -C "$ROOT" cat-file -e "${base}^{commit}" 2>/dev/null; then
    summary "" "<details><summary>changed paths since the last deployment</summary>" "" '```'
    summary "$(git -C "$ROOT" diff --no-renames --name-only "$base" "$sha" 2>/dev/null | head -n 200)"
    summary '```' "</details>"
  fi
}

case "${1:-}" in
  classify) shift; cmd_classify "$@" ;;
  changed) shift; cmd_changed "$@" ;;
  select) shift; cmd_select "$@" ;;
  last-deployed) cmd_last_deployed ;;
  decide) cmd_decide ;;
  *) echo "usage: scripts/cd/plan.sh {classify <path>...|changed <base> <head>|select <spec>|last-deployed|decide}" >&2; exit 2 ;;
esac
