#!/usr/bin/env bash
# invoke-as-admin.sh — supervisor tool; trust boundary = IAM lambda:InvokeFunction;
# Auth.cs trusts gateway-shaped claims by design (review §2.1.1).
#
# Invokes a Lambda with a hand-built HTTP API v2 event carrying super_admin claims, the way
# API Gateway would once an authorizer is attached. Used to drive the super_admin-only admin
# routes (e.g. POST /api/v1/admin/db/bootstrap-roles) from the deploy host.
#
#   scripts/invoke-as-admin.sh <function[:qualifier]> <METHOD> <path> [body-file]
#   MIGRATE_SECRET=… scripts/invoke-as-admin.sh core-vpc:prod POST /api/v1/admin/db/bootstrap-roles roles.json
#   DRY_RUN=1 scripts/invoke-as-admin.sh core-vpc:prod POST /api/v1/admin/db/ping   # print, no AWS call
set -euo pipefail

if [ "$#" -lt 3 ]; then
  echo "usage: scripts/invoke-as-admin.sh <function[:qualifier]> <METHOD> <path> [body-file]" >&2
  exit 2
fi

FN="$1"; METHOD="$2"; APATH="$3"; BODY_FILE="${4:-}"

command -v jq >/dev/null || { echo "jq is required" >&2; exit 1; }

BODY=""
if [ -n "$BODY_FILE" ]; then BODY="$(cat "$BODY_FILE")"; fi

# content-type always; x-migrate-secret only when MIGRATE_SECRET is set in the environment —
# the secret comes from the environment, never from argv.
headers="$(jq -n \
  --arg ms "${MIGRATE_SECRET:-}" \
  '{"content-type":"application/json"} + (if $ms == "" then {} else {"x-migrate-secret":$ms} end)')"
header_names="$(jq -r 'keys | join(",")' <<<"$headers")"

if [ "${DRY_RUN:-0}" = 1 ]; then
  echo "DRY: aws lambda invoke --function-name $FN $METHOD $APATH headers: $header_names"
  exit 0
fi

event="$(jq -n \
  --arg method "$METHOD" \
  --arg path "$APATH" \
  --argjson headers "$headers" \
  --arg body "$BODY" \
  '{
    version: "2.0",
    routeKey: "$default",
    rawPath: $path,
    rawQueryString: "",
    headers: $headers,
    requestContext: {
      http: { method: $method, path: $path },
      authorizer: { jwt: { claims: { "sub": "supervisor", "cognito:groups": "[super_admin]", "token_use": "access" } } }
    },
    body: (if $body == "" then null else $body end),
    isBase64Encoded: false
  }')"

out="$(mktemp)"
trap 'rm -f "$out"' EXIT
aws lambda invoke --region "${AWS_REGION:-ap-southeast-2}" --function-name "$FN" --cli-binary-format raw-in-base64-out --payload "$event" "$out" >/dev/null
jq -r '.statusCode // empty' "$out" >&2
jq -r '.body // .' "$out"
