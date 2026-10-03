#!/usr/bin/env bash
# deploy-python-lambda.sh <service> — package one Python Lambda (contract §10.6) and, outside
# DRY_RUN, upload it the src_C/deploy.sh way (lambda-release.sh): if the alias is still on $LATEST
# (first deploy of a Terraform-created function), publish the live code and move the alias to it
# first; overlay the committed non-secret env file onto the live environment, update the code, prove
# CodeSha256 equals the local zip, publish a version, verify it is Active/Successful, then move the
# alias.
#
# The build runs the service's tests first, installs only hash-verified wheels (the hashes in
# uv.lock, --require-hashes), and a real deploy refuses uncommitted changes under services/<svc>
# (the published version records the commit). It prints the one-line alias rollback command.
#
#   DRY_RUN=1 services/deploy-python-lambda.sh webhook-dispatcher   # build + print, never calls aws
#   AWS_PROFILE=devcards-deploy services/deploy-python-lambda.sh webhook-dispatcher   # supervisor only
#
# No secret is ever injected: each Python function reads its SSM parameters at runtime.
# This script never reads SSM and never prints an environment value (key names only).
set -euo pipefail
set +x

usage() {
  echo "usage: $(basename "$0") <webhook-dispatcher|ai-qa|source-watcher|notifier|synthetic-check>" >&2
  echo "  env: ENV (prod), AWS_REGION (ap-southeast-2), AWS_PROFILE (devcards-deploy), PUBLISH_ALIAS (prod), UV, DRY_RUN=1" >&2
  exit 2
}

[ "$#" -eq 1 ] || usage
SERVICE="$1"
case "$SERVICE" in
  webhook-dispatcher) FN="developercards-webhook-dispatcher"; PKG="webhook_dispatcher" ;;
  ai-qa)              FN="developercards-ai-qa";              PKG="ai_qa" ;;
  source-watcher)     FN="developercards-source-watcher";     PKG="source_watcher" ;;
  notifier)           FN="developercards-notifier";           PKG="notifier" ;;
  synthetic-check)    FN="developercards-synthetic-check";    PKG="synthetic_check" ;;
  *) usage ;;
esac

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
ENV="${ENV:-prod}"
REGION="${AWS_REGION:-ap-southeast-2}"
export AWS_PROFILE="${AWS_PROFILE:-devcards-deploy}"
PUBLISH_ALIAS="${PUBLISH_ALIAS:-prod}"
UV="${UV:-uv}"
if ! command -v "$UV" >/dev/null 2>&1; then UV="$HOME/.local/bin/uv"; fi
command -v "$UV" >/dev/null 2>&1 || { echo "uv is required (set UV=/path/to/uv)" >&2; exit 1; }
for tool in jq zip openssl; do
  command -v "$tool" >/dev/null 2>&1 || { echo "$tool is required" >&2; exit 1; }
done

SVC_DIR="$HERE/$SERVICE"
ENV_FILE="$SVC_DIR/env/$ENV.env.json"
BUILD="$SVC_DIR/build"
ZIP="$BUILD/$SERVICE.zip"
MAX_ZIP_BYTES=52428800   # direct-upload limit of update-function-code --zip-file

[ -f "$SVC_DIR/pyproject.toml" ] || { echo "$SVC_DIR/pyproject.toml not found" >&2; exit 1; }
[ -d "$SVC_DIR/src/$PKG" ] || { echo "$SVC_DIR/src/$PKG not found" >&2; exit 1; }
[ -f "$ENV_FILE" ] || { echo "$ENV_FILE not found" >&2; exit 1; }
jq -e 'type == "object" and all(.[]; type == "string")' "$ENV_FILE" >/dev/null 2>&1 \
  || { echo "$ENV_FILE must be a JSON object of strings" >&2; exit 1; }
file_env="$(jq -c . "$ENV_FILE")"

# --- preflight --------------------------------------------------------------------------------
dirty="$(git -C "$ROOT" status --porcelain -- "services/$SERVICE" 2>/dev/null || echo "not a git checkout")"
if [ -n "$dirty" ]; then
  if [ "${DRY_RUN:-0}" = 1 ]; then
    echo "DRY: warning: uncommitted changes under services/$SERVICE (a real deploy refuses this)" >&2
  else
    echo "refusing to deploy: uncommitted changes under services/$SERVICE:" >&2
    echo "$dirty" >&2
    exit 1
  fi
fi

# The tests never call AWS or a model; the credentials are removed anyway.
(cd "$SVC_DIR" && env -u AWS_PROFILE -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY -u AWS_SESSION_TOKEN \
  -u AWS_BEARER_TOKEN_BEDROCK -u ANTHROPIC_API_KEY \
  AWS_CONFIG_FILE=/dev/null AWS_SHARED_CREDENTIALS_FILE=/dev/null AWS_EC2_METADATA_DISABLED=true \
  "$UV" run --frozen --python 3.12 pytest -q) || { echo "tests failed; nothing was built" >&2; exit 1; }

# --- build ------------------------------------------------------------------------------------
rm -rf "$BUILD"
mkdir -p "$BUILD/pkg"
# --no-emit-project: without it the file starts with `-e .` (the project itself, not a dependency).
# The export keeps uv.lock's sha256 hashes and the install refuses any artifact that does not match.
"$UV" export --project "$SVC_DIR" --frozen --no-dev --no-emit-project --quiet > "$BUILD/requirements.txt"
"$UV" pip install --quiet --require-hashes --target "$BUILD/pkg" --python-version 3.12 \
  --python-platform aarch64-manylinux2014 --only-binary :all: -r "$BUILD/requirements.txt"
mkdir -p "$BUILD/pkg"   # uv does not create the target when there is nothing to install
rm -f "$BUILD/pkg/.lock"   # uv's install lock file, not package content
(cd "$SVC_DIR/src" && tar --exclude '__pycache__' --exclude '*.pyc' -cf - "$PKG") | (cd "$BUILD/pkg" && tar -xf -)
(cd "$BUILD/pkg" && zip -qr -X "../$SERVICE.zip" .)

zip_bytes="$(wc -c < "$ZIP" | tr -d ' ')"
if [ "$zip_bytes" -gt "$MAX_ZIP_BYTES" ]; then
  echo "$ZIP is $zip_bytes bytes, above the $MAX_ZIP_BYTES-byte direct-upload limit" >&2
  exit 1
fi

sha_b64() { openssl dgst -sha256 -binary "$1" | openssl base64 -A; }   # Lambda's CodeSha256 is base64(sha256)
local_sha="$(sha_b64 "$ZIP")"

if [ "${DRY_RUN:-0}" = 1 ]; then
  echo "DRY: function $FN (region $REGION, alias $PUBLISH_ALIAS)"
  echo "DRY: zip $ZIP ($zip_bytes bytes, sha256 $local_sha)"
  echo "DRY: $FN env overlay keys: $(jq -r 'keys | join(",")' <<<"$file_env")"
  exit 0
fi

# --- deploy (supervisor only) -----------------------------------------------------------------
command -v aws >/dev/null 2>&1 || { echo "aws CLI is required" >&2; exit 1; }
# shellcheck source=../src_C/scripts/merge-env.sh
source "$ROOT/src_C/scripts/merge-env.sh"
# shellcheck source=lambda-release.sh
source "$HERE/lambda-release.sh"
echo "== $FN <- $ZIP"
# Freeze the live code when the alias is still on $LATEST, update and verify $LATEST, publish and verify
# the version (no invoke), then move the alias and print the rollback (lambda-release.sh).
lambda_release "$FN" "$REGION" "$PUBLISH_ALIAS" "$ZIP" "$local_sha" "$file_env" \
  "deploy-python-lambda.sh $(date -u +%Y-%m-%dT%H:%M:%SZ) $(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo nogit)"
