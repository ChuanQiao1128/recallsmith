#!/usr/bin/env bash
set -euo pipefail

# Load .env into exported variables (simple KEY=VALUE lines)
ENV_FILE="${ENV_FILE:-.env}"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "❌ Missing $ENV_FILE" >&2
  exit 1
fi

# Export all vars defined in .env
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

# Basic checks (length only)
echo "✅ Loaded env from $ENV_FILE"
echo "BASE=$BASE"
echo "JWT_SUPER_ADMIN length: ${#JWT_SUPER_ADMIN}"
echo "MIGRATE_SECRET length:  ${#MIGRATE_SECRET}"
echo "DEV_SECRET length:      ${#DEV_SECRET}"
echo "PROD_SECRET length:     ${#PROD_SECRET}"