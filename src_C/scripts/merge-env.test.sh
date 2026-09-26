#!/usr/bin/env bash
# merge-env.test.sh — unit tests for the pure-jq env overlay library. No aws, no
# network. Fixture values for secret-named keys start with PLACEHOLDER- (E00 §5).
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=merge-env.sh
source "$HERE/merge-env.sh"

fail() { echo "merge-env test FAIL: $*" >&2; exit 1; }

# (a) file overrides current, unrelated current keys survive.
test_merge_file_over_current() {
  local out
  out="$(merge_env '{"FOO_KEEP":"x","LOG_LEVEL":"debug"}' '{"LOG_LEVEL":"info"}' '{}')"
  jq -e '.FOO_KEEP == "x"'      <<<"$out" >/dev/null || fail "(a) FOO_KEEP dropped"
  jq -e '.LOG_LEVEL == "info"'  <<<"$out" >/dev/null || fail "(a) file did not override current"
}

# (b) secret overrides file.
test_merge_secret_over_file() {
  local out
  out="$(merge_env '{}' '{"PGPASSWORD":"PLACEHOLDER-file"}' '{"PGPASSWORD":"PLACEHOLDER-secret"}')"
  jq -e '.PGPASSWORD == "PLACEHOLDER-secret"' <<<"$out" >/dev/null || fail "(b) secret did not override file"
}

# (c) all six leaf names map to the six env names and nothing else.
test_ssm_to_env_all_six() {
  local fixture out
  fixture='{"Parameters":[
    {"Name":"/developercards/prod/pg-password","Value":"PLACEHOLDER-1"},
    {"Name":"/developercards/prod/migrate-secret","Value":"PLACEHOLDER-2"},
    {"Name":"/developercards/prod/internal-shared-secret","Value":"PLACEHOLDER-3"},
    {"Name":"/developercards/prod/rc-webhook-auth-production","Value":"PLACEHOLDER-4"},
    {"Name":"/developercards/prod/rc-webhook-auth-development","Value":"PLACEHOLDER-5"},
    {"Name":"/developercards/prod/analytics-salt","Value":"PLACEHOLDER-6"}
  ]}'
  out="$(ssm_to_env "$fixture")"
  jq -e '
    (keys | sort) == ["ANALYTICS_USER_SALT","INTERNAL_SHARED_SECRET","MIGRATE_SECRET","PGPASSWORD","RC_WEBHOOK_AUTH_DEVELOPMENT","RC_WEBHOOK_AUTH_PRODUCTION"]
    and .PGPASSWORD == "PLACEHOLDER-1"
  ' <<<"$out" >/dev/null || fail "(c) six leaf names did not map cleanly"
}

# (d) an unmapped leaf name is a hard error.
test_ssm_to_env_unmapped() {
  local fixture err
  fixture='{"Parameters":[{"Name":"/developercards/prod/stray-name","Value":"PLACEHOLDER-x"}]}'
  if err="$(ssm_to_env "$fixture" 2>&1)"; then
    fail "(d) ssm_to_env accepted stray-name"
  fi
  grep -Fq 'unmapped SSM parameter' <<<"$err" || fail "(d) missing 'unmapped SSM parameter' message"
}

# (e) pick_keys keeps only the requested keys.
test_pick_keys() {
  local out
  out="$(pick_keys '{"PGUSER":"a","PGHOST":"h","PG_MAX":"1"}' "$WORKER_FILE_KEYS")"
  jq -e '. == {"PGUSER":"a","PG_MAX":"1"}' <<<"$out" >/dev/null || fail "(e) pick_keys picked the wrong set"
}

# (f) merge_env with a null current (a function that has no variables yet).
test_merge_null_current() {
  local out
  out="$(merge_env 'null' '{"LOG_LEVEL":"info"}' '{}')"
  jq -e '.LOG_LEVEL == "info"' <<<"$out" >/dev/null || fail "(f) null current broke merge_env"
}

test_merge_file_over_current
test_merge_secret_over_file
test_ssm_to_env_all_six
test_ssm_to_env_unmapped
test_pick_keys
test_merge_null_current

echo "merge-env tests OK"
