#!/usr/bin/env bash
set -euo pipefail

: "${BASE:?missing BASE}"
: "${JWT_USER:?missing JWT_USER}"
: "${JWT_SUPER_ADMIN:?missing JWT_SUPER_ADMIN}"
: "${SLUG:=react-basics-draft}"
: "${SUB:=f92e84a8-40a1-706e-0ec4-7770890889fe}"

echo ""
echo "== A) prod route must FAIL (sandbox should be rejected) =="
PROD_JSON="$(curl -sS "$BASE/api/v1/content/premium-url?slug=$SLUG&dev=1" \
  -H "Authorization: Bearer $JWT_USER" \
  -H "x-dev-bypass: 1")"
echo "$PROD_JSON" | jq

PROD_SUCCESS="$(echo "$PROD_JSON" | jq -r '.success // false')"
if [ "$PROD_SUCCESS" = "true" ]; then
  echo "❌ Unexpected: prod route succeeded. (This would be unsafe.)"
  exit 1
fi
echo "✅ prod route rejected (expected)"

echo ""
echo "== B) dev route must SUCCEED (dev bypass allowed) =="
DEV_JSON="$(curl -sS "$BASE/api/v1/content/premium-url-dev?slug=$SLUG" \
  -H "Authorization: Bearer $JWT_USER")"
echo "$DEV_JSON" | jq

DEV_SUCCESS="$(echo "$DEV_JSON" | jq -r '.success // false')"
DEV_URL="$(echo "$DEV_JSON" | jq -r '.data.url // ""')"
if [ "$DEV_SUCCESS" != "true" ] || [ -z "$DEV_URL" ]; then
  echo "❌ dev route failed (should succeed)."
  exit 1
fi
echo "✅ dev route ok (got presigned url)"

echo ""
echo "== C) DB view: rc-events (top 10) =="
curl -sS "$BASE/api/v1/admin/db/rc-events" \
  -H "Authorization: Bearer $JWT_SUPER_ADMIN" \
| jq -r '.data.rows[0:10][] | [.mode,.environment,.event_type,.product_id,.received_at] | @tsv'

echo ""
echo "== D) DB view: premium-state for SUB =="
curl -sS "$BASE/api/v1/admin/db/premium-state?user=$SUB" \
  -H "Authorization: Bearer $JWT_SUPER_ADMIN" | jq

echo ""
echo "✅ DONE"