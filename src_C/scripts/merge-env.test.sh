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

# (g) SSM_NOT_ENV leaves are skipped: they never become env vars.
test_ssm_to_env_skips_not_env_leaves() {
  local fixture out
  fixture='{"Parameters":[
    {"Name":"/developercards/prod/pg-password","Value":"PLACEHOLDER-1"},
    {"Name":"/developercards/prod/webhook-signing-secret","Value":"PLACEHOLDER-2"},
    {"Name":"/developercards/prod/anthropic-api-key","Value":"PLACEHOLDER-3"}
  ]}'
  out="$(ssm_to_env "$fixture")"
  jq -e '. == {"PGPASSWORD":"PLACEHOLDER-1"}' <<<"$out" >/dev/null || fail "(g) skipped leaves leaked into the env"
  if grep -Fq 'PLACEHOLDER-2' <<<"$out" || grep -Fq 'PLACEHOLDER-3' <<<"$out"; then
    fail "(g) a skipped value appears in the output"
  fi
}

# (h) an unmapped leaf beside a skipped one is still a hard error.
test_ssm_to_env_unmapped_beside_skipped() {
  local fixture err
  fixture='{"Parameters":[
    {"Name":"/developercards/prod/webhook-signing-secret","Value":"PLACEHOLDER-2"},
    {"Name":"/developercards/prod/stray-name","Value":"PLACEHOLDER-x"}
  ]}'
  if err="$(ssm_to_env "$fixture" 2>&1)"; then
    fail "(h) ssm_to_env accepted stray-name beside a skipped leaf"
  fi
  grep -Fq 'unmapped SSM parameter' <<<"$err" || fail "(h) missing 'unmapped SSM parameter' message"
}

# (i) the worker projection carries the webhook events queue URL.
test_worker_file_keys_webhook_queue() {
  local out
  out="$(pick_keys '{"PGUSER":"a","WEBHOOK_EVENTS_QUEUE_URL":"u","API_ENV":"production"}' "$WORKER_FILE_KEYS")"
  jq -e '. == {"PGUSER":"a","WEBHOOK_EVENTS_QUEUE_URL":"u"}' <<<"$out" >/dev/null || fail "(i) worker projection lacks WEBHOOK_EVENTS_QUEUE_URL"
}

# (j) during a signing-secret rotation the path also holds webhook-signing-secret-previous: the three
#     Python-only leaves produce no env key and no error beside the mapped ones.
test_ssm_to_env_rotation_leaf() {
  local fixture out
  fixture='{"Parameters":[
    {"Name":"/developercards/prod/internal-shared-secret","Value":"PLACEHOLDER-1"},
    {"Name":"/developercards/prod/webhook-signing-secret","Value":"PLACEHOLDER-2"},
    {"Name":"/developercards/prod/webhook-signing-secret-previous","Value":"PLACEHOLDER-3"},
    {"Name":"/developercards/prod/anthropic-api-key","Value":"PLACEHOLDER-4"}
  ]}'
  out="$(ssm_to_env "$fixture")" || fail "(j) ssm_to_env failed on the rotation leaf"
  jq -e '. == {"INTERNAL_SHARED_SECRET":"PLACEHOLDER-1"}' <<<"$out" >/dev/null || fail "(j) a Python-only leaf leaked into the env"
}

# (k) every leaf a README runbook tells the owner to create under /developercards/<env> (Z01
#     cloud-security-resilience-15): the Python-only rotation and per-subscription leaves are skipped by
#     pattern, and the internal-secret leaves map to the env keys core-vpc verifies with.
test_ssm_to_env_runbook_leaves() {
  local fixture out
  fixture='{"Parameters":[
    {"Name":"/developercards/prod/internal-shared-secret","Value":"PLACEHOLDER-1"},
    {"Name":"/developercards/prod/internal-shared-secret-previous","Value":"PLACEHOLDER-2"},
    {"Name":"/developercards/prod/ai-qa-results-secret","Value":"PLACEHOLDER-3"},
    {"Name":"/developercards/prod/ai-qa-results-secret-previous","Value":"PLACEHOLDER-4"},
    {"Name":"/developercards/prod/webhook-report-secret","Value":"PLACEHOLDER-5"},
    {"Name":"/developercards/prod/webhook-report-secret-previous","Value":"PLACEHOLDER-6"},
    {"Name":"/developercards/prod/webhook-signing-secret","Value":"PLACEHOLDER-7"},
    {"Name":"/developercards/prod/webhook-signing-secret-previous","Value":"PLACEHOLDER-8"},
    {"Name":"/developercards/prod/webhook-signing-secret-sub-12","Value":"PLACEHOLDER-9"},
    {"Name":"/developercards/prod/webhook-signing-secret-sub-12-previous","Value":"PLACEHOLDER-10"},
    {"Name":"/developercards/prod/anthropic-api-key","Value":"PLACEHOLDER-11"}
  ]}'
  out="$(ssm_to_env "$fixture")" || fail "(k) ssm_to_env failed on a runbook leaf"
  jq -e '. == {
    "INTERNAL_SHARED_SECRET":"PLACEHOLDER-1",
    "INTERNAL_SHARED_SECRET_PREVIOUS":"PLACEHOLDER-2",
    "INTERNAL_SECRET_AI_QA_RESULTS":"PLACEHOLDER-3",
    "INTERNAL_SECRET_AI_QA_RESULTS_PREVIOUS":"PLACEHOLDER-4",
    "INTERNAL_SECRET_WEBHOOK_REPORT":"PLACEHOLDER-5",
    "INTERNAL_SECRET_WEBHOOK_REPORT_PREVIOUS":"PLACEHOLDER-6"
  }' <<<"$out" >/dev/null || fail "(k) runbook leaves did not map/skip as expected: $out"
}

# (l) the patterns are anchored: near misses are still unmapped and still a hard error.
test_ssm_to_env_pattern_is_anchored() {
  local leaf err
  for leaf in webhook-signing-secret-sub-abc webhook-signing-secret-sub-12-extra previous stray-previous-name x-webhook-signing-secret-sub-1; do
    if err="$(ssm_to_env "{\"Parameters\":[{\"Name\":\"/developercards/prod/$leaf\",\"Value\":\"PLACEHOLDER-x\"}]}" 2>&1)"; then
      fail "(l) ssm_to_env accepted $leaf"
    fi
    grep -Fq "unmapped SSM parameter: $leaf" <<<"$err" || fail "(l) missing error for $leaf"
  done
}

# (m) an optional env key outlives its leaf only until the next deploy: drop_absent_optional removes it
#     from the live environment when the path no longer carries it, and keeps every other key.
test_drop_absent_optional() {
  local out
  out="$(drop_absent_optional '{"INTERNAL_SHARED_SECRET":"PLACEHOLDER-1","INTERNAL_SHARED_SECRET_PREVIOUS":"PLACEHOLDER-2","INTERNAL_SECRET_AI_QA_RESULTS":"PLACEHOLDER-3","FOO_KEEP":"x"}' '{"INTERNAL_SHARED_SECRET":"PLACEHOLDER-1","INTERNAL_SECRET_AI_QA_RESULTS":"PLACEHOLDER-3"}')"
  jq -e '. == {"INTERNAL_SHARED_SECRET":"PLACEHOLDER-1","INTERNAL_SECRET_AI_QA_RESULTS":"PLACEHOLDER-3","FOO_KEEP":"x"}' <<<"$out" >/dev/null \
    || fail "(m) drop_absent_optional kept a stale optional key or dropped another: $out"
  out="$(drop_absent_optional 'null' '{}')"
  jq -e '. == {}' <<<"$out" >/dev/null || fail "(m) null current broke drop_absent_optional"
}

# (n) R18A A10: the four automation callback leaves map to the four env names core-vpc verifies with.
test_ssm_to_env_automation_leaves() {
  local fixture out
  fixture='{"Parameters":[
    {"Name":"/developercards/prod/source-watch-secret","Value":"PLACEHOLDER-1"},
    {"Name":"/developercards/prod/source-watch-secret-previous","Value":"PLACEHOLDER-2"},
    {"Name":"/developercards/prod/notifier-secret","Value":"PLACEHOLDER-3"},
    {"Name":"/developercards/prod/notifier-secret-previous","Value":"PLACEHOLDER-4"}
  ]}'
  out="$(ssm_to_env "$fixture")" || fail "(n) ssm_to_env failed on the automation leaves"
  jq -e '. == {
    "INTERNAL_SECRET_SOURCE_WATCH":"PLACEHOLDER-1",
    "INTERNAL_SECRET_SOURCE_WATCH_PREVIOUS":"PLACEHOLDER-2",
    "INTERNAL_SECRET_NOTIFIER":"PLACEHOLDER-3",
    "INTERNAL_SECRET_NOTIFIER_PREVIOUS":"PLACEHOLDER-4"
  }' <<<"$out" >/dev/null || fail "(n) automation leaves did not map: $out"
}

# (o) notify-recipient is read by the notifier only: its value never reaches the core env, beside mapped leaves.
test_ssm_to_env_skips_notify_recipient() {
  local fixture out
  fixture='{"Parameters":[
    {"Name":"/developercards/prod/pg-password","Value":"PLACEHOLDER-1"},
    {"Name":"/developercards/prod/notifier-secret","Value":"PLACEHOLDER-2"},
    {"Name":"/developercards/prod/notify-recipient","Value":"PLACEHOLDER-recipient"}
  ]}'
  out="$(ssm_to_env "$fixture")" || fail "(o) ssm_to_env failed beside notify-recipient"
  jq -e '. == {"PGPASSWORD":"PLACEHOLDER-1","INTERNAL_SECRET_NOTIFIER":"PLACEHOLDER-2"}' <<<"$out" >/dev/null \
    || fail "(o) notify-recipient leaked or a mapped leaf was lost: $out"
  if grep -Fq 'PLACEHOLDER-recipient' <<<"$out"; then fail "(o) the notify-recipient value reached the output"; fi
}

# (p) a stray leaf is still a hard error beside the automation leaves.
test_ssm_to_env_unmapped_beside_automation_leaves() {
  local fixture err
  fixture='{"Parameters":[
    {"Name":"/developercards/prod/source-watch-secret","Value":"PLACEHOLDER-1"},
    {"Name":"/developercards/prod/notify-recipient","Value":"PLACEHOLDER-2"},
    {"Name":"/developercards/prod/stray-name","Value":"PLACEHOLDER-x"}
  ]}'
  if err="$(ssm_to_env "$fixture" 2>&1)"; then
    fail "(p) ssm_to_env accepted stray-name beside the automation leaves"
  fi
  grep -Fq 'unmapped SSM parameter: stray-name' <<<"$err" || fail "(p) missing error for stray-name"
}

test_merge_file_over_current
test_merge_secret_over_file
test_ssm_to_env_all_six
test_ssm_to_env_unmapped
test_pick_keys
test_merge_null_current
test_ssm_to_env_skips_not_env_leaves
test_ssm_to_env_unmapped_beside_skipped
test_worker_file_keys_webhook_queue
test_ssm_to_env_rotation_leaf
test_ssm_to_env_runbook_leaves
test_ssm_to_env_pattern_is_anchored
test_drop_absent_optional
test_ssm_to_env_automation_leaves
test_ssm_to_env_skips_notify_recipient
test_ssm_to_env_unmapped_beside_automation_leaves

echo "merge-env tests OK"
