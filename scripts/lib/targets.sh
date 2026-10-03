# scripts/lib/targets.sh — sourced, no side effects. The one list of what CD deploys (.github/workflows/cd.yml)
# and of what scripts/rollback.sh can move back, so the plan, the restore point and the rollback never disagree.
# Bash 3.2 compatible (the deploy Mac's /bin/bash): plain strings, no arrays.
# shellcheck shell=bash disable=SC2034  # the lists are read by the scripts that source this file

# The five Python Lambdas services/deploy-python-lambda.sh knows, each its own deploy target (services/<svc>/**).
CD_PYTHON_SERVICES="ai-qa notifier source-watcher synthetic-check webhook-dispatcher"
# Deploy order: the API first (core-vpc + worker-lambda, src_C/deploy.sh), then the Python services that call its
# internal routes, then the console that calls the API, then the landing page.
CD_DEPLOY_TARGETS="backend $CD_PYTHON_SERVICES console site"
# What scripts/rollback.sh moves: one Lambda prod alias each.
CD_ROLLBACK_TARGETS="vpc worker $CD_PYTHON_SERVICES"

# target_function <rollback-target> → the Lambda function name; returns 1 for anything else.
target_function() {
  case "${1:-}" in
    vpc) echo "${VPC_FN:-core-vpc}" ;;
    worker) echo "${WORKER_FN:-worker-lambda}" ;;
    ai-qa | notifier | source-watcher | synthetic-check | webhook-dispatcher) echo "developercards-$1" ;;
    *) return 1 ;;
  esac
}

# target_lambdas <deploy-target> → the rollback targets (Lambda aliases) that deploying it moves; empty for the
# static sites; returns 1 for an unknown target.
target_lambdas() {
  case "${1:-}" in
    backend) echo "vpc worker" ;;
    ai-qa | notifier | source-watcher | synthetic-check | webhook-dispatcher) echo "$1" ;;
    console | site) echo "" ;;
    *) return 1 ;;
  esac
}

# word_in <word> <space-separated list>
word_in() {
  case " $2 " in
    *" $1 "*) return 0 ;;
    *) return 1 ;;
  esac
}

# aws_profile_default — a laptop with no credentials in its environment gets the deploy profile; credentials that are
# already there (GitHub OIDC in CD, or `aws configure export-credentials`) and an AWS_PROFILE the operator set win.
aws_profile_default() {
  if [ -z "${AWS_PROFILE:-}${AWS_ACCESS_KEY_ID:-}${AWS_SESSION_TOKEN:-}${AWS_WEB_IDENTITY_TOKEN_FILE:-}" ]; then
    export AWS_PROFILE=devcards-deploy
  fi
}
