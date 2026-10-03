#!/usr/bin/env bash
# scripts/cd/plan.sh — the decisions of the `plan` job of .github/workflows/cd.yml, out of YAML so they can be tested
# (scripts/tests/cd-scripts.test.sh). Needs no AWS credential; the commands that read deployments and CI results use
# gh (GH_TOKEN with deployments: read and actions: read).
#
#   plan.sh classify <path>...        one line per path: the deploy target it belongs to, or "-"
#   plan.sh changed <base|""> <head>  the deploy targets with a file changed in base..head, in deploy order
#   plan.sh select <spec>             an explicit list ("all" or target names) checked and put in deploy order
#   plan.sh last-deployed             the commit of the last successful full CD deployment to production, or nothing
#   plan.sh latest-success            the id of the newest successful CD deployment to production of any kind (full,
#                                     partial, rollback), or nothing
#   plan.sh still-current <id|"">     the deploy and rollback jobs' first step: exit 1 unless latest-success is still
#                                     the <id> the plan saw (a re-run of an old run's failed job reuses its plan)
#   plan.sh decide                    the plan job: reads the event from the environment, prints key=value outputs
#
# What deploys when (infra/RUNBOOK.md §12):
#   backend   src_C/**, except Tests/ (not in the vpc or worker zip) and *.md
#   console   frontend/**, except tests/ and *.md
#   site      site/** (everything there is synced to the bucket)
#   <svc>     services/<svc>/**, except tests/ and *.md; svc in ai-qa notifier source-watcher synthetic-check
#             webhook-dispatcher
# Nothing else deploys: docs/, infra/ (Terraform stays local, MFA), mobile/ (OTA and binaries stay owner-driven),
# tools/, .github/, scripts/ ... A merge that touches only those makes no deploy job and so no approval request.
#
# Which commit: only a commit on main ever deploys. For a push, the commit CI passed must be an ancestor of (or equal
# to) refs/remotes/origin/main: a tag named `main` reaches CD with head_branch "main" too. When main has moved on and
# its tip's CI is already green, the run deploys the tip, so a run that GitHub's queue let through out of order (or a
# re-run of an old CI run) never leaves newer merged commits behind.
#
# "Changed" is measured from the last SUCCESSFUL full CD deployment, not from the previous commit: a run that was
# cancelled while queued, rejected at the approval, or rolled back leaves its changes in the next run's diff. The deploy
# job marks a full deployment by its environment URL,
#   https://github.com/<repo>/commit/<sha>#cd-full
# (#cd-partial for an explicit target list, #cd-rollback for a manual rollback: neither moves the base). With no full
# deployment on record (the first run) every target deploys. A deployment counts only when GitHub Actions made it, its
# first success status names the job that ran it (the one on its first in_progress status), and that job is a
# successful deploy or rollback job of this repository's cd.yml on main, read back through the Actions API: anyone who
# can write deployment statuses could otherwise post a #cd-full for main's tip and stop every later deploy.
set -euo pipefail
set +x
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=scripts/lib/targets.sh
source "$ROOT/scripts/lib/targets.sh"

MAIN_BRANCH="${CD_MAIN_BRANCH:-main}"
# Fully qualified: a tag named main would make a bare `main` ambiguous.
MAIN_REF="refs/remotes/origin/$MAIN_BRANCH"
TAB="$(printf '\t')"

die() { echo "plan: $*" >&2; exit 1; }

# classify_path <path> → target or "-"
classify_path() {
  local p="$1" svc
  case "$p" in
    site/*) echo site; return ;;
    *.md) echo -; return ;;
    src_C/Tests/*) echo -; return ;;
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

# cd_job_ok <repo> <log url> → 0 when the URL names a job of <repo> that is cd.yml's deploy or rollback job, in a run
# on main, and that job concluded success (read back through the Actions API, which no token can write).
cd_job_ok() {
  local repo="$1" log="$2" run job got
  [[ "$log" =~ ^https://github\.com/([^/]+/[^/]+)/actions/runs/([0-9]+)/job/([0-9]+)$ ]] || return 1
  [ "${BASH_REMATCH[1]}" = "$repo" ] || return 1
  run="${BASH_REMATCH[2]}"
  job="${BASH_REMATCH[3]}"
  got="$(gh api "repos/$repo/actions/jobs/$job" --jq '[(.run_id | tostring), .name, .status, (.conclusion // "")] | @tsv' 2>/dev/null)" || return 1
  case "$got" in
    "$run${TAB}deploy (production)${TAB}completed${TAB}success" | "$run${TAB}rollback (production)${TAB}completed${TAB}success") ;;
    *) return 1 ;;
  esac
  got="$(gh api "repos/$repo/actions/runs/$run" --jq '[.path, .head_branch] | @tsv' 2>/dev/null)" || return 1
  [ "$got" = ".github/workflows/cd.yml${TAB}$MAIN_BRANCH" ]
}

# scan_deployments <full|any> → the newest production deployment that GitHub Actions made and whose own success
# status a successful cd.yml deploy or rollback job on main set: "full" prints the commit of the newest #cd-full one,
# "any" the id of the newest one of any kind. Prints nothing when there is none in the newest CD_SCAN_LIMIT (40).
scan_deployments() {
  local want="$1" repo="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}" ids id line url log ran rest prefix runs_prefix scanned=0
  prefix="https://github.com/$repo/commit/"
  runs_prefix="https://github.com/$repo/actions/runs/"
  ids="$(gh api "repos/$repo/deployments?environment=production&per_page=100" \
    --jq '[.[] | select(.performed_via_github_app.slug == "github-actions")] | sort_by(.created_at) | reverse | .[].id')" \
    || die "cannot list the production deployments of $repo"
  for id in $ids; do
    scanned=$((scanned + 1))
    [ "$scanned" -le "${CD_SCAN_LIMIT:-40}" ] || break
    # Statuses come newest first. The job's own success status is the first success ever set (`last` here): one that
    # someone added later never counts. Its log URL must name the job that ran this deployment, which GitHub put on
    # the first in_progress status when the job started (no one can add an earlier one), so a status added to a failed
    # deployment cannot borrow another, successful job.
    line="$(gh api "repos/$repo/deployments/$id/statuses?per_page=100" \
      --jq '(map(select(.state == "success")) | last) as $s | (map(select(.state == "in_progress")) | last) as $p
        | if $s == null then "" else [($s.environment_url // ""), ($s.log_url // $s.target_url // ""), ($p.log_url // $p.target_url // "")] | @tsv end')" \
      || die "cannot read the statuses of deployment $id"
    [ -n "$line" ] || continue
    url="${line%%"$TAB"*}"
    log="${line#*"$TAB"}"
    ran="${log#*"$TAB"}"
    log="${log%%"$TAB"*}"
    rest="${url#"$prefix"}"
    if [ "$want" = full ]; then
      [[ "$url" = "$prefix"* && "$rest" =~ ^[0-9a-f]{40}#cd-full$ ]] || continue
    else
      [[ ( "$url" = "$prefix"* && "$rest" =~ ^[0-9a-f]{40}#cd-(full|partial)$ ) || ( "$url" = "$runs_prefix"* && "$url" =~ \#cd-rollback$ ) ]] || continue
    fi
    if [ -z "$log" ] || [ "$log" != "$ran" ] || ! cd_job_ok "$repo" "$log"; then
      echo "plan: warning: deployment $id carries a success status that the job which ran it (a successful cd.yml deploy or rollback job on $MAIN_BRANCH) did not set: ignored" >&2
      continue
    fi
    if [ "$want" = full ]; then echo "${rest%%#*}"; else echo "$id"; fi
    return 0
  done
  return 0
}

cmd_last_deployed() { scan_deployments full; }
cmd_latest_success() { scan_deployments any; }

# cmd_still_current <id the plan saw, or ""> — refuse a stale plan. "Re-run failed jobs" (or re-running only the deploy
# or rollback job) reuses the plan and build of the original attempt, so without this an old run would deploy its old
# commit over newer deployments.
cmd_still_current() {
  local seen="${1-}" now
  [ -z "$seen" ] || [[ "$seen" =~ ^[0-9]+$ ]] || die "still-current: '$seen' is not a deployment id"
  now="$(cmd_latest_success)" || die "still-current: cannot read the production deployments"
  if [ "$now" != "$seen" ]; then
    die "production was deployed since this run's plan (newest successful CD deployment: ${now:-none}; the plan saw ${seen:-none}). A re-run of an old run's failed job would deploy its old plan over it: refused, nothing changed. Use 'Re-run all jobs' (it plans again and never deploys backwards) or start a new run."
  fi
  echo "plan: still current: no CD deployment to production since the plan (newest: ${seen:-none})"
}

# main_tip → the commit refs/remotes/origin/main names after a refresh (the checkout's copy if the fetch fails)
main_tip() {
  git -C "$ROOT" fetch --quiet --no-tags origin "+refs/heads/$MAIN_BRANCH:$MAIN_REF" 2>/dev/null \
    || echo "plan: warning: could not refresh $MAIN_REF from origin; using the copy in this clone" >&2
  git -C "$ROOT" rev-parse --verify --quiet "$MAIN_REF^{commit}"
}

# out <key> <value> — one GITHUB_OUTPUT line (values here never hold a newline)
out() { printf '%s=%s\n' "$1" "$2"; }

summary() { [ -z "${GITHUB_STEP_SUMMARY:-}" ] || printf '%s\n' "$@" >> "$GITHUB_STEP_SUMMARY"; }

# cmd_decide — env: EVENT, REF, RUN_SHA (workflow_run.head_sha), DISPATCH_SHA (github.sha), IN_TARGETS,
# IN_ROLLBACK_TARGET, IN_ROLLBACK_VERSION, GITHUB_REPOSITORY, GH_TOKEN, DEPLOY_REPO (the CI verdict's repository).
cmd_decide() {
  local sha spec base="" targets scope t python="" rb_target rb_version status tip requested="" newer last_success envfiles
  case "${EVENT:-}" in
    workflow_run) sha="${RUN_SHA:-}" ;;
    workflow_dispatch)
      [ "${REF:-}" = "refs/heads/$MAIN_BRANCH" ] || die "workflow_dispatch from ${REF:-?} refused: CD deploys $MAIN_BRANCH only (choose $MAIN_BRANCH in 'Use workflow from')"
      sha="${DISPATCH_SHA:-}"
      ;;
    *) die "unexpected event '${EVENT:-}'" ;;
  esac
  [[ "$sha" =~ ^[0-9a-f]{40}$ ]] || die "no commit to deploy (got '$sha')"

  # Only a commit on main deploys. A tag named main reaches CD with head_branch "main" too, and runs CI from its own
  # ci.yml; cd.yml checks this before any script runs, and this repeats it for every event.
  tip="$(main_tip)" || die "no $MAIN_REF in this clone"
  git -C "$ROOT" merge-base --is-ancestor "$sha" "$tip" 2>/dev/null \
    || die "commit $sha is not on $MAIN_BRANCH ($MAIN_REF is $tip): a tag or another ref named $MAIN_BRANCH? Nothing is deployed."

  # Read before anything is decided, for every mode: the deploy and rollback jobs refuse to act once a newer CD
  # deployment exists (plan.sh still-current).
  last_success="$(cmd_latest_success)"

  if [ "$EVENT" = workflow_dispatch ]; then
    rb_target="${IN_ROLLBACK_TARGET:-none}"
    rb_version="${IN_ROLLBACK_VERSION:-}"
    if [ "$rb_target" != none ] && [ -n "$rb_target" ]; then
      word_in "$rb_target" "$CD_ROLLBACK_TARGETS" || die "unknown rollback_target '$rb_target' (known: $CD_ROLLBACK_TARGETS)"
      [[ "$rb_version" =~ ^[1-9][0-9]{0,5}$ ]] || die "rollback_version must be a published version number, got '$rb_version'"
      out mode rollback
      out deploy false
      out sha "$sha"
      out last_success "$last_success"
      out rollback_target "$rb_target"
      out rollback_version "$rb_version"
      summary "### CD plan: manual rollback" "" "Move \`$(target_function "$rb_target")\` alias \`prod\` to version **$rb_version** after approval."
      return 0
    fi
    [ -z "$rb_version" ] || die "rollback_version is set but rollback_target is not"
    spec="${IN_TARGETS:-changed}"
    # A push to main deploys only after CI succeeded (the workflow_run filter); a dispatch has to prove the same.
    "$ROOT/scripts/deploy-preflight.sh" --checks "$sha" >&2 || die "the required CI checks have not all succeeded on $sha; CD deploys green commits only"
  else
    spec=changed
    if [ "$tip" != "$sha" ]; then
      # GitHub keeps one queued run per concurrency group and lets the newest arrival replace it, whatever commit
      # either carries; a re-run of an old CI run arrives last too. So deploy main's tip when its CI is green already,
      # and otherwise say which merged commits this run leaves for their own run.
      newer="$(git -C "$ROOT" log --format='%h %s' "$sha..$tip" | head -n 20)"
      if "$ROOT/scripts/deploy-preflight.sh" --checks "$tip" >&2; then
        echo "plan: $MAIN_BRANCH has moved on to $tip and its CI is green: this run deploys it (CI started CD for $sha)" >&2
        requested="$sha"
        sha="$tip"
      else
        echo "::warning::$MAIN_BRANCH has newer commits than $sha whose CI has not succeeded (yet); this run does not deploy them, their own CD run will: $(printf '%s' "$newer" | tr '\n' ';')" >&2
      fi
    fi
  fi

  base="$(cmd_last_deployed)"
  spec="$(squeeze "$spec")" || die "bad targets input"
  if [ "$spec" = changed ]; then
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
  out last_success "$last_success"
  out targets "$targets"
  out scope "$scope"
  if [ -n "$targets" ]; then out deploy true; else out deploy false; fi
  if word_in backend "$targets"; then out has_backend true; else out has_backend false; fi
  if word_in console "$targets"; then out has_console true; else out has_console false; fi
  if word_in site "$targets"; then out has_site true; else out has_site false; fi
  out python "$python"

  summary "### CD plan" "" \
    "- commit: \`$sha\`${requested:+ (the tip of main, CI green; CI started this run for \`$requested\`)}" \
    "- last full deployment: ${base:+\`$base\`}${base:-none on record}" \
    "- targets: ${targets:-none (no deploy job, no approval request)}" \
    "- scope: $scope"
  if [ -n "$base" ] && [ -n "$targets" ] && git -C "$ROOT" cat-file -e "${base}^{commit}" 2>/dev/null; then
    # A committed environment file overrides the live value on deploy (merge-env.sh), e.g. AUTOMATION_MODE: say so
    # where the approver reads, so a local break-glass value is not undone unnoticed (RUNBOOK §7 emergency stop).
    envfiles="$(git -C "$ROOT" diff --no-renames --name-only "$base" "$sha" -- 'src_C/env/*.env.json' 'services/*/env/*.env.json' 2>/dev/null | tr '\n' ' ')"
    if [ -n "$envfiles" ]; then
      summary "- **environment files changed** (their values replace the live ones on deploy): $envfiles"
    fi
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
  latest-success) cmd_latest_success ;;
  still-current) shift; cmd_still_current "${1-}" ;;
  decide) cmd_decide ;;
  *) echo "usage: scripts/cd/plan.sh {classify <path>...|changed <base> <head>|select <spec>|last-deployed|latest-success|still-current <id>|decide}" >&2; exit 2 ;;
esac
