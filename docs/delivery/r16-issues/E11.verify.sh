#!/usr/bin/env bash
# E11 — cd-pipeline verify. cwd = worktree root. Re-runs the brief's five
# acceptance bullets verbatim; never trusts the worker's report.
#
# FAILS ON BASE at step 1.
# ON THE UNTOUCHED BASE TREE THIS SCRIPT EXITS NON-ZERO at step 1:
#   - .github/workflows/cd.yml, .github/workflows/ota.yml,
#     .github/workflows/terraform.yml, scripts/smoke.sh, scripts/rollback.sh,
#     infra/modules/identity/oidc.tf and the two E11 plan-allow files do not
#     exist on base
#   (step 1 then also checks the queue prerequisites that live only on the
#   integration branch: infra/scripts/check-plan.py (E01), rds-snapshot.sh (E02),
#   scripts/invoke-as-admin.sh + ENV handling in src_C/deploy.sh (E06),
#   CONSOLE_URL in frontend/deploy.sh (E09), the staging root (E10) and
#   src_C/Vpc/Internal/InternalEvents.cs with db/migrate + health/deep (E12) —
#   E00 §4 orders E12 before E11 because the CD invokes those two actions)
# Step 2 (literal guards) would also fail on base. Step 3 = gates, step 4 = the
# read-only plans (prod against the real backend in a copy of infra/, staging
# against an empty local state via E01's backend_override.tf in scratch copies,
# at HEAD and at the merge-base) + policy simulation, step 5 =
# the scope/frozen/OTA/apply guard.
#
# WORKER SAFETY RULE: this script only runs `terraform init` (-backend=false, or
# -reconfigure against the real backend which merely READS the state object),
# `validate`, `plan -lock=false -out` (never writes the .tflock) + `show -json`,
# and the read-only CLI calls `sts get-caller-identity`, `iam get-role`,
# `sns list-subscriptions-by-topic`, `iam simulate-custom-policy`. It never
# applies, never imports, never runs a deploy script without DRY_RUN=1. Plan
# files, plan JSON and the derived tfvars live in a mktemp dir removed by the
# EXIT trap and are printed only as `address<TAB>actions` lines.
#
# Needs: terraform 1.16.3, jq, python3 (+ yaml), dotnet (DRY packaging),
# AWS_PROFILE=dev (read-only). actionlint is used when installed.
# Runtime ≈ 6–9 min (three plans + one DRY_RUN packaging run).
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
BASE_REF="${BASE_REF:-${BASE:-delivery/r16-e-prod}}"   # driver exports BASE
fail() { echo "E11 VERIFY FAIL: $*" >&2; exit 1; }

export AWS_PROFILE="${AWS_PROFILE:-dev}"
export AWS_REGION="${AWS_REGION:-ap-southeast-2}"
export TF_PLUGIN_CACHE_DIR="${TF_PLUGIN_CACHE_DIR:-$HOME/.terraform.d/plugin-cache}"
export TF_IN_AUTOMATION=1
mkdir -p "$TF_PLUGIN_CACHE_DIR"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

CI=.github/workflows/ci.yml
CD=.github/workflows/cd.yml
OTA=.github/workflows/ota.yml
TFW=.github/workflows/terraform.yml
SMOKE=scripts/smoke.sh
RB=scripts/rollback.sh
DEPLOY=src_C/deploy.sh
OIDC=infra/modules/identity/oidc.tf
IVARS=infra/modules/identity/variables.tf
IOUTS=infra/modules/identity/outputs.tf
PMAIN=infra/envs/prod/main.tf
SMAIN=infra/envs/staging/main.tf
IREADME=infra/README.md
ALLOW_P=docs/delivery/r16-issues/E11.plan-allow.json
ALLOW_S=docs/delivery/r16-issues/E11.staging.plan-allow.json
ACCOUNT=622994489535
REGION=ap-southeast-2
PLAN_ROLE_ARN="arn:aws:iam::$ACCOUNT:role/developercards-gha-plan"
PROD_ROLE_ARN="arn:aws:iam::$ACCOUNT:role/developercards-gha-prod"
STAGING_ROLE_ARN="arn:aws:iam::$ACCOUNT:role/developercards-gha-staging"

has() { grep -Fq -- "$2" "$1" || fail "$1 lacks: $2"; }
hasE() { grep -Eq -- "$2" "$1" || fail "$1 lacks (regex): $2"; }
lacks() { if grep -Fq -- "$2" "$1"; then fail "$1 must not contain: $2"; fi; }
lineof() { grep -Fn -- "$1" "$2" | grep -Ev '^[0-9]+:[[:space:]]*#' | head -1 | cut -d: -f1; }   # first non-comment line

# ── 1. Scope files exist (FAILS ON BASE) + queue prerequisites ─────────────
echo "[1/5] scope files exist (+ E01/E02/E06/E09/E10/E12 prerequisites)"
for f in "$CD" "$OTA" "$TFW" "$SMOKE" "$RB" "$OIDC" "$ALLOW_P" "$ALLOW_S"; do
  [ -f "$f" ] || fail "$f does not exist (base tree fails here)"
done
[ -x "$SMOKE" ] || fail "$SMOKE is not executable"
[ -x "$RB" ] || fail "$RB is not executable"
for f in "$CI" "$DEPLOY" "$IVARS" "$IOUTS" "$PMAIN" "$SMAIN" "$IREADME" frontend/deploy.sh; do
  [ -f "$f" ] || fail "$f is missing from the tree"
done
[ -f infra/scripts/check-plan.py ] || fail "infra/scripts/check-plan.py missing — E01 must be merged first (E00 §4)"
[ -f infra/scripts/rds-snapshot.sh ] || fail "infra/scripts/rds-snapshot.sh missing — E02 must be merged first"
[ -f scripts/invoke-as-admin.sh ] || fail "scripts/invoke-as-admin.sh missing — E06 must be merged first"
grep -Fq 'ENV:-prod' "$DEPLOY" || fail "src_C/deploy.sh has no ENV handling — E06 must be merged first"
grep -Fq 'CONSOLE_URL' frontend/deploy.sh || fail "frontend/deploy.sh has no CONSOLE_URL — E09 must be merged first"
[ -f "$SMAIN" ] || fail "infra/envs/staging/main.tf missing — E10 must be merged first"
[ -f infra/envs/staging/staging.auto.tfvars.example ] || fail "staging.auto.tfvars.example missing (E10)"
[ -f infra/envs/prod/prod.auto.tfvars.example ] || fail "prod.auto.tfvars.example missing (E01)"
IE=src_C/Vpc/Internal/InternalEvents.cs
[ -f "$IE" ] || fail "$IE missing — E12 must be merged before E11 (E00 §4)"
grep -Fq '"db/migrate"' "$IE" || fail "InternalEvents.cs has no db/migrate action (E12 incomplete)"
grep -Fq '"health/deep"' "$IE" || fail "InternalEvents.cs has no health/deep action (E12 incomplete)"

mb="$(git merge-base HEAD "$BASE_REF" 2>/dev/null || git merge-base HEAD "origin/$BASE_REF" 2>/dev/null)" \
  || fail "cannot resolve base ref $BASE_REF (set BASE_REF / BASE); refusing to diff the tree against itself"

# ── 2. Literal guards ──────────────────────────────────────────────────────
echo "[2/5] literal guards"
# 2a. ci.yml: exactly one added line, workflow_call:
ns="$(git diff --numstat "$mb" HEAD -- "$CI" | cut -f1,2)"
[ "$ns" = "$(printf '1\t0')" ] || fail "ci.yml numstat must be '1 0', got '${ns:-<no diff>}'"
added="$(git diff -U0 "$mb" HEAD -- "$CI" | grep -E '^\+[^+]' | sed 's/^+//' | sed 's/^[[:space:]]*//' || true)"
[ "$added" = "workflow_call:" ] || fail "ci.yml: the only added line must be 'workflow_call:' (got: $added)"
# 2b. oidc.tf — resources, trust, policy vocabulary
for sym in 'resource "aws_iam_openid_connect_provider" "github"' \
           'resource "aws_iam_role" "gha_plan"' \
           'resource "aws_iam_role_policy_attachment" "gha_plan_readonly"' \
           'resource "aws_iam_role_policy" "gha_plan_tfstate"' \
           'resource "aws_iam_role" "gha_deploy"' \
           'resource "aws_iam_role_policy" "gha_deploy"' \
           'resource "aws_iam_role_policy_attachment" "gha_deploy_admin"' \
           'https://token.actions.githubusercontent.com' \
           'oidc-provider/token.actions.githubusercontent.com' \
           '"sts.amazonaws.com"' \
           'arn:aws:iam::aws:policy/ReadOnlyAccess' \
           'arn:aws:iam::aws:policy/AdministratorAccess' \
           'sts:AssumeRoleWithWebIdentity' \
           'token.actions.githubusercontent.com:aud' \
           'token.actions.githubusercontent.com:sub' \
           'repo:${var.github_repo}:pull_request' \
           'repo:${var.github_repo}:ref:refs/heads/main' \
           'repo:${var.github_repo}:environment:${e}' \
           'name = "developercards-gha-plan"' \
           'aws:ResourceTag/Env' \
           'kms:ViaService' \
           'terraform.tfstate.tflock' \
           'depends_on = [aws_iam_openid_connect_provider.github]'; do
  has "$OIDC" "$sym"
done
for sid in LambdaDeploy ConsoleBucketObjects ConsoleBucketList ConsoleInvalidate ConsoleList SsmRead SsmDecrypt RdsSnapshot TfstateList TfstateRead TfstateLock GitHubActionsOidc; do
  has "$OIDC" "\"$sid\""
done
for act in lambda:UpdateFunctionCode lambda:UpdateFunctionConfiguration lambda:PublishVersion lambda:UpdateAlias lambda:InvokeFunction \
           s3:ListBucket cloudfront:CreateInvalidation cloudfront:GetInvalidation cloudfront:ListDistributions \
           ssm:GetParametersByPath kms:Decrypt rds:CreateDBSnapshot rds:DescribeDBSnapshots s3:DeleteObject; do
  has "$OIDC" "\"$act\""
done
for bad in '"Action" = "*"' '"iam:*"' '"s3:*"' '"lambda:*"' 'ssm:PutParameter' 'data "aws_iam_openid_connect_provider"' 'terraform_remote_state' 'provisioner' 'null_resource' 'local-exec'; do
  lacks "$OIDC" "$bad"
done
# 2c. identity variables / outputs (append only)
for v in github_repo manage_github_oidc gha_deploy_role_name gha_deploy_environments gha_deploy_admin console_bucket_name tfstate_bucket_name db_identifier; do
  has "$IVARS" "variable \"$v\""
done
has "$IVARS" '"ChuanQiao1128/recallsmith"'
has "$IVARS" '"recallsmith-tfstate-622994489535"'
for o in github_oidc_provider_arn gha_plan_role_arn gha_deploy_role_arn gha_deploy_role_name; do
  has "$IOUTS" "output \"$o\""
done
# 2d. root wiring
hasE "$PMAIN" '^[[:space:]]*manage_github_oidc[[:space:]]*=[[:space:]]*true'
hasE "$PMAIN" '^[[:space:]]*gha_deploy_role_name[[:space:]]*=[[:space:]]*"developercards-gha-prod"'
hasE "$PMAIN" '^[[:space:]]*gha_deploy_environments[[:space:]]*=[[:space:]]*\["production", "infra-prod"\]'
hasE "$PMAIN" '^[[:space:]]*gha_deploy_admin[[:space:]]*=[[:space:]]*true'
hasE "$PMAIN" '^[[:space:]]*console_bucket_name[[:space:]]*=[[:space:]]*"recallsmith-console-622994489535"'
hasE "$PMAIN" '^[[:space:]]*db_identifier[[:space:]]*=[[:space:]]*"developercards"'
# staging: the deploy role is INLINE in the staging root (E00 §6 #28/#34 — no module "identity" there)
has "$SMAIN" 'resource "aws_iam_role" "gha_deploy"'
has "$SMAIN" 'resource "aws_iam_role_policy" "gha_deploy"'
has "$SMAIN" '"developercards-gha-staging"'
has "$SMAIN" 'environment:staging'
has "$SMAIN" 'oidc-provider/token.actions.githubusercontent.com'
has "$SMAIN" 'sts:AssumeRoleWithWebIdentity'
for sid in LambdaDeploy ConsoleBucketObjects ConsoleBucketList ConsoleInvalidate ConsoleList SsmRead SsmDecrypt; do has "$SMAIN" "\"$sid\""; done
for bad in 'module "identity"' 'manage_github_oidc' 'gha_deploy_admin' 'AdministratorAccess' 'RdsSnapshot' 'aws_iam_openid_connect_provider' 'aws_iam_role_policy_attachment' 'depends_on = [aws_iam_openid_connect_provider' 'gha_deploy[0]'; do
  lacks "$SMAIN" "$bad"
done
has "$IREADME" 'E11'
# 2e. allow files: valid JSON, exact address sets, all create
python3 -c 'import json,sys; [json.load(open(f)) for f in sys.argv[1:]]' "$ALLOW_P" "$ALLOW_S" || fail "allow file is not valid JSON"
EXP_P="$TMP/expected.prod"; EXP_S="$TMP/expected.staging"
cat > "$EXP_P" <<'X'
module.identity.aws_iam_openid_connect_provider.github[0]
module.identity.aws_iam_role.gha_deploy[0]
module.identity.aws_iam_role.gha_plan[0]
module.identity.aws_iam_role_policy.gha_deploy[0]
module.identity.aws_iam_role_policy.gha_plan_tfstate[0]
module.identity.aws_iam_role_policy_attachment.gha_deploy_admin[0]
module.identity.aws_iam_role_policy_attachment.gha_plan_readonly[0]
X
cat > "$EXP_S" <<'X'
aws_iam_role.gha_deploy
aws_iam_role_policy.gha_deploy
X
for pair in "$ALLOW_P:$EXP_P" "$ALLOW_S:$EXP_S"; do
  af="${pair%%:*}"; ef="${pair##*:}"
  jq -r '.changes | keys[]' "$af" | LC_ALL=C sort > "$TMP/allow.keys"
  LC_ALL=C sort "$ef" > "$TMP/exp.keys"
  diff -u "$TMP/exp.keys" "$TMP/allow.keys" >&2 || fail "$af: address set differs from the brief's Changes 4"
  jq -e '[.changes[] | (if type == "string" then . else .action end)] | all(. == "create")' "$af" >/dev/null || fail "$af: every entry must be \"create\""
  jq -e '.tags_only_updates == false and (has("outputs") | not) and (has("expect_imports") | not)' "$af" >/dev/null || fail "$af: tags_only_updates must be false; no outputs / expect_imports"
done
# 2f. cd.yml
for sym in 'name: CD' 'branches: [main]' 'workflow_dispatch:' 'uses: ./.github/workflows/ci.yml' \
           'environment: staging' 'environment: production' 'id-token: write' 'contents: read' \
           'group: cd-main' 'cancel-in-progress: false' 'aws-actions/configure-aws-credentials@v4' \
           "role-to-assume: $STAGING_ROLE_ARN" "role-to-assume: $PROD_ROLE_ARN" \
           'aws configure set region ap-southeast-2 --profile dev' \
           'MIGRATE_ON_PUBLISH=1' 'PUBLISH_ALIAS=staging' 'VPC_FN=core-vpc-staging' 'WORKER_FN=worker-lambda-staging' 'ENV=staging' 'ENV=prod' \
           'infra/scripts/rds-snapshot.sh pre-deploy-${GITHUB_SHA::7}' \
           'scripts/smoke.sh staging' 'scripts/smoke.sh prod' 'scripts/rollback.sh api' 'scripts/rollback.sh worker' \
           'if: failure()' 'steps.prev.outcome' 'retention-days: 30' 'actions/upload-artifact@v4' \
           'vars.CONSOLE_STAGING_CLIENT_ID' 'console-staging.developercards.app' 'api-staging.developercards.app' \
           'CONSOLE_BUCKET=developercards-console-staging' 'CONSOLE_URL=https://console-staging.developercards.app' \
           'VITE_BUILD_ID' 'list-distributions' 'actions/setup-dotnet@v5' 'actions/setup-node@v5' 'actions/checkout@v5' \
           'get-alias' 'npm ci'; do
  has "$CD" "$sym"
done
for j in 'test:' 'deploy-staging:' 'smoke-staging:' 'deploy-prod:'; do hasE "$CD" "^  $j"; done
has "$CD" 'id: smoke-prod'
has "$CD" 'id: rollback'
has "$CD" 'id: prev'
# 2g. ota.yml
for sym in 'name: OTA' 'tags:' "'v*'" 'environment: production' 'expo/expo-github-action@v8' 'secrets.EXPO_TOKEN' \
           'eas update --channel production --environment production --message "$GITHUB_REF_NAME" --non-interactive' \
           'jq -r .expo.version app.json' 'working-directory: mobile' 'uses: ./.github/workflows/ci.yml' 'npm ci'; do
  has "$OTA" "$sym"
done
lacks "$OTA" 'eas build'
lacks "$OTA" 'eas submit'
# 2h. terraform.yml
for sym in 'name: Terraform' "'infra/**'" 'pull_request:' 'branches: [main]' 'hashicorp/setup-terraform@v3' \
           'terraform_version: 1.16.3' 'terraform_wrapper: false' "role-to-assume: $PLAN_ROLE_ARN" "role-to-assume: $PROD_ROLE_ARN" \
           'environment: infra-prod' 'secrets.TFVARS_PROD' 'secrets.TFVARS_STAGING' 'terraform fmt -check -recursive infra' \
           'validate' 'show -json' 'apply -input=false tfplan' 'pull-requests: write' 'id-token: write' \
           'gh pr comment' 'select(.change.actions != ["no-op"])' 'TF_IN_AUTOMATION' 'rm -f tfplan'; do
  has "$TFW" "$sym"
done
for j in 'plan:' 'apply-prod:' 'apply-staging:' ; do hasE "$TFW" "^  $j"; done
lacks "$TFW" 'upload-artifact'
lacks "$TFW" 'backend=false'
# 2i. no long-lived keys in any workflow
if grep -rEiq 'aws-access-key-id|AWS_SECRET_ACCESS_KEY|AWS_ACCESS_KEY_ID' .github/workflows; then
  grep -rEin 'aws-access-key-id|AWS_SECRET_ACCESS_KEY|AWS_ACCESS_KEY_ID' .github/workflows >&2 || true
  fail "long-lived AWS keys referenced in a workflow (OIDC only)"
fi
# 2j. deploy.sh hook
for sym in 'migrate_by_version() {' \
           'if [ "$fn" = "$VPC_FN" ] && [ "${MIGRATE_ON_PUBLISH:-1}" = 1 ]; then migrate_by_version "$fn" "$ver"; fi' \
           'action:"db/migrate"' 'developercards.scheduler' '--function-name "$fn:$ver"' 'FunctionError' \
           '--cli-binary-format raw-in-base64-out' '.statusCode == 200'; do
  has "$DEPLOY" "$sym"
done
sed -n 1,30p "$DEPLOY" | grep -Fq 'MIGRATE_ON_PUBLISH' || fail "deploy.sh header (first 30 lines) must document MIGRATE_ON_PUBLISH"
lp="$(lineof 'publish-version' "$DEPLOY")"
lm="$(lineof 'then migrate_by_version "$fn" "$ver"; fi' "$DEPLOY")"
la="$(lineof 'update-alias' "$DEPLOY")"
[ -n "$lp" ] && [ -n "$lm" ] && [ -n "$la" ] || fail "deploy.sh: publish-version / hook / update-alias lines not all found"
[ "$lp" -lt "$lm" ] && [ "$lm" -lt "$la" ] || fail "deploy.sh: the migrate hook must sit between publish-version ($lp) and update-alias ($la); found at $lm"
# 2k. smoke.sh
for sym in 'scripts/smoke.sh <prod|staging>' 'https://api.developercards.app' 'https://api-staging.developercards.app' \
           'https://cdn.developercards.app' 'https://cdn-staging.developercards.app' 'core-vpc-staging' \
           '[1/5] health' '[2/5] health/deep' '[3/5] manifest' '[4/5] publish-roundtrip' '[5/5] dashboard' \
           'health/deep' 'developercards.scheduler' 'schemaVersion' '/content/manifest.json' '.schemaVersion == 2' \
           'smoke-' '/api/v1/authoring/decks' '/api/v1/authoring/cards' '/api/v1/authoring/publish' '/api/v1/authoring/publish/status?jobId=' \
           '/api/v1/admin/manifest/rebuild' '/api/v1/authoring/dashboard' 'invoke-as-admin.sh' 'SUCCESS' 'FAILED' 'buildId' \
           'DRY_RUN' 'SMOKE OK' 'FunctionError' 'trap'; do
  has "$SMOKE" "$sym"
done
# 2l. rollback.sh
for sym in 'api|worker|console|deck' 'update-alias' 'CodeSha256' 'dist-' '.tgz' '/rollback' '"buildId"' 'DRY_RUN' \
           'invoke-as-admin.sh' 'core-vpc-staging' 'worker-lambda-staging' 'developercards-console-staging' \
           'recallsmith-console-622994489535' 'E85FKUMZZWQWX' 'create-invalidation' 'invalidation-completed' 'no-cache' 'immutable'; do
  has "$RB" "$sym"
done
# 2m. suppression tokens: new files + '+' lines of edited files; secret-leak guard
NEWF="$CD $OTA $TFW $SMOKE $RB $OIDC $ALLOW_P $ALLOW_S"
if grep -Eq '\.skip\(|\.only\(|@ts-ignore|@ts-expect-error|eslint-disable|#pragma warning disable|\[Fact\(Skip' $NEWF; then
  fail "suppression token in a new file"
fi
plus="$TMP/plus.txt"
git diff -U0 "$mb" HEAD -- "$CI" "$DEPLOY" "$IVARS" "$IOUTS" "$PMAIN" "$SMAIN" "$IREADME" | grep -E '^\+[^+]' | sed 's/^+//' > "$plus" || true
if grep -Eq '\.skip\(|\.only\(|@ts-ignore|@ts-expect-error|eslint-disable|#pragma warning disable|\[Fact\(Skip' "$plus"; then
  fail "suppression token in an added line"
fi
if cat $NEWF "$plus" | grep -Eq '(PGPASSWORD|MIGRATE_SECRET|INTERNAL_SHARED_SECRET|RC_WEBHOOK_AUTH_(PRODUCTION|DEVELOPMENT)|ANALYTICS_USER_SALT|EXPO_TOKEN|TFVARS_(PROD|STAGING))[[:space:]]*[=:][[:space:]]*"[^"$P]'; then
  fail "a secret-bearing name carries a literal value in a new file or added line"
fi

# ── 3. Gates ───────────────────────────────────────────────────────────────
echo "[3/5] gates: terraform fmt/validate, bash -n, YAML, actionlint, JSON, DRY_RUN runs"
terraform fmt -check -recursive infra || fail "terraform fmt -check failed under infra/"
for root in prod staging; do
  ( cd "infra/envs/$root" && TF_DATA_DIR="$TMP/gate-$root" terraform init -backend=false -input=false >/dev/null && TF_DATA_DIR="$TMP/gate-$root" terraform validate ) \
    || fail "terraform init/validate failed in infra/envs/$root"
done
bash -n "$DEPLOY" "$SMOKE" "$RB" scripts/invoke-as-admin.sh infra/scripts/rds-snapshot.sh || fail "bash -n failed"
python3 -c 'import sys, yaml
for f in sys.argv[1:]:
    with open(f) as fh:
        yaml.safe_load(fh)' "$CI" "$CD" "$OTA" "$TFW" || fail "a workflow does not parse as YAML"
if command -v actionlint >/dev/null 2>&1; then
  actionlint -shellcheck= -pyflakes= "$CI" "$CD" "$OTA" "$TFW" || fail "actionlint reported errors"
else
  echo "  note: actionlint not installed — skipped"
fi
python3 -m json.tool "$ALLOW_P" >/dev/null && python3 -m json.tool "$ALLOW_S" >/dev/null || fail "allow file JSON"
for e in staging prod; do
  out="$(DRY_RUN=1 "$SMOKE" "$e")" || fail "DRY_RUN=1 smoke.sh $e exited non-zero"
  for k in 1 2 3 4 5; do echo "$out" | grep -Fq "[$k/5]" || fail "DRY_RUN smoke.sh $e did not print check [$k/5]"; done
done
DRY_RUN=1 "$RB" api 1 >/dev/null || fail "DRY_RUN rollback.sh api"
DRY_RUN=1 "$RB" worker 1 >/dev/null || fail "DRY_RUN rollback.sh worker"
DRY_RUN=1 "$RB" console abc1234 >/dev/null || fail "DRY_RUN rollback.sh console"
DRY_RUN=1 "$RB" deck 1 b >/dev/null || fail "DRY_RUN rollback.sh deck"
if "$RB" nope 1 >/dev/null 2>&1; then fail "rollback.sh must reject an unknown verb"; fi
if "$SMOKE" nope >/dev/null 2>&1; then fail "smoke.sh must reject an unknown environment"; fi
dry="$( cd src_C && DRY_RUN=1 ENV=staging VPC_FN=core-vpc-staging PUBLISH_ALIAS=staging ./deploy.sh 2>&1 )" || { echo "$dry" | tail -20 >&2; fail "DRY_RUN=1 ENV=staging ./deploy.sh exited non-zero"; }
echo "$dry" | grep -Fq 'DRY: aws lambda invoke --function-name core-vpc-staging:new-version db/migrate' \
  || fail "DRY_RUN deploy.sh did not print the migrate_by_version DRY line for core-vpc-staging"
# src_C root gate only when a compiled file changed (E11 touches deploy.sh only; anything else is out of scope anyway)
if git diff --name-only "$mb" HEAD -- src_C | grep -Ev '^src_C/deploy\.sh$' | grep -q .; then
  ( cd src_C && dotnet build RecallSmith.Lambda.sln -c Release -nologo ) || fail "dotnet build failed"
fi
if git diff --name-only "$mb" HEAD -- frontend | grep -q .; then
  ( cd frontend && npm run lint && npm run build ) || fail "frontend lint/build failed"
fi

# ── 4. Plans (read-only) + policy simulation ───────────────────────────────
#   prod    → real backend, read-only (init -reconfigure in a COPY of infra/, plan -lock=false never writes
#             the .tflock): the effective set must be exactly the seven E11 creates and check-plan.py must
#             accept E11.plan-allow.json — the same check the supervisor runs (E00 §3.1; E06/E12 precedent).
#   staging → empty local state through backend_override.tf in the scratch copies (E00 §6 #25 mode a) at HEAD and at the merge-base tree:
#             every effective action is create, and the HEAD − base delta is exactly the two E11 creates.
echo "[4/5] terraform plan: prod (real backend, read-only) + staging (HEAD vs merge-base); simulate the planned policies"
[ "$(aws sts get-caller-identity --query Account --output text)" = "$ACCOUNT" ] || fail "AWS_PROFILE=dev must resolve to account $ACCOUNT"
python3 -m py_compile infra/scripts/check-plan.py || fail "check-plan.py does not compile"
rm -rf "$TMP/infra" "$TMP/base"; cp -R infra "$TMP/infra"; rm -rf "$TMP"/infra/envs/*/.terraform
mkdir -p "$TMP/base"; git archive "$mb" infra | tar -x -C "$TMP/base" || fail "git archive of infra at the merge-base failed"
PRODROOT="$TMP/infra/envs/prod"; STGROOT="$TMP/infra/envs/staging"; STGBASE="$TMP/base/infra/envs/staging"
# prod variables: the real prod.auto.tfvars is gitignored. Derive one from the committed example; two read-only
# lookups replace the placeholders that would otherwise plan a spurious change. Never echoed.
PRODVARS=""
if [ ! -f "$PRODROOT/prod.auto.tfvars" ]; then
  awk '!/^[[:space:]]*(alert_email|snowflake_external_id)[[:space:]]*=/' "$PRODROOT/prod.auto.tfvars.example" > "$TMP/e11.tfvars"
  PRODVARS="-var-file=$TMP/e11.tfvars"
  if grep -Fq 'variable "snowflake_external_id"' "$PRODROOT/variables.tf" && [ -z "${TF_VAR_snowflake_external_id:-}" ]; then
    ext="$(aws iam get-role --role-name snowflake-recallsmith-s3-role \
            --query 'Role.AssumeRolePolicyDocument.Statement[0].Condition.StringEquals."sts:ExternalId"' --output text 2>/dev/null || true)"
    [ -n "$ext" ] && [ "$ext" != "None" ] && export TF_VAR_snowflake_external_id="$ext"
    unset ext
  fi
  if grep -Fq 'variable "alert_email"' "$PRODROOT/variables.tf" && [ -z "${TF_VAR_alert_email:-}" ]; then
    mail="$(aws sns list-subscriptions-by-topic --topic-arn "arn:aws:sns:$REGION:$ACCOUNT:developercards-alerts" \
             --query "Subscriptions[?Protocol=='email'].Endpoint | [0]" --output text 2>/dev/null || true)"
    [ -n "$mail" ] && [ "$mail" != "None" ] && export TF_VAR_alert_email="$mail"
    unset mail
  fi
fi
plan_err() { grep -E '^(Error|│ Error|Planning failed)' "$1" | grep -Eiv 'PASSWORD|SECRET|_AUTH_|SALT' | head -15 >&2 || true; }
# 4a. prod — real backend, read-only
( cd "$PRODROOT" && terraform init -input=false -reconfigure -no-color >/dev/null 2>"$TMP/init-prod.err" ) \
  || { tail -15 "$TMP/init-prod.err" >&2; fail "prod: terraform init (real backend, read-only) failed — E01…E12 must be applied"; }
( cd "$PRODROOT" && terraform plan -input=false -lock=false -no-color ${PRODVARS:+"$PRODVARS"} -out="$TMP/E11.prod.tfplan" >/dev/null 2>"$TMP/plan-prod.err" ) \
  || { plan_err "$TMP/plan-prod.err"; fail "prod: terraform plan failed"; }
( cd "$PRODROOT" && terraform show -json "$TMP/E11.prod.tfplan" > "$TMP/head.prod.plan.json" ) || fail "prod: terraform show -json failed"
unset TF_VAR_alert_email TF_VAR_snowflake_external_id
effective() { jq -r '.resource_changes[] | select(.mode != "data") | select(.change.actions != ["no-op"]) | "\(.address)\t\(.change.actions | join(","))"' "$1" | LC_ALL=C sort; }
effective "$TMP/head.prod.plan.json" > "$TMP/head.prod.eff"
awk -v OFS='\t' '{ print $0, "create" }' "$TMP/expected.prod" | LC_ALL=C sort > "$TMP/expected.prod.eff"
echo "  prod effective changes:"; sed 's/^/    /' "$TMP/head.prod.eff"
diff -u "$TMP/expected.prod.eff" "$TMP/head.prod.eff" >&2 || fail "prod: the effective set is not exactly the seven E11 creates of Changes 4 (E01…E12 must be applied and their second plan empty)"
if jq -e '[.resource_changes[] | select(.change.importing != null)] | length > 0' "$TMP/head.prod.plan.json" >/dev/null; then fail "prod: importing present in a real-backend plan"; fi
jq -e '(.output_changes // {}) | to_entries | all(.value.actions == ["no-op"])' "$TMP/head.prod.plan.json" >/dev/null || fail "prod: output_changes must be empty"
python3 infra/scripts/check-plan.py --plan "$TMP/head.prod.plan.json" --allow "$ALLOW_P" || fail "check-plan.py rejects the prod plan against E11.plan-allow.json"
# 4b. staging — local override (empty state) at HEAD and at the merge-base; delta = exactly the two root-level creates (E00 §6 #34)
plan_stg() {   # <root-dir> <out.json> <log>  — scratch copies only; empty local state via E01's backend_override.tf (E00 §6 #25 mode a)
  printf 'terraform {\n  backend "local" {\n    path = "%s/terraform.tfstate"\n  }\n}\n' "$1" > "$1/backend_override.tf"
  ( cd "$1" && terraform init -input=false -reconfigure -no-color >/dev/null 2>"$3" \
      && terraform plan -input=false -lock=false -no-color -var-file=staging.auto.tfvars.example -out="$1/e11.tfplan" >/dev/null 2>>"$3" \
      && terraform show -json "$1/e11.tfplan" > "$2" && rm -f "$1/e11.tfplan" "$1/backend_override.tf" "$1"/terraform.tfstate* )
}
plan_stg "$STGROOT" "$TMP/head.staging.plan.json" "$TMP/plan-stg-head.err" || { plan_err "$TMP/plan-stg-head.err"; fail "staging: plan at HEAD failed"; }
plan_stg "$STGBASE" "$TMP/base.staging.plan.json" "$TMP/plan-stg-base.err" || { plan_err "$TMP/plan-stg-base.err"; fail "staging: plan at the merge-base failed"; }
effective "$TMP/head.staging.plan.json" > "$TMP/head.staging.eff"
effective "$TMP/base.staging.plan.json" > "$TMP/base.staging.eff"
if cut -f2 "$TMP/head.staging.eff" | grep -qvx create; then cut -f2 "$TMP/head.staging.eff" | sort | uniq -c >&2; fail "staging: every effective action must be create (empty local state through the local override)"; fi
if jq -e '[.resource_changes[] | select(.change.importing != null)] | length > 0' "$TMP/head.staging.plan.json" >/dev/null; then fail "staging: importing present"; fi
comm -13 "$TMP/base.staging.eff" "$TMP/head.staging.eff" > "$TMP/added.staging"
comm -23 "$TMP/base.staging.eff" "$TMP/head.staging.eff" > "$TMP/removed.staging"
[ ! -s "$TMP/removed.staging" ] || { cat "$TMP/removed.staging" >&2; fail "staging: an effective change of the base plan disappeared"; }
awk -v OFS='\t' '{ print $0, "create" }' "$TMP/expected.staging" | LC_ALL=C sort > "$TMP/expected.staging.eff"
echo "  staging delta (HEAD − merge-base):"; sed 's/^/    /' "$TMP/added.staging"
diff -u "$TMP/expected.staging.eff" "$TMP/added.staging" >&2 || fail "staging: plan delta is not exactly the two E11 creates of Changes 4"
if jq -e '.resource_changes[] | select(.address | test("aws_iam_openid_connect_provider|gha_plan"))' "$TMP/head.staging.plan.json" >/dev/null; then
  fail "staging plan must not contain the OIDC provider or the plan role (prod-owned)"
fi
python3 infra/scripts/check-plan.py --plan "$TMP/head.staging.plan.json" --allow "$ALLOW_S" >/dev/null 2>&1 \
  && echo "  note: check-plan.py also accepts the staging allow file against the empty-state plan" \
  || echo "  note: check-plan.py is strict on the empty-state staging plan (expected: E10/E12 creates present); the supervisor's real-backend run is the binding check"
after() { jq -r --arg a "$2" --arg k "$3" '.resource_changes[] | select(.address == $a) | .change.after[$k]' "$1"; }
# the deploy role's address differs per root (E00 §6 #34): prod = module.identity…[0], staging = inline root resource
ROLE_ADDR_prod='module.identity.aws_iam_role.gha_deploy[0]';        ROLE_ADDR_staging='aws_iam_role.gha_deploy'
POL_ADDR_prod='module.identity.aws_iam_role_policy.gha_deploy[0]';  POL_ADDR_staging='aws_iam_role_policy.gha_deploy'
role_addr() { eval "printf '%s' \"\$ROLE_ADDR_$1\""; }
pol_addr()  { eval "printf '%s' \"\$POL_ADDR_$1\""; }
# trust documents
for spec in "prod:repo:ChuanQiao1128/recallsmith:environment:production" "prod:repo:ChuanQiao1128/recallsmith:environment:infra-prod" "staging:repo:ChuanQiao1128/recallsmith:environment:staging"; do
  root="${spec%%:*}"; sub="${spec#*:}"
  after "$TMP/head.$root.plan.json" "$(role_addr "$root")" assume_role_policy \
    | jq -e --arg s "$sub" '.Statement[0].Condition.StringEquals["token.actions.githubusercontent.com:sub"] | if type == "array" then index($s) != null else . == $s end' >/dev/null \
    || fail "$root gha_deploy trust lacks sub $sub"
done
after "$TMP/head.staging.plan.json" "$ROLE_ADDR_staging" assume_role_policy \
  | jq -e '.Statement[0].Condition.StringEquals["token.actions.githubusercontent.com:sub"] | if type == "array" then length == 1 else true end' >/dev/null \
  || fail "staging gha_deploy trust must admit exactly one environment"
for sub in 'repo:ChuanQiao1128/recallsmith:pull_request' 'repo:ChuanQiao1128/recallsmith:ref:refs/heads/main'; do
  after "$TMP/head.prod.plan.json" 'module.identity.aws_iam_role.gha_plan[0]' assume_role_policy \
    | jq -e --arg s "$sub" '.Statement[0].Condition.StringEquals["token.actions.githubusercontent.com:sub"] | index($s) != null' >/dev/null \
    || fail "gha_plan trust lacks sub $sub"
done
for root in prod staging; do
  after "$TMP/head.$root.plan.json" "$(role_addr "$root")" assume_role_policy \
    | jq -e '.Statement[0].Condition.StringEquals["token.actions.githubusercontent.com:aud"] == "sts.amazonaws.com" and .Statement[0].Action == "sts:AssumeRoleWithWebIdentity"' >/dev/null \
    || fail "$root gha_deploy trust: aud / action"
done
# planned policy documents → simulate-custom-policy (read-only)
SPOL="$TMP/staging-deploy.policy.json"; PPOL="$TMP/prod-deploy.policy.json"; TPOL="$TMP/plan-tfstate.policy.json"
after "$TMP/head.staging.plan.json" "$POL_ADDR_staging" policy > "$SPOL"
after "$TMP/head.prod.plan.json" "$POL_ADDR_prod" policy > "$PPOL"
after "$TMP/head.prod.plan.json" 'module.identity.aws_iam_role_policy.gha_plan_tfstate[0]' policy > "$TPOL"
for p in "$SPOL" "$PPOL" "$TPOL"; do jq -e '.Statement | length > 0' "$p" >/dev/null || fail "planned policy document $p is empty or unknown at plan time"; done
STAR='[.Statement[] | select(.Resource | if type == "array" then index("*") != null else . == "*" end)] | all(.Sid == "ConsoleList")'
jq -e "$STAR" "$SPOL" >/dev/null || fail 'staging deploy policy: bare Resource "*" only under Sid ConsoleList'
jq -e "$STAR" "$PPOL" >/dev/null || fail 'prod deploy policy: bare Resource "*" only under Sid ConsoleList'
jq -e '[.Statement[] | select(.Resource | if type == "array" then index("*") != null else . == "*" end)] | length == 0' "$TPOL" >/dev/null || fail 'plan tfstate policy must not carry Resource "*"'
for p in "$SPOL" "$PPOL" "$TPOL"; do
  jq -e '[.Statement[] | .Action | if type == "array" then .[] else . end] | any(. == "*" or endswith(":*")) | not' "$p" >/dev/null || fail "$p grants a wildcard action"
done
jq -e '[.Statement[] | select(.Sid == "RdsSnapshot")] | length == 0' "$SPOL" >/dev/null || fail "staging deploy policy must not carry RdsSnapshot"
jq -e '[.Statement[] | select(.Sid == "RdsSnapshot")] | length == 1' "$PPOL" >/dev/null || fail "prod deploy policy must carry RdsSnapshot"
sim() {   # <policy-file> <action> <resource-arn> <want> [context-entries…]
  local pol="$1" act="$2" res="$3" want="$4" got; shift 4
  # the document goes in as a string: for a list-typed parameter `file://` is read as a JSON list, not as one policy
  got="$(aws iam simulate-custom-policy --policy-input-list "$(cat "$pol")" --action-names "$act" --resource-arns "$res" "$@" --query 'EvaluationResults[0].EvalDecision' --output text)"
  [ "$got" = "$want" ] || fail "simulate $act on $res → $got (want $want)"
}
LAM="arn:aws:lambda:$REGION:$ACCOUNT:function"
sim "$SPOL" lambda:UpdateAlias "$LAM:core-vpc-staging:staging" allowed
sim "$SPOL" lambda:UpdateFunctionCode "$LAM:worker-lambda-staging" allowed
sim "$SPOL" lambda:InvokeFunction "$LAM:core-vpc-staging:12" allowed
sim "$SPOL" s3:PutObject "arn:aws:s3:::developercards-console-staging/index.html" allowed
sim "$SPOL" s3:ListBucket "arn:aws:s3:::developercards-console-staging" allowed
sim "$SPOL" ssm:GetParametersByPath "arn:aws:ssm:$REGION:$ACCOUNT:parameter/developercards/staging" allowed
sim "$SPOL" ssm:GetParameter "arn:aws:ssm:$REGION:$ACCOUNT:parameter/developercards/staging/pg-password" allowed
sim "$SPOL" cloudfront:CreateInvalidation "arn:aws:cloudfront::$ACCOUNT:distribution/EXAMPLE12345" allowed \
    --context-entries "ContextKeyName=aws:ResourceTag/Env,ContextKeyValues=staging,ContextKeyType=string"
sim "$SPOL" cloudfront:ListDistributions "*" allowed
sim "$SPOL" kms:Decrypt "arn:aws:kms:$REGION:$ACCOUNT:key/00000000-0000-0000-0000-000000000000" allowed \
    --context-entries "ContextKeyName=kms:ViaService,ContextKeyValues=ssm.$REGION.amazonaws.com,ContextKeyType=string"
sim "$SPOL" lambda:UpdateAlias "$LAM:core-vpc:prod" implicitDeny
sim "$SPOL" lambda:DeleteFunction "$LAM:core-vpc-staging" implicitDeny
sim "$SPOL" s3:PutObject "arn:aws:s3:::recallsmith-console-622994489535/index.html" implicitDeny
sim "$SPOL" s3:PutObject "arn:aws:s3:::core-vpc/content/manifest.json" implicitDeny
sim "$SPOL" ssm:GetParameter "arn:aws:ssm:$REGION:$ACCOUNT:parameter/developercards/prod/pg-password" implicitDeny
sim "$SPOL" cloudfront:CreateInvalidation "arn:aws:cloudfront::$ACCOUNT:distribution/E85FKUMZZWQWX" implicitDeny \
    --context-entries "ContextKeyName=aws:ResourceTag/Env,ContextKeyValues=prod,ContextKeyType=string"
sim "$SPOL" kms:Decrypt "arn:aws:kms:$REGION:$ACCOUNT:key/00000000-0000-0000-0000-000000000000" implicitDeny
sim "$SPOL" rds:DeleteDBInstance "*" implicitDeny
sim "$SPOL" iam:PassRole "*" implicitDeny
sim "$SPOL" sqs:DeleteQueue "*" implicitDeny
sim "$PPOL" rds:CreateDBSnapshot "arn:aws:rds:$REGION:$ACCOUNT:db:developercards" allowed
sim "$PPOL" lambda:InvokeFunction "$LAM:core-vpc:48" allowed
sim "$PPOL" s3:PutObject "arn:aws:s3:::recallsmith-console-622994489535/index.html" allowed
sim "$PPOL" s3:PutObject "arn:aws:s3:::developercards-console-staging/index.html" implicitDeny
sim "$TPOL" s3:PutObject "arn:aws:s3:::recallsmith-tfstate-622994489535/envs/prod/terraform.tfstate.tflock" allowed
sim "$TPOL" s3:DeleteObject "arn:aws:s3:::recallsmith-tfstate-622994489535/envs/staging/terraform.tfstate.tflock" allowed
sim "$TPOL" s3:GetObject "arn:aws:s3:::recallsmith-tfstate-622994489535/envs/prod/terraform.tfstate" allowed
sim "$TPOL" s3:ListBucket "arn:aws:s3:::recallsmith-tfstate-622994489535" allowed
sim "$TPOL" s3:PutObject "arn:aws:s3:::recallsmith-tfstate-622994489535/envs/prod/terraform.tfstate" implicitDeny
sim "$TPOL" s3:DeleteObject "arn:aws:s3:::recallsmith-tfstate-622994489535/envs/prod/terraform.tfstate" implicitDeny
rm -f "$TMP"/*.plan.json "$TMP"/*.policy.json "$TMP"/*.tfplan "$TMP"/*.tfvars

# ── 5. Scope + frozen + OTA + apply guard ──────────────────────────────────
echo "[5/5] scope + frozen + OTA + apply guard"
outside="$( { git diff --name-only "$mb" HEAD; git ls-files --others --exclude-standard -- .github scripts infra src_C/deploy.sh docs; } | sort -u \
  | grep -Ev '^(\.github/workflows/(ci|cd|ota|terraform)\.yml|scripts/(smoke|rollback)\.sh|src_C/deploy\.sh|infra/modules/identity/(oidc|variables|outputs)\.tf|infra/envs/(prod|staging)/main\.tf|infra/README\.md|docs/delivery/r16-issues/.*)$' || true )"
[ -z "$outside" ] || { echo "$outside" >&2; fail "files changed outside E11 scope"; }
git diff --quiet "$mb" HEAD -- mobile/src/content/deckRepository.ts mobile/src/sync/progressSync.ts mobile/src/review/model.ts \
  || fail "frozen mobile file modified"
git diff --quiet "$mb" HEAD -- mobile || fail "mobile/ must be zero-diff in E11 (OTA rule)"
[ -z "$(git ls-files --others --exclude-standard -- mobile/src mobile/tests mobile/app.json mobile/eas.json mobile/package.json mobile/package-lock.json)" ] || fail "untracked file under mobile/"
grep -Fq '"version": "1.6.1"' mobile/app.json || fail "app.json version changed"
if grep -rq "@sentry" mobile/src; then fail "@sentry reference under mobile/src"; fi
git diff --quiet "$mb" HEAD -- infra/envs/prod/imports.tf infra/envs/prod/variables.tf infra/envs/prod/outputs.tf infra/envs/staging/variables.tf infra/envs/staging/outputs.tf 2>/dev/null \
  || fail "root imports.tf / variables.tf / outputs.tf must not change in E11"
[ -z "$(git ls-files infra | grep -E '\.(tfplan|plan\.json)$|generated.*\.tf$|[^e]\.auto\.tfvars$' || true)" ] || fail "a plan / generated / tfvars file is tracked"
[ -z "$(grep -rn 'profile *= *"' infra --include=*.tf || true)" ] || fail "a provider block carries a profile"
# The verify and the smoke script never mutate: no apply/import, no create-/update-/delete-/put- CLI verbs outside comments.
for f in docs/delivery/r16-issues/E11.verify.sh "$SMOKE"; do
  if grep -v '^[[:space:]]*#' "$f" | grep -Eq 'terraform +(apply|import)|aws +[a-z0-9-]+ +(create|update|delete|put)-'; then
    grep -v '^[[:space:]]*#' "$f" | grep -En 'terraform +(apply|import)|aws +[a-z0-9-]+ +(create|update|delete|put)-' >&2 || true
    fail "$f contains a state-changing command"
  fi
done
# cd.yml never applies Terraform; terraform.yml applies only from a saved plan in the approval environment.
if grep -Eq 'terraform[[:space:]]+(apply|import)' "$CD"; then fail "cd.yml must never apply or import Terraform"; fi
[ "$(grep -c 'apply -input=false tfplan' "$TFW" || true)" = "2" ] || fail "terraform.yml must apply exactly twice (prod, staging) from a saved plan"

echo "E11 VERIFY OK"
