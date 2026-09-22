#!/usr/bin/env bash
# infra/scripts/rds-snapshot.sh <label> — manual RDS snapshot of the prod instance.
# Supervisor/owner tool (E00 §0): run before every migration / risky apply.
# Workers run it ONLY as DRY_RUN=1 (prints the two commands, calls nothing).
set -euo pipefail
label="${1:-}"
[[ "$label" =~ ^[a-z0-9-]{1,40}$ ]] || { echo "usage: $0 <label>   (label must match ^[a-z0-9-]{1,40}$)" >&2; exit 2; }
DB_ID="${DB_ID:-developercards}"
SNAP="developercards-${label}-$(date -u +%Y%m%d-%H%M)"
if [ "${DRY_RUN:-0}" = "1" ]; then
  echo "DRY_RUN: aws rds create-db-snapshot --db-instance-identifier $DB_ID --db-snapshot-identifier $SNAP"
  echo "DRY_RUN: aws rds wait db-snapshot-available --db-snapshot-identifier $SNAP"
  exit 0
fi
aws rds create-db-snapshot --db-instance-identifier "$DB_ID" --db-snapshot-identifier "$SNAP" --query 'DBSnapshot.DBSnapshotIdentifier' --output text
aws rds wait db-snapshot-available --db-snapshot-identifier "$SNAP"
echo "$SNAP"
