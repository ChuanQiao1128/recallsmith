#!/usr/bin/env bash
# scripts/deploy-preflight.sh — what a production deploy from a laptop must prove before it touches AWS.
#
#   scripts/deploy-preflight.sh <caller>      # called by src_C/deploy.sh, frontend/deploy.sh, site/deploy.sh and
#                                             # services/deploy-python-lambda.sh
#   scripts/deploy-preflight.sh --checks <sha>  # only the CI verdict for one commit (CD's plan: a dispatch, or main's
#                                               # tip when it is newer than the commit CI started CD for)
#
# Production deploys run in CD (.github/workflows/cd.yml, infra/RUNBOOK.md §12). A local deploy is break-glass, and
# even then it ships exactly what CD would have: refused unless
#   1. the working tree is clean (`git status --porcelain`, untracked files included: an untracked .cs file under
#      src_C/Vpc is compiled into the zip),
#   2. HEAD is origin/main after a fetch, and
#   3. every check the main ruleset requires (REQUIRED_CHECKS below, the job names of .github/workflows/ci.yml)
#      concluded success on that commit, in the push run of ci.yml on main (gh api …/actions/workflows/ci.yml/runs and
#      …/runs/<id>/jobs; needs a logged-in gh).
# BREAK_GLASS=1 turns a refusal into a loud warning and lets the deploy go on: for an outage that cannot wait for CI.
#
# Skipped, with one line, when DRY_RUN=1 (nothing is uploaded) and inside GitHub Actions (GITHUB_ACTIONS=true: CD
# checks CI itself and deploys an exact commit). This is a guard against mistakes, not a security boundary: the
# boundary is the MFA on devcards-deploy and the production environment's approval in CD.
set -euo pipefail
set +x
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPO="${DEPLOY_REPO:-ChuanQiao1128/recallsmith}"
BRANCH="${DEPLOY_BRANCH:-main}"

# The nine checks the main ruleset requires, by exact name. scripts/tests/cd-scripts.test.sh fails when this list and
# the job names in .github/workflows/ci.yml drift apart.
REQUIRED_CHECKS='mobile (typecheck + vitest + expo export)
frontend (vitest + build)
frontend (playwright smoke)
backend (dotnet test)
python (uv lock + pytest)
infra (terraform fmt/validate + agent routes + deploy scripts)
tools/mcp-server (build + vitest)
integrations/n8n (signature verifier + recipe logic)
tools/author-runner (build + vitest)'

# checks_verdict <sha> → one line per required check; exit 0 when all nine concluded success, 1 otherwise, 2 when the
# CI result cannot be read. Read from the Actions API, not from check runs: the newest push run of
# .github/workflows/ci.yml for <sha> on $BRANCH, and the jobs of its latest attempt (a re-run is judged by its latest
# attempt). Any token with checks: write (a workflow on any branch can ask for it) can create a check run of any name
# on any commit; a run of ci.yml pushed to main and its jobs' conclusions cannot be written by anyone.
checks_verdict() {
  local sha="$1" run jobs name line bad=0
  command -v gh >/dev/null 2>&1 || { echo "  gh is not installed: cannot read the CI result of $sha" >&2; return 2; }
  [[ "$sha" =~ ^[0-9a-f]{40}$ ]] && [[ "$BRANCH" =~ ^[A-Za-z0-9._/-]+$ ]] || { echo "  bad commit or branch name" >&2; return 2; }
  if ! run="$(gh api "repos/$REPO/actions/workflows/ci.yml/runs?head_sha=$sha&event=push&branch=$BRANCH&per_page=100" \
    --jq "[.workflow_runs[] | select(.head_sha == \"$sha\" and .event == \"push\" and .head_branch == \"$BRANCH\" and .path == \".github/workflows/ci.yml\")] | max_by(.id) | if . == null then \"\" else (.id | tostring) end" 2>/dev/null)"; then
    echo "  cannot read the CI runs of $sha from $REPO (gh api failed: logged in? network?)" >&2
    return 2
  fi
  if [ -z "$run" ]; then
    echo "  no push run of .github/workflows/ci.yml on $BRANCH for $sha"
    jobs=""
  elif ! jobs="$(gh api --paginate "repos/$REPO/actions/runs/$run/jobs?filter=latest&per_page=100" \
    --jq '.jobs[] | [.name, .status, (.conclusion // "")] | @tsv' 2>/dev/null)"; then
    echo "  cannot read the jobs of CI run $run from $REPO (gh api failed: logged in? network?)" >&2
    return 2
  fi
  while IFS= read -r name; do
    [ -n "$name" ] || continue
    line="$(printf '%s\n' "$jobs" | awk -F '\t' -v n="$name" '$1 == n' | tail -n 1)"
    if [ -z "$line" ]; then
      echo "  MISSING  $name"
      bad=1
    elif [ "$(printf '%s' "$line" | cut -f2)" != completed ] || [ "$(printf '%s' "$line" | cut -f3)" != success ]; then
      echo "  $(printf '%s' "$line" | cut -f2)/$(printf '%s' "$line" | cut -f3)  $name"
      bad=1
    else
      echo "  success  $name"
    fi
  done <<<"$REQUIRED_CHECKS"
  return "$bad"
}

if [ "${1:-}" = --checks ]; then
  [ "$#" -eq 2 ] && [[ "$2" =~ ^[0-9a-f]{40}$ ]] || { echo "usage: scripts/deploy-preflight.sh --checks <40-hex sha>" >&2; exit 2; }
  echo "required CI checks on $2:"
  checks_verdict "$2"
  exit $?
fi
if [ "${1:-}" = --list-checks ]; then
  printf '%s\n' "$REQUIRED_CHECKS"
  exit 0
fi

CALLER="${1:-deploy}"
if [ "${DRY_RUN:-0}" = 1 ]; then
  echo "preflight ($CALLER): skipped, DRY_RUN=1"
  exit 0
fi
if [ "${GITHUB_ACTIONS:-}" = true ]; then
  echo "preflight ($CALLER): skipped inside GitHub Actions (CD verifies CI and deploys an exact commit)"
  exit 0
fi

problems=""
add_problem() { problems="${problems}  - $1"$'\n'; }

if ! top="$(git -C "$ROOT" rev-parse --show-toplevel 2>/dev/null)"; then
  add_problem "$ROOT is not a git checkout"
else
  dirty="$(git -C "$top" status --porcelain 2>/dev/null || echo '?? git status failed')"
  if [ -n "$dirty" ]; then
    add_problem "the working tree is not clean ($(printf '%s\n' "$dirty" | wc -l | tr -d ' ') path(s), untracked included):"$'\n'"$(printf '%s\n' "$dirty" | head -n 10 | sed 's/^/      /')"
  fi
  head_sha="$(git -C "$top" rev-parse HEAD)"
  if git -C "$top" fetch --quiet origin "+refs/heads/$BRANCH:refs/remotes/origin/$BRANCH" 2>/dev/null; then
    remote_sha="$(git -C "$top" rev-parse "refs/remotes/origin/$BRANCH")"
    [ "$head_sha" = "$remote_sha" ] || add_problem "HEAD $head_sha is not origin/$BRANCH ($remote_sha)"
  else
    add_problem "git fetch origin $BRANCH failed, so HEAD cannot be compared with origin/$BRANCH"
  fi
  echo "preflight ($CALLER): required CI checks on $head_sha:"
  set +e
  checks_verdict "$head_sha"
  verdict=$?
  set -e
  case "$verdict" in
    0) ;;
    2) add_problem "the CI result of $head_sha could not be read" ;;
    *) add_problem "not every required CI check concluded success on $head_sha" ;;
  esac
fi

if [ -z "$problems" ]; then
  echo "preflight ($CALLER): OK — clean tree, HEAD = origin/$BRANCH, required CI checks green"
  exit 0
fi

if [ "${BREAK_GLASS:-0}" = 1 ]; then
  {
    echo "################################################################################"
    echo "## BREAK_GLASS=1: deploying ANYWAY although the preflight failed ($CALLER):"
    printf '%s' "$problems"
    echo "## This deploy did not come from CD and may ship code that CI never passed."
    echo "## Say so in the incident notes; the next CD deploy of main replaces it."
    echo "################################################################################"
  } >&2
  exit 0
fi

{
  echo "preflight ($CALLER): refusing to deploy:"
  printf '%s' "$problems"
  echo "Production deploys run in CD (infra/RUNBOOK.md §12): merge to main and approve the run."
  echo "For an outage that cannot wait, rerun with BREAK_GLASS=1 (and DRY_RUN=1 never needs this)."
} >&2
exit 1
