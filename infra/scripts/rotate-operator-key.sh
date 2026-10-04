#!/usr/bin/env bash
# rotate-operator-key.sh — rotate the static access key of IAM user devcards-admin (profile `dev`, RUNBOOK §10)
# without the secret ever being printed, copied or passed on a command line.
#
#   infra/scripts/rotate-operator-key.sh                     # create a new key, write it to [dev], verify, deactivate the old one
#   infra/scripts/rotate-operator-key.sh --delete-inactive   # a week later: delete the deactivated key
#
# Every IAM call goes through the MFA admin role (profile devcards-admin), so run it in your own terminal: the CLI asks
# for the 6-digit code once. The new secret goes from the create-access-key response straight into the credentials file
# inside one python process (file mode 600); a timestamped backup of the previous file is kept next to it and should be
# deleted once the new key is confirmed. Only key ids are printed, masked.
set -euo pipefail
USER_NAME=devcards-admin
CREDS="${AWS_SHARED_CREDENTIALS_FILE:-$HOME/.aws/credentials}"
export AWS_REGION="${AWS_REGION:-ap-southeast-2}" AWS_PAGER=""
unset AWS_PROFILE AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN

admin() { aws --profile devcards-admin "$@"; }
mask() { local s="$1"; echo "${s:0:4}…${s: -4}"; }
say() { echo "[$(date +%H:%M:%S)] $*"; }

say "admin session: $(admin sts get-caller-identity --query Arn --output text)"
keys="$(admin iam list-access-keys --user-name "$USER_NAME" --query 'AccessKeyMetadata[].[AccessKeyId,Status,CreateDate]' --output text)"
current="$(aws configure get aws_access_key_id --profile dev)"

if [ "${1:-}" = "--delete-inactive" ]; then
  n=0
  while read -r id status created; do
    [ -n "$id" ] || continue
    if [ "$status" = Inactive ] && [ "$id" != "$current" ]; then
      last="$(admin iam get-access-key-last-used --access-key-id "$id" --query 'AccessKeyLastUsed.LastUsedDate' --output text)"
      say "deleting inactive key $(mask "$id") (created ${created%%T*}, last used ${last%%T*})"
      admin iam delete-access-key --user-name "$USER_NAME" --access-key-id "$id"
      n=$((n + 1))
    fi
  done <<<"$keys"
  say "deleted $n inactive key(s)"; exit 0
fi

count="$(grep -c . <<<"$keys" || true)"
[ "$count" -lt 2 ] || { echo "user already has 2 keys; run --delete-inactive first (or deactivate one)" >&2; exit 1; }
grep -q "^$current" <<<"$keys" || { echo "the [dev] key is not one of $USER_NAME's keys; stopping" >&2; exit 1; }

say "creating a new key for $USER_NAME (old: $(mask "$current"))"
backup="$CREDS.bak-$(date +%Y%m%d-%H%M%S)"
cp -p "$CREDS" "$backup" && chmod 600 "$backup"
# The response is piped, never echoed: python writes the two values into [dev] and prints only the new key id.
new_id="$(admin iam create-access-key --user-name "$USER_NAME" --output json | python3 -c '
import configparser, json, os, sys
key = json.load(sys.stdin)["AccessKey"]
path = sys.argv[1]
cfg = configparser.RawConfigParser()
cfg.read(path)
if not cfg.has_section("dev"):
    cfg.add_section("dev")
cfg.set("dev", "aws_access_key_id", key["AccessKeyId"])
cfg.set("dev", "aws_secret_access_key", key["SecretAccessKey"])
tmp = path + ".tmp"
with open(os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), "w") as fh:
    cfg.write(fh)
os.replace(tmp, path)
print(key["AccessKeyId"])
' "$CREDS")"
say "new key $(mask "$new_id") written to [dev] (backup: $backup)"

say "waiting for the new key to work (IAM is eventually consistent)"
ok=0
for _ in $(seq 1 12); do
  if arn="$(aws sts get-caller-identity --profile dev --query Arn --output text 2>/dev/null)"; then ok=1; break; fi
  sleep 5
done
if [ "$ok" != 1 ]; then
  echo "the new key does not authenticate yet; the old key is still ACTIVE. Restore with: cp -p '$backup' '$CREDS'" >&2
  exit 1
fi
say "new key works: $arn"
if aws sts get-caller-identity --profile devcards-ro --query Arn --output text </dev/null >/dev/null 2>&1; then
  say "ok devcards-ro assumes with the new key"
else
  echo "devcards-ro does not assume with the new key; the old key is still ACTIVE. Check, or restore: cp -p '$backup' '$CREDS'" >&2
  exit 1
fi

admin iam update-access-key --user-name "$USER_NAME" --access-key-id "$current" --status Inactive
say "old key $(mask "$current") deactivated (delete it after a quiet week: $0 --delete-inactive)"
say "done. Delete the backup once you are happy: rm '$backup'"
