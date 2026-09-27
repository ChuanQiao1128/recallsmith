# merge-env.sh — sourced library, pure jq, no AWS CLI call, no side effects.
# It is the deploy-time env overlay of E00 §2.6.3: deploy.sh reads the current
# Lambda environment, the committed non-secret file and the decrypted SSM values,
# and merges them ($cur + $file + $sec, later wins) so the two unspellable keys
# and every stray key survive untouched. Values never leave via this file.

# The only place the SSM leaf name → env var name map is written (E00 §2.6.2).
SSM_TO_ENV='{"pg-password":"PGPASSWORD","migrate-secret":"MIGRATE_SECRET","internal-shared-secret":"INTERNAL_SHARED_SECRET","rc-webhook-auth-production":"RC_WEBHOOK_AUTH_PRODUCTION","rc-webhook-auth-development":"RC_WEBHOOK_AUTH_DEVELOPMENT","analytics-salt":"ANALYTICS_USER_SALT"}'
# The internal-secret rows (R18 Z01, cloud-security-resilience-2/-11): the per-route secrets and the
# optional -previous leaves that exist only while a rotation or a cut-over is in progress. Appended to the
# map above (plain string splice, no jq at source time). R18A A10: the source-watch and notifier callback
# secrets (core-vpc verifies both routes); mapped before A10 creates the leaves, because the deploy reads the
# whole path and an unmapped leaf is a hard error.
SSM_TO_ENV_INTERNAL='{"internal-shared-secret-previous":"INTERNAL_SHARED_SECRET_PREVIOUS","ai-qa-results-secret":"INTERNAL_SECRET_AI_QA_RESULTS","ai-qa-results-secret-previous":"INTERNAL_SECRET_AI_QA_RESULTS_PREVIOUS","webhook-report-secret":"INTERNAL_SECRET_WEBHOOK_REPORT","webhook-report-secret-previous":"INTERNAL_SECRET_WEBHOOK_REPORT_PREVIOUS","source-watch-secret":"INTERNAL_SECRET_SOURCE_WATCH","source-watch-secret-previous":"INTERNAL_SECRET_SOURCE_WATCH_PREVIOUS","notifier-secret":"INTERNAL_SECRET_NOTIFIER","notifier-secret-previous":"INTERNAL_SECRET_NOTIFIER_PREVIOUS"}'
SSM_TO_ENV="${SSM_TO_ENV%\}},${SSM_TO_ENV_INTERNAL#\{}"
# Env keys whose SSM leaf may be absent. merge_env keeps every key of the live environment, so without this
# a key would outlive its deleted leaf (a rotation that has ended would keep accepting the old secret).
# deploy.sh drops each of these from the live environment when the path no longer holds its leaf.
SSM_OPTIONAL_ENV='["INTERNAL_SHARED_SECRET_PREVIOUS","INTERNAL_SECRET_AI_QA_RESULTS","INTERNAL_SECRET_AI_QA_RESULTS_PREVIOUS","INTERNAL_SECRET_WEBHOOK_REPORT","INTERNAL_SECRET_WEBHOOK_REPORT_PREVIOUS","INTERNAL_SECRET_SOURCE_WATCH","INTERNAL_SECRET_SOURCE_WATCH_PREVIOUS","INTERNAL_SECRET_NOTIFIER","INTERNAL_SECRET_NOTIFIER_PREVIOUS"]'
# R18C L2 (cloud-security-resilience-9): Terraform seeds every secret leaf with a committed placeholder value until the
# owner's post-apply secret step sets it. An internal-secret leaf (the rows of SSM_TO_ENV_INTERNAL) whose value starts
# with PLACEHOLDER_SECRET_PREFIX or is shorter than MIN_INTERNAL_SECRET_LENGTH is never deployed: drop_placeholder_secrets
# removes it with a warning, and drop_absent_optional then removes a stale copy from the live environment, so core-vpc
# answers "Missing <env>" instead of verifying signatures against a string that is public in the repo.
PLACEHOLDER_SECRET_PREFIX='PLACEHOLDER-'
MIN_INTERNAL_SECRET_LENGTH=32
SSM_PLACEHOLDER_CHECKED_ENV="$(jq -c '[.[]]' <<<"$SSM_TO_ENV_INTERNAL")"
# Leaves read by a Python Lambda at cold start; they never become a core-vpc/worker env var (R18-00 §14 #8).
# webhook-signing-secret-previous exists only while a signing-secret rotation is in progress (dispatcher
# README runbook); deploy.sh reads the whole path, so it must be skipped here or every deploy in that
# window fails (Y01 cloud-security-resilience-10). R18A: notify-recipient (created by A11) is read by the
# notifier only and must never become a core env var.
SSM_NOT_ENV='["webhook-signing-secret","webhook-signing-secret-previous","anthropic-api-key","notify-recipient"]'
# Leaf patterns skipped as well (Z01 cloud-security-resilience-15), so a runbook that creates a rotation or
# per-subscription leaf does not need a new row here first: any unmapped *-previous leaf, and the dispatcher's
# per-subscription signing secrets webhook-signing-secret-sub-<id>[-previous]. A mapped leaf wins over a
# pattern; any other unmapped leaf is still a hard error.
SSM_NOT_ENV_PATTERN='^(.+-previous|webhook-signing-secret-sub-[0-9]+(-previous)?)$'
# R18A A10: AUTOMATION_NOTIFY_QUEUE_URL stays core-vpc only (only core-vpc enqueues emails), so it is not here.
WORKER_FILE_KEYS='["PGUSER","PGSSLMODE","PG_MAX","LOG_LEVEL","WEBHOOK_EVENTS_QUEUE_URL"]'
WORKER_SECRET_KEYS='["PGPASSWORD"]'

# merge_env CURRENT_JSON FILE_JSON SECRETS_JSON
#   → ($cur // {}) + ($file // {}) + ($sec // {}); later wins, every key of
#     CURRENT_JSON that neither overlay names survives. Compact JSON on stdout.
merge_env() {
  jq -cn \
    --argjson cur "${1:-null}" \
    --argjson file "${2:-null}" \
    --argjson sec "${3:-null}" \
    '($cur // {}) + ($file // {}) + ($sec // {})'
}

# ssm_to_env GET_PARAMETERS_BY_PATH_JSON
#   → {ENV_NAME: value} using SSM_TO_ENV on the last path segment of each
#     .Parameters[].Name. A mapped leaf always maps; an unmapped leaf listed in
#     SSM_NOT_ENV or matching SSM_NOT_ENV_PATTERN is skipped (it never becomes
#     an env var); any other unmapped leaf is a hard error.
ssm_to_env() {
  jq -c \
    --argjson map "$SSM_TO_ENV" \
    --argjson skip "$SSM_NOT_ENV" \
    --arg skip_re "$SSM_NOT_ENV_PATTERN" \
    '
    reduce (.Parameters[]?) as $p ({};
      ($p.Name | split("/") | last) as $leaf
      | if $map[$leaf] != null then .[$map[$leaf]] = $p.Value
        elif any($skip[]; . == $leaf) or ($leaf | test($skip_re)) then .
        else error("unmapped SSM parameter: " + $leaf)
        end
    )
    ' <<<"${1:-null}"
}

# drop_placeholder_secrets SECRETS_JSON
#   → SECRETS_JSON without each SSM_PLACEHOLDER_CHECKED_ENV key whose value starts with PLACEHOLDER_SECRET_PREFIX or
#     is shorter than MIN_INTERNAL_SECRET_LENGTH; one warning per dropped key on stderr (the key name, never the value).
drop_placeholder_secrets() {
  local filter dropped key
  filter='.key as $k | (.value | tostring) as $v | ($keys | index($k)) != null and (($v | startswith($p)) or ($v | length) < $min)'
  dropped="$(jq -r --argjson keys "$SSM_PLACEHOLDER_CHECKED_ENV" --arg p "$PLACEHOLDER_SECRET_PREFIX" --argjson min "$MIN_INTERNAL_SECRET_LENGTH" \
    "(. // {}) | to_entries[] | select($filter) | .key" <<<"${1:-null}")" || return 1
  for key in $dropped; do
    echo "warning: $key holds a placeholder or a value shorter than $MIN_INTERNAL_SECRET_LENGTH characters; not deployed (set its SSM leaf first)" >&2
  done
  jq -c --argjson keys "$SSM_PLACEHOLDER_CHECKED_ENV" --arg p "$PLACEHOLDER_SECRET_PREFIX" --argjson min "$MIN_INTERNAL_SECRET_LENGTH" \
    "(. // {}) | with_entries(select(($filter) | not))" <<<"${1:-null}"
}

# drop_absent_optional CURRENT_JSON SECRETS_JSON
#   → CURRENT_JSON without each SSM_OPTIONAL_ENV key that SECRETS_JSON does not
#     carry: the leaf was deleted, so the env var must go too.
drop_absent_optional() {
  jq -c \
    --argjson sec "${2:-null}" \
    --argjson optional "$SSM_OPTIONAL_ENV" \
    '(. // {}) | with_entries(select(.key as $k | ($optional | index($k)) == null or (($sec // {}) | has($k))))' \
    <<<"${1:-null}"
}

# pick_keys JSON KEYS_JSON
#   → the entries of JSON whose key is in KEYS_JSON (missing keys simply absent).
pick_keys() {
  jq -c \
    --argjson keys "${2:-[]}" \
    '(. // {}) | with_entries(select(.key as $k | $keys | index($k)))' \
    <<<"${1:-null}"
}
