# merge-env.sh — sourced library, pure jq, no AWS CLI call, no side effects.
# It is the deploy-time env overlay of E00 §2.6.3: deploy.sh reads the current
# Lambda environment, the committed non-secret file and the decrypted SSM values,
# and merges them ($cur + $file + $sec, later wins) so the two unspellable keys
# and every stray key survive untouched. Values never leave via this file.

# The only place the SSM leaf name → env var name map is written (E00 §2.6.2).
SSM_TO_ENV='{"pg-password":"PGPASSWORD","migrate-secret":"MIGRATE_SECRET","internal-shared-secret":"INTERNAL_SHARED_SECRET","rc-webhook-auth-production":"RC_WEBHOOK_AUTH_PRODUCTION","rc-webhook-auth-development":"RC_WEBHOOK_AUTH_DEVELOPMENT","analytics-salt":"ANALYTICS_USER_SALT"}'
# Leaves read by a Python Lambda at cold start; they never become a core-vpc/worker env var (R18-00 §14 #8).
# webhook-signing-secret-previous exists only while a signing-secret rotation is in progress (dispatcher
# README runbook); deploy.sh reads the whole path, so it must be skipped here or every deploy in that
# window fails (Y01 cloud-security-resilience-10).
SSM_NOT_ENV='["webhook-signing-secret","webhook-signing-secret-previous","anthropic-api-key"]'
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
#     .Parameters[].Name. A leaf listed in SSM_NOT_ENV is skipped (it never
#     becomes an env var); any other leaf absent from the map is a hard error.
ssm_to_env() {
  jq -c \
    --argjson map "$SSM_TO_ENV" \
    --argjson skip "$SSM_NOT_ENV" \
    '
    reduce (.Parameters[]?) as $p ({};
      ($p.Name | split("/") | last) as $leaf
      | if any($skip[]; . == $leaf) then .
        else
          ($map[$leaf] // error("unmapped SSM parameter: " + $leaf)) as $env
          | .[$env] = $p.Value
        end
    )
    ' <<<"${1:-null}"
}

# pick_keys JSON KEYS_JSON
#   → the entries of JSON whose key is in KEYS_JSON (missing keys simply absent).
pick_keys() {
  jq -c \
    --argjson keys "${2:-[]}" \
    '(. // {}) | with_entries(select(.key as $k | $keys | index($k)))' \
    <<<"${1:-null}"
}
