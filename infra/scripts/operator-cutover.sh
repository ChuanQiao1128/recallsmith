#!/usr/bin/env bash
# operator-cutover.sh — enterprise audit SEC-01 step 4 (RUNBOOK §10). Takes AdministratorAccess off the static
# key (user devcards-admin) once the three operator roles from infra/modules/operators are proven to work.
#
#   1. The owner proves the MFA path first, in their own terminal (the CLI prompts for the 6-digit code and
#      caches a 12-hour role session in ~/.aws/cli/cache):  aws sts get-caller-identity --profile devcards-admin
#   2. infra/scripts/operator-cutover.sh            # preflight only: prints what it would change
#      CONFIRM=1 infra/scripts/operator-cutover.sh  # make the change, then re-verify every profile
#
# Every IAM write goes through the MFA admin role, never through the key being cut down, so a broken MFA path
# stops the script before anything changes. Rollback (needs the same MFA role session) is printed at the end.
set -euo pipefail
ACCOUNT=622994489535
USER_NAME=devcards-admin
BASE_POLICY="arn:aws:iam::$ACCOUNT:policy/devcards-operator-base"
ADMIN_GROUP=admins
DIRECT_POLICIES=(arn:aws:iam::aws:policy/AmazonEC2FullAccess arn:aws:iam::aws:policy/AmazonS3FullAccess)
export AWS_REGION="${AWS_REGION:-ap-southeast-2}"

# stdin from /dev/null: an expired MFA session fails here instead of waiting for a code nobody will type.
whoami_as() { aws sts get-caller-identity --profile "$1" --query Arn --output text </dev/null 2>/dev/null; }
must_be_denied() { if "$@" >/dev/null 2>&1 </dev/null; then echo "FAIL expected AccessDenied: $*" >&2; return 1; fi; echo "ok denied: ${*:1:4}"; }

echo "== preflight"
for p in devcards-ro devcards-deploy; do
  arn="$(whoami_as "$p")" || { echo "FAIL profile $p cannot assume its role (RUNBOOK §10 profiles)" >&2; exit 1; }
  echo "ok $p -> $arn"
done
arn="$(whoami_as devcards-admin)" || {
  echo "FAIL no MFA session for devcards-admin. The owner runs, in their own terminal:" >&2
  echo "     aws sts get-caller-identity --profile devcards-admin" >&2
  exit 1
}
echo "ok devcards-admin -> $arn"
aws iam get-policy --profile devcards-admin --policy-arn "$BASE_POLICY" --query Policy.PolicyName --output text >/dev/null

in_group="$(aws iam list-groups-for-user --profile devcards-admin --user-name "$USER_NAME" --query "Groups[?GroupName=='$ADMIN_GROUP'] | length(@)" --output text)"
attached="$(aws iam list-attached-user-policies --profile devcards-admin --user-name "$USER_NAME" --query 'AttachedPolicies[].PolicyArn' --output text)"
echo "now: in group $ADMIN_GROUP=$in_group; attached: ${attached:-none}"

if [ "${CONFIRM:-0}" != 1 ]; then
  echo "would: attach $BASE_POLICY; detach ${DIRECT_POLICIES[*]}; remove $USER_NAME from $ADMIN_GROUP"
  echo "preflight only. Re-run with CONFIRM=1 to make the change."
  exit 0
fi

echo "== cutover"
grep -q "$BASE_POLICY" <<<"$attached" || aws iam attach-user-policy --profile devcards-admin --user-name "$USER_NAME" --policy-arn "$BASE_POLICY"
for p in "${DIRECT_POLICIES[@]}"; do
  if grep -q "$p" <<<"$attached"; then aws iam detach-user-policy --profile devcards-admin --user-name "$USER_NAME" --policy-arn "$p"; fi
done
[ "$in_group" = 0 ] || aws iam remove-user-from-group --profile devcards-admin --user-name "$USER_NAME" --group-name "$ADMIN_GROUP"

echo "== verify (IAM is eventually consistent; allow ~10 s)"
sleep 10
must_be_denied aws iam list-users --profile dev
must_be_denied aws s3api list-buckets --profile dev
for p in devcards-ro devcards-deploy devcards-admin; do whoami_as "$p" >/dev/null && echo "ok $p still assumes"; done
echo "DONE: the static key can now only assume devcards-agent-readonly / devcards-deployer, and devcards-admin-mfa with MFA."
echo "ROLLBACK: aws iam add-user-to-group --profile devcards-admin --user-name $USER_NAME --group-name $ADMIN_GROUP"
