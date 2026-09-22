#!/usr/bin/env bash
# E05 — iam-least-privilege verify. cwd = worktree root. Re-runs the brief's five
# acceptance bullets verbatim; never trusts the worker's report.
#
# ON THE UNTOUCHED BASE TREE THIS SCRIPT EXITS NON-ZERO at step 1:
#   - infra/modules/identity/policies.tf and
#     docs/delivery/r16-issues/E05.plan-allow.json do not exist on base
#   - the E01–E04 prerequisites (infra/scripts/check-plan.py, infra/envs/prod/imports.tf,
#     infra/modules/observability/alarms.tf, E02–E04 plan-allow files) do not exist on base
# Step 2 (literal guards) would also fail on base: no worker role, no scoped documents,
# the four *FullAccess ARNs still in the tree. Step 3 is the infra root gate, step 4 the
# read-only plan + policy simulation, step 5 a purely negative scope guard.
#
# Network: step 3 may download hashicorp/aws 6.66.0 once into TF_PLUGIN_CACHE_DIR; step 4
# needs AWS_PROFILE=dev (read-only: terraform plan, aws iam get-role,
# aws iam simulate-custom-policy). Nothing here changes state; *.tfplan / *.plan.json / the
# temp var-file live in a mktemp dir removed by the trap. Runtime: steps 1-3 < 1 min, step 4
# 3-5 min (the plan dominates). The driver's diff-scoped banned-term grep and suppression
# scan run separately — this script deliberately does not spell those terms.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
BASE_REF="${BASE_REF:-${BASE:-delivery/r16-e-prod}}"   # driver exports BASE
fail() { echo "E05 VERIFY FAIL: $*" >&2; exit 1; }

export AWS_PROFILE="${AWS_PROFILE:-dev}"
export AWS_REGION="${AWS_REGION:-ap-southeast-2}"
export AWS_PAGER=""
export TF_PLUGIN_CACHE_DIR="${TF_PLUGIN_CACHE_DIR:-$HOME/.terraform.d/plugin-cache}"
export TF_IN_AUTOMATION=1
mkdir -p "$TF_PLUGIN_CACHE_DIR"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/e05verify.XXXXXX")"
PROD=infra/envs/prod
OVR="$PROD/backend_override.tf"   # E01 gap 13: gitignored local backend for the worker's plan; created in step 4, removed by the trap
trap 'rm -f "$OVR" "$PROD/.terraform/terraform.tfstate" 2>/dev/null; rm -rf "$TMP"' EXIT

ISSUES=docs/delivery/r16-issues
POL=infra/modules/identity/policies.tf
IDVARS=infra/modules/identity/variables.tf
IDOUT=infra/modules/identity/outputs.tf
IDMAIN=infra/modules/identity/main.tf
RMAIN=infra/envs/prod/main.tf
IMPORTS=infra/envs/prod/imports.tf
LOCK=infra/envs/prod/.terraform.lock.hcl
WFN=infra/modules/worker/function.tf
README=infra/README.md
ALLOW=$ISSUES/E05.plan-allow.json
CHECK=infra/scripts/check-plan.py
ACCOUNT=622994489535
QUEUE_ARN="arn:aws:sqs:ap-southeast-2:$ACCOUNT:recallsmith-publish-jobs"
LOG_PREFIX="arn:aws:logs:ap-southeast-2:$ACCOUNT:log-group:/aws/lambda"
WORKER_ROLE_ARN="arn:aws:iam::$ACCOUNT:role/developercards-worker-lambda-role"

count() { grep -Ec "$1" "$2" || true; }     # ERE count, 0 when no match
fcount() { grep -Fc "$1" "$2" || true; }    # fixed-string count, 0 when no match
block() { awk -v n="$1" '$0 ~ "^module \"" n "\" \\{" {f=1} f {print} f && /^\}/ {exit}' "$2"; }

mb="$(git merge-base HEAD "$BASE_REF" 2>/dev/null || git merge-base HEAD "origin/$BASE_REF" 2>/dev/null)" \
  || fail "cannot resolve base ref $BASE_REF (set BASE_REF / BASE); refusing to diff the tree against itself"

# ── 1. Scope files exist (FAILS ON BASE) ───────────────────────────────────
echo "[1/5] scope files exist"
[ -f "$POL" ]   || fail "$POL does not exist (base tree fails here)"
[ -f "$ALLOW" ] || fail "$ALLOW does not exist (base tree fails here)"
for f in "$CHECK" "$RMAIN" "$IMPORTS" "$LOCK" "$IDVARS" "$IDOUT" "$IDMAIN" "$WFN" "$README" \
         infra/modules/observability/alarms.tf infra/modules/worker/queue.tf \
         "$ISSUES/E02.plan-allow.json" "$ISSUES/E03.plan-allow.json" "$ISSUES/E04.plan-allow.json"; do
  [ -f "$f" ] || fail "$f is missing (E01–E04 must be merged below E05)"
done
git ls-files --error-unmatch "$IMPORTS" >/dev/null 2>&1 || fail "$IMPORTS is not tracked"

# ── 2. Literal guards ──────────────────────────────────────────────────────
echo "[2/5] literal guards"
# 2a. policies.tf — the role, the two documents, the Sids, the ENI list
for s in 'resource "aws_iam_role" "worker"' 'name = var.worker_role_name' '"sts:AssumeRole"' '"lambda.amazonaws.com"' \
         'resource "aws_iam_role_policy" "core_vpc"' 'resource "aws_iam_role_policy" "worker"' \
         'role = aws_iam_role.core_vpc.id' 'role = aws_iam_role.worker.id' \
         '"developercards-core-vpc-scoped"' '"developercards-worker-lambda-scoped"' 'jsonencode(' \
         '"S3Content"' '"S3Premium"' '"S3Head"' '"SqsSend"' '"S3Builds"' '"SqsConsume"' '"Logs"' '"Eni"' \
         '"ec2:CreateNetworkInterface"' '"ec2:DescribeNetworkInterfaces"' '"ec2:DescribeSubnets"' \
         '"ec2:DeleteNetworkInterface"' '"ec2:AssignPrivateIpAddresses"' '"ec2:UnassignPrivateIpAddresses"' \
         '"sqs:ChangeMessageVisibility"' '"sqs:SendMessage"' '"sqs:ReceiveMessage"' '"s3:ListBucket"' \
         '/content/*' '/analytics/*' 'log-group:/aws/lambda/'; do
  grep -Fq -e "$s" "$POL" || fail "policies.tf lacks: $s"
done
[ "$(fcount '"Eni"' "$POL")" = 2 ]     || fail "policies.tf: Sid Eni must appear exactly twice (one per document)"
[ "$(fcount '"S3Head"' "$POL")" = 2 ]  || fail "policies.tf: Sid S3Head must appear exactly twice"
[ "$(fcount '"Logs"' "$POL")" = 2 ]    || fail "policies.tf: Sid Logs must appear exactly twice"
[ "$(fcount 'resource "' "$POL")" = 3 ] || fail "policies.tf: exactly three resources (role + two inline policies)"
grep -Eq 'ssm:|"\*:\*"|Action[[:space:]]*=[[:space:]]*"\*"|aws_iam_policy_document|inline_policy|managed_policy_arns|sts:ExternalId|s3:DeleteObject|rds:|"iam:' "$POL" \
  && fail "policies.tf: forbidden token (ssm/rds/iam/DeleteObject, wildcard action, policy_document data source, in-role policy args, ExternalId)"
grep -Eq 'data[[:space:]]+"|resource[[:space:]]+"aws_iam_policy"|aws_iam_role_policy_attachment' "$POL" \
  && fail "policies.tf: only aws_iam_role + aws_iam_role_policy resources belong here"
# 2b. identity interface — six variables, two outputs, the output ordering hook
for v in worker_role_name content_bucket_name premium_bucket_name publish_queue_name core_vpc_function_name worker_function_name; do
  grep -Eq "^variable \"$v\"" "$IDVARS" || fail "variables.tf lacks variable \"$v\""
done
grep -Eq '^output "worker_role_arn"' "$IDOUT"  || fail "outputs.tf lacks output worker_role_arn"
grep -Eq '^output "worker_role_name"' "$IDOUT" || fail "outputs.tf lacks output worker_role_name"
awk '/^output "worker_role_arn"/{f=1} f{print} f&&/^\}/{exit}' "$IDOUT" | grep -Eq 'depends_on[[:space:]]*=[[:space:]]*\[aws_iam_role_policy\.worker\]' \
  || fail "output worker_role_arn must carry depends_on = [aws_iam_role_policy.worker]"
# 2c. the five managed ARNs vanish from every .tf under infra (attachment maps + import blocks)
bad="$(grep -rn -E 'AmazonEC2FullAccess|AmazonRDSFullAccess|AmazonSQSFullAccess|AmazonS3FullAccess|AWSLambdaSQSQueueExecutionRole' infra --include='*.tf' || true)"
[ -z "$bad" ] || { echo "$bad" >&2; fail "a *FullAccess / SQSQueueExecutionRole ARN is still in infra/**/*.tf"; }
# 2d. root wiring
block identity "$RMAIN" > "$TMP/identity.block"; block worker "$RMAIN" > "$TMP/worker.block"
[ -s "$TMP/identity.block" ] || fail "main.tf: module \"identity\" block not found"
[ -s "$TMP/worker.block" ]   || fail "main.tf: module \"worker\" block not found"
for a in worker_role_name content_bucket_name premium_bucket_name publish_queue_name core_vpc_function_name worker_function_name; do
  grep -Eq "^[[:space:]]*$a[[:space:]]*=" "$TMP/identity.block" || fail "main.tf: module identity lacks argument $a"
done
grep -Eq 'worker_role_name[[:space:]]*=[[:space:]]*"developercards-worker-lambda-role"' "$TMP/identity.block" || fail "main.tf: worker_role_name must be \"developercards-worker-lambda-role\""
grep -Eq 'role_arn[[:space:]]*=[[:space:]]*module\.identity\.worker_role_arn' "$TMP/worker.block" || fail "main.tf: module worker must pass role_arn = module.identity.worker_role_arn"
grep -q 'core_vpc_role_arn' "$TMP/worker.block" && fail "main.tf: module worker still references core_vpc_role_arn"
grep -Eq 'role[[:space:]]*=[[:space:]]*var\.role_arn' "$WFN" || fail "worker/function.tf: aws_lambda_function.worker.role must be var.role_arn"
# 2e. imports.tf — deletions only, exactly the six addresses
added="$(git diff --numstat "$mb" HEAD -- "$IMPORTS" | cut -f1)"
[ "${added:-0}" = 0 ] || fail "imports.tf gained $added line(s); only deletions are allowed"
git show "$mb:$IMPORTS" | grep -E '^[[:space:]]*to[[:space:]]*=' | sed -E 's/^[[:space:]]*to[[:space:]]*=[[:space:]]*//' | sort -u > "$TMP/to.base"
grep -E '^[[:space:]]*to[[:space:]]*=' "$IMPORTS" | sed -E 's/^[[:space:]]*to[[:space:]]*=[[:space:]]*//' | sort -u > "$TMP/to.head"
cat > "$TMP/to.expected_removed" <<'X'
module.identity.aws_iam_role_policy_attachment.core_vpc["ec2_full"]
module.identity.aws_iam_role_policy_attachment.core_vpc["rds_full"]
module.identity.aws_iam_role_policy_attachment.core_vpc["s3_full"]
module.identity.aws_iam_role_policy_attachment.core_vpc["sqs_exec"]
module.identity.aws_iam_role_policy_attachment.core_vpc["sqs_full"]
module.identity.aws_iam_role_policy_attachment.snowflake["s3_full"]
X
comm -23 "$TMP/to.base" "$TMP/to.head" > "$TMP/to.removed"
diff -u "$TMP/to.expected_removed" "$TMP/to.removed" >&2 || fail "imports.tf: the removed import targets are not exactly the six attachments"
[ -z "$(comm -13 "$TMP/to.base" "$TMP/to.head")" ] || fail "imports.tf: a new import target appeared"
[ "$(wc -l < "$TMP/to.head" | tr -d ' ')" = 87 ] || fail "imports.tf must keep exactly 87 import targets (93 - 6)"
git diff --quiet "$mb" HEAD -- "$ISSUES/E01.imports.txt" || fail "E01.imports.txt must stay byte-identical"
# 2f. identity/main.tf — no new resource block
git diff "$mb" HEAD -- "$IDMAIN" | grep '^+' | grep -v '^+++' | grep -Eq '^[+][[:space:]]*resource[[:space:]]+"' \
  && fail "identity/main.tf: new resource blocks belong in policies.tf"
grep -Eq 'aws_iam_role_policy_attachment' "$IDMAIN" || fail "identity/main.tf: the remaining attachments (logs, vpc, read) must still be declared"
# 2g. allow file — parsed equality with the brief's Changes 7
python3 - "$ALLOW" <<'PY' || fail "E05.plan-allow.json differs from the brief's Changes 7"
import json, sys
got = json.load(open(sys.argv[1]))
D = "delete"
want = {"tags_only_updates": False, "changes": {
  "module.identity.aws_iam_role.worker": "create",
  "module.identity.aws_iam_role_policy.core_vpc": "create",
  "module.identity.aws_iam_role_policy.worker": "create",
  'module.identity.aws_iam_role_policy_attachment.core_vpc["ec2_full"]': D,
  'module.identity.aws_iam_role_policy_attachment.core_vpc["rds_full"]': D,
  'module.identity.aws_iam_role_policy_attachment.core_vpc["s3_full"]': D,
  'module.identity.aws_iam_role_policy_attachment.core_vpc["sqs_exec"]': D,
  'module.identity.aws_iam_role_policy_attachment.core_vpc["sqs_full"]': D,
  'module.identity.aws_iam_role_policy_attachment.snowflake["s3_full"]': D,
  "module.worker.aws_lambda_function.worker": {"action": "update", "keys": ["role"]}}}
sys.exit(0 if got == want else 1)
PY
# 2h. README §6 change-log line
awk '/^## 6/{f=1} f{print}' "$README" | grep -q 'E05' || fail "infra/README.md §6 has no E05 line"
# 2i. hygiene over the diff's + lines and the new files
git diff "$mb" HEAD -- infra > "$TMP/infra.diff"
{ grep '^+' "$TMP/infra.diff" | grep -v '^+++'; cat "$POL"; } > "$TMP/added.lines"
grep -Eq 'provisioner|local-exec|null_resource|"external"|archive_file|terraform_remote_state|profile[[:space:]]*=[[:space:]]*"' "$TMP/added.lines" \
  && fail "forbidden Terraform construct in the diff (E00 §0)"
grep -q 'SFCRole=' "$TMP/added.lines" && fail "a Snowflake external-id fragment is in the diff"
grep -Eq "\.skip\(|\.only\(|@ts-ignore|@ts-expect-error|eslint-disable" "$TMP/added.lines" "$POL" "$ALLOW" \
  && fail "test gutting / suppression found"
grep -Eq 'Skip[[:space:]]*=|#pragma warning disable' "$TMP/added.lines" && fail "suppression token in the diff"

# ── 3. Root gates (infra) ──────────────────────────────────────────────────
echo "[3/5] terraform fmt / init -backend=false / validate"
terraform fmt -check -recursive infra >/dev/null || fail "terraform fmt -check -recursive infra"
( cd infra/envs/prod && terraform init -backend=false -input=false >/dev/null && terraform validate >/dev/null && terraform fmt -check -recursive .. >/dev/null ) \
  || fail "infra root gate (init -backend=false / validate / fmt) failed in infra/envs/prod"
git diff --quiet "$mb" HEAD -- "$LOCK" || fail ".terraform.lock.hcl changed"
python3 -c 'import ast,sys; ast.parse(open(sys.argv[1]).read(), sys.argv[1])' "$CHECK" || fail "check-plan.py does not parse"
python3 -c 'import json,sys; json.load(open(sys.argv[1]))' "$ALLOW" || fail "E05.plan-allow.json is not valid JSON"

# ── 4. Plan (local backend override, read-only) → noise filter → check-plan.py → policy docs → simulator ──
echo "[4/5] terraform plan -out (local override, read-only, AWS_PROFILE=$AWS_PROFILE) → check-plan.py → simulate-custom-policy"
aws sts get-caller-identity --query Account --output text > "$TMP/account" 2>/dev/null || fail "AWS credentials unavailable (export AWS_PROFILE=dev)"
[ "$(tr -d '[:space:]' < "$TMP/account")" = "$ACCOUNT" ] || fail "AWS_PROFILE=$AWS_PROFILE is not account $ACCOUNT"
# Variables (the E02/E03/E04 recipe): the real prod.auto.tfvars is gitignored and absent in a worktree.
# Feed the example minus its two sensitive lines; read the live Snowflake sts:ExternalId (iam get-role,
# not a secret per AWS, never printed) and the live budget subscriber e-mail (budgets describe-*,
# read-only, never printed) into TF_VAR_* so the two adopted resources stay no-op in the worker's plan.
VARS="$TMP/e05.tfvars"; : > "$VARS"
[ -f "$PROD/prod.auto.tfvars.example" ] && { grep -Ev 'external_id|alert_email' "$PROD/prod.auto.tfvars.example" > "$VARS" || true; }
EXT_VAR="$(grep -Eo 'variable "[A-Za-z0-9_]*external_id[A-Za-z0-9_]*"' "$PROD/variables.tf" | head -1 | cut -d'"' -f2 || true)"
if [ -n "$EXT_VAR" ] && [ -z "$(printenv "TF_VAR_${EXT_VAR}" 2>/dev/null || true)" ]; then
  EXT_ID="$(aws iam get-role --role-name snowflake-recallsmith-s3-role \
            --query 'Role.AssumeRolePolicyDocument.Statement[0].Condition.StringEquals."sts:ExternalId"' --output text 2>/dev/null || true)"
  [ -n "$EXT_ID" ] && [ "$EXT_ID" != "None" ] || fail "could not read the Snowflake ExternalId from iam get-role"
  export "TF_VAR_${EXT_VAR}=${EXT_ID}"; unset EXT_ID
fi
if grep -Eq '^variable "alert_email"' "$PROD/variables.tf" && [ -z "${TF_VAR_alert_email:-}" ]; then
  NOTIF="$(aws budgets describe-notifications-for-budget --account-id "$ACCOUNT" --budget-name "My Monthly Cost Budget" --query 'Notifications[0]' --output json 2>/dev/null || true)"
  [ -n "$NOTIF" ] && [ "$NOTIF" != null ] || fail "could not read the budget notifications (budgets describe-notifications-for-budget)"
  TF_VAR_alert_email="$(aws budgets describe-subscribers-for-notification --account-id "$ACCOUNT" --budget-name "My Monthly Cost Budget" \
      --notification "$NOTIF" --query 'Subscribers[?SubscriptionType==`EMAIL`].Address | [0]' --output text 2>/dev/null || true)"
  [ -n "$TF_VAR_alert_email" ] && [ "$TF_VAR_alert_email" != None ] || fail "could not read the budget subscriber e-mail; export TF_VAR_alert_email"
  export TF_VAR_alert_email
fi
printf 'terraform {\n  backend "local" {\n    path = "%s/e05.tfstate"\n  }\n}\n' "$TMP" > "$OVR"
( cd "$PROD" && terraform init -input=false -reconfigure -no-color > "$TMP/init.log" 2>&1 ) \
  || { tail -30 "$TMP/init.log" >&2; fail "terraform init with the local backend override failed"; }
( cd "$PROD" && terraform plan -input=false -no-color -var-file="$VARS" -out="$TMP/e05.tfplan" > "$TMP/plan.log" 2>&1 ) \
  || { grep -E '^(Error|│|╷|╵)' "$TMP/plan.log" | head -40 >&2; fail "terraform plan failed"; }
grep -E '^Plan:' "$TMP/plan.log" || fail "plan produced no Plan: line"
( cd "$PROD" && terraform show -json "$TMP/e05.tfplan" > "$TMP/e05.plan.json" ) || fail "terraform show -json failed"
rm -f "$OVR" "$VARS"; unset TF_VAR_alert_email

cat > "$TMP/e05_plan.py" <<'PY'
# Reads the plan JSON; prints ONLY addresses / actions / keys / Sids (never before/after values).
# Worker mode (any `importing` entry — the empty local state of E00 §5): drop the worker-side noise the
# E03/E04 verifies established — (a) `create` entries whose address an earlier issue's allow file lists
# as create (they exist in the account but are not in imports.tf), (b) the provider-side RDS update
# (E00 §2.1.4 keys + E02's backup_retention_period until its maintenance window), (c) `create`
# output_changes for root outputs that already exist at the merge base, (d) an imported resource whose
# `update` changes no attribute and only re-marks a value as sensitive — and, new for E05, (e) use the
# committed allow file minus its `delete` entries, because nothing can be destroyed out of an empty
# state; the six addresses must then be absent from the plan altogether (their config and import blocks
# are gone — steps 2c/2e prove that). Supervisor mode (no `importing`, remote state): no filter, the
# committed allow file verbatim, the six deletes present.
import json, os, re, subprocess, sys
plan_path, allow_path, tmp, issues, mb = sys.argv[1:6]
plan = json.load(open(plan_path)); allow = json.load(open(allow_path))
rcs = plan.get("resource_changes", []) or []
by_addr = {rc["address"]: rc for rc in rcs}
importing = any((rc.get("change") or {}).get("importing") for rc in rcs)
def act(spec): return spec if isinstance(spec, str) else spec["action"]
deletes = sorted(a for a, s in allow["changes"].items() if act(s) == "delete")
RDS = "module.data.aws_db_instance.developercards"
RDS_KEYS = {"apply_immediately", "skip_final_snapshot", "final_snapshot_identifier", "backup_retention_period"}
def diff_keys(ch):
    b, a, u = ch.get("before") or {}, ch.get("after") or {}, ch.get("after_unknown") or {}
    return {k for k in set(b) | set(a) if u.get(k) is not True and b.get(k) != a.get(k)}
effective_allow = allow
if importing:
    noise = set()
    for tag in ("E02", "E03", "E04"):
        prior = json.load(open(os.path.join(issues, tag + ".plan-allow.json")))
        noise |= {a for a, s in prior.get("changes", {}).items() if act(s) == "create"}
    base = subprocess.run(["git", "show", mb + ":infra/envs/prod/outputs.tf"], capture_output=True, text=True).stdout
    base_outputs = set(re.findall(r'output\s+"([^"]+)"', base))
    kept, dropped = [], []
    for rc in rcs:
        ch, addr, acts = rc.get("change") or {}, rc["address"], (rc.get("change") or {}).get("actions") or []
        if acts == ["create"] and addr in noise:
            dropped.append((addr, "create (earlier issue, not in imports.tf)")); continue
        if acts == ["update"] and addr == RDS and diff_keys(ch) <= RDS_KEYS:
            dropped.append((addr, "update (provider-side RDS keys)")); continue
        if acts == ["update"] and ch.get("importing") and not diff_keys(ch) and (ch.get("before_sensitive") != ch.get("after_sensitive")):
            # an adopted resource whose only change is the sensitive marking of a value fed by a
            # `sensitive = true` variable (snowflake trust / budget subscriber): no attribute differs.
            dropped.append((addr, "update (sensitivity marking only, no attribute change)")); continue
        kept.append(rc)
    oc = plan.get("output_changes") or {}
    for name in list(oc):
        if name in base_outputs and oc[name].get("actions") == ["create"]:
            dropped.append(("output." + name, "create (pre-existing root output)")); del oc[name]
    plan["resource_changes"], plan["output_changes"] = kept, oc
    for a in deletes:
        if a in by_addr: sys.exit("worker-mode plan still carries %s (its config or import block survived)" % a)
    effective_allow = {"tags_only_updates": allow.get("tags_only_updates", False),
                       "changes": {a: s for a, s in allow["changes"].items() if act(s) != "delete"}}
    for a, why in dropped: print("  dropped worker-side noise: %s  %s" % (a, why))
    n_imp = sum(1 for rc in rcs if (rc.get("change") or {}).get("importing"))
    print("mode=worker (empty local state; %d imports; %d noise entries dropped; allow file minus %d deletes)" % (n_imp, len(dropped), len(deletes)))
else:
    print("mode=supervisor (remote state; committed allow file verbatim)")
    for a in deletes:
        rc = by_addr.get(a)
        if not rc or rc["change"]["actions"] != ["delete"]: sys.exit("%s is not a delete in the supervisor plan" % a)
json.dump(plan, open(os.path.join(tmp, "e05.filtered.json"), "w"))
json.dump(effective_allow, open(os.path.join(tmp, "allow.effective.json"), "w"), indent=1)
# ---- the three creates + the one update, shape-checked here (values never printed)
def need(addr, actions):
    rc = by_addr.get(addr)
    if not rc: sys.exit(f"{addr} missing from the plan")
    if rc["change"]["actions"] != actions: sys.exit(f"{addr}: actions {rc['change']['actions']} != {actions}")
    print(f"{addr}  {'/'.join(actions)}")
    return rc["change"].get("after") or {}
role = need("module.identity.aws_iam_role.worker", ["create"])
if role.get("name") != "developercards-worker-lambda-role": sys.exit("worker role name is not developercards-worker-lambda-role")
if role.get("path") not in (None, "/"): sys.exit(f"worker role path must be / (got {role.get('path')})")
trust = json.loads(role["assume_role_policy"])
st = trust["Statement"]
if len(st) != 1 or st[0].get("Effect") != "Allow" or st[0].get("Action") != "sts:AssumeRole" \
   or (st[0].get("Principal") or {}).get("Service") != "lambda.amazonaws.com":
    sys.exit("worker role trust policy must be exactly one lambda.amazonaws.com sts:AssumeRole statement")
fn = need("module.worker.aws_lambda_function.worker", ["update"])
rc = by_addr["module.worker.aws_lambda_function.worker"]
before, after, unknown = rc["change"].get("before") or {}, rc["change"].get("after") or {}, rc["change"].get("after_unknown") or {}
# Known-after keys that differ must be role only; keys unknown-after-apply are computed attributes
# (last_modified, …) plus role — check-plan.py owns the authoritative `keys` rule (E00 §3.1).
changed_known = sorted(k for k in after if after[k] != before.get(k))
unknown_keys = sorted(k for k, v in unknown.items() if v is True)
print(f"module.worker.aws_lambda_function.worker  changed(known)={changed_known} unknown-after-apply={unknown_keys}")
if not (set(changed_known) <= {"role"}): sys.exit("worker function update touches more than role")
if not (unknown.get("role") is True or after.get("role") == "arn:aws:iam::622994489535:role/developercards-worker-lambda-role"):
    sys.exit("worker function role is neither unknown-after-apply nor the new role ARN")
if before.get("role") != "arn:aws:iam::622994489535:role/service-role/core-vpc-role-joizyiwt":
    sys.exit("worker function before.role is not the shared core-vpc role (plan not against the live function?)")
# ---- policy documents
Q = "arn:aws:sqs:ap-southeast-2:622994489535:recallsmith-publish-jobs"
C, P = "arn:aws:s3:::core-vpc", "arn:aws:s3:::core-vpc-premium"
LG = "arn:aws:logs:ap-southeast-2:622994489535:log-group:/aws/lambda/"
ENI = {"ec2:CreateNetworkInterface", "ec2:DescribeNetworkInterfaces", "ec2:DescribeSubnets",
       "ec2:DeleteNetworkInterface", "ec2:AssignPrivateIpAddresses", "ec2:UnassignPrivateIpAddresses"}
EXPECT = {
  "core_vpc": {
    "S3Content": ({"s3:GetObject", "s3:PutObject"}, {C + "/content/*", C + "/analytics/*"}),
    "S3Premium": ({"s3:GetObject"}, {P + "/*"}),
    "S3Head":    ({"s3:ListBucket"}, {C, P}),
    "SqsSend":   ({"sqs:SendMessage", "sqs:GetQueueAttributes"}, {Q}),
    "Logs":      ({"logs:CreateLogStream", "logs:PutLogEvents"}, {LG + "core-vpc:*"}),
    "Eni":       (ENI, {"*"}),
  },
  "worker": {
    "S3Builds":   ({"s3:GetObject", "s3:PutObject"}, {C + "/content/*", P + "/*"}),
    "S3Head":     ({"s3:ListBucket"}, {C, P}),
    "SqsConsume": ({"sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes", "sqs:ChangeMessageVisibility"}, {Q}),
    "Logs":       ({"logs:CreateLogStream", "logs:PutLogEvents"}, {LG + "worker-lambda:*"}),
    "Eni":        (ENI, {"*"}),
  },
}
def aslist(x): return [x] if isinstance(x, str) else list(x or [])
POLICY_NAMES = {"core_vpc": "developercards-core-vpc-scoped", "worker": "developercards-worker-lambda-scoped"}
for name, sids in EXPECT.items():
    addr = f"module.identity.aws_iam_role_policy.{name}"
    after = need(addr, ["create"])
    if after.get("name") != POLICY_NAMES[name]: sys.exit(f"{addr}: name must be {POLICY_NAMES[name]}")
    if not isinstance(after.get("policy"), str): sys.exit(f"{addr}: policy is not fully known at plan time (build it from var.* only)")
    doc = json.loads(after["policy"])
    if doc.get("Version") != "2012-10-17": sys.exit(f"{addr}: Version")
    got = {}
    for s in doc["Statement"]:
        if s.get("Effect") != "Allow": sys.exit(f"{addr}: non-Allow statement {s.get('Sid')}")
        if "Condition" in s or "NotAction" in s or "NotResource" in s: sys.exit(f"{addr}: Condition/NotAction/NotResource not allowed")
        acts, res = set(aslist(s.get("Action"))), set(aslist(s.get("Resource")))
        for a in acts:
            if a == "*" or a.endswith(":*"): sys.exit(f"{addr}: wildcard action {a} in {s.get('Sid')}")
        if "*" in res and s.get("Sid") != "Eni": sys.exit(f"{addr}: Resource * outside Eni ({s.get('Sid')})")
        got[s.get("Sid")] = (acts, res)
    if set(got) != set(sids): sys.exit(f"{addr}: Sids {sorted(got)} != {sorted(sids)}")
    for sid, (acts, res) in sids.items():
        if got[sid][0] != acts: sys.exit(f"{addr}/{sid}: actions {sorted(got[sid][0])} != {sorted(acts)}")
        if got[sid][1] != res:  sys.exit(f"{addr}/{sid}: resources differ from the brief")
    print(f"{addr}  Sids={sorted(got)}")
    json.dump(doc, open(os.path.join(tmp, f"{name}.policy.json"), "w"))
print("PLAN SHAPE OK")
PY
python3 "$TMP/e05_plan.py" "$TMP/e05.plan.json" "$ALLOW" "$TMP" "$ISSUES" "$mb" || fail "plan shape / policy document check failed"
python3 "$CHECK" --plan "$TMP/e05.filtered.json" --allow "$TMP/allow.effective.json" | tee "$TMP/check.log" || fail "check-plan.py rejected the plan"
grep -q '^PLAN OK' "$TMP/check.log" || fail "check-plan.py did not print PLAN OK"
rm -f "$TMP/e05.tfplan" "$TMP/e05.plan.json" "$TMP/e05.filtered.json" "$TMP/plan.log" "$TMP/init.log" "$TMP"/e05.tfstate* "$PROD/.terraform/terraform.tfstate"
[ ! -e "$OVR" ] || fail "backend override file not removed"

# 4b. simulator matrix (E00 §3.2 + the brief's Context #4): one resource per call, documents from the plan
sim() { # doc action resource expected
  local got
  got="$(aws iam simulate-custom-policy --policy-input-list "$(cat "$TMP/$1.policy.json")" \
          --action-names "$2" --resource-arns "$3" --query 'EvaluationResults[0].EvalDecision' --output text 2>/dev/null || echo ERROR)"
  [ "$got" = "$4" ] || fail "simulate-custom-policy: $1 $2 on $3 -> $got (expected $4)"
  echo "  ok $1 $2 $3 -> $got"
}
sim core_vpc s3:PutObject  arn:aws:s3:::core-vpc/content/x allowed
sim core_vpc s3:GetObject  arn:aws:s3:::core-vpc/content/manifest.json allowed
sim core_vpc s3:PutObject  arn:aws:s3:::core-vpc/analytics/raw/review_events/x allowed
sim core_vpc s3:GetObject  arn:aws:s3:::core-vpc/analytics/marts/content_intelligence/card_snapshot_30d/latest.json.gz allowed
sim core_vpc s3:GetObject  arn:aws:s3:::core-vpc-premium/premium/decks/x/builds/y/deck.json allowed
sim core_vpc s3:ListBucket arn:aws:s3:::core-vpc allowed
sim core_vpc s3:ListBucket arn:aws:s3:::core-vpc-premium allowed
sim core_vpc sqs:SendMessage       "$QUEUE_ARN" allowed
sim core_vpc sqs:GetQueueAttributes "$QUEUE_ARN" allowed
sim core_vpc logs:PutLogEvents "$LOG_PREFIX/core-vpc:*" allowed
sim core_vpc ec2:CreateNetworkInterface '*' allowed
sim core_vpc s3:PutObject    arn:aws:s3:::core-vpc-premium/x implicitDeny
sim core_vpc s3:PutObject    arn:aws:s3:::core-vpc/other/x implicitDeny
sim core_vpc s3:DeleteObject arn:aws:s3:::core-vpc/content/x implicitDeny
sim core_vpc s3:DeleteBucket       '*' implicitDeny
sim core_vpc rds:DeleteDBInstance  '*' implicitDeny
sim core_vpc ec2:TerminateInstances '*' implicitDeny
sim core_vpc sqs:DeleteQueue       '*' implicitDeny
sim core_vpc iam:PassRole          '*' implicitDeny
sim core_vpc sqs:ReceiveMessage    '*' implicitDeny
sim core_vpc sqs:ReceiveMessage    "$QUEUE_ARN" implicitDeny
sim core_vpc ssm:GetParameter      '*' implicitDeny
sim core_vpc logs:PutLogEvents "$LOG_PREFIX/worker-lambda:*" implicitDeny
sim worker sqs:ReceiveMessage          "$QUEUE_ARN" allowed
sim worker sqs:DeleteMessage           "$QUEUE_ARN" allowed
sim worker sqs:GetQueueAttributes      "$QUEUE_ARN" allowed
sim worker sqs:ChangeMessageVisibility "$QUEUE_ARN" allowed
sim worker s3:PutObject  arn:aws:s3:::core-vpc-premium/x allowed
sim worker s3:PutObject  arn:aws:s3:::core-vpc/content/decks/x/builds/y/deck.json allowed
sim worker s3:GetObject  arn:aws:s3:::core-vpc/content/manifest.json allowed
sim worker s3:ListBucket arn:aws:s3:::core-vpc allowed
sim worker logs:PutLogEvents "$LOG_PREFIX/worker-lambda:*" allowed
sim worker ec2:CreateNetworkInterface '*' allowed
sim worker sqs:SendMessage '*' implicitDeny
sim worker sqs:SendMessage "$QUEUE_ARN" implicitDeny
sim worker s3:PutObject arn:aws:s3:::core-vpc/analytics/x implicitDeny
sim worker s3:DeleteBucket        '*' implicitDeny
sim worker rds:DeleteDBInstance   '*' implicitDeny
sim worker ec2:TerminateInstances '*' implicitDeny
sim worker sqs:DeleteQueue        '*' implicitDeny
sim worker iam:PassRole           '*' implicitDeny
sim worker ssm:GetParameter       '*' implicitDeny
sim worker logs:PutLogEvents "$LOG_PREFIX/core-vpc:*" implicitDeny
rm -f "$TMP"/*.policy.json

# ── 5. Scope + frozen + OTA + secret/apply guards (purely negative) ────────
echo "[5/5] scope + frozen + OTA + secret/apply guards"
frozen="$(git diff --numstat "$mb" HEAD -- mobile/src/content/deckRepository.ts mobile/src/sync/progressSync.ts mobile/src/review/model.ts \
  mobile/package.json mobile/package-lock.json mobile/app.json mobile/eas.json mobile/src mobile/tests \
  src_C frontend snowflake scripts .github site \
  infra/envs/prod/versions.tf infra/envs/prod/providers.tf infra/envs/prod/backend.tf infra/envs/prod/variables.tf infra/envs/prod/outputs.tf \
  infra/modules/data infra/modules/edge infra/modules/api infra/modules/observability infra/modules/identity/cognito.tf infra/scripts \
  "$ISSUES/E01.imports.txt" "$ISSUES/E01.plan-allow.json" "$ISSUES/E02.plan-allow.json" "$ISSUES/E03.plan-allow.json" "$ISSUES/E04.plan-allow.json" \
  ':(glob)docs/*.md')"
[ -z "$frozen" ] || { echo "$frozen" >&2; fail "frozen/out-of-scope file modified"; }
grep -Fq '"version": "1.6.1"' mobile/app.json || fail "mobile/app.json version drifted from 1.6.1"
grep -rq "@sentry" mobile/src && fail "@sentry under mobile/src (next binary, not this wave)"
# Untracked scan is pathspec-scoped, never bare (the driver symlinks node_modules into the worktree).
outside="$( { git diff --name-only "$mb" HEAD; git ls-files --others --exclude-standard -- infra docs | grep -Ev '(^|/)(\.terraform|__pycache__)/'; } | sort -u \
  | grep -Ev '^(infra/modules/identity/policies\.tf|infra/modules/identity/variables\.tf|infra/modules/identity/outputs\.tf|infra/modules/identity/main\.tf|infra/envs/prod/main\.tf|infra/envs/prod/imports\.tf|infra/modules/worker/function\.tf|infra/README\.md|docs/delivery/r16-issues/.*)$' || true )"
[ -z "$outside" ] || { echo "$outside" >&2; fail "files changed outside E05 scope"; }
# secret-leak guard over + lines and new files (a name may appear; a literal value may not)
grep -Eq '(PGPASSWORD|MIGRATE_SECRET|INTERNAL_SHARED_SECRET|RC_WEBHOOK_AUTH_(PRODUCTION|DEVELOPMENT)|ANALYTICS_USER_SALT)[[:space:]]*[=:][[:space:]]*"[^"$P]' "$TMP/added.lines" \
  && fail "a secret literal is in the diff"
tracked_junk="$(git ls-files infra | grep -E '\.(tfplan|plan\.json)$|generated.*\.tf$|_override\.tf$|[^e]\.auto\.tfvars$|(^|/)\.terraform/' || true)"
[ -z "$tracked_junk" ] || { echo "$tracked_junk" >&2; fail "plan artefacts / tfvars tracked under infra"; }
prof="$(grep -rn 'profile *= *"' infra --include='*.tf' || true)"
[ -z "$prof" ] || { echo "$prof" >&2; fail "provider profile hard-coded"; }
# apply guard: no non-comment line of a worker-reachable script performs a state change
applyish="$( { [ -d infra/scripts ] && find infra/scripts -type f; [ -d src_C/scripts ] && find src_C/scripts -type f; [ -d scripts ] && find scripts -type f; echo "$ISSUES/E05.verify.sh"; } 2>/dev/null \
  | xargs grep -HnE 'terraform +(apply|import)|aws +[a-z0-9-]+ +(create|update|delete|put)-' 2>/dev/null \
  | grep -Ev ':[0-9]+:[[:space:]]*#' | grep -Ev 'DRY_RUN|echo |DRY:|^(src_C/scripts/|scripts/)(rds-snapshot|deploy|invoke-as-admin|smoke|rollback)\.sh' | grep -Ev '^infra/scripts/rds-snapshot\.sh' || true )"
[ -z "$applyish" ] || { echo "$applyish" >&2; fail "state-changing command outside a DRY_RUN/echo context or a supervisor-only script"; }

echo "E05 VERIFY OK"
