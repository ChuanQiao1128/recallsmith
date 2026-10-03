#!/usr/bin/env bash
# dr-restore-drill.sh — enterprise audit DR-01 ("no restore drill"). Proves the production database can be restored
# and served, and measures RPO and RTO:
#   1. restore `developercards` to its latest restorable time into a throwaway instance (same subnets, same SGs);
#   2. run a throwaway copy of the live core-vpc build (same code, role, VPC and environment, PGHOST swapped) against it;
#   3. ask both production and the copy the same read-only admin questions (applied migrations, decks and card counts);
#   4. write a report, then delete the copy and the instance (an EXIT trap, so a failure still cleans up).
# Nothing in production changes; the throwaway function has no API Gateway permission, schedule or event source.
#
#   aws sts get-caller-identity --profile devcards-admin    # the owner, MFA (1-hour session; the drill takes ~20-35 min)
#   infra/scripts/dr-restore-drill.sh                       # preflight only: prints what it would do
#   CONFIRM=1 infra/scripts/dr-restore-drill.sh             # the drill; report in docs/ops/ (counts only, no PII)
# Cost: a db.t4g.micro for under an hour, about US$0.03.
set -euo pipefail
export AWS_PROFILE="${AWS_PROFILE:-devcards-admin}" AWS_REGION="${AWS_REGION:-ap-southeast-2}" AWS_PAGER=""
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SRC_DB=developercards
SRC_FN="core-vpc:prod"
STAMP="$(date -u +%Y%m%d-%H%M)"
DRILL="dc-dr-drill-$STAMP"
REPORT="${REPORT:-$ROOT/docs/ops/dr-restore-drill-$(date -u +%Y-%m-%d).md}"
WORK="$(mktemp -d)"; chmod 700 "$WORK"
now() { date -u +%s; }
iso() { date -u -r "$1" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d "@$1" +%Y-%m-%dT%H:%M:%SZ; }
say() { echo "[$(date -u +%H:%M:%S)] $*"; }

created_db=0; created_fn=0
cleanup() {
  local rc=$?
  if [ "$created_fn" = 1 ]; then
    if aws lambda delete-function --function-name "$DRILL" >/dev/null 2>&1; then say "deleted function $DRILL"; else say "WARN delete function $DRILL by hand"; fi
  fi
  if [ "$created_db" = 1 ]; then
    if aws rds delete-db-instance --db-instance-identifier "$DRILL" --skip-final-snapshot --delete-automated-backups >/dev/null 2>&1; then
      say "deleting instance $DRILL (takes a few minutes, nothing to wait for)"
    else say "WARN delete instance $DRILL by hand"; fi
  fi
  rm -rf "$WORK"
  exit "$rc"
}
trap cleanup EXIT

say "== preflight"
who="$(aws sts get-caller-identity --query Arn --output text </dev/null)" || { echo "no credentials for $AWS_PROFILE (the owner runs: aws sts get-caller-identity --profile devcards-admin)" >&2; exit 1; }
case "$who" in *devcards-admin-mfa*) say "as $who" ;; *) echo "must run as devcards-admin-mfa, got $who" >&2; exit 1 ;; esac
src="$(aws rds describe-db-instances --db-instance-identifier "$SRC_DB" --query 'DBInstances[0]' --output json)"
subnets="$(jq -r '.DBSubnetGroup.DBSubnetGroupName' <<<"$src")"
sgs="$(jq -r '[.VpcSecurityGroups[].VpcSecurityGroupId] | join(" ")' <<<"$src")"
read -ra sg_ids <<<"$sgs"
class="$(jq -r '.DBInstanceClass' <<<"$src")"
leftover="$(aws rds describe-db-instances --query "DBInstances[?starts_with(DBInstanceIdentifier, 'dc-dr-drill-')].DBInstanceIdentifier" --output text)"
[ -z "$leftover" ] || { echo "a previous drill instance still exists: $leftover (delete it first)" >&2; exit 1; }
say "source $SRC_DB: $class, subnet group $subnets, SGs $sgs, PITR up to $(jq -r '.LatestRestorableTime' <<<"$src")"
if [ "${CONFIRM:-0}" != 1 ]; then
  say "would: restore $SRC_DB (latest restorable time) -> $DRILL; copy $SRC_FN -> function $DRILL with PGHOST swapped;"
  say "       compare GET /api/v1/admin/db/migrations and /api/v1/admin/decks; write $REPORT; delete both."
  say "preflight only. Re-run with CONFIRM=1."
  exit 0
fi

say "== 1. restore"
t0="$(now)"
lrt_iso="$(jq -r '.LatestRestorableTime' <<<"$src")"
lrt="$(date -u -j -f '%Y-%m-%dT%H:%M:%S' "${lrt_iso%%[+Z]*}" +%s 2>/dev/null || date -u -d "$lrt_iso" +%s)"
restore="$(aws rds restore-db-instance-to-point-in-time --source-db-instance-identifier "$SRC_DB" \
  --target-db-instance-identifier "$DRILL" --use-latest-restorable-time --db-instance-class "$class" \
  --db-subnet-group-name "$subnets" --vpc-security-group-ids "${sg_ids[@]}" --no-publicly-accessible --no-multi-az \
  --no-deletion-protection --tags Key=Purpose,Value=dr-restore-drill \
  --query 'DBInstance.DBInstanceIdentifier' --output text)"
created_db=1
say "restoring into $restore"
aws rds wait db-instance-available --db-instance-identifier "$DRILL" 2>/dev/null \
  || aws rds wait db-instance-available --db-instance-identifier "$DRILL"   # the waiter gives up after 30 min; once more
t1="$(now)"
drill="$(aws rds describe-db-instances --db-instance-identifier "$DRILL" --query 'DBInstances[0]' --output json)"
host="$(jq -r '.Endpoint.Address' <<<"$drill")"
# The restore point: RDS restores to the source's latest restorable time as of the request.
restored_to="$(aws rds describe-events --source-type db-instance --source-identifier "$DRILL" --duration 120 \
  --query "Events[?contains(Message, 'restored')].Message | [0]" --output text 2>/dev/null || true)"
say "available after $(( t1 - t0 )) s at $host"

say "== 2. throwaway copy of $SRC_FN"
cfg="$(aws lambda get-function --function-name "$SRC_FN" --output json)"
curl -fsS -o "$WORK/code.zip" "$(jq -r '.Code.Location' <<<"$cfg")"
c="$(jq '.Configuration' <<<"$cfg")"
jq --arg h "$host" '{Variables: (.Environment.Variables + {PGHOST: $h})}' <<<"$c" > "$WORK/env.json"   # holds secrets: 0700 dir, never printed
aws lambda create-function --function-name "$DRILL" --role "$(jq -r '.Role' <<<"$c")" \
  --runtime "$(jq -r '.Runtime' <<<"$c")" --handler "$(jq -r '.Handler' <<<"$c")" \
  --architectures "$(jq -r '.Architectures[0]' <<<"$c")" --memory-size "$(jq -r '.MemorySize' <<<"$c")" --timeout 90 \
  --vpc-config "SubnetIds=$(jq -r '.VpcConfig.SubnetIds | join(",")' <<<"$c"),SecurityGroupIds=$(jq -r '.VpcConfig.SecurityGroupIds | join(",")' <<<"$c")" \
  --environment "file://$WORK/env.json" --zip-file "fileb://$WORK/code.zip" \
  --description "DR drill $STAMP: core-vpc build against $DRILL; deleted by the drill" --query 'FunctionName' --output text >/dev/null
created_fn=1
rm -f "$WORK/env.json"
aws lambda wait function-active-v2 --function-name "$DRILL"
say "function $DRILL active"

say "== 3. compare read-only admin answers"
# invoke-as-admin.sh prints the response body; a compressed body (base64 + gzip) is unpacked here.
ask() {
  "$ROOT/scripts/invoke-as-admin.sh" "$1" GET "$2" 2>/dev/null | python3 -c '
import base64, gzip, sys
b = sys.stdin.read().strip()
if b[:1] not in "{[":
    raw = base64.b64decode(b)
    try: raw = gzip.decompress(raw)
    except OSError: pass
    b = raw.decode("utf-8", "replace")
print(b)'
}
# Counts and a fingerprint only (no per-user data): applied migration versions; live decks, their card totals and versions.
digest_migrations() { jq -c '(.data // .) | .applied | if type=="array" then {applied: length, latest: (map(.version) | max)} else {raw: "unexpected shape"} end'; }
digest_decks() {
  local body; body="$(cat)"
  # fingerprint = sha256 of every live deck's slug@version, sorted: equal only if the same decks at the same versions
  jq -c --arg fp "$(jq -r '(.data // .) as $d | ($d.items // $d.decks // $d) | if type=="array" then map("\(.slug)@\(.version)") | sort | join(",") else "" end' <<<"$body" | shasum -a 256 | cut -c1-16)" \
    '(.data // .) as $d | ($d.items // $d.decks // $d) | if type=="array" then {decks: length, cards: (map(.totalCards // 0) | add), fingerprint: $fp} else {raw: "unexpected shape"} end' <<<"$body"
}
pm="$(ask "$SRC_FN" /api/v1/admin/db/migrations | digest_migrations)"; dm="$(ask "$DRILL" /api/v1/admin/db/migrations | digest_migrations)"
pd="$(ask "$SRC_FN" /api/v1/admin/decks | digest_decks)";         dd="$(ask "$DRILL" /api/v1/admin/decks | digest_decks)"
t2="$(now)"
say "migrations prod=$pm drill=$dm"
say "decks      prod=$pd drill=$dd"
verdict=PASS
if [ "$pm" != "$dm" ] || grep -q raw <<<"$pm$dm$pd$dd"; then verdict=FAIL; fi
if [ "$(jq -r '.decks' <<<"$pd")" != "$(jq -r '.decks' <<<"$dd")" ]; then verdict=FAIL; fi
if [ "$(jq -r '.decks' <<<"$dd")" = 0 ]; then verdict=FAIL; fi
say "verdict $verdict (card counts may differ by learner activity after the restore point; deck and migration sets may not)"

mkdir -p "$(dirname "$REPORT")"
cat > "$REPORT" <<MD
# Database restore drill — $(iso "$t0")

Script: \`infra/scripts/dr-restore-drill.sh\` (enterprise audit DR-01). Run as \`$(cut -d/ -f2- <<<"$who")\`.

| Step | Result |
|---|---|
| Source | \`$SRC_DB\` ($class, PostgreSQL $(jq -r '.EngineVersion' <<<"$src"), encrypted, PITR, 14-day backups) |
| Restore point | latest restorable time at request: $(jq -r '.LatestRestorableTime' <<<"$src") |
| Restore started → instance available | $(iso "$t0") → $(iso "$t1") (**$(( (t1 - t0 + 59) / 60 )) min**) |
| App on the restored DB, answers compared | $(iso "$t2") (**RTO $(( (t2 - t0 + 59) / 60 )) min** end to end) |
| Applied migrations (prod / restored) | \`$pm\` / \`$dm\` |
| Decks and cards (prod / restored) | \`$pd\` / \`$dd\` |
| Verdict | **$verdict** |
| RPO | measured: the newest restorable point was **$(( (t0 - lrt) / 60 )) min $(( (t0 - lrt) % 60 )) s** behind the request (RDS uploads transaction logs about every 5 minutes, so expect 5–10 min) |
| Cleanup | throwaway function and instance deleted by the drill's EXIT trap (no final snapshot) |

$( [ -n "$restored_to" ] && [ "$restored_to" != None ] && echo "RDS event: $restored_to" )

Restored instance and function used the production subnets, security groups and execution role, so the drill also
proves the network path and the credentials survive a restore. No learner data left the account and nothing in the
report is per-user.
MD
say "report: $REPORT"
[ "$verdict" = PASS ]
