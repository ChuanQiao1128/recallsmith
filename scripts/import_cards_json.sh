#!/usr/bin/env bash
set -eo pipefail

DECK_ID="${1:?deckId required}"
PREFIX="${2:?stableUid prefix required (e.g. reactd)}"
FILE="${3:?json file required}"

: "${BASE:?Missing BASE (run: source scripts/env.sh)}"
: "${JWT_SUPER_ADMIN:?Missing JWT_SUPER_ADMIN (run: source scripts/env.sh)}"

if [[ ! -f "$FILE" ]]; then
  echo "❌ File not found: $FILE" >&2
  exit 1
fi

TMP_EXIST="/tmp/_cards_existing_${DECK_ID}.json"
TMP_EXPANDED="/tmp/_cards_import_expanded_${DECK_ID}.json"

# 1) Fetch existing cards JSON into a file (avoid shell/python quoting issues)
curl -sS "$BASE/api/v1/authoring/cards?deckId=$DECK_ID" \
  -H "Authorization: Bearer $JWT_SUPER_ADMIN" > "$TMP_EXIST"

# 2) Compute next order from file
START_ORDER="$(python3 - <<PY
import json
with open("$TMP_EXIST","r",encoding="utf-8") as f:
    d=json.load(f)
cards=d.get("data") or []
m=0
for c in cards:
    try:
        m=max(m,int(c.get("orderInDeck") or 0))
    except:
        pass
print(m+1)
PY
)"

echo "✅ deckId=$DECK_ID next order starts at $START_ORDER"
echo "✅ importing from $FILE with stableUid prefix '$PREFIX'"

# 3) Expand input cards -> expanded payload list (deckId/stableUid/orderInDeck)
python3 - <<PY > "$TMP_EXPANDED"
import json
from pathlib import Path

cards=json.loads(Path("$FILE").read_text(encoding="utf-8"))
if not isinstance(cards,list):
  raise SystemExit("Input JSON must be an array of card objects")

start=int("$START_ORDER")
out=[]
for idx,c in enumerate(cards):
  if not isinstance(c,dict):
    raise SystemExit(f"Card[{idx}] must be an object")

  q=str(c.get("question","")).strip()
  if not q:
    raise SystemExit(f"Card[{idx}] missing non-empty question")

  n=start+idx
  uid=f"{'$PREFIX'}-{n:03d}"

  out.append({
    "deckId": int("$DECK_ID"),
    "stableUid": uid,
    "orderInDeck": n,
    "difficulty": int(c.get("difficulty",2)),
    "revision": int(c.get("revision",1)),
    "question": q,
    "explanation": (str(c.get("explanation","")).strip() if c.get("explanation") is not None else None),
    "codeLanguage": (str(c.get("codeLanguage","")).strip() if c.get("codeLanguage") else None),
    "codeSnippet": (str(c.get("codeSnippet","")) if c.get("codeSnippet") else None),
    "realWorldUsage": (str(c.get("realWorldUsage","")).strip() if c.get("realWorldUsage") else None),
  })

print(json.dumps(out, ensure_ascii=False))
PY

TOTAL="$(python3 -c "import json; a=json.load(open('$TMP_EXPANDED')); print(len(a))")"
echo "✅ expanded $TOTAL cards -> will insert sequentially"

# 4) Insert one by one
for i in $(seq 0 $((TOTAL-1))); do
  PAYLOAD="$(python3 - <<PY
import json
a=json.load(open("$TMP_EXPANDED"))
import json as j
print(j.dumps(a[$i], ensure_ascii=False))
PY
)"

  CARD_UID="$(python3 - <<PY
import json
a=json.load(open("$TMP_EXPANDED"))
print(a[$i]["stableUid"])
PY
)"

  ORD="$(python3 - <<PY
import json
a=json.load(open("$TMP_EXPANDED"))
print(a[$i]["orderInDeck"])
PY
)"

  echo "-> inserting [$i/$((TOTAL-1))] $CARD_UID (order $ORD)"

  RESP_FILE="/tmp/_cards_import_resp_${DECK_ID}_${i}.json"

  curl -sS -X POST "$BASE/api/v1/authoring/cards" \
    -H "Authorization: Bearer $JWT_SUPER_ADMIN" \
    -H "Content-Type: application/json" \
    -d "$PAYLOAD" > "$RESP_FILE"

  OK="$(python3 - <<PY
import json
with open("$RESP_FILE","r",encoding="utf-8") as f:
  d=json.load(f)
print("1" if d.get("success") else "0")
PY
)"

  if [[ "$OK" != "1" ]]; then
    echo "❌ insert failed at index $i ($CARD_UID)" >&2
    cat "$RESP_FILE" >&2
    exit 2
  fi
done

echo "✅ import complete: inserted $TOTAL cards into deckId=$DECK_ID"